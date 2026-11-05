import { GoogleGenerativeAI, type Content, type FunctionCall, type GenerativeModel, type Part } from "@google/generative-ai";
import { toolInputSchemas } from "../schemas/tool-inputs.js";
import { mcpToolsToGemini } from "./gemini-tools.js";
import type { CountryMcpClient } from "./mcp-client.js";

export const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `Sos un asistente que responde preguntas sobre países.
Reglas:
- Respondé sobre países usando EXCLUSIVAMENTE los datos que devuelven las herramientas disponibles. No uses tu conocimiento propio para datos como capitales, poblaciones, regiones o países limítrofes.
- Si necesitás datos de varios países, pedilos todos juntos en una misma respuesta (llamadas en paralelo) y recién después respondé. Por ejemplo, para comparar los limítrofes de un país: primero get_country_neighbors y después get_country_info de todos los limítrofes a la vez.
- Los nombres de países se pasan a las herramientas en inglés (ej: "Brazil", "Germany").
- Si una herramienta devuelve un error, explicalo con claridad; no inventes el dato.
- Si la consulta no tiene que ver con países o ninguna herramienta permite responderla, decí amablemente que no podés ayudar con eso y contá qué tipo de preguntas sí podés responder.
- Respondé en español, de forma breve y clara.`;

export interface AgentStep {
  iteration: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  iterations: number;
  history: Content[];
}

export class CountryAgent {
  private genAI: GoogleGenerativeAI;

  constructor(
    private mcp: CountryMcpClient,
    apiKey: string,
    private modelName: string,
    private fallbackModelName?: string
  ) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private buildModel(modelName: string) {
    return this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
      // Las herramientas salen de tools/list, no de una lista escrita a mano
      tools: [{ functionDeclarations: mcpToolsToGemini(this.mcp.tools) }],
    });
  }

  /** Ejecuta una llamada propuesta por el modelo: valida con Zod y recién ahí invoca vía MCP. */
  private async executeCall(call: FunctionCall, iteration: number, steps: AgentStep[]): Promise<Part> {
    const args = (call.args ?? {}) as Record<string, unknown>;
    let ok = false;
    let result: unknown;

    const schema = toolInputSchemas[call.name];
    const validation = schema ? schema.safeParse(args) : { success: true as const };

    if (!this.mcp.tools.some((tool) => tool.name === call.name)) {
      result = { code: "UNKNOWN_TOOL", message: `La herramienta ${call.name} no existe.` };
    } else if (!validation.success) {
      result = {
        code: "INVALID_INPUT",
        message: validation.error.issues.map((issue) => issue.message).join(" "),
      };
    } else {
      try {
        const outcome = await this.mcp.callTool(call.name, args);
        ok = !outcome.isError;
        result = outcome.data;
      } catch (error) {
        result = { code: "MCP_ERROR", message: error instanceof Error ? error.message : String(error) };
      }
    }

    steps.push({ iteration, tool: call.name, args, ok, result });
    console.log(`[agent] iteración ${iteration} → ${call.name}(${JSON.stringify(args)}) ${ok ? "OK" : "ERROR"}`);

    // La observación vuelve al modelo como functionResponse
    return {
      functionResponse: {
        name: call.name,
        response: ok ? { result } : { error: result },
      },
    };
  }

  /** Llama a un modelo reintentando ante saturación temporal (429/500/503). */
  private async generateWith(modelName: string, contents: Content[]) {
    const model = this.buildModel(modelName);
    const delays = [1000, 3000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await model.generateContent({ contents });
      } catch (error) {
        const status = (error as { status?: number }).status;
        const retryable = status === 429 || status === 500 || status === 503;
        if (!retryable || attempt >= delays.length) throw error;
        console.log(`[agent] ${modelName} respondió ${status}: reintento ${attempt + 1} de ${delays.length}`);
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  /** Usa el modelo principal y, si está saturado o no disponible, el modelo de respaldo. */
  private async generate(contents: Content[]) {
    try {
      return await this.generateWith(this.modelName, contents);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const switchable = status === 404 || status === 429 || status === 500 || status === 503;
      if (switchable && this.fallbackModelName && this.fallbackModelName !== this.modelName) {
        console.log(`[agent] ${this.modelName} no disponible (${status}): uso ${this.fallbackModelName}`);
        try {
          return await this.generateWith(this.fallbackModelName, contents);
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      const finalStatus = (error as { status?: number }).status;
      if (finalStatus === 429 || finalStatus === 500 || finalStatus === 503) {
        throw new Error("Gemini está con mucha demanda en este momento. Probá de nuevo en unos segundos.");
      }
      throw error;
    }
  }

  async run(question: string, history: Content[] = []): Promise<AgentResult> {
    // Estado: el historial completo (usuario, llamadas, observaciones y respuestas) se reenvía en cada iteración
    const contents: Content[] = [...history, { role: "user", parts: [{ text: question }] }];
    const steps: AgentStep[] = [];

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      const { response } = await this.generate(contents);
      const modelContent = response.candidates?.[0]?.content;
      if (!modelContent?.parts?.length) {
        return {
          answer: "No pude generar una respuesta para esa consulta. Probá reformularla.",
          steps,
          iterations: iteration,
          history: contents,
        };
      }
      // Se guarda tal cual vino (incluye metadatos que Gemini necesita en la próxima vuelta)
      contents.push({ ...modelContent, role: "model" });

      const calls = response.functionCalls() ?? [];
      if (calls.length === 0) {
        return { answer: response.text().trim(), steps, iterations: iteration, history: contents };
      }

      const observations: Part[] = [];
      for (const call of calls) {
        observations.push(await this.executeCall(call, iteration, steps));
      }
      // La API actual de Gemini espera las observaciones con rol "user" (el rol "function" ya no se acepta)
      contents.push({ role: "user", parts: observations });
    }

    return {
      answer: `Alcancé el límite de ${MAX_ITERATIONS} iteraciones sin llegar a una respuesta final. Probá reformular la pregunta o dividirla en partes más simples.`,
      steps,
      iterations: MAX_ITERATIONS,
      history: contents,
    };
  }
}

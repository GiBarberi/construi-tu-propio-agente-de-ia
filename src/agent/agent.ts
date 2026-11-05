import { GoogleGenerativeAI, type Content, type FunctionCall, type Part } from "@google/generative-ai";
import { toolInputSchemas } from "../schemas/tool-inputs.js";
import { mcpToolsToGemini } from "./gemini-tools.js";
import type { CountryMcpClient } from "./mcp-client.js";

export const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `Sos un asistente que responde preguntas sobre países.
Reglas:
- Respondé sobre países usando EXCLUSIVAMENTE los datos que devuelven las herramientas disponibles. No uses tu conocimiento propio para datos como capitales, poblaciones, regiones o países limítrofes.
- Si necesitás varios datos, llamá a las herramientas las veces que haga falta (podés hacer varias llamadas en paralelo) antes de responder.
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
    private modelName: string
  ) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private buildModel() {
    return this.genAI.getGenerativeModel({
      model: this.modelName,
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

  async run(question: string, history: Content[] = []): Promise<AgentResult> {
    // El ChatSession mantiene el historial: mensaje del usuario, llamadas, observaciones y respuestas
    const chat = this.buildModel().startChat({ history });
    const steps: AgentStep[] = [];
    let message: string | Part[] = question;

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      const { response } = await chat.sendMessage(message);
      const calls = response.functionCalls() ?? [];

      if (calls.length === 0) {
        return { answer: response.text().trim(), steps, iterations: iteration, history: await chat.getHistory() };
      }

      message = [];
      for (const call of calls) {
        message.push(await this.executeCall(call, iteration, steps));
      }
    }

    return {
      answer: `Alcancé el límite de ${MAX_ITERATIONS} iteraciones sin llegar a una respuesta final. Probá reformular la pregunta o dividirla en partes más simples.`,
      steps,
      iterations: MAX_ITERATIONS,
      history: await chat.getHistory(),
    };
  }
}

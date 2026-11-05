import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { CountryInputSchema } from "./schemas/country-input.schema.js";
import { getCountryInfo } from "./services/countries.service.js";
import { getCountryNeighbors } from "./services/neighbors.service.js";
import type { ZodTypeAny } from "zod";

// En stdio, stdout es el canal de JSON-RPC: todo el logging va a stderr
const log = (message: string) => console.error(`[country-agent-server] ${message}`);

// La descripción del parámetro sale del esquema de la Preentrega 1: un solo contrato
const countryNameDescription = CountryInputSchema.shape.countryName.description;

const countryInputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    countryName: { type: "string", minLength: 2, description: countryNameDescription },
  },
  required: ["countryName"],
  additionalProperties: false,
};

type ServiceResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

// Registro de herramientas: definición MCP + esquema Zod + lógica de negocio (importada)
const tools: Array<{ definition: Tool; schema: ZodTypeAny; handler: (input: any) => Promise<ServiceResult> }> = [
  {
    definition: {
      name: "get_country_info",
      description:
        "Obtiene la capital, la población y la región de un país a partir de su nombre común en inglés. " +
        "Usala cuando el usuario pregunte por la capital, la cantidad de habitantes o el continente/región de un país concreto. " +
        "Devuelve un JSON con name, capital, population y region, o un error descriptivo si el país no existe.",
      inputSchema: countryInputSchema,
    },
    schema: CountryInputSchema,
    handler: getCountryInfo,
  },
  {
    definition: {
      name: "get_country_neighbors",
      description:
        "Obtiene la lista de países limítrofes (con los que comparte frontera terrestre) de un país, a partir de su nombre común en inglés. " +
        "Usala cuando el usuario pregunte por vecinos, fronteras o países limítrofes. " +
        "Devuelve un JSON con country y neighbors (código y nombre de cada limítrofe). Una lista vacía significa que no tiene fronteras terrestres.",
      inputSchema: countryInputSchema,
    },
    schema: CountryInputSchema,
    handler: getCountryNeighbors,
  },
];

// Respuestas en el formato de contenido que espera MCP
const toolSuccess = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const toolError = (code: string, message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ code, message }, null, 2) }],
});

const server = new Server(
  { name: "country-agent-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// tools/list: anuncia las herramientas con su nombre, descripción e inputSchema
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("tools/list");
  return { tools: tools.map((tool) => tool.definition) };
});

// tools/call: valida → ejecuta la lógica de negocio → devuelve el resultado
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  log(`tools/call ${name} ${JSON.stringify(args ?? {})}`);

  const tool = tools.find((item) => item.definition.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Herramienta desconocida: ${name}`);
  }

  // 1. Validación antes de ejecutar: si no cumple el contrato, nunca llega al fetch
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    log(`argumentos inválidos: ${message}`);
    return toolError("INVALID_INPUT", message);
  }

  // 2. Ejecución: la lógica de negocio se importa, no se reescribe
  try {
    const result = await tool.handler(parsed.data);
    if (!result.ok) {
      log(`error ${result.error.code}: ${result.error.message}`);
      return toolError(result.error.code, result.error.message);
    }
    return toolSuccess(result.data);
  } catch (error) {
    // Red de seguridad: ninguna excepción corta la sesión MCP
    const message = error instanceof Error ? error.message : String(error);
    log(`error inesperado: ${message}`);
    return toolError("UNEXPECTED_ERROR", message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("servidor iniciado por stdio");
}

main().catch((error) => {
  log(`no se pudo iniciar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

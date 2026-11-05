import type { FunctionDeclaration, FunctionDeclarationSchema } from "@google/generative-ai";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Gemini acepta un subconjunto de JSON Schema: nos quedamos solo con esas claves
const ALLOWED_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "format", "nullable"]);

function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      clean.properties = Object.fromEntries(
        Object.entries(value).map(([prop, propSchema]) => [prop, toGeminiSchema(propSchema)])
      );
    } else if (key === "items") {
      clean.items = toGeminiSchema(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/** Transforma las herramientas descubiertas por MCP al formato de function declarations de Gemini. */
export function mcpToolsToGemini(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: toGeminiSchema(tool.inputSchema) as FunctionDeclarationSchema,
  }));
}

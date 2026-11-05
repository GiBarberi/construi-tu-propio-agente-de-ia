import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// El host lanza el servidor MCP de la Preentrega 2 como subproceso y habla con él por stdio
const SERVER_PATH = fileURLToPath(new URL("../server.js", import.meta.url));

export interface ToolCallOutcome {
  isError: boolean;
  data: unknown;
}

export class CountryMcpClient {
  private client = new Client({ name: "country-agent-host", version: "1.0.0" });
  tools: Tool[] = [];

  async connect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH],
      // Por defecto el SDK no pasa todas las variables: el servidor necesita RESTCOUNTRIES_API_KEY
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
      stderr: "inherit",
    });
    await this.client.connect(transport);

    // Descubrimiento dinámico: el host no conoce las herramientas de antemano
    const { tools } = await this.client.listTools();
    this.tools = tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((item): item is { type: "text"; text: string } => item?.type === "text")
      .map((item) => item.text)
      .join("\n");

    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // si no es JSON, se devuelve el texto tal cual
    }
    return { isError: Boolean(result.isError), data };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

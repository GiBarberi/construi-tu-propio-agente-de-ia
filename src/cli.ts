// Uso local por consola: npm run cli
import { createInterface } from "node:readline/promises";
import type { Content } from "@google/generative-ai";
import { CountryAgent } from "./agent/agent.js";
import { CountryMcpClient } from "./agent/mcp-client.js";
import { loadHostEnv } from "./config/env.js";

const envResult = loadHostEnv();
if (!envResult.ok) {
  console.error(`Configuración inválida: ${envResult.error}`);
  process.exit(1);
}

const mcp = new CountryMcpClient();
await mcp.connect();
console.log(`Herramientas descubiertas: ${mcp.tools.map((tool) => tool.name).join(", ")}`);
console.log('Escribí tu pregunta (o "salir").\n');

const agent = new CountryAgent(mcp, envResult.env.GEMINI_API_KEY, envResult.env.GEMINI_MODEL);
const rl = createInterface({ input: process.stdin, output: process.stdout });
let history: Content[] = [];

while (true) {
  const question = (await rl.question("Vos: ")).trim();
  if (!question) continue;
  if (question.toLowerCase() === "salir") break;

  try {
    const result = await agent.run(question, history);
    history = result.history;
    console.log(`\nAgente: ${result.answer}\n`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

rl.close();
await mcp.close();

// Levanta el servidor MCP por stdio, le envía mensajes JSON-RPC y muestra el intercambio.
// Uso: npm run build && node scripts/mcp-exchange.mjs
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "evidence-client", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_country_info", arguments: { countryName: "Argentina" } },
  },
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_country_info", arguments: { countryName: "Invernalia" } },
  },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "get_country_info", arguments: { countryName: "A" } },
  },
];

const titles = {
  1: "initialize (handshake)",
  2: "tools/list",
  3: "tools/call — país válido",
  4: "tools/call — país inexistente",
  5: "tools/call — argumentos inválidos",
};

const server = spawn("node", ["dist/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
const lines = createInterface({ input: server.stdout });

lines.on("line", (line) => {
  const response = JSON.parse(line); // si hubiera un console.log en stdout, esto fallaría
  pending.get(response.id)?.(response);
});

const send = (message) =>
  new Promise((resolve) => {
    if (message.id !== undefined) pending.set(message.id, resolve);
    server.stdin.write(JSON.stringify(message) + "\n");
    if (message.id === undefined) resolve(null);
  });

const out = [];
for (const message of messages) {
  const response = await send(message);
  if (!response) continue;
  out.push(
    `### ${titles[message.id]}`,
    "",
    "→ Cliente",
    JSON.stringify(message, null, 2),
    "",
    "← Servidor",
    JSON.stringify(response, null, 2),
    ""
  );
}

server.kill();
console.log(out.join("\n").trim());

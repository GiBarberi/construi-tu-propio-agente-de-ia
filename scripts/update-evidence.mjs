// Genera la evidencia real y la pega en el README:
// - Preentrega 1: salida de `npm run demo`
// - Preentrega 2: intercambio JSON-RPC con el servidor MCP por stdio
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const run = (command) => execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function replaceBlock(readme, marker, content) {
  const start = `<!-- ${marker}:inicio -->`;
  const end = `<!-- ${marker}:fin -->`;
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`No encontré los marcadores "${marker}" en el README.`);
  }
  return readme.slice(0, startIndex) + `${start}\n\n${content}\n\n${end}` + readme.slice(endIndex + end.length);
}

execSync("npm run build", { stdio: "ignore" });

const demo = run("npx tsx src/demo.ts");
const exchange = run("node scripts/mcp-exchange.mjs");

let readme = readFileSync("README.md", "utf8");
readme = replaceBlock(readme, "evidencia", "```text\n$ npm run demo\n" + demo + "\n```");
readme = replaceBlock(readme, "evidencia-mcp", "```text\n$ node scripts/mcp-exchange.mjs\n\n" + exchange + "\n```");
writeFileSync("README.md", readme);

console.log(demo + "\n\n" + exchange);
console.log("\n✔ README actualizado con la evidencia de las preentregas 1 y 2.");

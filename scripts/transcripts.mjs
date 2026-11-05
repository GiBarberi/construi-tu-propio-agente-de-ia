// Conversa con el agente desplegado y pega las transcripciones en DEPLOY.md.
// Uso: node scripts/transcripts.mjs https://tu-servicio.onrender.com
import { readFileSync, writeFileSync } from "node:fs";

const baseUrl = (process.argv[2] ?? "").replace(/\/$/, "");
if (!baseUrl.startsWith("http")) {
  console.error("Pasá la URL del agente desplegado. Ej: npm run transcripts -- https://country-agent.onrender.com");
  process.exit(1);
}

const conversations = [
  { title: "Conversación 1 — Consulta de varios pasos", question: "¿Cuál de los países limítrofes de Brasil tiene mayor población?" },
  { title: "Conversación 2 — Consulta fuera de alcance", question: "¿Cómo hago una pizza?" },
];

async function ask(message) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

// El plan gratuito de Render hiberna: el primer pedido despierta el servicio
console.log(`Despertando ${baseUrl}…`);
await fetch(`${baseUrl}/health`).catch(() => {});

const timestamp = new Date().toISOString();
const blocks = [`Generado el ${timestamp} contra \`${baseUrl}\`.`];

for (const { title, question } of conversations) {
  console.log(`\n→ ${question}`);
  const result = await ask(question);

  const lines = [`Usuario: ${question}`, ""];
  if (result.steps.length === 0) {
    lines.push("[herramientas] Ninguna: el agente no invocó herramientas.");
  } else {
    for (const step of result.steps) {
      lines.push(`[iteración ${step.iteration}] ${step.tool}(${JSON.stringify(step.args)}) → ${step.ok ? "OK" : "ERROR"}`);
      lines.push(`    resultado: ${JSON.stringify(step.result)}`);
    }
  }
  lines.push("", `Agente: ${result.answer}`, "", `(iteraciones del modelo: ${result.iterations})`);

  const text = lines.join("\n");
  console.log(text);
  blocks.push(`### ${title}\n\n\`\`\`text\n${text}\n\`\`\``);
}

const START = "<!-- transcripciones:inicio -->";
const END = "<!-- transcripciones:fin -->";
const deploy = readFileSync("DEPLOY.md", "utf8");
const startIndex = deploy.indexOf(START);
const endIndex = deploy.indexOf(END);
if (startIndex === -1 || endIndex === -1) throw new Error("No encontré los marcadores en DEPLOY.md");

writeFileSync(
  "DEPLOY.md",
  deploy.slice(0, startIndex) + `${START}\n\n${blocks.join("\n\n")}\n\n${END}` + deploy.slice(endIndex + END.length)
);
console.log("\n✔ DEPLOY.md actualizado con las transcripciones.");

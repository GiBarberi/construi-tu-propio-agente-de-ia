// Corre el demo y pega su salida real en la sección "## Evidencia" del README.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const START = "<!-- evidencia:inicio -->";
const END = "<!-- evidencia:fin -->";

const output = execSync("npx tsx src/demo.ts", { encoding: "utf8" }).trim();
const readme = readFileSync("README.md", "utf8");

const startIndex = readme.indexOf(START);
const endIndex = readme.indexOf(END);
if (startIndex === -1 || endIndex === -1) {
  console.error("No encontré los marcadores de evidencia en el README.");
  process.exit(1);
}

const block = `${START}\n\n\`\`\`text\n$ npm run demo\n${output}\n\`\`\`\n\n${END}`;
writeFileSync("README.md", readme.slice(0, startIndex) + block + readme.slice(endIndex + END.length));

console.log(output);
console.log("\n✔ README actualizado con la salida del demo.");

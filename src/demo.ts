import { getCountryInfo } from "./services/countries.service.js";

const scenarios: Array<{ title: string; input: unknown }> = [
  { title: "Escenario 1 — País válido", input: { countryName: "  Argentina  " } },
  { title: "Escenario 2 — País inexistente", input: { countryName: "Invernalia" } },
  { title: "Escenario 3 — Entrada inválida", input: { countryName: "A" } },
];

for (const { title, input } of scenarios) {
  const result = await getCountryInfo(input);
  console.log(`\n=== ${title} ===`);
  console.log("Entrada:", JSON.stringify(input));
  console.log("Resultado:", JSON.stringify(result, null, 2));
}

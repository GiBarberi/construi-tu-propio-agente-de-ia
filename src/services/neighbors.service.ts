import { CountryInputSchema } from "../schemas/country-input.schema.js";
import { CountryNeighborsSchema, type CountryNeighbors } from "../schemas/country-neighbors.schema.js";
import { fail, fetchCountryObjects, findCountryRecord, type ServiceError } from "./countries.service.js";

export type NeighborsResult = { ok: true; data: CountryNeighbors } | ServiceError;

/**
 * Traduce códigos alpha-3 (ej: "ARG") a nombres comunes.
 * Primero trae todos los países de la región en un solo pedido; los que falten
 * (limítrofes de otra región) se buscan uno por uno.
 */
async function resolveCodes(codes: string[], region: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const sameRegion = await fetchCountryObjects(`/region/${encodeURIComponent(region)}?limit=100`);
  if (sameRegion.ok) {
    for (const item of sameRegion.objects) {
      const code = item?.codes?.alpha_3;
      const name = item?.names?.common;
      if (typeof code === "string" && typeof name === "string") names.set(code, name);
    }
  }

  for (const code of codes) {
    if (names.has(code)) continue;
    const single = await fetchCountryObjects(`/codes.alpha_3/${encodeURIComponent(code)}`);
    const name = single.ok ? single.objects[0]?.names?.common : undefined;
    if (typeof name === "string") names.set(code, name);
  }

  return names;
}

export async function getCountryNeighbors(input: unknown): Promise<NeighborsResult> {
  // ── Tramo 1: validar y normalizar la entrada (mismo contrato que get_country_info) ──
  const parsedInput = CountryInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return fail("INVALID_INPUT", parsedInput.error.issues.map((issue) => issue.message).join(" "));
  }

  // ── Tramo 2: consultar el país y resolver los códigos de sus limítrofes ────────
  const found = await findCountryRecord(parsedInput.data.countryName);
  if (!found.ok) return found;

  const record = found.record;
  const codes: string[] = Array.isArray(record?.borders)
    ? record.borders.filter((code: unknown): code is string => typeof code === "string")
    : [];
  const names = codes.length > 0 ? await resolveCodes(codes, String(record?.region ?? "")) : new Map();

  // ── Tramo 3: validar y normalizar la salida ────────────────────────────────────
  const parsedOutput = CountryNeighborsSchema.safeParse({
    country: record?.names?.common,
    neighbors: codes.map((code) => ({ code, name: names.get(code) ?? code })),
  });
  if (!parsedOutput.success) {
    const message = parsedOutput.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ");
    return fail("INVALID_RESPONSE", `La respuesta de la API no cumple el contrato. ${message}`);
  }

  return { ok: true, data: parsedOutput.data };
}

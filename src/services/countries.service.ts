import { loadEnv } from "../config/env.js";
import { CountryInputSchema } from "../schemas/country-input.schema.js";
import { CountryOutputSchema, type Country } from "../schemas/country-output.schema.js";

// REST Countries v3.1 fue deprecada: usamos la v5, que requiere API key (plan gratuito)
const BASE_URL = "https://api.restcountries.com/countries/v5/names.common";
const TIMEOUT_MS = 8000;

export type CountryErrorCode =
  | "INVALID_INPUT"
  | "CONFIG_ERROR"
  | "NOT_FOUND"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export type CountryResult =
  | { ok: true; data: Country }
  | { ok: false; error: { code: CountryErrorCode; message: string } };

const fail = (code: CountryErrorCode, message: string): CountryResult => ({
  ok: false,
  error: { code, message },
});

const notFound = (countryName: string) =>
  fail("NOT_FOUND", `No se encontró el país '${countryName}'. Verificá el nombre (en inglés, ej: 'France').`);

/**
 * Mapea un registro crudo de la v5 (sin confiar en su forma) al contrato de salida.
 * No valida: solo arma el candidato que después revisa CountryOutputSchema.
 */
function toCandidate(raw: any): unknown {
  const capitals = Array.isArray(raw?.capitals) ? raw.capitals : [];
  const capital = capitals.find((item: any) => item?.primary) ?? capitals[0];
  return {
    name: raw?.names?.common,
    capital: typeof capital === "string" ? capital : capital?.name,
    population: raw?.population,
    region: raw?.region,
  };
}

export async function getCountryInfo(input: unknown): Promise<CountryResult> {
  // ── Tramo 1: validar y normalizar la entrada ─────────────────────────
  const parsedInput = CountryInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const message = parsedInput.error.issues.map((issue) => issue.message).join(" ");
    return fail("INVALID_INPUT", message);
  }
  const { countryName } = parsedInput.data;

  const env = loadEnv();
  if (!env.ok) return fail("CONFIG_ERROR", env.error);

  // ── Tramo 2: consultar REST Countries ───────────────────────────────
  let body: any;
  try {
    const url = `${BASE_URL}?q=${encodeURIComponent(countryName)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.env.RESTCOUNTRIES_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 404) return notFound(countryName);
    if (response.status === 401 || response.status === 403) {
      return fail("API_ERROR", `REST Countries rechazó la API key (HTTP ${response.status}). Revisá RESTCOUNTRIES_API_KEY.`);
    }
    if (response.status === 429) {
      return fail("API_ERROR", "REST Countries limitó las consultas (HTTP 429). Probá de nuevo en unos segundos.");
    }
    if (!response.ok) {
      return fail("API_ERROR", `REST Countries respondió con error HTTP ${response.status}.`);
    }

    body = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NETWORK_ERROR", `No se pudo consultar REST Countries: ${detail}`);
  }

  // ── Tramo 3: validar y normalizar la salida ──────────────────────────
  // La v5 devuelve los resultados en data.objects
  const objects = body?.data?.objects;
  if (!Array.isArray(objects)) {
    return fail("INVALID_RESPONSE", "REST Countries devolvió una respuesta con un formato inesperado.");
  }
  if (objects.length === 0) return notFound(countryName);

  // La búsqueda es parcial ("India" puede traer más de un país): priorizamos la coincidencia exacta
  const match =
    objects.find((item: any) => String(item?.names?.common ?? "").toLowerCase() === countryName) ??
    objects[0];

  const parsedOutput = CountryOutputSchema.safeParse(toCandidate(match));
  if (!parsedOutput.success) {
    const message = parsedOutput.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" | ");
    return fail("INVALID_RESPONSE", `La respuesta de la API no cumple el contrato. ${message}`);
  }

  // Siempre el objeto normalizado, nunca la respuesta cruda
  return { ok: true, data: parsedOutput.data };
}

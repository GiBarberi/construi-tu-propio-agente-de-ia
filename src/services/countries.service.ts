import { CountryInputSchema } from "../schemas/country-input.schema.js";
import { CountryOutputSchema, type Country } from "../schemas/country-output.schema.js";

const BASE_URL = "https://restcountries.com/v3.1/name";
// Pedimos solo los campos del contrato: menos datos, menos tokens para el modelo
const FIELDS = "name,capital,population,region";
const TIMEOUT_MS = 8000;

export type CountryErrorCode =
  | "INVALID_INPUT"
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

/**
 * Mapea la respuesta cruda (sin confiar en su forma) al contrato de salida.
 * No valida: solo arma el candidato que después revisa CountryOutputSchema.
 */
function toCandidate(raw: any): unknown {
  return {
    name: raw?.name?.common,
    capital: Array.isArray(raw?.capital) ? raw.capital[0] : raw?.capital,
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

  // ── Tramo 2: consultar REST Countries ───────────────────────────────
  let body: unknown;
  try {
    const url = `${BASE_URL}/${encodeURIComponent(countryName)}?fields=${FIELDS}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (response.status === 404) {
      return fail(
        "NOT_FOUND",
        `No se encontró el país '${countryName}'. Verificá el nombre (en inglés, ej: 'France').`
      );
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
  if (!Array.isArray(body) || body.length === 0) {
    return fail("INVALID_RESPONSE", "REST Countries devolvió una respuesta vacía o inesperada.");
  }

  // La búsqueda por nombre es parcial: priorizamos la coincidencia exacta
  const match =
    body.find((item: any) => String(item?.name?.common ?? "").toLowerCase() === countryName) ??
    body[0];

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

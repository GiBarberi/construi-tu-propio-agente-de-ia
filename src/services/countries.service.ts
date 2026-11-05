import { loadEnv } from "../config/env.js";
import { CountryInputSchema } from "../schemas/country-input.schema.js";
import { CountryOutputSchema, type Country } from "../schemas/country-output.schema.js";

// REST Countries v3.1 fue deprecada: usamos la v5, que requiere API key (plan gratuito)
const API_URL = "https://api.restcountries.com/countries/v5";
const TIMEOUT_MS = 8000;

export type CountryErrorCode =
  | "INVALID_INPUT"
  | "CONFIG_ERROR"
  | "NOT_FOUND"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export type ServiceError = { ok: false; error: { code: CountryErrorCode; message: string } };
export type CountryResult = { ok: true; data: Country } | ServiceError;

export const fail = (code: CountryErrorCode, message: string): ServiceError => ({
  ok: false,
  error: { code, message },
});

const notFound = (countryName: string) =>
  fail("NOT_FOUND", `No se encontró el país '${countryName}'. Verificá el nombre (en inglés, ej: 'France').`);

/**
 * GET a la v5 con manejo de errores HTTP y de red.
 * Devuelve la lista cruda de data.objects (sin validar su contenido).
 */
// Caché en memoria: la API limita a 20 pedidos cada 10 segundos y el agente puede consultar varios países seguidos
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { objects: any[]; expiresAt: number }>();

export async function fetchCountryObjects(path: string): Promise<{ ok: true; objects: any[] } | ServiceError> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, objects: cached.objects };

  const result = await requestCountryObjects(path);
  if (result.ok) cache.set(path, { objects: result.objects, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function requestCountryObjects(path: string): Promise<{ ok: true; objects: any[] } | ServiceError> {
  const env = loadEnv();
  if (!env.ok) return fail("CONFIG_ERROR", env.error);

  let body: any;
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.env.RESTCOUNTRIES_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 404) return { ok: true, objects: [] };
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

  // La v5 devuelve los resultados en data.objects
  const objects = body?.data?.objects;
  if (!Array.isArray(objects)) {
    return fail("INVALID_RESPONSE", "REST Countries devolvió una respuesta con un formato inesperado.");
  }
  return { ok: true, objects };
}

/** Busca por nombre común (parcial) y prioriza la coincidencia exacta. */
export async function findCountryRecord(countryName: string): Promise<{ ok: true; record: any } | ServiceError> {
  const result = await fetchCountryObjects(`/names.common?q=${encodeURIComponent(countryName)}`);
  if (!result.ok) return result;
  if (result.objects.length === 0) return notFound(countryName);

  // La búsqueda es parcial ("India" puede traer más de un país)
  const record =
    result.objects.find((item: any) => String(item?.names?.common ?? "").toLowerCase() === countryName) ??
    result.objects[0];
  return { ok: true, record };
}

/**
 * Mapea un registro crudo de la v5 (sin confiar en su forma) al contrato de salida.
 * No valida: solo arma el candidato que después revisa CountryOutputSchema.
 */
function toCandidate(raw: any): unknown {
  const capitals = Array.isArray(raw?.capitals) ? raw.capitals : [];
  const capital =
    capitals.find((item: any) => item?.attributes?.primary || item?.primary) ?? capitals[0];
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

  // ── Tramo 2: consultar REST Countries ───────────────────────────────
  const found = await findCountryRecord(parsedInput.data.countryName);
  if (!found.ok) return found;

  // ── Tramo 3: validar y normalizar la salida ──────────────────────────
  const parsedOutput = CountryOutputSchema.safeParse(toCandidate(found.record));
  if (!parsedOutput.success) {
    const message = parsedOutput.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" | ");
    return fail("INVALID_RESPONSE", `La respuesta de la API no cumple el contrato. ${message}`);
  }

  // Siempre el objeto normalizado, nunca la respuesta cruda
  return { ok: true, data: parsedOutput.data };
}

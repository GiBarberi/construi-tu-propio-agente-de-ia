import type { ZodTypeAny } from "zod";
import { CountryInputSchema } from "./country-input.schema.js";

/**
 * Esquemas Zod con los que el host valida los argumentos que propone el modelo
 * ANTES de invocar la herramienta vía MCP. No es la lista de herramientas (esa se
 * descubre dinámicamente con tools/list): si una tool descubierta no figura acá,
 * la validación queda a cargo del servidor, que de todos modos valida siempre.
 */
export const toolInputSchemas: Record<string, ZodTypeAny> = {
  get_country_info: CountryInputSchema,
  get_country_neighbors: CountryInputSchema,
};

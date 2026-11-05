import { z } from "zod";

/**
 * Contrato de entrada: el argumento que más adelante va a enviar el modelo.
 * Las descripciones están pensadas para que un LLM entienda cómo completar el campo.
 */
export const CountryInputSchema = z
  .object({
    countryName: z
      .string({
        required_error: "Falta el campo countryName.",
        invalid_type_error: "countryName debe ser un texto.",
      })
      .trim()
      .min(2, "countryName debe tener al menos 2 caracteres.")
      .transform((value) => value.toLowerCase())
      .describe(
        "Nombre común del país en inglés, por ejemplo 'Argentina', 'France' o 'Japan'."
      ),
  })
  .describe("Datos necesarios para consultar la información básica de un país.");

/** Lo que recibe el servicio (antes de validar). */
export type CountryInputRaw = z.input<typeof CountryInputSchema>;

/** Lo que queda después de validar y normalizar (trim + minúsculas). */
export type CountryInput = z.infer<typeof CountryInputSchema>;

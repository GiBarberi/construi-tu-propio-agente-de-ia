import { z } from "zod";

/**
 * Contrato de salida: el objeto limpio que el sistema devuelve,
 * sin importar cómo venga la respuesta cruda de REST Countries.
 */
export const CountryOutputSchema = z.object({
  name: z.string().min(1, "El nombre del país vino vacío."),
  capital: z.string().min(1, "La capital vino vacía."),
  population: z
    .number({ invalid_type_error: "La población debe ser un número." })
    .refine((value) => value >= 0, {
      message: "La población no puede ser negativa.",
    }),
  region: z.string().min(1, "La región vino vacía."),
});

export type Country = z.infer<typeof CountryOutputSchema>;

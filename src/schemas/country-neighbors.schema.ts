import { z } from "zod";

/** Contrato de salida de get_country_neighbors: el país y sus limítrofes con nombre legible. */
export const CountryNeighborsSchema = z.object({
  country: z.string().min(1, "El nombre del país vino vacío."),
  neighbors: z.array(
    z.object({
      code: z.string().length(3, "El código de país debe tener 3 letras."),
      name: z.string().min(1, "El nombre del país limítrofe vino vacío."),
    })
  ),
});

export type CountryNeighbors = z.infer<typeof CountryNeighborsSchema>;

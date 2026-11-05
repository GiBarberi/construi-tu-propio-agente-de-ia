import { config } from "dotenv";
import { z } from "zod";

// quiet: true → dotenv no escribe nada en stdout (en stdio, stdout es el canal de JSON-RPC)
config({ quiet: true });

/**
 * Variables de entorno validadas con Zod.
 * - RESTCOUNTRIES_API_KEY: necesaria desde que REST Countries pasó a la v5.
 * - GEMINI_API_KEY: queda lista para el Proyecto Final.
 */
const EnvSchema = z.object({
  RESTCOUNTRIES_API_KEY: z
    .string({ required_error: "Falta RESTCOUNTRIES_API_KEY en el archivo .env." })
    .trim()
    .min(1, "Falta RESTCOUNTRIES_API_KEY en el archivo .env."),
  GEMINI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): { ok: true; env: Env } | { ok: false; error: string } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  return { ok: true, env: parsed.data };
}

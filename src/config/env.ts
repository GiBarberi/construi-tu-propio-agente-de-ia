import "dotenv/config";
import { z } from "zod";

/**
 * Variables de entorno validadas con Zod.
 * Todavía no se usan en esta preentrega: quedan listas para conectar Gemini en el Proyecto Final.
 */
const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "Falta GEMINI_API_KEY en el archivo .env."),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): { ok: true; env: Env } | { ok: false; error: string } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  return { ok: true, env: parsed.data };
}

import { config } from "dotenv";
import { z } from "zod";

// quiet: true → dotenv no escribe nada en stdout (en stdio, stdout es el canal de JSON-RPC)
config({ quiet: true });

const required = (name: string) =>
  z
    .string({ required_error: `Falta ${name} en las variables de entorno.` })
    .trim()
    .min(1, `Falta ${name} en las variables de entorno.`);

/** Lo que necesita el servidor MCP (capa de datos). */
const ServerEnvSchema = z.object({
  RESTCOUNTRIES_API_KEY: required("RESTCOUNTRIES_API_KEY"),
});

/** Lo que necesita el host (agente + servidor HTTP). */
const HostEnvSchema = ServerEnvSchema.extend({
  GEMINI_API_KEY: required("GEMINI_API_KEY"),
  // gemini-1.5-flash fue dado de baja por Google: el alias apunta siempre al Flash vigente
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-flash-latest"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type HostEnv = z.infer<typeof HostEnvSchema>;

type EnvResult<T> = { ok: true; env: T } | { ok: false; error: string };

function validate<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): EnvResult<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  return { ok: true, env: parsed.data };
}

export const loadEnv = (): EnvResult<ServerEnv> => validate(ServerEnvSchema);
export const loadHostEnv = (): EnvResult<HostEnv> => validate(HostEnvSchema);

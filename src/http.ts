import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Content } from "@google/generative-ai";
import { z } from "zod";
import { CountryAgent, MAX_ITERATIONS } from "./agent/agent.js";
import { CountryMcpClient } from "./agent/mcp-client.js";
import { loadHostEnv } from "./config/env.js";

// ── 1. Validación de entorno al arranque: si falta algo, se corta acá ──────
const envResult = loadHostEnv();
if (!envResult.ok) {
  console.error(`[startup] Configuración inválida: ${envResult.error}`);
  process.exit(1);
}
const env = envResult.env;

const PAGE = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

// Estado de las conversaciones (en memoria): sessionId → historial de Gemini
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, { history: Content[]; updatedAt: number }>();

const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, "El mensaje no puede estar vacío.").max(500, "El mensaje es demasiado largo."),
  sessionId: z.string().uuid().optional(),
});

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Body demasiado grande.");
  }
  return raw ? JSON.parse(raw) : {};
}

async function main() {
  console.log("[startup] Iniciando country-agent…");
  console.log(`[startup] Modelo: ${env.GEMINI_MODEL} (respaldo: ${env.GEMINI_FALLBACK_MODEL}) · máximo de iteraciones: ${MAX_ITERATIONS}`);

  // ── 2. Cliente MCP: lanza el servidor y descubre sus herramientas ────────
  const mcp = new CountryMcpClient();
  await mcp.connect();
  console.log(`[startup] Conectado a country-agent-server por stdio`);
  console.log(`[startup] Herramientas descubiertas (tools/list): ${mcp.tools.map((tool) => tool.name).join(", ")}`);

  const agent = new CountryAgent(mcp, env.GEMINI_API_KEY, env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL);

  // ── 3. Servidor HTTP ─────────────────────────────────────────────────────
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(PAGE);
      }

      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { status: "ok", tools: mcp.tools.map((tool) => tool.name) });
      }

      if (req.method === "POST" && req.url === "/api/chat") {
        const parsed = ChatRequestSchema.safeParse(await readBody(req));
        if (!parsed.success) {
          return sendJson(res, 400, { error: parsed.error.issues.map((issue) => issue.message).join(" ") });
        }

        const sessionId = parsed.data.sessionId ?? randomUUID();
        const previous = sessions.get(sessionId)?.history ?? [];
        console.log(`[chat] ${sessionId.slice(0, 8)} · "${parsed.data.message}"`);

        const result = await agent.run(parsed.data.message, previous);
        sessions.set(sessionId, { history: result.history, updatedAt: Date.now() });

        return sendJson(res, 200, {
          sessionId,
          answer: result.answer,
          iterations: result.iterations,
          steps: result.steps,
        });
      }

      sendJson(res, 404, { error: "Ruta no encontrada." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[error] ${message}`);
      sendJson(res, 500, { error: `El agente no pudo procesar la consulta: ${message}` });
    }
  });

  // Limpieza de sesiones viejas
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60_000).unref();

  server.listen(env.PORT, () => {
    console.log(`[startup] Agente escuchando en el puerto ${env.PORT}`);
  });

  const shutdown = async () => {
    console.log("[shutdown] Cerrando…");
    server.close();
    await mcp.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(`[startup] No se pudo iniciar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

# Construí tu propio agente de IA — Agente de países

Agente de IA que responde preguntas sobre países en lenguaje natural. **Gemini** decide qué herramientas usar, el host las invoca a través de un **servidor MCP** propio y el servidor consulta la **[REST Countries API](https://restcountries.com)** con validación **Zod** de punta a punta. El agente no inventa datos: todo lo que responde sale de las herramientas.

| Etapa | Qué agrega |
| --- | --- |
| Preentrega 1 | Capa de datos validada con Zod (`getCountryInfo`) |
| Preentrega 2 | Servidor MCP `country-agent-server` por stdio |
| **Entrega final** | Host con Gemini, bucle de razonamiento, servidor HTTP y despliegue en Render ([DEPLOY.md](DEPLOY.md)) |

> **Notas de versiones.**
> - REST Countries deprecó la v3.1 que usaba el curso (ahora responde un aviso en lugar de datos). El servicio usa la **v5**, que requiere una API key gratuita (`RESTCOUNTRIES_API_KEY`).
> - Google dio de baja `gemini-1.5-flash` en septiembre de 2025. El modelo se configura con `GEMINI_MODEL`, y su valor por defecto, `gemini-flash-latest`, es el alias que apunta siempre al Flash vigente. Se sigue usando el SDK `@google/generative-ai` que pide la consigna.

## Herramientas expuestas por el servidor MCP

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `get_country_info` | `countryName` (string, inglés, mínimo 2 caracteres) | `{ name, capital, population, region }` |
| `get_country_neighbors` | `countryName` (string, inglés, mínimo 2 caracteres) | `{ country, neighbors: [{ code, name }] }` |

Las dos validan la entrada con `CountryInputSchema` y la salida con su esquema Zod. Ante cualquier error devuelven `isError: true` con `{ code, message }`, sin cortar la sesión MCP.

## Flujo del agente

```
Usuario ──► POST /api/chat ──► CountryAgent (Gemini)
                                  │
             ┌────────────────────┤  bucle de razonamiento (máx. 5 iteraciones)
             │                    ▼
             │        Gemini decide: ¿responder o llamar herramientas?
             │                    │ functionCall(s)
             │                    ▼
             │        Validación Zod de los argumentos (host)
             │                    │
             │                    ▼
             │        Cliente MCP ──stdio──► country-agent-server ──► REST Countries v5
             │                    │
             │                    ▼  observación (functionResponse)
             └──── se agrega al historial y vuelve a decidir
                                  │ texto final
                                  ▼
                               Respuesta
```

1. **Arranque.** Se validan las variables de entorno y, si falta alguna, la app se corta con un mensaje claro. El host lanza el servidor MCP como subproceso y llama a `tools/list`.
2. **Descubrimiento dinámico.** Las herramientas descubiertas se transforman al formato de *function declarations* de Gemini (`src/agent/gemini-tools.ts`). No hay una lista escrita a mano.
3. **Decisión.** Gemini recibe la pregunta con un *system prompt* que lo obliga a responder sobre países solo con las herramientas, y a admitir cuando una consulta queda fuera de alcance.
4. **Ejecución.** Cada llamada propuesta se valida con Zod (`src/schemas/tool-inputs.ts`) y recién ahí se invoca vía MCP.
5. **Observación.** El resultado vuelve al modelo como `functionResponse` y queda en el historial. El ciclo se repite hasta obtener la respuesta final o llegar al tope de **5 iteraciones**, y en ese caso devuelve un mensaje claro.
6. **Estado.** El historial se conserva entre iteraciones y también entre mensajes de una misma sesión (`sessionId`), así se pueden hacer preguntas de seguimiento.

Por ejemplo, "¿Cuál de los países limítrofes de Brasil tiene mayor población?" se resuelve en 3 iteraciones:
1. `get_country_neighbors("Brazil")`.
2. `get_country_info` de los 10 limítrofes, en paralelo.
3. La respuesta final.

## Estructura

```
src/
├── schemas/                       # Contratos Zod
│   ├── country-input.schema.ts    #   entrada (también es el contrato de las tools MCP)
│   ├── country-output.schema.ts   #   salida de get_country_info
│   ├── country-neighbors.schema.ts#   salida de get_country_neighbors
│   └── tool-inputs.ts             #   esquemas con los que el host valida los argumentos del modelo
├── services/                      # Lógica de negocio (REST Countries v5)
│   ├── countries.service.ts
│   └── neighbors.service.ts
├── agent/                         # Host
│   ├── mcp-client.ts              #   cliente MCP: lanza el servidor y descubre las tools
│   ├── gemini-tools.ts            #   tools MCP → function declarations de Gemini
│   └── agent.ts                   #   bucle de razonamiento con tope de iteraciones
├── config/env.ts                  # Variables de entorno validadas al arranque
├── server.ts                      # Servidor MCP (stdio)
├── http.ts                        # Servidor HTTP: página de chat, /api/chat y /health
├── cli.ts                         # Chat por consola para uso local
└── demo.ts                        # Demo de la capa de datos (Preentrega 1)
public/index.html                  # Interfaz web del agente
render.yaml                        # Configuración del despliegue en Render
scripts/                           # Generación de evidencia
DEPLOY.md                          # Evidencia del despliegue
```

## Correrlo localmente

Requiere Node.js 20 o superior.

```bash
git clone https://github.com/GiBarberi/construi-tu-propio-agente-de-ia.git
cd construi-tu-propio-agente-de-ia
npm install
cp .env.example .env     # completá GEMINI_API_KEY y RESTCOUNTRIES_API_KEY
npm run build
npm start                # abre http://localhost:3000
```

| Comando | Qué hace |
| --- | --- |
| `npm start` | Servidor HTTP del agente (`node dist/http.js`) |
| `npm run cli` | Chat con el agente por consola |
| `npm run mcp-server` | Solo el servidor MCP por stdio |
| `npm run inspector` | MCP Inspector conectado al servidor |
| `npm run demo` | Demo de la capa de datos (Preentrega 1) |
| `npm run evidence` | Regenera la evidencia de las preentregas en este README |
| `npm run transcripts -- <URL>` | Conversa con el agente desplegado y pega las transcripciones en DEPLOY.md |

### API HTTP

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"¿Cuál es la capital de Japón?"}'
```

La respuesta incluye `answer`, `sessionId` (se reenvía para continuar la conversación), `iterations` y `steps`, con cada herramienta invocada, sus argumentos y su resultado.

### Usar el servidor MCP desde Claude Desktop

```json
{
  "mcpServers": {
    "country-agent-server": {
      "command": "node",
      "args": ["/ruta/absoluta/al/repo/dist/server.js"],
      "env": { "RESTCOUNTRIES_API_KEY": "tu_clave" }
    }
  }
}
```

## Detalle de las preentregas

### Preentrega 1 — Contrato de datos

- **Entrada:** `countryName` es un string con `.trim()`, mínimo 2 caracteres, pasado a minúsculas con `.transform()`.
- **Salida:** `name`, `capital`, `population` y `region`. La población tiene un `.refine()` que no la deja ser negativa.
- **Manejo de errores:** toda validación usa `safeParse`. `getCountryInfo` devuelve `{ ok: true, data }` o `{ ok: false, error: { code, message } }`.

### Preentrega 2 — Servidor MCP

- **Identidad:** `country-agent-server` 1.0.0, con la capacidad `tools` y transporte `StdioServerTransport`.
- **Ejecución:** valida antes de ejecutar e importa la lógica de negocio en lugar de reescribirla.
- **Errores y logs:** los errores vuelven con `isError: true` y todo el logging va a `stderr`.


## Evidencia de las preentregas

La evidencia del despliegue de la entrega final está en [DEPLOY.md](DEPLOY.md). Lo que sigue es la evidencia de las preentregas 1 y 2, tal como se entregó en su momento: en la Preentrega 2 el servidor exponía una sola herramienta.

### Preentrega 1 — Salida de `npm run demo`

Tres escenarios: país válido, país inexistente y entrada inválida.

<!-- evidencia:inicio -->

```text
$ npm run demo
=== Escenario 1 — País válido ===
Entrada: {"countryName":"  Argentina  "}
Resultado: {
  "ok": true,
  "data": {
    "name": "Argentina",
    "capital": "Buenos Aires",
    "population": 46466688,
    "region": "Americas"
  }
}

=== Escenario 2 — País inexistente ===
Entrada: {"countryName":"Invernalia"}
Resultado: {
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "No se encontró el país 'invernalia'. Verificá el nombre (en inglés, ej: 'France')."
  }
}

=== Escenario 3 — Entrada inválida ===
Entrada: {"countryName":"A"}
Resultado: {
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "countryName debe tener al menos 2 caracteres."
  }
}
```

<!-- evidencia:fin -->

### Preentrega 2 — Intercambio JSON-RPC por stdio

Handshake, `tools/list` y tres llamadas a `tools/call`: país válido, país inexistente y argumentos inválidos.

<!-- evidencia-mcp:inicio -->

```text
$ node scripts/mcp-exchange.mjs

### initialize (handshake)

→ Cliente
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "evidence-client",
      "version": "1.0.0"
    }
  }
}

← Servidor
{
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "country-agent-server",
      "version": "1.0.0"
    }
  },
  "jsonrpc": "2.0",
  "id": 1
}

### tools/list

→ Cliente
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}

← Servidor
{
  "result": {
    "tools": [
      {
        "name": "get_country_info",
        "description": "Obtiene la capital, la población y la región de un país a partir de su nombre común en inglés. Usala cuando el usuario pregunte por la capital, la cantidad de habitantes o el continente/región de un país concreto. Devuelve un JSON con name, capital, population y region, o un error descriptivo si el país no existe.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "countryName": {
              "type": "string",
              "minLength": 2,
              "description": "Nombre común del país en inglés, por ejemplo 'Argentina', 'France' o 'Japan'."
            }
          },
          "required": [
            "countryName"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 2
}

### tools/call — país válido

→ Cliente
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_country_info",
    "arguments": {
      "countryName": "Argentina"
    }
  }
}

← Servidor
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"name\": \"Argentina\",\n  \"capital\": \"Buenos Aires\",\n  \"population\": 46466688,\n  \"region\": \"Americas\"\n}"
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 3
}

### tools/call — país inexistente

→ Cliente
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "get_country_info",
    "arguments": {
      "countryName": "Invernalia"
    }
  }
}

← Servidor
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"code\": \"NOT_FOUND\",\n  \"message\": \"No se encontró el país 'invernalia'. Verificá el nombre (en inglés, ej: 'France').\"\n}"
      }
    ],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 4
}

### tools/call — argumentos inválidos

→ Cliente
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_country_info",
    "arguments": {
      "countryName": "A"
    }
  }
}

← Servidor
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"code\": \"INVALID_INPUT\",\n  \"message\": \"countryName debe tener al menos 2 caracteres.\"\n}"
      }
    ],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 5
}
```

<!-- evidencia-mcp:fin -->

### Preentrega 2 — MCP Inspector

![MCP Inspector ejecutando get_country_info](docs/mcp-inspector.png)

El Inspector se conectó a `country-agent-server`, listó la herramienta (`tools/list` OK) y ejecutó `get_country_info` con `Argentina` (`tools/call` OK). Los errores en `resources/list` y `prompts/list` son esperables: el servidor declara solo la capacidad `tools`, así que rechaza los métodos de capacidades que no ofrece.

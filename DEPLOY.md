# Despliegue — Agente de países en Render

El agente corre como un **Web Service de Render** (plan gratuito). En un mismo contenedor corren las dos piezas:

- **El host** (`node dist/http.js`): servidor HTTP, Gemini y bucle de razonamiento.
- **El servidor MCP** (`dist/server.js`): el host lo lanza como subproceso y se comunica con él por **stdio**.

Como las dos piezas viven en el mismo contenedor, no hace falta un túnel ni exponer el servidor MCP a internet.

## 1. URL pública

**https://PENDIENTE.onrender.com**

El plan gratuito de Render hiberna el servicio tras 15 minutos sin uso, y el primer pedido después de eso tarda unos 30 a 60 segundos en responder. Por eso la evidencia verificable está en las secciones siguientes, commiteada en este repositorio.

## 2. Archivo de configuración del hosting

[`render.yaml`](render.yaml), en la raíz del repositorio:

```yaml
services:
  - type: web
    name: country-agent
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: GEMINI_MODEL
        value: gemini-flash-latest
      - key: GEMINI_API_KEY
        sync: false
      - key: RESTCOUNTRIES_API_KEY
        sync: false
```

- `npm ci` instala exactamente las versiones del `package-lock.json` commiteado.
- `npm start` ejecuta el archivo transpilado (`node dist/http.js`), no el de desarrollo.
- Los secretos (`sync: false`) se cargan a mano en el panel de Render y nunca entran al repositorio.
- `healthCheckPath` hace que Render solo dé el servicio por activo cuando `/health` responde, es decir, cuando el host ya se conectó al servidor MCP.

## 3. Panel del hosting

![Panel de Render con el servicio activo](docs/render-panel.png)

## 4. Logs de arranque en Render

<!-- logs:inicio -->

```text
PENDIENTE: pegar los logs de arranque copiados del panel de Render.
```

<!-- logs:fin -->

## 5. Transcripción de conversaciones con el agente desplegado

Generadas con `npm run transcripts -- <URL>`, que envía las preguntas al agente desplegado y registra qué herramientas invocó, con qué argumentos y qué devolvieron.

<!-- transcripciones:inicio -->

_PENDIENTE: ejecutar `npm run transcripts -- https://PENDIENTE.onrender.com`._

<!-- transcripciones:fin -->

## Cómo reproducir el despliegue

1. En Render: **New → Blueprint** y elegí este repositorio. Render lee `render.yaml`.
2. Cargá `GEMINI_API_KEY` y `RESTCOUNTRIES_API_KEY` cuando el panel las pida.
3. Render corre `npm ci && npm run build` y después `npm start`. El servicio queda activo cuando `/health` responde `200`.

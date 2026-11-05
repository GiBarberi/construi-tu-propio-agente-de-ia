# Agente de IA — Preentrega 1: Contrato de datos

Capa de datos validada del agente: recibe el nombre de un país, lo valida y normaliza con Zod, consulta la [REST Countries API](https://restcountries.com) y devuelve siempre un objeto limpio y tipado, o un error descriptivo. Nunca lanza una excepción sin capturar.

Es la base de las próximas etapas: en la Preentrega 2 `getCountryInfo` se expone como herramienta MCP y en el Proyecto Final Gemini la usa como motor de razonamiento.

## Estructura

```
src/
├── schemas/
│   ├── country-input.schema.ts    # Contrato de entrada (lo que va a mandar el modelo)
│   └── country-output.schema.ts   # Contrato de salida (el objeto limpio)
├── services/
│   └── countries.service.ts       # getCountryInfo: validar → consultar → validar salida
├── config/
│   └── env.ts                     # GEMINI_API_KEY validada con Zod (para el Proyecto Final)
└── demo.ts                        # Tres escenarios de prueba
scripts/
└── update-evidence.mjs            # Corre el demo y pega la salida en este README
```

## Contratos

**Entrada (`CountryInputSchema`)**

| Campo | Regla |
| --- | --- |
| `countryName` | string, `.trim()`, mínimo 2 caracteres, pasado a minúsculas con `.transform()` |

**Salida (`CountryOutputSchema`)**

| Campo | Tipo | Regla |
| --- | --- | --- |
| `name` | string | no vacío |
| `capital` | string | no vacío |
| `population` | number | `.refine()`: no puede ser negativa |
| `region` | string | no vacío |

Los dos esquemas exportan sus tipos con `z.infer`, así el contrato vive en un solo lugar.

## Cómo funciona `getCountryInfo`

1. **Validar la entrada** con `CountryInputSchema.safeParse()`. Si falla, devuelve `INVALID_INPUT`.
2. **Consultar REST Countries** pidiendo solo los campos del contrato (`?fields=name,capital,population,region`). El 404 devuelve `NOT_FOUND`, otros códigos HTTP devuelven `API_ERROR` y los problemas de red o timeout devuelven `NETWORK_ERROR`.
3. **Validar y normalizar la salida** con `CountryOutputSchema.safeParse()`. Si la API cambia su formato, devuelve `INVALID_RESPONSE` en lugar de romperse.

El resultado siempre tiene la misma forma:

```ts
{ ok: true,  data: { name, capital, population, region } }
{ ok: false, error: { code, message } }
```

En todo el proyecto no se usa `.parse()`: toda validación pasa por `.safeParse()`.

## Uso

Requiere Node.js 18 o superior.

```bash
npm install
cp .env.example .env   # opcional en esta etapa: completá GEMINI_API_KEY
npm run demo           # corre los tres escenarios
npm run typecheck      # verifica los tipos con TypeScript
npm run evidence       # corre el demo y actualiza la sección Evidencia
```

## Evidencia

Salida real de `npm run demo` con los tres escenarios: país válido, país inexistente y entrada inválida.

<!-- evidencia:inicio -->

_Pendiente: ejecutar `npm run evidence` para pegar acá la salida de consola._

<!-- evidencia:fin -->

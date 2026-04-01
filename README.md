# Tesseract

Manifest-first SDK generator — turns `sdk-manifold/v1` manifests into production-ready TypeScript SDKs.

Tesseract is **not** an OpenAPI parser. It consumes a purpose-built manifest format designed specifically for SDK generation, producing fully typed, batteries-included TypeScript packages.

## Install

```bash
npm install -g @apollo-deploy/tesseract
# or
bun add -g @apollo-deploy/tesseract
```

## Quick Start

```bash
tesseract generate -i manifest.json -o ./sdk
```

This reads your manifest and produces a complete npm-ready SDK in `./sdk/`.

## CLI

```
tesseract generate [options]
```

| Flag | Required | Description |
|------|----------|-------------|
| `-i, --input <path>` | Yes | Path to the `sdk-manifold/v1` manifest JSON file |
| `-o, --output <dir>` | Yes | Output directory for the generated SDK |
| `-n, --name <name>` | No | Override the npm package name |
| `--client-name <name>` | No | Override the generated client class name |
| `--base-url <url>` | No | Override the default base URL |

## Input: The Manifest

Tesseract consumes a `BackendManifest` JSON file with schema `"sdk-manifold/v1"`:

```json
{
  "schema": "sdk-manifold/v1",
  "info": {
    "title": "My API",
    "version": "1.0.0",
    "description": "An example API",
    "baseUrl": "https://api.example.com"
  },
  "domains": [
    {
      "name": "users",
      "prefix": "/users",
      "stability": "stable",
      "routes": [
        {
          "method": "GET",
          "url": "/:id",
          "schema": {
            "params": { "id": { "type": "string" } },
            "response": { "200": { "$ref": "#/definitions/User" } }
          },
          "sdk": { "methodName": "get" }
        }
      ]
    }
  ],
  "definitions": {
    "User": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" }
      }
    }
  }
}
```

### Key Manifest Fields

- **`info`** — Title, version, description, and base URL for the API
- **`domains`** — Groups of routes organized by domain, each with a prefix, stability level (`stable` / `experimental` / `internal`), and route definitions
- **`definitions`** — JSON Schema definitions for shared types
- **`schemaPackage`** _(optional)_ — An external npm package to import types from instead of generating them

### Route Configuration

Each route in a domain can specify:

- **`method`** / **`url`** — HTTP method and Fastify-style URL pattern (`:param`)
- **`schema`** — JSON Schemas for params, query, body, headers, and response
- **`sdk`** — SDK-specific config: method name override, transport type (`json` | `multipart` | `binary` | `stream`), exclusion flags
- **`sse: true`** — Marks the route as a Server-Sent Events stream

## Output

Tesseract generates a complete, publishable npm package:

```
sdk/
├── package.json
├── tsconfig.json
├── README.md
├── index.ts
└── src/
    ├── client.ts              # Main client with config, auth, plugins
    ├── transport/
    │   ├── axios.ts           # HTTP transport with retries, telemetry
    │   └── sse.ts             # SSE streaming transport (if needed)
    ├── domain/
    │   ├── users.ts           # Domain-grouped API methods
    │   └── ...
    ├── types/
    │   ├── models.ts          # Interfaces, type aliases, enums
    │   ├── common.ts          # Pagination, error envelope
    │   ├── errors.ts          # SDKError class
    │   └── index.ts           # Barrel export
    ├── utils/
    │   └── query.ts           # Query parameter utilities
    └── webhooks/
        └── handler.ts         # Typed webhook registry (if needed)
```

### Generated SDK Features

- **Typed client** with grouped domain methods
- **Automatic retries** with exponential backoff, jitter, and customizable retry logic
- **Configurable timeouts** at both transport and per-request level
- **Security scheme support** — API key, Bearer, OAuth2, OpenID Connect
- **Plugin system** — `SDKPlugin` hooks for request/response/error interception
- **Telemetry hooks** — `onRequest`, `onResponse`, `onError` with timing data
- **Idempotency keys** on mutating requests
- **SSE streaming** — Typed `AsyncIterable<SSEEvent<T>>` with automatic reconnection, heartbeat detection, and buffer overflow protection
- **Webhook handlers** — Typed event registry with HMAC verification, replay protection, handler timeouts, and one-time handlers
- **AbortSignal support** for request cancellation
- **Per-request overrides** — timeout, headers, retry config

### Example Usage of Generated SDK

```typescript
import { createMyApiClient } from './sdk';

const client = createMyApiClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'sk_...',
  timeoutMs: 10000,
  retries: { attempts: 3, backoffMs: 500, jitter: true },
  plugins: [{
    name: 'logger',
    beforeRequest(config) {
      console.log('→', config.method, config.url);
    },
  }],
  onError({ method, url, error, attempt, willRetry }) {
    console.error(`${method} ${url} failed (attempt ${attempt}, retry: ${willRetry})`);
  },
});

// Typed domain methods
const user = await client.users.get('user_123');

// Per-request overrides
const result = await client.orders.list(
  { page: 1, limit: 20 },
  { timeoutMs: 30000, retries: { attempts: 5 } },
);

// SSE streaming
for await (const event of client.events.stream({ signal: controller.signal })) {
  console.log(event.type, event.data);
}

// Webhooks
client.webhooks.on('orderCreated', async (payload, meta) => {
  console.log('New order:', payload.id);
});
```

## Pipeline

Tesseract processes manifests through three stages:

1. **Intake** — Reads and validates the manifest, converts it to an intermediate representation (SDKIR). Handles JSON Schema → TypeScript type conversion, parameter extraction, and domain grouping. Internal-stability domains are filtered out.

2. **Enrich** — Augments the SDKIR with a symbol table, import graph, topologically sorted schemas (with cycle detection), render decisions (interface / type alias / enum / union), method signatures, and doc blocks.

3. **Write** — Diff-aware file writer. Only overwrites files whose content has actually changed, making it safe for CI/CD regeneration.

### Code Generation Approach

Tesseract uses a dual strategy:

- **[ts-morph](https://ts-morph.com/)** (AST-based) for type definitions — interfaces, enums, type aliases
- **[Handlebars](https://handlebarsjs.com/)** templates for everything else — client, transport, domain methods, utilities

All output is formatted with Prettier.

## Programmatic API

```typescript
import { generate } from '@apollo-deploy/tesseract';

await generate({
  input: './manifest.json',
  output: './sdk',
  language: 'typescript',
  packageName: '@my-org/api-sdk',
  clientName: 'MyApi',
  baseUrl: 'https://api.example.com',
});
```

### Configuration

| Option | Type | Description |
|--------|------|-------------|
| `input` | `string` | Path to the manifest file |
| `output` | `string` | Output directory |
| `language` | `'typescript'` | Target language |
| `packageName` | `string?` | Override npm package name |
| `clientName` | `string?` | Override client class name |
| `baseUrl` | `string?` | Override default base URL |
| `environments` | `{ name: string; baseUrl: string }[]?` | Named environment presets |
| `dryRun` | `boolean?` | Transform only, no file I/O |
| `check` | `boolean?` | Compare output without writing |
| `prettier` | `boolean?` | Toggle formatting (default: `true`) |

## Requirements

- Node.js ≥ 18 or Bun ≥ 1.0

## License

MIT

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

### `tesseract generate`

Generate an SDK from a static manifest file.

| Flag | Required | Description |
|------|----------|-------------|
| `-i, --input <path>` | Yes | Path to the `sdk-manifold/v1` manifest JSON file |
| `-o, --output <dir>` | Yes | Output directory for the generated SDK |
| `-n, --name <name>` | No | Override the npm package name |
| `--package-version <version>` | No | Override the generated package version |
| `--client-name <name>` | No | Override the generated client class name |
| `--base-url <url>` | No | Override the default base URL |
| `--sdk-style <style>` | No | `functional` (default) or `class` (Resend-style `new MySDK('key')`) |
| `--client-type <type>` | No | `internal` (full options, default) or `public` (auth key only, baseUrl baked in) |
| `--dry-run` | No | Preview changes without writing files |
| `--check` | No | Exit non-zero if generated output is out of date |

`--dry-run` and `--check` are mutually exclusive.

### `tesseract run`

Boot an instrumented Fastify app with `TESSERACT_GENERATE=1` to collect annotated routes at runtime and generate an SDK without a static manifest file.

```bash
tesseract run dist/app.js
```

The app must register `tesseractPlugin` from `@apollo-deploy/tesseract/fastify`. See [Fastify Integration](#fastify-integration) below.

## Input: The Manifest

Tesseract consumes a `BackendManifest` JSON file with `$schema: "sdk-manifold/v1"`:

```json
{
  "$schema": "sdk-manifold/v1",
  "info": {
    "title": "My API",
    "version": "1.0.0",
    "description": "An example API",
    "baseUrl": "https://api.example.com"
  },
  "domains": [
    {
      "domain": "users",
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
- **`domains`** — Groups of routes organized by domain, each with a prefix, stability level (`stable` / `experimental` / `internal`), and route definitions. `internal`-stability domains are excluded from public SDK builds.
- **`definitions`** — JSON Schema definitions for shared types
- **`schemaPackage`** _(optional)_ — An external npm package to import types from instead of generating them

### Route Configuration

Each route in a domain can specify:

- **`method`** / **`url`** — HTTP method and Fastify-style URL pattern (`:param`)
- **`schema`** — JSON Schemas for `params`, `querystring`, `body`, `headers`, and `response`
- **`sdk`** — SDK-specific config: `methodName`, `transport` (`json` | `multipart` | `binary` | `stream`), `exclude`, `deprecated`, `internal`, `timeout`, `requiredHeaders`
- **`sse: true`** — Marks the route as a Server-Sent Events stream

## Framework Integration

Tesseract ships adapters for every major Node.js API framework. Each adapter is a separate subpath export so you only pull in what you use.

| Framework | Import |
|-----------|--------|
| **Fastify** | `@apollo-deploy/tesseract/fastify` |
| **Express** | `@apollo-deploy/tesseract/express` |
| **Hono** | `@apollo-deploy/tesseract/hono` |
| **Koa** | `@apollo-deploy/tesseract/koa` |
| **Elysia** | `@apollo-deploy/tesseract/elysia` |
| **NestJS** | `@apollo-deploy/tesseract/nestjs` |
| **Generic / any framework** | `import { SDKCollector } from '@apollo-deploy/tesseract'` |

All non-Fastify adapters follow the same pattern:

1. Create an `SDKCollector` (or framework-specific subclass) with your API metadata.
2. Register domains and routes with the collector alongside your framework route definitions.
3. Call `collector.tryGenerate()` (or let a plugin do it) — it only runs when `TESSERACT_GENERATE=1`.

---

### Fastify

The Fastify adapter hooks into `onRoute` to collect routes automatically at boot time — no manual registration needed.

```ts
// app.ts
import { tesseractPlugin } from '@apollo-deploy/tesseract/fastify';

app.register(tesseractPlugin, {
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
  // Optional: import types from a shared package instead of regenerating them
  schemaPackage: { name: '@my-org/schemas', version: '^2.0.0' },
  sdkStyle: 'functional', // or 'class'
  clientType: 'internal', // or 'public'
});
```

The plugin is a complete no-op unless `TESSERACT_GENERATE=1` is set, so it is safe to register unconditionally.

Add `sdk` as a top-level option on each route (sibling to `schema`):

```ts
fastify.get('/:id', {
  schema: { response: { 200: UserSchema } },
  sdk: { methodName: 'getUser' },
}, handler);
```

Use `sdkDomain()` to name the domain and set a description:

```ts
import fp from 'fastify-plugin';
import { sdkDomain } from '@apollo-deploy/tesseract/fastify';

export default fp(async (fastify) => {
  sdkDomain(fastify, { domain: 'users', description: 'User management' });

  fastify.get('/:id', {
    schema: { response: { 200: UserSchema } },
    sdk: { methodName: 'getUser' },
  }, handler);
});
```

Or use the `@SDKModule()` class decorator:

```ts
import { SDKModule } from '@apollo-deploy/tesseract';

@SDKModule({ prefix: '/users', domain: 'users', description: 'User management' })
export class UsersPlugin {
  register(app: FastifyInstance) {
    app.get('/:id', { schema: { ... }, sdk: { methodName: 'getUser' } }, handler);
  }
}
```

**Trigger:**
```bash
tesseract run dist/app.js
# or
TESSERACT_GENERATE=1 node dist/app.js
```

---

### Express

```ts
import express from 'express';
import { ExpressSDKCollector } from '@apollo-deploy/tesseract/express';

const app = express();
const collector = new ExpressSDKCollector({
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
});

collector.domain('/users', { domain: 'users', description: 'User management' });

app.get('/users/:id',
  collector.expressRoute('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
  getUserHandler,
);
app.post('/users',
  collector.expressRoute('/users', 'POST', { sdk: { methodName: 'createUser' } }),
  createUserHandler,
);

// After all routes are registered:
if (await collector.tryGenerate()) process.exit(0);

app.listen(3000);
```

**Trigger:** `TESSERACT_GENERATE=1 node dist/app.js`

---

### Hono

```ts
import { Hono } from 'hono';
import { HonoSDKCollector } from '@apollo-deploy/tesseract/hono';

const app = new Hono();
const collector = new HonoSDKCollector({
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
});

collector.domain('/users', { domain: 'users', description: 'User management' });

app.get('/users/:id',
  collector.honoMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
  (c) => c.json(getUser(c.req.param('id'))),
);

if (await collector.tryGenerate()) process.exit(0);

export default app;
```

**Trigger:** `TESSERACT_GENERATE=1 node dist/app.js`

---

### Koa

```ts
import Koa from 'koa';
import Router from '@koa/router';
import { KoaSDKCollector } from '@apollo-deploy/tesseract/koa';

const app = new Koa();
const router = new Router();
const collector = new KoaSDKCollector({
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
});

collector.domain('/users', { domain: 'users', description: 'User management' });

router.get('/users/:id',
  collector.koaMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
  getUserHandler,
);

app.use(router.routes());

if (await collector.tryGenerate()) process.exit(0);

app.listen(3000);
```

**Trigger:** `TESSERACT_GENERATE=1 node dist/app.js`

---

### Elysia

```ts
import { Elysia } from 'elysia';
import { tesseractPlugin } from '@apollo-deploy/tesseract/elysia';

const { plugin, collector } = tesseractPlugin({
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
});

collector.domain('/users', { domain: 'users', description: 'User management' });
collector.route('/users/:id', 'GET', { sdk: { methodName: 'getUser' } });
collector.route('/users', 'POST', { sdk: { methodName: 'createUser' } });

const app = new Elysia()
  .use(plugin)
  .get('/users/:id', ({ params }) => getUser(params.id))
  .post('/users', ({ body }) => createUser(body))
  .listen(3000);
```

The plugin triggers generation automatically in its `onStart` hook when `TESSERACT_GENERATE=1` is set.

**Trigger:** `TESSERACT_GENERATE=1 bun run dist/app.js`

---

### NestJS

Decorate controllers and methods, then call `collectFromNestControllers()` at bootstrap:

```ts
// users.controller.ts
import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { SDKMethod, SDKDomain } from '@apollo-deploy/tesseract/nestjs';

@Controller('users')
@SDKDomain({ domain: 'users', description: 'User management' })
export class UsersController {
  @Get(':id')
  @SDKMethod({ methodName: 'getUser', schema: { response: { 200: { $ref: 'User' } } } })
  getUser(@Param('id') id: string) { ... }

  @Post()
  @SDKMethod({ methodName: 'createUser' })
  createUser(@Body() body: CreateUserDto) { ... }
}
```

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SDKCollector, collectFromNestControllers } from '@apollo-deploy/tesseract/nestjs';
import { UsersController } from './users/users.controller';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init();

  if (process.env.TESSERACT_GENERATE) {
    const collector = new SDKCollector({
      info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
      output: './packages/api-sdk',
    });
    collectFromNestControllers([UsersController], collector);
    await collector.generate();
    await app.close();
    process.exit(0);
  }

  await app.listen(3000);
}
bootstrap();
```

Requires `reflect-metadata` (standard NestJS dep) and `"emitDecoratorMetadata": true` in `tsconfig.json`.

**Trigger:** `TESSERACT_GENERATE=1 node dist/main.js`

---

### Generic / any framework

Use `SDKCollector` directly from the main package with any HTTP framework:

```ts
import { SDKCollector } from '@apollo-deploy/tesseract';

const collector = new SDKCollector({
  info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
  output: './packages/api-sdk',
});

collector.domain('/users', { domain: 'users', description: 'User management' });
collector.route('/users/:id', 'GET', { sdk: { methodName: 'getUser' } });
collector.route('/users', 'POST', { sdk: { methodName: 'createUser' } });

// After all routes are declared:
if (await collector.tryGenerate()) process.exit(0);
```

## Output

Tesseract generates a complete, publishable npm package. The structure varies slightly by `sdkStyle`.

**Functional style** (default — `createMyClient(config)`):

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

**Class style** (`--sdk-style class` — `new MySDK('api_key', options?)`): generates `client-class.ts`, `domain-class/` files, and a matching `index.ts` using the class-based entry point.

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
  packageVersion: '1.2.3',
  clientName: 'MyApi',
  baseUrl: 'https://api.example.com',
});
```

You can also pass a pre-parsed manifest object instead of a file path:

```typescript
import { generate } from '@apollo-deploy/tesseract';
import type { BackendManifest } from '@apollo-deploy/tesseract';

const manifest: BackendManifest = { /* ... */ };

await generate({ manifest, output: './sdk' });
```

### Configuration

Either `input` or `manifest` must be provided.

| Option | Type | Description |
|--------|------|-------------|
| `input` | `string?` | Path to the manifest file. Required if `manifest` is not provided. |
| `manifest` | `BackendManifest?` | Pre-parsed manifest object. Alternative to `input`. |
| `output` | `string` | Output directory |
| `language` | `'typescript'` | Target language |
| `packageName` | `string?` | Override npm package name |
| `packageVersion` | `string?` | Override generated package version; defaults to `info.version` from the manifest |
| `clientName` | `string?` | Override client class name |
| `baseUrl` | `string?` | Override default base URL |
| `sdkStyle` | `'functional' \| 'class'?` | `functional` (default) generates a `createMyClient(config)` factory; `class` generates a Resend-style `new MySDK('api_key', options?)` class |
| `clientType` | `'internal' \| 'public'?` | `internal` (default) exposes full config options; `public` accepts only an auth key with `baseUrl` baked in |
| `environments` | `{ name: string; baseUrl: string }[]?` | Named environment presets |
| `dryRun` | `boolean?` | Transform only, no file I/O |
| `check` | `boolean?` | Compare output without writing |
| `prettier` | `boolean?` | Toggle formatting (default: `true`) |

## Requirements

- Node.js ≥ 18 or Bun ≥ 1.0

## License

MIT

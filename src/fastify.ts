/**
 * Tesseract Fastify integration.
 *
 * Provides a Fastify plugin that collects annotated routes at runtime and
 * generates an SDK when triggered by `TESSERACT_GENERATE=1`.
 *
 * ```ts
 * // app.ts
 * import { tesseractPlugin } from '@apollo-deploy/tesseract/fastify';
 *
 * app.register(tesseractPlugin, {
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 * ```
 *
 * Then run: `TESSERACT_GENERATE=1 node dist/app.js`
 * Or via CLI: `tesseract run dist/app.js`
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { SDKModuleConfig, SDKRouteConfig } from './types/sdk-module.js';
import type { ManifestRouteSchema } from './types/manifest.js';
import { _domainRegistry } from './types/sdk-module.js';
import { buildManifestFromRoutes } from './collector.js';

// ── Fastify type augmentation ─────────────────────────────────────────────────
// `sdk` is a sibling to `schema` on each route — matching how SDK-Connector worked.
// No config-file or separate extraction step needed.

declare module 'fastify' {
  interface RouteOptions {
    /** SDK generation configuration for this route. Sibling to `schema`. */
    sdk?: SDKRouteConfig;
  }
  interface RouteShorthandOptions {
    /** SDK generation configuration for this route. Sibling to `schema`. */
    sdk?: SDKRouteConfig;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CollectedRoute {
  url: string;
  method: string;
  schema?: ManifestRouteSchema;
  sdk: SDKRouteConfig;
  sse?: boolean;
}

export interface TesseractPluginOptions {
  /** API metadata written into the generated SDK's package.json and README. */
  info: {
    title: string;
    version: string;
    baseUrl?: string;
    description?: string;
  };
  /** Output directory for the generated SDK. */
  output: string;
  /**
   * Shared type package used across your backend and generated SDK.
   *
   * When set, bare `$ref` values in route schemas (e.g. `{ $ref: 'Deployment' }`)
   * are treated as type names from this package. Tesseract emits
   * `import type { Deployment } from '<name>'` instead of regenerating types.
   *
   * @example
   * ```ts
   * app.register(tesseractPlugin, {
   *   info: { ... },
   *   output: './packages/api-sdk',
   *   schemaPackage: { name: '@apollo-deploy/schemas', version: '^2.1.0' },
   * });
   * ```
   */
  schemaPackage?: {
    name: string;
    version?: string;
    importPath?: string;
  };
  /**
   * Function to convert framework-specific schema objects to JSON Schema at generation time.
   *
   * Required when using `fastify-type-provider-zod` (or similar): Fastify exposes raw Zod
   * schema objects in the `onRoute` hook, not compiled JSON Schema. Pass `toJSONSchema` from
   * `zod` here so Tesseract can read parameter and response types correctly.
   *
   * @example
   * ```ts
   * import { toJSONSchema } from 'zod';
   * app.register(tesseractPlugin, { ..., schemaConverter: toJSONSchema });
   * ```
   */
  schemaConverter?: (schema: unknown) => unknown;
  /**
   * Zod v4 global registry — used to emit specific named re-exports from
   * `schemaPackage` instead of a wildcard `export type *`.
   *
   * Pass `z.globalRegistry` from your app so Tesseract can map Zod schemas
   * that have a registered id to their canonical type name, replacing inline
   * expansion with a bare `$ref` that intake resolves as an external type.
   *
   * @example
   * ```ts
   * import { z, toJSONSchema } from 'zod';
   * app.register(tesseractPlugin, {
   *   ...,
   *   schemaConverter: toJSONSchema,
   *   zodGlobalRegistry: z.globalRegistry,
   * });
   * ```
   */
  zodGlobalRegistry?: ZodGlobalRegistry;
  /**
   * `'public'` strips routes marked `internal: true` from the SDK.
   * `'internal'` includes all routes. Defaults to `'internal'`.
   */
  clientType?: 'public' | 'internal';
  /** Override the generated npm package name. */
  packageName?: string;
  /** Override the generated package version. */
  packageVersion?: string;
  /** `'functional'` (default) or `'class'` (Resend-style `new MySDK('key')`). */
  sdkStyle?: 'functional' | 'class';
}

// ── Domain registration helper ────────────────────────────────────────────────

/**
 * Declare SDK domain metadata for the current Fastify plugin scope.
 *
 * Call at the top of a plugin function to name the domain and set a
 * description. The prefix is read automatically from `fastify.prefix`.
 *
 * ```ts
 * import fp from 'fastify-plugin';
 * import { sdkDomain } from '@apollo-deploy/tesseract/fastify';
 *
 * export default fp(async (fastify) => {
 *   sdkDomain(fastify, { domain: 'users', description: 'User management' });
 *
 *   fastify.get('/:id', {
 *     schema: { response: { 200: UserSchema } },
 *     config: { sdk: { methodName: 'get' } },
 *   }, handler);
 * });
 * ```
 *
 * Not needed when using the `@SDKModule()` class decorator — it registers
 * domain metadata automatically.
 */
export function sdkDomain(
  fastify: FastifyInstance,
  config: Omit<SDKModuleConfig, 'prefix'> & { prefix?: string },
): void {
  const prefix = config.prefix ?? fastify.prefix ?? '/';
  _domainRegistry.set(prefix, { prefix, ...config });
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/** Returns true if `value` is a Zod v4 schema instance. */
function isZodSchema(value: unknown): boolean {
  return !!value && typeof value === 'object' && '_zod' in (value as object);
}

/** Minimal interface for z.globalRegistry — only what we need. */
interface ZodGlobalRegistry {
  get(schema: unknown): { id?: string } | undefined;
  /** Internal id→schema map present in Zod v4 registries. */
  _idmap?: Map<string, unknown>;
}

/**
 * Post-process a JSON Schema produced by `toJSONSchema` so that any `$defs`
 * entry whose key matches a registered global id is lifted to a bare `$ref`.
 *
 * Zod v4's `toJSONSchema` always emits `$ref: '#/$defs/<id>'` for sub-schemas
 * that have a registry id. Those `#/...` refs are treated as local by
 * `intake.ts` and would be inlined instead of resolved as external imports.
 * This function replaces them with bare `$ref: '<id>'` so `intake.ts` detects
 * them as external type stubs from the configured `schemaPackage`.
 */
function liftRegisteredRefs(
  schema: unknown,
  registeredIds: Set<string>,
): unknown {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map((item) => liftRegisteredRefs(item, registeredIds));
  }

  const s = schema as Record<string, unknown>;

  // If this node is a local $ref pointing at a registered id, lift it.
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/$defs/')) {
    const id = s.$ref.slice('#/$defs/'.length);
    if (registeredIds.has(id)) return { $ref: id };
  }

  // Recurse into all values, skipping $defs (handled separately below).
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(s)) {
    if (key === '$defs') continue;
    result[key] = liftRegisteredRefs(val, registeredIds);
  }

  // Re-add only $defs entries that are NOT lifted (i.e. not registered ids).
  if (s.$defs && typeof s.$defs === 'object' && !Array.isArray(s.$defs)) {
    const remainingDefs: Record<string, unknown> = {};
    for (const [defKey, defVal] of Object.entries(s.$defs as Record<string, unknown>)) {
      if (!registeredIds.has(defKey)) {
        remainingDefs[defKey] = liftRegisteredRefs(defVal, registeredIds);
      }
    }
    if (Object.keys(remainingDefs).length > 0) result.$defs = remainingDefs;
  }

  return result;
}

/**
 * Convert a single schema value. When `zodRegistry` is provided and the schema
 * has a registered global id, emit a bare `$ref` to that id instead of
 * expanding inline. This lets `intake.ts` treat it as an external type from
 * the configured `schemaPackage`.
 *
 * For schemas that are NOT directly registered but reference registered
 * sub-schemas, `toJSONSchema` is called and then `liftRegisteredRefs`
 * replaces any `$ref: '#/$defs/<id>'` with bare `$ref: '<id>'` for known ids.
 */
function convertSchemaValue(
  value: unknown,
  toJSONSchema: (s: unknown) => unknown,
  zodRegistry?: ZodGlobalRegistry,
): unknown {
  if (isZodSchema(value)) {
    if (zodRegistry) {
      const entry = zodRegistry.get(value);
      if (entry?.id) return { $ref: entry.id };
    }
    try {
      const jsonSchema = toJSONSchema(value);
      if (zodRegistry?._idmap && jsonSchema && typeof jsonSchema === 'object') {
        const registeredIds = new Set(zodRegistry._idmap.keys());
        return liftRegisteredRefs(jsonSchema, registeredIds);
      }
      return jsonSchema;
    } catch { return value; }
  }
  return value;
}

// Schema fields whose values should be treated as typed payloads — eligible for
// registry-based $ref replacement. All registered Zod schemas in these fields
// are replaced with a bare $ref so intake.ts can create external type stubs and
// emit specific named imports instead of wildcard re-exports.
//
// Note: headers are always expanded inline since they are rarely modelled as
// top-level registered schemas and Tesseract reads individual header names.
const REGISTRY_ELIGIBLE_FIELDS = new Set(['body', 'querystring', 'query', 'params']);

function convertRouteSchema(
  schema: ManifestRouteSchema | undefined,
  toJSONSchema: (s: unknown) => unknown,
  zodRegistry?: ZodGlobalRegistry,
): ManifestRouteSchema | undefined {
  if (!schema) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'response' && val && typeof val === 'object') {
      const serialized: Record<string, unknown> = {};
      for (const [status, responseSchema] of Object.entries(val as Record<string, unknown>)) {
        serialized[status] = convertSchemaValue(responseSchema, toJSONSchema, zodRegistry);
      }
      result[key] = serialized;
    } else if (REGISTRY_ELIGIBLE_FIELDS.has(key)) {
      result[key] = convertSchemaValue(val, toJSONSchema, zodRegistry);
    } else {
      // headers — always expand inline
      result[key] = convertSchemaValue(val, toJSONSchema);
    }
  }
  return result as ManifestRouteSchema;
}

const _tesseractPlugin: FastifyPluginAsync<TesseractPluginOptions> = async (fastify, opts) => {
  if (!process.env.TESSERACT_GENERATE) return;

  const collectedRoutes: CollectedRoute[] = [];

  fastify.addHook('onRoute', (routeOptions) => {
    const sdk = routeOptions.sdk;
    if (!sdk || sdk.exclude) return;

    // Fastify auto-generates HEAD for every GET; skip to avoid duplicates.
    const method = Array.isArray(routeOptions.method)
      ? routeOptions.method[0]
      : routeOptions.method;
    if (method === 'HEAD') return;

    collectedRoutes.push({
      url: routeOptions.url,
      method,
      schema: routeOptions.schema as ManifestRouteSchema | undefined,
      sdk,
      sse: (routeOptions as unknown as Record<string, unknown>).sse as boolean | undefined,
    });
  });

  fastify.addHook('onReady', async () => {
    if (collectedRoutes.length === 0) {
      console.error(
        '\n[tesseract] No SDK routes found. Add `sdk: { ... }` to routes or use `@SDKModule` + `sdkDomain()`.',
      );
      process.exit(1);
    }

    // Convert Zod v4 schemas to JSON Schema (dynamic import so Tesseract doesn't
    // need zod as a hard dependency — it resolves via the host app's node_modules).
    let resolvedRoutes = collectedRoutes;

    // When a schemaPackage is configured and the user provides their z.globalRegistry,
    // body/response schemas with a registered id emit a bare $ref instead of being
    // expanded inline. This lets intake.ts create correct external type stubs and
    // emit specific named exports instead of a wildcard re-export.
    const zodRegistry = opts.schemaPackage ? opts.zodGlobalRegistry : undefined;

    const toJSONSchema = opts.schemaConverter;
    if (typeof toJSONSchema === 'function') {
      resolvedRoutes = collectedRoutes.map((r) => ({
        ...r,
        schema: convertRouteSchema(r.schema, toJSONSchema, zodRegistry),
      }));
    } else {
      // Attempt automatic detection via dynamic import as fallback.
      try {
        const zodPkg = 'zod';
        const zodModule = await import(zodPkg) as Record<string, unknown>;
        const zodConverter = zodModule.toJSONSchema as ((s: unknown) => unknown) | undefined;
        if (typeof zodConverter === 'function') {
          resolvedRoutes = collectedRoutes.map((r) => ({
            ...r,
            schema: convertRouteSchema(r.schema, zodConverter, zodRegistry),
          }));
        }
      } catch {
        // zod not available — schemas stay as-is (JSON Schema passed directly)
      }
    }

    const manifest = buildManifestFromRoutes(resolvedRoutes, _domainRegistry, opts.info, opts.schemaPackage);

    console.log(
      `\n[tesseract] ${manifest.domains.length} domain(s), ${collectedRoutes.length} route(s) → ${opts.output}`,
    );

    // Dynamic import keeps the generation pipeline out of the user's app bundle
    // when TESSERACT_GENERATE is not set (the plugin returns early above).
    try {
      const { generate } = await import('./index.js');
      const result = await generate({
        manifest,
        output: opts.output,
        clientType: opts.clientType,
        packageName: opts.packageName,
        packageVersion: opts.packageVersion,
        sdkStyle: opts.sdkStyle,
      });

      for (const w of result.warnings) {
        console.warn(`  ⚠  ${w}`);
      }
      console.log(`[tesseract] ✓ ${result.filesWritten} files written\n`);
      process.exit(0);
    } catch (err) {
      console.error('[tesseract] Generation failed:', err);
      process.exit(1);
    }
  });
};

/**
 * Fastify plugin that collects SDK-annotated routes and generates an SDK
 * when `TESSERACT_GENERATE=1` is set in the environment.
 *
 * Wrapped with `fastify-plugin` so the `onRoute` hook is registered at the
 * root scope and captures routes from all sibling plugins.
 *
 * Register once at the application root — it is a complete no-op unless the
 * env var is set, so it is safe to register unconditionally.
 *
 * ```ts
 * import { tesseractPlugin } from '@apollo-deploy/tesseract/fastify';
 *
 * app.register(tesseractPlugin, {
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 * ```
 */
export const tesseractPlugin = fp(_tesseractPlugin, {
  name: 'tesseract',
  fastify: '>=4',
});



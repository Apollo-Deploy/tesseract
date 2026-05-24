/**
 * SDKCollector — framework-agnostic route and domain collector.
 *
 * The core primitive behind all framework adapters. Accumulates route
 * definitions and domain metadata, then builds a `BackendManifest` in memory
 * and calls the Tesseract generator.
 *
 * Used directly for framework-agnostic workflows and internally by all
 * framework adapters (Express, Hono, Koa, Elysia, NestJS).
 *
 * ```ts
 * import { SDKCollector } from '@apollo-deploy/tesseract';
 *
 * const collector = new SDKCollector({
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 *
 * collector.domain('/users', { domain: 'users', description: 'User management' });
 * collector.route('/users/:id', 'GET', { sdk: { methodName: 'getUser' } });
 * collector.route('/users', 'POST', { sdk: { methodName: 'createUser' } });
 *
 * if (process.env.TESSERACT_GENERATE) {
 *   await collector.generate();
 *   process.exit(0);
 * }
 * ```
 */

import type { BackendManifest, ManifestRoute, ManifestRouteSchema } from './types/manifest.js';
import type { SDKModuleConfig, SDKRouteConfig } from './types/sdk-module.js';

export interface CollectorOptions {
  /** API metadata written into the generated package.json and README. */
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
   * When set, bare `$ref` values in route schemas (e.g. `{ $ref: 'User' }`)
   * are treated as type names from this package rather than generating them inline.
   */
  schemaPackage?: {
    name: string;
    version?: string;
    importPath?: string;
  };
  /** `'functional'` (default) or `'class'` (Resend-style `new MySDK('key')`). */
  sdkStyle?: 'functional' | 'class';
  /** `'internal'` (default) or `'public'` (auth key only, baseUrl baked in). */
  clientType?: 'internal' | 'public';
  /** Override the generated npm package name. */
  packageName?: string;
  /** Override the generated package version. */
  packageVersion?: string;
}

export interface CollectorRouteConfig {
  /** JSON Schemas for params, querystring, body, headers, and response. */
  schema?: ManifestRouteSchema;
  /** SDK-specific options for this route. */
  sdk: SDKRouteConfig;
  /** Whether the route is a Server-Sent Events stream. */
  sse?: boolean;
}

interface InternalRoute {
  url: string;
  method: string;
  schema?: ManifestRouteSchema;
  sdk: SDKRouteConfig;
  sse?: boolean;
}

/**
 * Framework-agnostic route and domain collector.
 *
 * Works with any Node.js HTTP framework — Express, Hono, Koa, Elysia, NestJS,
 * or plain `node:http`. Framework-specific subpackages export pre-wired
 * subclasses or helpers that build on this class.
 */
export class SDKCollector {
  protected readonly _routes: InternalRoute[] = [];
  protected readonly _registry = new Map<string, SDKModuleConfig>();
  readonly opts: Readonly<CollectorOptions>;

  constructor(opts: CollectorOptions) {
    this.opts = opts;
  }

  /**
   * Declare a domain (route group) by its URL prefix.
   *
   * @param prefix - The URL prefix shared by all routes in this domain (e.g. `/users`).
   * @param config - Optional domain metadata — name override, description, stability.
   */
  domain(prefix: string, config?: Omit<SDKModuleConfig, 'prefix'>): this {
    this._registry.set(prefix, { prefix, ...config });
    return this;
  }

  /**
   * Register a route with the collector.
   *
   * Routes with `sdk.exclude: true` are silently ignored.
   *
   * @param url    - Full URL path, e.g. `/users/:id`.
   * @param method - HTTP method (case-insensitive).
   * @param config - Schema and SDK options for this route.
   */
  route(url: string, method: string, config: CollectorRouteConfig): this {
    if (config.sdk?.exclude) return this;
    this._routes.push({
      url,
      method: method.toUpperCase(),
      schema: config.schema,
      sdk: config.sdk,
      sse: config.sse,
    });
    return this;
  }

  /** Build and return the `BackendManifest` from all accumulated routes and domains. */
  buildManifest(): BackendManifest {
    return buildManifestFromRoutes(this._routes, this._registry, this.opts.info, this.opts.schemaPackage);
  }

  /** Generate the SDK from accumulated routes and domains. */
  async generate(): Promise<import('./index.js').GenerateResult> {
    const { generate } = await import('./index.js');
    const manifest = this.buildManifest();
    return generate({
      manifest,
      output: this.opts.output,
      clientType: this.opts.clientType,
      packageName: this.opts.packageName,
      packageVersion: this.opts.packageVersion,
      sdkStyle: this.opts.sdkStyle,
    });
  }

  /**
   * Check if `TESSERACT_GENERATE=1` is set and generate the SDK if so.
   *
   * Returns `true` if generation was triggered. Call after all routes have
   * been registered:
   *
   * ```ts
   * // At the bottom of your app setup file:
   * if (await collector.tryGenerate()) process.exit(0);
   * ```
   */
  async tryGenerate(): Promise<boolean> {
    if (!process.env.TESSERACT_GENERATE) return false;
    const result = await this.generate();
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.warn(`  ⚠  ${w}`);
    }
    console.log(`[tesseract] ✓ ${result.filesWritten} files written → ${this.opts.output}`);
    return true;
  }
}

// ── Shared manifest builder ───────────────────────────────────────────────────

/**
 * Builds a `BackendManifest` from a flat list of collected routes and a domain
 * registry. Exported so framework adapters (including the Fastify plugin) can
 * use it directly without going through `SDKCollector`.
 */
export function buildManifestFromRoutes(
  routes: ReadonlyArray<{
    url: string;
    method: string;
    schema?: ManifestRouteSchema;
    sdk: SDKRouteConfig;
    sse?: boolean;
  }>,
  registry: ReadonlyMap<string, SDKModuleConfig>,
  info: CollectorOptions['info'],
  schemaPackage?: CollectorOptions['schemaPackage'],
): BackendManifest {
  // Longest-prefix-first so more specific prefixes match before their parents
  const sortedPrefixes = [...registry.keys()].sort((a, b) => b.length - a.length);

  const domainMap = new Map<string, { config: SDKModuleConfig; routes: ManifestRoute[] }>();

  for (const route of routes) {
    const matchedPrefix =
      sortedPrefixes.find((p) => route.url === p || route.url.startsWith(p + '/')) ??
      derivePrefix(route.url);

    if (!domainMap.has(matchedPrefix)) {
      domainMap.set(matchedPrefix, {
        config: registry.get(matchedPrefix) ?? { prefix: matchedPrefix },
        routes: [],
      });
    }

    const tail = route.url.substring(matchedPrefix.length) || '/';
    domainMap.get(matchedPrefix)!.routes.push({
      method: route.method,
      url: tail.startsWith('/') ? tail : '/' + tail,
      schema: route.schema,
      sdk: route.sdk,
      sse: route.sse,
    });
  }

  return {
    $schema: 'sdk-manifold/v1',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
      baseUrl: info.baseUrl,
    },
    ...(schemaPackage && { schemaPackage }),
    domains: [...domainMap.values()].map(({ config, routes }) => ({ ...config, routes })),
  };
}

/** Derives a domain prefix from the first non-parameter URL segment. */
function derivePrefix(url: string): string {
  const first = url.split('/').find((s) => s.length > 0 && !s.startsWith(':'));
  return first ? '/' + first : '/';
}

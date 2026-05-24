/**
 * SDKModuleConfig — domain-level metadata for an API route module.
 *
 * Used via the `@SDKModule()` class decorator or `sdkDomain()` from
 * `@apollo-deploy/tesseract/fastify`.
 */
export interface SDKModuleConfig {
  /**
   * The URL prefix applied to every route in this module.
   * Path parameters use `:param` syntax, e.g. `/signal/projects/:projectId/domains`.
   */
  prefix: string;

  /**
   * Override the SDK group / domain key.
   * Defaults to the last path segment of `prefix` when omitted.
   */
  domain?: string;

  /**
   * Override the output file name for this domain's generated file.
   * Defaults to the kebab-cased domain name when omitted.
   */
  fileName?: string;

  /** Human-readable description surfaced in generated READMEs and JSDoc. */
  description?: string;

  /**
   * Stability level of this domain.
   *
   * - `'stable'` — production-ready, included in all SDK builds.
   * - `'experimental'` — may change; included but annotated.
   * - `'internal'` — excluded from public SDK builds.
   *
   * @default 'stable'
   */
  stability?: 'stable' | 'experimental' | 'internal';
}

/** Symbol used to store SDKModuleConfig on a decorated class. */
export const SDK_MODULE_CONFIG = Symbol('tesseract:sdkModuleConfig');

/**
 * Module-level domain registry. Populated by `@SDKModule` and `sdkDomain()`.
 * Read by the Fastify plugin at generation time.
 * @internal
 */
export const _domainRegistry = new Map<string, SDKModuleConfig>();

/**
 * Class decorator that attaches `SDKModuleConfig` metadata to a Fastify plugin
 * or route module class, and registers the domain in the global `_domainRegistry`
 * for the Fastify plugin to read at generation time.
 *
 * ```ts
 * import { SDKModule } from "@apollo-deploy/tesseract";
 *
 * @SDKModule({
 *   prefix: "/users",
 *   domain: "users",
 *   description: "User management",
 * })
 * export class UsersPlugin {
 *   register(app: FastifyInstance) {
 *     app.get('/:id', {
 *       schema: { response: { 200: UserSchema } },
 *       sdk: { methodName: 'getUser' },
 *     }, handler);
 *   }
 * }
 * ```
 *
 * The config is accessible at runtime via the `SDK_MODULE_CONFIG` symbol:
 * ```ts
 * import { SDK_MODULE_CONFIG } from "@apollo-deploy/tesseract";
 * UsersPlugin[SDK_MODULE_CONFIG]; // SDKModuleConfig
 * ```
 */
export function SDKModule(config: SDKModuleConfig) {
  return <T extends abstract new (...args: unknown[]) => unknown>(
    target: T,
    _context: ClassDecoratorContext<T>,
  ): void => {
    Object.defineProperty(target, SDK_MODULE_CONFIG, {
      value: config,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    // Register in domain registry so the Fastify plugin can group routes by prefix
    _domainRegistry.set(config.prefix, config);
  };
}


/**
 * SDKRouteConfig — per-route SDK options, set via `sdk` on a route definition.
 *
 * Canonical definition: `ManifestSDKRouteConfig` is a direct alias of this type.
 *
 * ```ts
 * import type { SDKRouteConfig } from "@apollo-deploy/tesseract";
 *
 * const sdkOptions: SDKRouteConfig = {
 *   methodName: "listDomains",
 *   internal: true,
 * };
 * ```
 */
export interface SDKRouteConfig {
  /** Override the generated method name for this route. */
  methodName?: string;

  /** Request body encoding. Defaults to `'json'`. */
  transport?: 'json' | 'multipart' | 'binary' | 'stream';

  /** Completely exclude this route from the generated SDK. */
  exclude?: boolean;

  /**
   * Mark the generated method as deprecated.
   * Pass a string to include a deprecation message in the JSDoc.
   */
  deprecated?: boolean | string;

  /** Override the JSDoc description for this route's generated method. */
  description?: string;

  /** Override the operationId used for method-name derivation. */
  operationId?: string;

  /**
   * Exclude this route from public SDKs; only emit it in internal SDKs.
   */
  internal?: boolean;

  /** Per-route request timeout in milliseconds. */
  timeout?: number;

  /** Override the URL prefix for this individual route. */
  prefix?: string;

  /**
   * Declare required headers that should be exposed as explicit parameters
   * on the generated method signature.
   */
  requiredHeaders?: Array<{
    name: string;
    paramName: string;
    description?: string;
  }>;

  /**
   * SSE routes only. Overrides the generated return type to a named type
   * exported from the schema package, bypassing the default `SSEEvent<T>`
   * wrapper. e.g. `"SignalStreamEvent"` emits `AsyncIterable<SignalStreamEvent>`.
   */
  sseReturnType?: string;
}

/**
 * Manifest type mirrors for sdk-manifold/v1.
 *
 * Defined inline so Tesseract has no runtime dependency on @apollo-deploy/sdk-manifold.
 * Keep in sync with the manifold package's manifest.ts.
 */

// ── JSON Schema subset ───────────────────────────────────────────────────────

export type JsonSchema =
  | { $ref: string; [k: string]: unknown }
  | {
      type: 'object';
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean | JsonSchema;
      description?: string;
      nullable?: boolean;
      [k: string]: unknown;
    }
  | {
      type: 'array';
      items?: JsonSchema;
      description?: string;
      nullable?: boolean;
      [k: string]: unknown;
    }
  | {
      type: 'string' | 'number' | 'integer' | 'boolean' | 'null';
      format?: string;
      description?: string;
      nullable?: boolean;
      readOnly?: boolean;
      writeOnly?: boolean;
      deprecated?: boolean;
      [k: string]: unknown;
    }
  | {
      enum: Array<string | number | boolean | null>;
      type?: string;
      description?: string;
      [k: string]: unknown;
    }
  | {
      allOf?: JsonSchema[];
      anyOf?: JsonSchema[];
      oneOf?: JsonSchema[];
      description?: string;
      nullable?: boolean;
      [k: string]: unknown;
    };

// ── Route Schema ─────────────────────────────────────────────────────────────

export interface ManifestRouteSchema {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  consumes?: string[];
  produces?: string[];
  params?: JsonSchema;
  querystring?: JsonSchema;
  query?: JsonSchema;
  body?: JsonSchema;
  headers?: JsonSchema;
  response?: Record<string | number, JsonSchema>;
}

// ── SDK Route Config ─────────────────────────────────────────────────────────

export interface ManifestSDKRouteConfig {
  methodName?: string;
  transport?: 'json' | 'multipart' | 'binary' | 'stream';
  exclude?: boolean;
  deprecated?: boolean | string;
  description?: string;
  operationId?: string;
  group?: string;
  internal?: boolean;
  timeout?: number;
  prefix?: string;
  requiredHeaders?: Array<{
    name: string;
    paramName: string;
    description?: string;
  }>;
}

// ── Route ────────────────────────────────────────────────────────────────────

export interface ManifestRoute {
  method: string | string[];
  url: string;
  schema?: ManifestRouteSchema;
  sdk?: ManifestSDKRouteConfig;
  sse?: boolean;
}

// ── Domain ───────────────────────────────────────────────────────────────────

export interface ManifestDomain {
  prefix: string;
  domain?: string;
  fileName?: string;
  description?: string;
  stability?: 'stable' | 'experimental' | 'internal';
  routes: ManifestRoute[];
}

// ── Backend Manifest ─────────────────────────────────────────────────────────

export interface BackendManifest {
  $schema: 'sdk-manifold/v1';
  info: {
    title: string;
    version: string;
    description?: string;
    baseUrl?: string;
  };
  domains: ManifestDomain[];
  definitions?: Record<string, JsonSchema>;
  schemaPackage?: {
    name: string;
    version?: string;
    importPath?: string;
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateManifest(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const obj = value as Record<string, unknown>;

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }

  if (obj.$schema !== 'sdk-manifold/v1') {
    errors.push(`Expected $schema "sdk-manifold/v1", got "${obj.$schema}"`);
  }

  const info = obj.info as Record<string, unknown> | undefined;
  if (!info || typeof info !== 'object') {
    errors.push('Missing required field: info');
  } else {
    if (!info.title || typeof info.title !== 'string') errors.push('info.title is required');
    if (!info.version || typeof info.version !== 'string') errors.push('info.version is required');
  }

  if (!Array.isArray(obj.domains)) {
    errors.push('Missing required field: domains (must be an array)');
  }

  return { valid: errors.length === 0, errors };
}

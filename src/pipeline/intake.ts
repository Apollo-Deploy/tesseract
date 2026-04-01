/**
 * Manifest Intake — converts an sdk-manifold/v1 manifest to SDKIR.
 *
 * This is the only intake path in Tesseract. No OpenAPI parsing.
 */

import { readFileSync } from 'node:fs';
import { camelCase, pascalCase, kebabCase } from 'change-case';
import { deriveCleanMethodName } from '../utils/naming.js';
import type {
  BackendManifest,
  ManifestDomain,
  ManifestRoute,
  JsonSchema,
} from '../types/manifest.js';
import type {
  SDKIR,
  SDKMeta,
  OperationGroup,
  Operation,
  Parameter,
  RequestBodyDef,
  SchemaDefinition,
  SchemaProperty,
} from '../types/ir.js';
import type { ResolvedConfig } from '../types/config.js';
import { validateManifest } from '../types/manifest.js';

// ── Entry point ──────────────────────────────────────────────────────────────

export function intake(config: ResolvedConfig): SDKIR {
  let manifest: BackendManifest;
  try {
    const raw = readFileSync(config.input, 'utf-8');
    manifest = JSON.parse(raw) as BackendManifest;
  } catch (err) {
    throw new Error(
      `Failed to read manifest at "${config.input}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest:\n  ${validation.errors.join('\n  ')}`);
  }

  const schemaPackage = manifest.schemaPackage;
  const importPath = schemaPackage?.importPath ?? schemaPackage?.name;

  const externalRefNames = schemaPackage
    ? collectExternalRefNames(manifest)
    : new Set<string>();

  // External schema stubs — one per bare $ref name, imported from schemaPackage
  const externalSchemas: SchemaDefinition[] = schemaPackage
    ? Array.from(externalRefNames).map((name) => ({
        name,
        isEnum: false,
        properties: [],
        ownership: {
          kind: 'external' as const,
          externalImport: {
            packageName: schemaPackage.name,
            importPath: importPath!,
            exportName: name,
          },
        },
      }))
    : [];

  // Local definitions — skip types already covered by the external package
  const localDefinitions = Object.fromEntries(
    Object.entries(manifest.definitions ?? {}).filter(
      ([k]) => !externalRefNames.has(pascalCase(k)),
    ),
  );
  const schemas: SchemaDefinition[] = [...externalSchemas, ...buildSchemas(localDefinitions)];

  const groups: OperationGroup[] = [];
  const allInlineSchemas: SchemaDefinition[] = [];

  for (const domain of manifest.domains.filter((d) => d.stability !== 'internal')) {
    const { group, inlineSchemas } = buildOperationGroup(domain, schemas);
    groups.push(group);
    allInlineSchemas.push(...inlineSchemas);
  }

  const allSchemas: SchemaDefinition[] = [...schemas, ...allInlineSchemas];

  const meta: SDKMeta = {
    title: manifest.info.title,
    version: manifest.info.version,
    // Only set packageVersion when the caller explicitly supplied it.
    // When undefined the TypeScript adapter queries npm and bumps the patch.
    packageVersion: config.packageVersion,
    description: manifest.info.description,
    baseUrl: config.baseUrl ?? manifest.info.baseUrl ?? 'http://localhost',
    packageName: config.packageName ?? kebabCase(manifest.info.title).toLowerCase(),
    clientName: config.clientName ?? pascalCase(manifest.info.title),
    schemaPackage: schemaPackage
      ? { name: schemaPackage.name, version: schemaPackage.version, importPath }
      : undefined,
    environments: config.environments,
  };

  return { meta, groups, schemas: allSchemas };
}

// ── External ref collection ──────────────────────────────────────────────────

function collectExternalRefNames(manifest: BackendManifest): Set<string> {
  const names = new Set<string>();
  for (const domain of manifest.domains) {
    for (const route of domain.routes) {
      const s = route.schema;
      if (!s) continue;
      for (const field of [s.params, s.querystring, s.query, s.body, s.headers]) {
        if (field) scanSchemaForExternalRefs(field, names);
      }
      if (s.response) {
        for (const resp of Object.values(s.response)) {
          scanSchemaForExternalRefs(resp, names);
        }
      }
    }
  }
  return names;
}

function scanSchemaForExternalRefs(schema: JsonSchema, out: Set<string>): void {
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string') {
    if (!s.$ref.startsWith('#')) {
      out.add(pascalCase(s.$ref.split('/').pop()!));
    }
    return;
  }
  const props = s.properties as Record<string, JsonSchema> | undefined;
  if (props) {
    for (const v of Object.values(props)) scanSchemaForExternalRefs(v, out);
  }
  if (s.additionalProperties && typeof s.additionalProperties === 'object') {
    scanSchemaForExternalRefs(s.additionalProperties as JsonSchema, out);
  }
  if (s.items) scanSchemaForExternalRefs(s.items as JsonSchema, out);
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const arr = s[key] as JsonSchema[] | undefined;
    if (Array.isArray(arr)) {
      for (const m of arr) scanSchemaForExternalRefs(m, out);
    }
  }
}

// ── Schema building ──────────────────────────────────────────────────────────

function buildSchemas(definitions: Record<string, JsonSchema>): SchemaDefinition[] {
  return Object.entries(definitions).map(([name, schema]) =>
    jsonSchemaToDefinition(pascalCase(name), schema),
  );
}

function jsonSchemaToDefinition(name: string, schema: JsonSchema): SchemaDefinition {
  const s = schema as Record<string, unknown>;

  if ('enum' in s && Array.isArray(s.enum)) {
    return {
      name,
      description: s.description as string | undefined,
      isEnum: true,
      enumValues: (s.enum as Array<string | number | null>).filter(
        (v): v is string | number => v !== null,
      ),
      properties: [],
      isTypeAlias: true,
    };
  }

  if ('oneOf' in s && Array.isArray(s.oneOf)) {
    return {
      name,
      description: s.description as string | undefined,
      isEnum: false,
      isUnionType: true,
      unionMembers: (s.oneOf as JsonSchema[]).map(jsonSchemaToType),
      properties: [],
      isTypeAlias: true,
    };
  }

  if ('anyOf' in s && Array.isArray(s.anyOf)) {
    return {
      name,
      description: s.description as string | undefined,
      isEnum: false,
      isUnionType: true,
      unionMembers: (s.anyOf as JsonSchema[]).map(jsonSchemaToType),
      properties: [],
      isTypeAlias: true,
    };
  }

  if ('allOf' in s && Array.isArray(s.allOf)) {
    const members = s.allOf as JsonSchema[];
    if (members.length === 2) {
      const refMember = members.find((m) => '$ref' in m);
      const objectMember = members.find(
        (m) => !('$ref' in m) && (m as Record<string, unknown>).type === 'object',
      );
      if (refMember && objectMember) {
        const baseDef = jsonSchemaToDefinition(name, objectMember);
        return { ...baseDef, extends: jsonSchemaToType(refMember) };
      }
    }
    return {
      name,
      description: s.description as string | undefined,
      isEnum: false,
      isIntersectionType: true,
      intersectionMembers: members.map(jsonSchemaToType),
      properties: [],
      isTypeAlias: true,
    };
  }

  if (s.type === 'object') {
    const required = new Set((s.required as string[] | undefined) ?? []);
    const rawProps = (s.properties as Record<string, JsonSchema> | undefined) ?? {};
    const properties: SchemaProperty[] = Object.entries(rawProps).map(([propName, propSchema]) => {
      const ps = propSchema as Record<string, unknown>;
      return {
        name: propName,
        type: jsonSchemaToType(propSchema),
        required: required.has(propName),
        description: ps.description as string | undefined,
        nullable: (ps.nullable as boolean | undefined) ?? false,
        format: ps.format as string | undefined,
        readOnly: ps.readOnly as boolean | undefined,
        writeOnly: ps.writeOnly as boolean | undefined,
      };
    });

    const ap = s.additionalProperties;
    const additionalPropertiesType =
      ap && typeof ap === 'object' ? jsonSchemaToType(ap as JsonSchema) : undefined;

    return {
      name,
      description: s.description as string | undefined,
      isEnum: false,
      properties,
      additionalPropertiesType,
    };
  }

  return {
    name,
    description: (s as Record<string, unknown>).description as string | undefined,
    isEnum: false,
    isTypeAlias: true,
    properties: [],
  };
}

// ── Type string conversion ───────────────────────────────────────────────────

export function jsonSchemaToType(schema: JsonSchema): string {
  const s = schema as Record<string, unknown>;

  if ('$ref' in s && typeof s.$ref === 'string') {
    return pascalCase(s.$ref.split('/').pop()!);
  }

  if ('enum' in s && Array.isArray(s.enum)) {
    return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
  }

  if (Array.isArray(s.allOf)) return (s.allOf as JsonSchema[]).map(jsonSchemaToType).join(' & ');
  if (Array.isArray(s.oneOf)) return (s.oneOf as JsonSchema[]).map(jsonSchemaToType).join(' | ');
  if (Array.isArray(s.anyOf)) return (s.anyOf as JsonSchema[]).map(jsonSchemaToType).join(' | ');

  const type = s.type as string | undefined;

  if (type === 'object') {
    const required = new Set((s.required as string[] | undefined) ?? []);
    const rawProps = s.properties as Record<string, JsonSchema> | undefined;
    if (rawProps) {
      const entries = Object.entries(rawProps)
        .map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${jsonSchemaToType(v)}`)
        .join('; ');
      const ap = s.additionalProperties;
      if (ap && typeof ap === 'object') {
        return `{ ${entries}; [key: string]: ${jsonSchemaToType(ap as JsonSchema)} }`;
      }
      return entries ? `{ ${entries} }` : 'Record<string, unknown>';
    }
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      return `Record<string, ${jsonSchemaToType(s.additionalProperties as JsonSchema)}>`;
    }
    return 'Record<string, unknown>';
  }

  if (type === 'array') {
    const items = s.items as JsonSchema | undefined;
    return `Array<${items ? jsonSchemaToType(items) : 'unknown'}>`;
  }

  if (type === 'string' || type === 'date') return 'string';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'null') return 'null';
  if (type === 'never') return 'never';

  if (type === 'nullable') {
    const def = s.def as Record<string, unknown> | undefined;
    if (def?.innerType) return jsonSchemaToType(def.innerType as JsonSchema) + ' | null';
    return 'unknown | null';
  }

  if (type === 'union') {
    const options = s.options as JsonSchema[] | undefined;
    if (options) return options.map(jsonSchemaToType).join(' | ');
  }

  return 'unknown';
}

// ── Group / operation building ───────────────────────────────────────────────

function isComplexInlineSchema(s: Record<string, unknown>): boolean {
  if (s.type === 'object') return true;
  if (Array.isArray(s.allOf)) return true;

  // anyOf / oneOf that is just `SomeRef | null` is not complex — emit inline
  for (const key of ['anyOf', 'oneOf'] as const) {
    const arr = s[key] as JsonSchema[] | undefined;
    if (!Array.isArray(arr)) continue;
    if (isNullableRefUnion(arr)) return false;
    return true;
  }

  return false;
}

/** Returns true when the union is exactly `{ $ref } | { type: "null" }` */
function isNullableRefUnion(members: JsonSchema[]): boolean {
  if (members.length !== 2) return false;
  const refMember = members.find((m) => '$ref' in m);
  const nullMember = members.find((m) => (m as Record<string, unknown>).type === 'null');
  return !!refMember && !!nullMember;
}

function buildOperationGroup(
  domain: ManifestDomain,
  _schemas: SchemaDefinition[],
): { group: OperationGroup; inlineSchemas: SchemaDefinition[] } {
  const domainName = domain.domain ?? domain.prefix;
  const name = camelCase(domainName);
  const fileName = kebabCase(domainName);

  const allInlineSchemas: SchemaDefinition[] = [];
  const operations: Operation[] = [];

  for (const route of domain.routes) {
    if (route.sdk?.exclude || route.sdk?.internal) continue;
    const { operation, inlineSchemas } = buildOperation(route, name);
    operations.push(operation);
    for (const s of inlineSchemas) {
      allInlineSchemas.push({
        ...s,
        ownership: { kind: 'generated', domainFile: fileName },
      });
    }
  }

  return {
    group: {
      name,
      fileName,
      interfaceName: pascalCase(domainName) + 'API',
      factoryName: 'create' + pascalCase(domainName) + 'API',
      description: domain.description,
      operations,
    },
    inlineSchemas: allInlineSchemas,
  };
}

function buildOperation(
  route: ManifestRoute,
  groupName: string,
): { operation: Operation; inlineSchemas: SchemaDefinition[] } {
  const httpMethod = (Array.isArray(route.method) ? route.method[0] : route.method).toUpperCase();
  const pathParams = extractPathParams(route.url, route.schema?.params);
  const querySchema = route.schema?.querystring ?? route.schema?.query;
  const queryParams = extractQueryParams(querySchema);
  const headerParams = extractHeaderParams(route.schema?.headers);

  const inlineSchemas: SchemaDefinition[] = [];

  const name =
    route.sdk?.methodName ??
    deriveCleanMethodName({
      operationId: route.schema?.operationId,
      summary: route.schema?.summary,
      path: route.url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}'),
      httpMethod: httpMethod.toLowerCase(),
      tagName: groupName,
    });

  // Response type
  let responseType = 'void';
  let statusCode = 200;
  const successResponse = pickSuccessResponse(route.schema?.response);
  if (successResponse) {
    const { schema: successSchema, statusCode: sc } = successResponse;
    statusCode = sc;
    const rs = successSchema as Record<string, unknown>;
    if (rs.type === 'null' || (rs.type === 'object' && !rs.properties && !rs.$ref)) {
      responseType = 'void';
    } else if (typeof rs.$ref !== 'string' && isComplexInlineSchema(rs)) {
      const typeName = pascalCase(name) + 'Response';
      inlineSchemas.push(jsonSchemaToDefinition(typeName, successSchema));
      responseType = typeName;
    } else {
      responseType = jsonSchemaToType(successSchema);
    }
  }

  // Request body
  let requestBody: RequestBodyDef | undefined;
  if (route.schema?.body) {
    const bodySchema = route.schema.body;
    const bs = bodySchema as Record<string, unknown>;
    let bodyType: string;
    if (typeof bs.$ref !== 'string' && isComplexInlineSchema(bs)) {
      const typeName = pascalCase(name) + 'Input';
      inlineSchemas.push(jsonSchemaToDefinition(typeName, bodySchema));
      bodyType = typeName;
    } else {
      bodyType = jsonSchemaToType(bodySchema);
    }
    requestBody = {
      type: bodyType,
      required: true,
      contentType:
        route.sdk?.transport === 'multipart' ? 'multipart/form-data' : 'application/json',
    };
  }

  // Query type
  let queryType: string | undefined;
  if (querySchema) {
    const qs = querySchema as Record<string, unknown>;
    if (typeof qs.$ref === 'string') {
      queryType = jsonSchemaToType(querySchema);
    } else if (queryParams.length > 0) {
      queryType = jsonSchemaToType(querySchema);
    }
  }

  // Required headers from sdk config
  if (route.sdk?.requiredHeaders) {
    for (const rh of route.sdk.requiredHeaders) {
      headerParams.push({
        name: camelCase(rh.paramName),
        originalName: rh.name,
        type: 'string',
        required: true,
        description: rh.description,
      });
    }
  }

  return {
    operation: {
      name,
      operationId: route.schema?.operationId ?? route.sdk?.operationId,
      summary: route.schema?.summary,
      description: route.schema?.description ?? route.sdk?.description,
      httpMethod,
      path: fastifyPathToIR(route.url),
      pathParams,
      queryParams,
      queryType,
      headerParams,
      requestBody,
      responseType,
      statusCode,
      deprecated: route.sdk?.deprecated ? true : undefined,
      isEventStream: route.sse ?? route.sdk?.transport === 'stream',
    },
    inlineSchemas,
  };
}

// ── Parameter extraction ─────────────────────────────────────────────────────

function extractPathParams(url: string, paramsSchema?: JsonSchema): Parameter[] {
  const urlParams = [...url.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
  if (urlParams.length === 0) return [];

  const s = paramsSchema as Record<string, unknown> | undefined;
  const props = s?.properties as Record<string, JsonSchema> | undefined;
  const required = new Set((s?.required as string[] | undefined) ?? []);

  return urlParams.map((paramName) => {
    const propSchema = props?.[paramName];
    return {
      name: camelCase(paramName),
      originalName: paramName,
      type: propSchema ? jsonSchemaToType(propSchema) : 'string',
      required: required.size === 0 || required.has(paramName),
      description: propSchema
        ? (propSchema as Record<string, unknown>).description as string | undefined
        : undefined,
    };
  });
}

function extractQueryParams(querySchema?: JsonSchema): Parameter[] {
  if (!querySchema) return [];
  const s = querySchema as Record<string, unknown>;
  if (s.type !== 'object' || !s.properties) return [];

  const required = new Set((s.required as string[] | undefined) ?? []);
  const props = s.properties as Record<string, JsonSchema>;

  return Object.entries(props).map(([name, schema]) => ({
    name: camelCase(name),
    originalName: name,
    type: jsonSchemaToType(schema),
    required: required.has(name),
    description: (schema as Record<string, unknown>).description as string | undefined,
    deprecated: (schema as Record<string, unknown>).deprecated as boolean | undefined,
  }));
}

const SYSTEM_HEADERS = new Set([
  'content-type',
  'content-length',
  'transfer-encoding',
  'host',
  'accept',
  'accept-encoding',
]);

function extractHeaderParams(headersSchema?: JsonSchema): Parameter[] {
  if (!headersSchema) return [];
  const s = headersSchema as Record<string, unknown>;
  if (s.type !== 'object' || !s.properties) return [];

  const required = new Set((s.required as string[] | undefined) ?? []);
  const props = s.properties as Record<string, JsonSchema>;

  return Object.entries(props)
    .filter(([name]) => !SYSTEM_HEADERS.has(name.toLowerCase()))
    .map(([name, schema]) => ({
      name: camelCase(name),
      originalName: name,
      type: jsonSchemaToType(schema),
      required: required.has(name),
      description: (schema as Record<string, unknown>).description as string | undefined,
    }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fastifyPathToIR(url: string): string {
  return url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '${$1}');
}

function pickSuccessResponse(
  response: Record<string | number, JsonSchema> | undefined,
): { schema: JsonSchema; statusCode: number } | undefined {
  if (!response) return undefined;
  for (const [code, schema] of [
    [200, response['200'] ?? response[200]],
    [201, response['201'] ?? response[201]],
    [202, response['202'] ?? response[202]],
    [204, response['204'] ?? response[204]],
    [200, response['2xx']],
    [200, response['default']],
  ] as const) {
    if (schema) return { schema, statusCode: code };
  }
  return undefined;
}

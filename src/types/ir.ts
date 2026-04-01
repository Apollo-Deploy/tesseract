/**
 * SDK Intermediate Representation.
 *
 * The manifest intake stage produces this; enrichment and adapters consume it.
 */

// ── Core IR ──────────────────────────────────────────────────────────────────

export interface SDKIR {
  meta: SDKMeta;
  groups: OperationGroup[];
  schemas: SchemaDefinition[];
  securitySchemes?: SecurityScheme[];
  webhooks?: WebhookDefinition[];
}

export interface SDKMeta {
  title: string;
  version: string;
  description?: string;
  baseUrl: string;
  packageName: string;
  clientName: string;
  serverVariables?: {
    name: string;
    default: string;
    description?: string;
    enum?: string[];
  }[];
  environments?: {
    name: string;
    baseUrl: string;
    description?: string;
  }[];
  schemaPackage?: {
    name: string;
    version?: string;
    importPath?: string;
  };
}

export interface SecurityScheme {
  name: string;
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  in?: 'header' | 'query' | 'cookie';
  paramName?: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

export interface OperationGroup {
  name: string;
  sourceTag?: string;
  fileName: string;
  interfaceName: string;
  factoryName: string;
  description?: string;
  operations: Operation[];
}

export interface Operation {
  operationId?: string;
  name: string;
  summary?: string;
  description?: string;
  httpMethod: string;
  path: string;
  pathParams: Parameter[];
  queryParams: Parameter[];
  headerParams: Parameter[];
  cookieParams?: Parameter[];
  requestBody?: RequestBodyDef;
  requestBodyContentTypes?: string[];
  queryType?: string;
  headerType?: string;
  cookieType?: string;
  responseType: string;
  statusCode: number;
  deprecated?: boolean;
  isEventStream?: boolean;
  eventSchema?: string;
}

export interface Parameter {
  name: string;
  originalName: string;
  type: string;
  required: boolean;
  description?: string;
  deprecated?: boolean;
}

export interface RequestBodyDef {
  type: string;
  required: boolean;
  contentType: string;
}

export interface WebhookDefinition {
  name: string;
  event: string;
  payloadType: string;
  description?: string;
}

// ── Schema ownership ─────────────────────────────────────────────────────────

export interface ExternalImportMeta {
  packageName: string;
  importPath: string;
  exportName: string;
}

export interface SchemaOwnership {
  kind: 'generated' | 'external';
  externalImport?: ExternalImportMeta;
  runtimeImport?: ExternalImportMeta;
  domainFile?: string;
}

export interface SchemaDefinition {
  name: string;
  description?: string;
  properties: SchemaProperty[];
  isEnum: boolean;
  enumValues?: (string | number)[];
  extends?: string;
  isUnionType?: boolean;
  unionMembers?: string[];
  isIntersectionType?: boolean;
  intersectionMembers?: string[];
  isTypeAlias?: boolean;
  additionalPropertiesType?: string;
  ownership?: SchemaOwnership;
  componentName?: string;
}

export interface SchemaProperty {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  nullable?: boolean;
  format?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  defaultValue?: unknown;
}

// ── Enriched IR ──────────────────────────────────────────────────────────────

export interface SymbolTableEntry {
  definedIn: string;
  kind: string;
  isExternal: boolean;
  importPath?: string;
}

export type SymbolTable = Record<string, SymbolTableEntry>;

export type ImportGraph = Record<string, string[]>;

export interface DomainAllocation {
  fileName: string;
  schemas: string[];
}

export interface OperationSignature {
  params: string;
  returnType: string;
  isAsync: boolean;
}

export type SchemaRenderDecision = 'interface' | 'type-alias' | 'enum' | 'union' | 'skip';

export interface DocBlock {
  summary?: string;
  description?: string;
  lines: string[];
}

export interface SerializationHint {
  dateProperties: string[];
}

export interface EnrichedSDKIR extends SDKIR {
  symbolTable: SymbolTable;
  importGraph: ImportGraph;
  schemaOrder: string[];
  domainAllocations: DomainAllocation[];
  signatures: Record<string, OperationSignature>;
  docBlocks: Record<string, DocBlock>;
  renderDecisions: Record<string, SchemaRenderDecision>;
  serialization: Record<string, SerializationHint>;
}

// ── Target language ──────────────────────────────────────────────────────────

export type TargetLanguage = 'typescript';

/**
 * SDK Intermediate Representation (IR)
 *
 * Design goals:
 * - Strict separation of intake → enrichment → generation
 * - Deterministic structures (no runtime ambiguity)
 * - Minimal optionality in hot paths
 * - Explicit ownership semantics for schema resolution
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core IR
// ─────────────────────────────────────────────────────────────────────────────

export interface SDKIR {
  meta: SDKMeta;
  groups: OperationGroup[];
  schemas: SchemaDefinition[];

  securitySchemes?: SecurityScheme[];
  webhooks?: WebhookDefinition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface SDKMeta {
  title: string;
  version: string;

  /**
   * Explicit package version override.
   * If omitted, generator resolves from registry and auto-bumps patch.
   */
  packageVersion?: string;

  description?: string;

  baseUrl: string;
  packageName: string;
  clientName: string;

  serverVariables?: ServerVariable[];
  environments?: EnvironmentDefinition[];

  schemaPackage?: SchemaPackageRef;
}

export interface ServerVariable {
  name: string;
  default: string;
  description?: string;
  enum?: string[];
}

export interface EnvironmentDefinition {
  name: string;
  baseUrl: string;
  description?: string;
}

export interface SchemaPackageRef {
  name: string;
  version?: string;
  importPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Security
// ─────────────────────────────────────────────────────────────────────────────

export interface SecurityScheme {
  name: string;
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";

  in?: "header" | "query" | "cookie";
  paramName?: string;

  scheme?: string;
  bearerFormat?: string;

  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────────────

export interface OperationGroup {
  name: string;
  sourceTag?: string;

  fileName: string;
  interfaceName: string;
  factoryName: string;

  description?: string;

  /**
   * Controls SDK exposure.
   * internal → excluded from public SDK output
   */
  visibility: "public" | "internal";

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

  cookieParams: Parameter[];

  requestBody?: RequestBodyDef;

  requestBodyContentTypes: string[];

  queryType?: string;
  headerType?: string;
  cookieType?: string;

  responseType: string;
  statusCode: number;

  deprecated: boolean;
  deprecationMessage?: string;

  timeoutMs?: number;

  visibility: "public" | "internal";

  isEventStream: boolean;
  eventSchema?: string;

  /**
   * Overrides SSE envelope type.
   * Must be exported from schema package if used.
   */
  sseReturnType?: string;
}

export interface Parameter {
  name: string;
  originalName: string;
  type: string;

  required: boolean;

  description?: string;
  deprecated?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request / Response
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestBodyDef {
  type: string;
  required: boolean;
  contentType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookDefinition {
  name: string;
  event: string;
  payloadType: string;
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema ownership model
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalImportMeta {
  packageName: string;
  importPath: string;
  exportName: string;

  /**
   * Optional version pin for diagnostics and multi-package resolution.
   */
  version?: string;
}

export type SchemaOwnershipKind = "generated" | "external";

export interface SchemaOwnership {
  kind: SchemaOwnershipKind;

  externalImport?: ExternalImportMeta;

  runtimeImport?: ExternalImportMeta;

  /**
   * Domain-scoped grouping hint used during enrichment.
   */
  domainFile?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema model
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Enriched IR
// ─────────────────────────────────────────────────────────────────────────────

export interface SymbolTableEntry {
  definedIn: string;

  /**
   * More specific typing improves downstream generation correctness.
   */
  kind: "interface" | "enum" | "alias" | "union" | "unknown";

  isExternal: boolean;

  importPath?: string;
}

export type SymbolTable = Record<string, SymbolTableEntry>;

/**
 * Adjacency list:
 * schema → direct dependencies
 */
export type ImportGraph = Record<string, readonly string[]>;

export interface DomainAllocation {
  fileName: string;
  schemas: string[];
}

export interface OperationSignature {
  params: string;
  returnType: string;
  isAsync: boolean;
}

export type SchemaRenderDecision =
  | "interface"
  | "type-alias"
  | "enum"
  | "union"
  | "skip";

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

// ─────────────────────────────────────────────────────────────────────────────
// Target language
// ─────────────────────────────────────────────────────────────────────────────

export type TargetLanguage = "typescript";

/**
 * Enrichment — transforms raw SDKIR into an enriched, compiler-ready IR.
 * Responsibilities:
 *  - Symbol resolution
 *  - Import graph construction
 *  - Topological schema ordering
 *  - Domain allocation
 *  - Render + serialization decisions
 *  - Method normalization (dedupe)
 *  - Operation signatures
 *  - Documentation blocks
 */

import type {
  SDKIR,
  EnrichedSDKIR,
  SchemaDefinition,
  OperationGroup,
  Operation,
  SymbolTable,
  ImportGraph,
  DomainAllocation,
  OperationSignature,
  DocBlock,
  SchemaRenderDecision,
  SerializationHint,
} from "../types/ir.js";

import { deduplicateMethodNames } from "../utils/naming.js";

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

export function enrich(ir: SDKIR): EnrichedSDKIR {
  const symbolTable = createSymbolTable(ir.schemas);
  const importGraph = createImportGraph(ir.schemas, symbolTable);

  const schemaOrder = topoSortSchemas(ir.schemas, importGraph);
  const renderDecisions = createRenderDecisions(ir.schemas);
  const serialization = createSerializationHints(ir.schemas);

  const groups = normalizeOperations(ir.groups);
  const signatures = createSignatures(groups);
  const docBlocks = createDocBlocks(groups);

  return {
    ...ir,
    groups,
    symbolTable,
    importGraph,
    schemaOrder,
    domainAllocations: createDomainAllocations(groups, ir.schemas),
    signatures,
    docBlocks,
    renderDecisions,
    serialization,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol Table
// ─────────────────────────────────────────────────────────────────────────────

function createSymbolTable(schemas: SchemaDefinition[]): SymbolTable {
  const table: SymbolTable = {};

  for (const schema of schemas) {
    const ownershipKind = schema.ownership?.kind ?? "types";

    table[schema.name] = {
      definedIn: ownershipKind === "generated" ? "types" : ownershipKind,
      kind: schema.isEnum ? "enum" : schema.isTypeAlias ? "alias" : "interface",
      isExternal: schema.ownership?.kind === "external",
      importPath: schema.ownership?.externalImport?.importPath,
    };
  }

  return table;
}

// ─────────────────────────────────────────────────────────────────────────────
// Import Graph
// ─────────────────────────────────────────────────────────────────────────────

function createImportGraph(
  schemas: SchemaDefinition[],
  symbolTable: SymbolTable,
): ImportGraph {
  const graph: ImportGraph = {};
  const schemaNames = new Set(schemas.map((s) => s.name));

  for (const schema of schemas) {
    const deps = new Set<string>();
    collectSchemaDependencies(schema, symbolTable, deps, schema.name);
    graph[schema.name] = [...deps].filter((d) => schemaNames.has(d));
  }

  return graph;
}

function collectSchemaDependencies(
  schema: SchemaDefinition,
  symbolTable: SymbolTable,
  out: Set<string>,
  self: string,
): void {
  if (schema.extends) {
    const ref = extractSimpleRef(schema.extends);
    if (ref && ref !== self && symbolTable[ref]) {
      out.add(ref);
    }
  }

  for (const prop of schema.properties) {
    collectTypeDependencies(prop.type, symbolTable, out, self);
  }

  if (schema.unionMembers) {
    for (const t of schema.unionMembers) {
      collectTypeDependencies(t, symbolTable, out, self);
    }
  }

  if (schema.intersectionMembers) {
    for (const t of schema.intersectionMembers) {
      collectTypeDependencies(t, symbolTable, out, self);
    }
  }

  if (schema.additionalPropertiesType) {
    collectTypeDependencies(
      schema.additionalPropertiesType,
      symbolTable,
      out,
      self,
    );
  }
}

function collectTypeDependencies(
  typeStr: string,
  symbolTable: SymbolTable,
  out: Set<string>,
  self: string,
): void {
  const matches = typeStr.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];

  for (const ref of matches) {
    if (
      ref !== self &&
      ref !== "Array" &&
      ref !== "Record" &&
      symbolTable[ref]
    ) {
      out.add(ref);
    }
  }
}

function extractSimpleRef(typeStr: string): string | undefined {
  const match = /^([A-Z][a-zA-Z0-9]+)$/.exec(typeStr);
  return match?.[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological Sort
// ─────────────────────────────────────────────────────────────────────────────

function topoSortSchemas(
  schemas: SchemaDefinition[],
  graph: ImportGraph,
): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;

    visiting.add(name);

    for (const dep of graph[name] ?? []) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }

  for (const s of schemas) {
    visit(s.name);
  }

  return order;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain Allocation
// ─────────────────────────────────────────────────────────────────────────────

function createDomainAllocations(
  groups: OperationGroup[],
  schemas: SchemaDefinition[],
): DomainAllocation[] {
  const map = new Map<string, Set<string>>();

  // Schema ownership-based grouping
  for (const schema of schemas) {
    if (schema.ownership?.kind === "generated" && schema.ownership.domainFile) {
      ensure(map, schema.ownership.domainFile).add(schema.name);
    }
  }

  // Operation-driven grouping
  for (const group of groups) {
    const set = ensure(map, group.fileName);

    for (const op of group.operations) {
      collectOperationRefs(op, set);
    }
  }

  return [...map.entries()].map(([fileName, schemas]) => ({
    fileName,
    schemas: [...schemas],
  }));
}

function ensure(map: Map<string, Set<string>>, key: string): Set<string> {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key)!;
}

function collectOperationRefs(op: Operation, out: Set<string>): void {
  const scan = (value?: string) => {
    if (!value) return;
    const matches = value.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
    for (const m of matches) {
      if (m !== "Array" && m !== "Record") out.add(m);
    }
  };

  scan(op.responseType);
  scan(op.requestBody?.type);
  scan(op.queryType);

  for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
    scan(p.type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render Decisions
// ─────────────────────────────────────────────────────────────────────────────

function createRenderDecisions(
  schemas: SchemaDefinition[],
): Record<string, SchemaRenderDecision> {
  const out: Record<string, SchemaRenderDecision> = {};

  for (const s of schemas) {
    if (s.ownership?.kind === "external") out[s.name] = "skip";
    else if (s.isEnum) out[s.name] = "enum";
    else if (s.isTypeAlias) out[s.name] = "type-alias";
    else if (s.isUnionType) out[s.name] = "union";
    else out[s.name] = "interface";
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization Hints
// ─────────────────────────────────────────────────────────────────────────────

function createSerializationHints(
  schemas: SchemaDefinition[],
): Record<string, SerializationHint> {
  const hints: Record<string, SerializationHint> = {};

  for (const schema of schemas) {
    const dateProps = schema.properties
      .filter((p) => p.format === "date" || p.format === "date-time")
      .map((p) => p.name);

    if (dateProps.length) {
      hints[schema.name] = { dateProperties: dateProps };
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operation Normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOperations(groups: OperationGroup[]): OperationGroup[] {
  return groups.map((group) => {
    const deduped = deduplicateMethodNames(group.operations.map((o) => o.name));

    return {
      ...group,
      operations: group.operations.map((op, i) => ({
        ...op,
        name: deduped[i],
      })),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Signatures
// ─────────────────────────────────────────────────────────────────────────────

function createSignatures(
  groups: OperationGroup[],
): Record<string, OperationSignature> {
  const out: Record<string, OperationSignature> = {};

  for (const group of groups) {
    for (const op of group.operations) {
      const params: string[] = [];

      for (const p of op.pathParams) {
        params.push(`${p.name}: ${p.type}`);
      }

      if (op.requestBody) {
        params.push(`body: ${op.requestBody.type}`);
      }

      if (op.queryType) {
        params.push(`query: ${op.queryType}`);
      } else {
        const req = op.queryParams
          .filter((p) => p.required)
          .map((p) => `${p.name}: ${p.type}`);

        const opt = op.queryParams
          .filter((p) => !p.required)
          .map((p) => `${p.name}?: ${p.type}`);

        if (req.length) params.push(req.join(", "));
        if (opt.length) params.push(opt.join(", "));
      }

      for (const h of op.headerParams) {
        params.push(`${h.name}${h.required ? "" : "?"}: ${h.type}`);
      }

      const returnType = op.isEventStream
        ? `AsyncIterable<${op.responseType}>`
        : op.responseType;

      out[`${group.name}.${op.name}`] = {
        params: params.join(", "),
        returnType,
        isAsync: true,
      };
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc Blocks
// ─────────────────────────────────────────────────────────────────────────────

function createDocBlocks(groups: OperationGroup[]): Record<string, DocBlock> {
  const out: Record<string, DocBlock> = {};

  for (const group of groups) {
    for (const op of group.operations) {
      const lines: string[] = [];

      if (op.summary) lines.push(op.summary);

      if (op.description && op.description !== op.summary) {
        if (lines.length) lines.push("");
        lines.push(op.description);
      }

      for (const p of op.pathParams) {
        lines.push(`@param ${p.name} ${p.description ?? ""}`);
      }

      if (op.requestBody) {
        lines.push(`@param body ${op.requestBody.type}`);
      }

      if (op.deprecated) {
        lines.push("@deprecated");
      }

      out[`${group.name}.${op.name}`] = {
        summary: op.summary,
        description: op.description,
        lines,
      };
    }
  }

  return out;
}

/**
 * Enrichment — adds symbol table, import graph, topological order,
 * doc blocks, signatures, and domain allocation to a raw SDKIR.
 */

import { camelCase, pascalCase } from 'change-case';
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
} from '../types/ir.js';
import { deduplicateMethodNames } from '../utils/naming.js';

// ── Entry point ──────────────────────────────────────────────────────────────

export function enrich(ir: SDKIR): EnrichedSDKIR {
  const symbolTable = buildSymbolTable(ir.schemas);
  const importGraph = buildImportGraph(ir.schemas, symbolTable);
  const schemaOrder = topoSort(ir.schemas, importGraph);
  const domainAllocations = buildDomainAllocations(ir.groups, ir.schemas, symbolTable);
  const renderDecisions = buildRenderDecisions(ir.schemas);
  const serialization = buildSerializationHints(ir.schemas);
  const operations = deduplicateAllMethods(ir.groups);
  const signatures = buildSignatures(operations);
  const docBlocks = buildDocBlocks(operations);

  return {
    ...ir,
    groups: operations,
    symbolTable,
    importGraph,
    schemaOrder,
    domainAllocations,
    signatures,
    docBlocks,
    renderDecisions,
    serialization,
  };
}

// ── Symbol table ─────────────────────────────────────────────────────────────

function buildSymbolTable(schemas: SchemaDefinition[]): SymbolTable {
  const table: SymbolTable = {};
  for (const s of schemas) {
    table[s.name] = {
      definedIn: s.ownership?.kind === 'generated' ? 'types' : s.ownership?.kind ?? 'types',
      kind: s.isEnum ? 'enum' : s.isTypeAlias ? 'alias' : 'interface',
      isExternal: s.ownership?.kind === 'external',
      importPath: s.ownership?.kind === 'external' ? s.ownership.externalImport?.importPath : undefined,
    };
  }
  return table;
}

// ── Import graph ─────────────────────────────────────────────────────────────

function buildImportGraph(schemas: SchemaDefinition[], symbolTable: SymbolTable): ImportGraph {
  const graph: ImportGraph = {};

  for (const schema of schemas) {
    const deps = new Set<string>();
    collectSchemaDeps(schema, symbolTable, deps);
    graph[schema.name] = [...deps];
  }

  return graph;
}

function collectSchemaDeps(schema: SchemaDefinition, symbolTable: SymbolTable, out: Set<string>): void {
  if (schema.extends) {
    const ref = extractRefName(schema.extends);
    if (ref && ref !== schema.name && ref in symbolTable) out.add(ref);
  }

  for (const prop of schema.properties) {
    collectTypeDeps(prop.type, symbolTable, out, schema.name);
  }

  if (schema.unionMembers) {
    for (const m of schema.unionMembers) collectTypeDeps(m, symbolTable, out, schema.name);
  }
  if (schema.intersectionMembers) {
    for (const m of schema.intersectionMembers) collectTypeDeps(m, symbolTable, out, schema.name);
  }
  if (schema.additionalPropertiesType) {
    collectTypeDeps(schema.additionalPropertiesType, symbolTable, out, schema.name);
  }
}

function collectTypeDeps(typeStr: string, symbolTable: SymbolTable, out: Set<string>, self: string): void {
  // Extract PascalCase words that could be symbol references
  const references = typeStr.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
  for (const ref of references) {
    if (ref !== self && ref in symbolTable && ref !== 'Array' && ref !== 'Record') {
      out.add(ref);
    }
  }
}

function extractRefName(typeStr: string): string | undefined {
  const match = typeStr.match(/^([A-Z][a-zA-Z0-9]+)$/);
  return match?.[1];
}

// ── Topological sort ─────────────────────────────────────────────────────────

function topoSort(schemas: SchemaDefinition[], importGraph: ImportGraph): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const visiting = new Set<string>(); // cycle detection

  const nameSet = new Set(schemas.map((s) => s.name));

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // break cycle
    visiting.add(name);

    const deps = importGraph[name] ?? [];
    for (const dep of deps) {
      if (nameSet.has(dep)) visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }

  for (const schema of schemas) {
    visit(schema.name);
  }

  return order;
}

// ── Domain allocations ───────────────────────────────────────────────────────

function buildDomainAllocations(
  groups: OperationGroup[],
  schemas: SchemaDefinition[],
  _symbolTable: SymbolTable,
): DomainAllocation[] {
  const domainMap = new Map<string, Set<string>>();

  // Schemas explicitly assigned to a domain
  for (const schema of schemas) {
    if (schema.ownership?.kind === 'generated' && schema.ownership.domainFile) {
      const domain = schema.ownership.domainFile;
      if (!domainMap.has(domain)) domainMap.set(domain, new Set());
      domainMap.get(domain)!.add(schema.name);
    }
  }

  // Schemas referenced by operations in each group
  for (const group of groups) {
    if (!domainMap.has(group.fileName)) domainMap.set(group.fileName, new Set());
    const domainSchemas = domainMap.get(group.fileName)!;

    for (const op of group.operations) {
      collectOperationSchemaRefs(op, domainSchemas);
    }
  }

  return Array.from(domainMap.entries()).map(([fileName, schemaNames]) => ({
    fileName,
    schemas: [...schemaNames],
  }));
}

function collectOperationSchemaRefs(op: Operation, out: Set<string>): void {
  const refs = (op.responseType + ' ' + (op.requestBody?.type ?? '') + ' ' + (op.queryType ?? ''))
    .match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
  for (const ref of refs) {
    if (ref !== 'Array' && ref !== 'Record') out.add(ref);
  }
  for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
    const pRefs = p.type.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
    for (const ref of pRefs) {
      if (ref !== 'Array' && ref !== 'Record') out.add(ref);
    }
  }
}

// ── Render decisions ─────────────────────────────────────────────────────────

function buildRenderDecisions(schemas: SchemaDefinition[]): Record<string, SchemaRenderDecision> {
  const decisions: Record<string, SchemaRenderDecision> = {};

  for (const schema of schemas) {
    if (schema.ownership?.kind === 'external') {
      decisions[schema.name] = 'skip';
    } else if (schema.isEnum) {
      decisions[schema.name] = 'enum';
    } else if (schema.isTypeAlias) {
      decisions[schema.name] = 'type-alias';
    } else if (schema.isUnionType) {
      decisions[schema.name] = 'union';
    } else {
      decisions[schema.name] = 'interface';
    }
  }

  return decisions;
}

// ── Serialization hints ──────────────────────────────────────────────────────

function buildSerializationHints(schemas: SchemaDefinition[]): Record<string, SerializationHint> {
  const hints: Record<string, SerializationHint> = {};

  for (const schema of schemas) {
    const dateProps: string[] = [];
    for (const prop of schema.properties) {
      if (prop.format === 'date-time' || prop.format === 'date') {
        dateProps.push(prop.name);
      }
    }
    if (dateProps.length > 0) {
      hints[schema.name] = { dateProperties: dateProps };
    }
  }

  return hints;
}

// ── Method deduplication ─────────────────────────────────────────────────────

function deduplicateAllMethods(groups: OperationGroup[]): OperationGroup[] {
  return groups.map((group) => {
    const names = group.operations.map((op) => op.name);
    const deduped = deduplicateMethodNames(names);
    return {
      ...group,
      operations: group.operations.map((op, i) => ({ ...op, name: deduped[i] })),
    };
  });
}

// ── Operation signatures ─────────────────────────────────────────────────────

function buildSignatures(groups: OperationGroup[]): Record<string, OperationSignature> {
  const signatures: Record<string, OperationSignature> = {};

  for (const group of groups) {
    for (const op of group.operations) {
      const paramParts: string[] = [];

      // Path params always first
      for (const p of op.pathParams) {
        paramParts.push(`${p.name}: ${p.type}`);
      }

      // Body param
      if (op.requestBody) {
        paramParts.push(`body: ${op.requestBody.type}`);
      }

      // Query params (as options bag)
      const optionalQuery = op.queryParams.filter((p) => !p.required);
      const requiredQuery = op.queryParams.filter((p) => p.required);
      if (requiredQuery.length > 0 || op.queryType) {
        if (op.queryType) {
          paramParts.push(`query: ${op.queryType}`);
        } else {
          const queryParts = requiredQuery.map((p) => `${p.name}: ${p.type}`);
          paramParts.push(queryParts.join(', '));
        }
      }
      if (optionalQuery.length > 0 && !op.queryType) {
        const optParts = optionalQuery.map((p) => `${p.name}?: ${p.type}`);
        paramParts.push(optParts.join(', '));
      }

      // Header params
      for (const h of op.headerParams) {
        paramParts.push(`${h.name}${h.required ? '' : '?'}: ${h.type}`);
      }

      const returnType = op.isEventStream ? `AsyncIterable<${op.responseType}>` : op.responseType;

      signatures[`${group.name}.${op.name}`] = {
        params: paramParts.join(', '),
        returnType,
        isAsync: true,
      };
    }
  }

  return signatures;
}

// ── Doc blocks ───────────────────────────────────────────────────────────────

function buildDocBlocks(groups: OperationGroup[]): Record<string, DocBlock> {
  const docs: Record<string, DocBlock> = {};

  for (const group of groups) {
    for (const op of group.operations) {
      const lines: string[] = [];

      if (op.summary) lines.push(op.summary);
      if (op.description && op.description !== op.summary) {
        if (lines.length > 0) lines.push('');
        lines.push(op.description);
      }

      for (const p of op.pathParams) {
        lines.push(`@param ${p.name} ${p.description ?? ''}`);
      }
      if (op.requestBody) {
        lines.push(`@param body ${op.requestBody.type}`);
      }

      if (op.deprecated) lines.push('@deprecated');

      docs[`${group.name}.${op.name}`] = {
        summary: op.summary,
        description: op.description,
        lines,
      };
    }
  }

  return docs;
}

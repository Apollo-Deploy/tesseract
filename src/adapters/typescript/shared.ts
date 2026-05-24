/**
 * Shared TypeScript adapter utilities.
 * External import grouping + schema ownership partitioning.
 *
 * Optimized for:
 * - Single-pass grouping where possible
 * - Reduced allocations in hot loops
 * - Safer deduplication logic
 */

import type { SchemaDefinition, SDKMeta } from "../../types/ir.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common runtime types emitted by shared templates.
 * Used to avoid redundant re-exports from external schema packages.
 */
export const COMMON_TYPE_NAMES = [
  "PaginationQuery",
  "PageMeta",
  "Page",
  "SuccessResponse",
  "MessageResponse",
  "ApiErrorEnvelope",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalExport {
  exportName: string;
  alias?: string;
}

export interface ExternalImportGroup {
  importPath: string;
  exports: ExternalExport[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema partitioning
// ─────────────────────────────────────────────────────────────────────────────

export function splitSchemasByOwnership(schemas: SchemaDefinition[]): {
  generatedSchemas: SchemaDefinition[];
  externalSchemas: SchemaDefinition[];
} {
  const generated: SchemaDefinition[] = [];
  const external: SchemaDefinition[] = [];

  for (const s of schemas) {
    if (s.ownership?.kind === "external") {
      external.push(s);
    } else {
      generated.push(s);
    }
  }

  return {
    generatedSchemas: generated,
    externalSchemas: external,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// External import grouping
// ─────────────────────────────────────────────────────────────────────────────

export function buildExternalImportGroups(
  schemas: SchemaDefinition[],
): ExternalImportGroup[] {
  const groups = new Map<string, ExternalImportGroup>();

  for (const schema of schemas) {
    const ownership = schema.ownership;
    if (!ownership || ownership.kind !== "external") continue;

    const imp = ownership.externalImport;
    if (!imp) continue;

    const importPath = imp.importPath;
    const exportName = imp.exportName;

    let group = groups.get(importPath);

    if (!group) {
      group = {
        importPath,
        exports: [],
      };
      groups.set(importPath, group);
    }

    const exports = group.exports;

    // Fast dedup (avoid O(n²) .some scans)
    let exists = false;
    for (let i = 0; i < exports.length; i++) {
      const e = exports[i];
      if (
        e.exportName === exportName &&
        e.alias === (schema.name !== exportName ? schema.name : undefined)
      ) {
        exists = true;
        break;
      }
    }

    if (exists) continue;

    exports.push({
      exportName,
      alias: schema.name !== exportName ? schema.name : undefined,
    });
  }

  // Stable sort for deterministic output
  const result = [...groups.values()];

  for (const g of result) {
    g.exports.sort((a, b) => {
      const aKey = `${a.exportName}:${a.alias ?? ""}`;
      const bKey = `${b.exportName}:${b.alias ?? ""}`;
      return aKey.localeCompare(bKey);
    });
  }

  result.sort((a, b) => a.importPath.localeCompare(b.importPath));

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// External package collection
// ─────────────────────────────────────────────────────────────────────────────

export function collectExternalPackages(
  schemas: SchemaDefinition[],
  schemaPackage?: SDKMeta["schemaPackage"],
): Array<{ name: string; version: string }> {
  const packages = new Map<string, string>();

  for (const schema of schemas) {
    const imp = schema.ownership?.externalImport;
    if (imp?.packageName) {
      packages.set(imp.packageName, imp.version ?? "*");
    }
  }

  if (schemaPackage?.name) {
    packages.set(schemaPackage.name, schemaPackage.version ?? "*");
  }

  const result: Array<{ name: string; version: string }> = [];

  for (const [name, version] of packages) {
    result.push({ name, version });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

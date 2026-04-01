/**
 * Shared TypeScript adapter utilities.
 * External import grouping and schema splitting.
 */

import type { SchemaDefinition, SDKMeta } from '../../types/ir.js';

/** Common type names emitted by types-common.hbs. Used to skip re-exporting
 *  types that are already provided by an external schema package. */
export const COMMON_TYPE_NAMES = [
  'PaginationQuery',
  'PageMeta',
  'Page',
  'SuccessResponse',
  'MessageResponse',
  'ApiErrorEnvelope',
] as const;

export interface ExternalExport {
  exportName: string;
  alias?: string;
}

export interface ExternalImportGroup {
  importPath: string;
  exports: ExternalExport[];
}

export function splitSchemasByOwnership(schemas: SchemaDefinition[]): {
  generatedSchemas: SchemaDefinition[];
  externalSchemas: SchemaDefinition[];
} {
  return {
    generatedSchemas: schemas.filter((s) => s.ownership?.kind !== 'external'),
    externalSchemas: schemas.filter((s) => s.ownership?.kind === 'external'),
  };
}

export function buildExternalImportGroups(schemas: SchemaDefinition[]): ExternalImportGroup[] {
  const byPath = new Map<string, ExternalImportGroup>();

  for (const schema of schemas) {
    if (schema.ownership?.kind !== 'external') continue;
    const ei = schema.ownership.externalImport;
    if (!ei) continue;

    const exportEntry: ExternalExport = {
      exportName: ei.exportName,
      alias: schema.name !== ei.exportName ? schema.name : undefined,
    };

    const existing = byPath.get(ei.importPath);
    if (!existing) {
      byPath.set(ei.importPath, { importPath: ei.importPath, exports: [exportEntry] });
      continue;
    }

    if (!existing.exports.some((e) => e.exportName === exportEntry.exportName && e.alias === exportEntry.alias)) {
      existing.exports.push(exportEntry);
    }
  }

  return [...byPath.values()]
    .map((group) => ({
      ...group,
      exports: [...group.exports].sort((a, b) =>
        `${a.exportName}:${a.alias ?? ''}`.localeCompare(`${b.exportName}:${b.alias ?? ''}`),
      ),
    }))
    .sort((a, b) => a.importPath.localeCompare(b.importPath));
}

export function collectExternalPackages(
  schemas: SchemaDefinition[],
  schemaPackage?: SDKMeta['schemaPackage'],
): Array<{ name: string; version: string }> {
  const packages = new Map<string, string>();
  for (const schema of schemas) {
    if (schema.ownership?.kind !== 'external') continue;
    if (schema.ownership.externalImport) {
      packages.set(schema.ownership.externalImport.packageName, '*');
    }
  }
  if (schemaPackage) {
    packages.set(schemaPackage.name, schemaPackage.version ?? '*');
  }
  return [...packages.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => ({ name, version }));
}

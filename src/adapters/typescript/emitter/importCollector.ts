/**
 * Import resolution for schema dependencies.
 */

import { SchemaDefinition } from "../../../types/ir.js";

export function collectTypeImportStatements(
  schemas: SchemaDefinition[],
  schemasByName: Map<string, SchemaDefinition>,
  known: Set<string>,
): string[] {
  const imports = new Map<string, Set<string>>();

  for (const s of schemas) {
    for (const ref of extractRefs(s, known)) {
      const target = schemasByName.get(ref);
      if (!target) continue;

      const path =
        target.ownership?.kind === "external"
          ? target.ownership.externalImport!.importPath
          : "./models.js";

      if (!imports.has(path)) imports.set(path, new Set());
      imports.get(path)!.add(target.name);
    }
  }

  return [...imports.entries()].map(
    ([path, set]) => `import type { ${[...set].join(", ")} } from '${path}';`,
  );
}

function extractRefs(schema: SchemaDefinition, known: Set<string>): string[] {
  const refs = new Set<string>();

  for (const p of schema.properties) {
    if (known.has(p.type)) {
      refs.add(p.type);
    } else {
      // Extract inner type from generics like Array<T> or T[]
      const inner = extractInnerType(p.type);
      if (inner && known.has(inner)) refs.add(inner);
    }
  }

  if (schema.unionMembers)
    schema.unionMembers.forEach((m) => known.has(m) && refs.add(m));
  if (schema.intersectionMembers)
    schema.intersectionMembers.forEach((m) => known.has(m) && refs.add(m));

  if (
    schema.additionalPropertiesType &&
    known.has(schema.additionalPropertiesType)
  ) {
    refs.add(schema.additionalPropertiesType);
  }

  if (schema.extends && known.has(schema.extends)) refs.add(schema.extends);

  return [...refs];
}

/**
 * Extract the inner type name from a generic type string.
 * Handles `Array<T>` and `T[]` patterns.
 * Returns the inner type name, or undefined if no match.
 */
function extractInnerType(type: string): string | undefined {
  // Array<T>
  const arrayGeneric = /^Array<([A-Za-z_$][A-Za-z0-9_$]*)>$/.exec(type);
  if (arrayGeneric) return arrayGeneric[1];
  // T[]
  const arrayBracket = /^([A-Za-z_$][A-Za-z0-9_$]*)\[\]$/.exec(type);
  if (arrayBracket) return arrayBracket[1];
  return undefined;
}

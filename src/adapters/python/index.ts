/**
 * Python language adapter.
 * Emits a Python SDK package using Handlebars templates.
 */

import { join } from "node:path";
import Handlebars from "handlebars";
import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";

// ── Python type mapping ───────────────────────────────────────────────────

const PYTHON_TYPE_MAP: Record<string, string> = {
  string: "str",
  number: "float",
  integer: "int",
  boolean: "bool",
  any: "Any",
  unknown: "Any",
  void: "None",
  null: "None",
};

function pythonType(tsType: string): string {
  const t = tsType.trim();
  if (PYTHON_TYPE_MAP[t]) return PYTHON_TYPE_MAP[t];
  // Nullable: T | null → Optional[T]
  const nullMatch = t.match(/^(.+?)\s*\|\s*null$/);
  if (nullMatch) return `Optional[${pythonType(nullMatch[1])}]`;
  // Array<T> → List[T]
  const arrMatch = t.match(/^Array<(.+)>$/);
  if (arrMatch) return `List[${pythonType(arrMatch[1])}]`;
  // Record<K, V> → Dict[K, V]
  const recMatch = t.match(/^Record<(.+?)\s*,\s*(.+)>$/);
  if (recMatch)
    return `Dict[${pythonType(recMatch[1])}, ${pythonType(recMatch[2])}]`;
  // Handle TypeScript union literals: "a" | "b" → just use str
  if (t.startsWith('"') || t.startsWith("'")) return "str";
  return t;
}

let pythonHelpersRegistered = false;

function registerPythonHelpers(): void {
  if (pythonHelpersRegistered) return;
  pythonHelpersRegistered = true;
  Handlebars.registerHelper("pythonType", (tsType: string) =>
    pythonType(tsType),
  );
}

export class PythonAdapter implements LanguageAdapter {
  readonly language = "python";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();
    registerPythonHelpers();
    const files: EmittedFile[] = [];
    const warnings: string[] = [];

    const schemaNames = new Set(enriched.schemas.map((s) => s.name));

    // ── Visibility filter ──────────────────────────────────────────────────
    const clientType = config?.clientType ?? "internal";
    const visibleGroups = enriched.groups
      .filter((g) => {
        if (clientType === "public" && g.visibility === "internal")
          return false;
        return g.operations.some(
          (op) => clientType !== "public" || op.visibility !== "internal",
        );
      })
      .map((g) => {
        if (clientType === "public") {
          return {
            ...g,
            operations: g.operations.filter(
              (op) => op.visibility !== "internal",
            ),
          };
        }
        return g;
      });

    const hasSSE = visibleGroups.some((g) =>
      g.operations.some((op) => op.isEventStream),
    );

    const packageName = enriched.meta.packageName;
    const moduleName = packageName.replace(/^@.+\//, "").replace(/-/g, "_");

    // ── Template emission helper ───────────────────────────────────────────
    const emit = (
      relativePath: string,
      tplName: string,
      ctx: unknown,
    ): void => {
      try {
        files.push({
          relativePath,
          content: getTemplate("python", tplName)(ctx),
        });
      } catch (err) {
        warnings.push(
          `${relativePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    // ── Package files ─────────────────────────────────────────────────────
    emit("pyproject.toml", "pyproject", {
      ...enriched.meta,
      moduleName,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      moduleName,
    });

    // ── Source files ──────────────────────────────────────────────────────
    emit(join(moduleName, "__init__.py"), "index", {
      ...enriched.meta,
      groups: visibleGroups,
      hasSSE,
      moduleName,
    });

    emit(join(moduleName, "client.py"), "client", {
      ...enriched.meta,
      groups: visibleGroups,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      moduleName,
      clientType,
    });

    emit(join(moduleName, "transport.py"), "transport", {
      securitySchemes: enriched.securitySchemes,
      moduleName,
    });

    emit(join(moduleName, "types.py"), "types", {
      schemas: enriched.schemas,
      moduleName,
    });

    emit(join(moduleName, "errors.py"), "types-errors", {
      moduleName,
    });

    emit(join(moduleName, "resources", "__init__.py"), "resources-init", {
      groups: visibleGroups,
      moduleName,
    });

    // ── Domain files ──────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);
      const groupHasSSE = group.operations.some((op) => op.isEventStream);

      emit(join(moduleName, "resources", `${group.fileName}.py`), "domain", {
        ...group,
        imports,
        hasSSE: groupHasSSE,
        securitySchemes: enriched.securitySchemes,
        moduleName,
      });
    }

    return { files, warnings };
  }
}

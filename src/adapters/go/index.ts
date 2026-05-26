/**
 * Go language adapter.
 * Generates an idiomatic Go SDK package using net/http.
 */

import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";
import Handlebars from "handlebars";

function goTypeExpr(tsType: string | undefined): string {
  if (!tsType) return "interface{}";
  // If it's a simple identifier (alphanumeric), pass through
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tsType)) return "*" + tsType;
  // If it's a TypeScript inline type with braces, use interface{}
  return "interface{}";
}

function goPropertyType(tsType: string): string {
  const t = tsType.trim();
  const MAP: Record<string, string> = {
    string: "string",
    number: "float64",
    integer: "int",
    boolean: "bool",
    any: "interface{}",
    unknown: "interface{}",
  };
  if (MAP[t]) return MAP[t];
  // Array<T>
  const arr = t.match(/^Array<(.+)>$/);
  if (arr) return `[]${goPropertyType(arr[1])}`;
  // Record<K, V>
  const rec = t.match(/^Record<(.+),\s*(.+)>$/);
  if (rec) return `map[${goPropertyType(rec[1])}]${goPropertyType(rec[2])}`;
  // TypeScript union literals → string
  if (/^["']/.test(t)) return "string";
  return t;
}

let goHelpersRegistered = false;

function registerGoHelpers(): void {
  if (goHelpersRegistered) return;
  goHelpersRegistered = true;
  Handlebars.registerHelper("goQueryType", (tsType: string | undefined) =>
    goTypeExpr(tsType),
  );
  Handlebars.registerHelper("goPropertyType", (tsType: string) =>
    goPropertyType(tsType),
  );
}

export class GoAdapter implements LanguageAdapter {
  readonly language = "go";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();
    registerGoHelpers();

    const files: EmittedFile[] = [];
    const warnings: string[] = [];

    const schemaNames = new Set(enriched.schemas.map((s) => s.name));
    const clientType = config?.clientType ?? "internal";

    // ── Visibility filtering ───────────────────────────────────────────────
    const visibleGroups: typeof enriched.groups = [];

    for (const g of enriched.groups) {
      if (clientType === "public" && g.visibility === "internal") continue;

      const ops =
        clientType === "public"
          ? g.operations.filter((op) => op.visibility !== "internal")
          : g.operations;

      if (ops.length === 0) continue;

      visibleGroups.push(ops === g.operations ? g : { ...g, operations: ops });
    }

    const hasSSE = visibleGroups.some((g) =>
      g.operations.some((op) => op.isEventStream),
    );

    const pkgName = (enriched.meta.packageName.split("/").pop() || "sdk")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^[^a-zA-Z_]/, "sdk");

    // ── Emit helper ────────────────────────────────────────────────────────
    const emit = (
      relativePath: string,
      templateName: string,
      ctx: unknown,
    ): void => {
      try {
        const tpl = getTemplate("go", templateName);
        files.push({ relativePath, content: tpl(ctx) });
      } catch (err) {
        warnings.push(
          `${relativePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    // ── Root files ─────────────────────────────────────────────────────────
    emit("go.mod", "go-mod", {
      ...enriched.meta,
      pkgName,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      pkgName,
    });

    // ── Core package files ─────────────────────────────────────────────────
    emit("client.go", "client", {
      ...enriched.meta,
      groups: visibleGroups,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      pkgName,
      clientType,
    });

    emit("transport.go", "transport", {
      securitySchemes: enriched.securitySchemes,
      pkgName,
    });

    emit("errors.go", "errors", {
      pkgName,
    });

    emit("types.go", "types", {
      schemas: enriched.schemas,
      pkgName,
    });

    emit("utils.go", "utils", {
      pkgName,
    });

    // ── Domain files ───────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);
      const groupHasSSE = group.operations.some((op) => op.isEventStream);

      emit(`${group.fileName}.go`, "domain", {
        ...group,
        imports,
        hasSSE: groupHasSSE,
        securitySchemes: enriched.securitySchemes,
        pkgName,
      });
    }

    return { files, warnings };
  }
}

/**
 * Rust language adapter.
 * Emits a Cargo-based Rust SDK with reqwest transport, serde types, and
 * tokio async runtime.
 */

import { join } from "node:path";
import { snakeCase } from "change-case";
import Handlebars from "handlebars";

import type {
  EnrichedSDKIR,
  Operation,
  SchemaDefinition,
  SchemaProperty,
} from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";

// ─────────────────────────────────────────────────────────────────────────────
// Rust type mapping
// ─────────────────────────────────────────────────────────────────────────────

const RUST_TYPE_MAP: Record<string, string> = {
  string: "String",
  number: "f64",
  integer: "i64",
  boolean: "bool",
  any: "serde_json::Value",
  unknown: "serde_json::Value",
  void: "()",
};

function rustType(tsType: string, isParam: boolean = false): string {
  // Strip whitespace
  const t = tsType.trim();

  // String literal → String
  if (t.startsWith('"') || t.startsWith("'")) return "String";

  // Direct map
  if (RUST_TYPE_MAP[t]) {
    const rust = RUST_TYPE_MAP[t];
    return isParam && rust === "String" ? "&str" : rust;
  }

  // Nullable: `T | null` → Option<T>
  const nullMatch = t.match(/^(.+?)\s*\|\s*null$/);
  if (nullMatch) {
    return `Option<${rustType(nullMatch[1], false)}>`;
  }

  // Array<T> → Vec<T>
  const arrMatch = t.match(/^Array<(.+)>$/);
  if (arrMatch) {
    return `Vec<${rustType(arrMatch[1], false)}>`;
  }

  // Record<K, V> → HashMap<K, V>
  const recMatch = t.match(/^Record<(.+),\s*(.+)>$/);
  if (recMatch) {
    return `std::collections::HashMap<${rustType(recMatch[1], false)}, ${rustType(recMatch[2], false)}>`;
  }

  // Map<T> → HashMap<String, T>
  const mapMatch = t.match(/^Map<(.+)>$/);
  if (mapMatch) {
    return `std::collections::HashMap<String, ${rustType(mapMatch[1], false)}>`;
  }

  // Union type `A | B` — approximate with enum or keep as-is
  if (t.includes(" | ")) {
    const parts = t.split(" | ").map((p) => rustType(p.trim(), false));
    // For schema unions, just return the first concrete type name
    // Real union support requires enum generation at the schema level
    return parts.join("Or").replace(/\s/g, "");
  }

  // Intersection type — approximate
  if (t.includes(" & ")) {
    return t.replace(/\s*&\s*/g, "And").replace(/\s/g, "");
  }

  // Parenthesized
  if (t.startsWith("(") && t.endsWith(")")) {
    return rustType(t.slice(1, -1), false);
  }

  // Passthrough (schema type names)
  return t;
}

function rustParamType(tsType: string): string {
  return rustType(tsType, true);
}

function rustReturnType(tsType: string): string {
  if (tsType === "void") return "()";
  return rustType(tsType, false);
}

function isRustCopyType(tsType: string): boolean {
  const rust = rustType(tsType, false);
  return ["f64", "i64", "bool", "i32", "u32", "usize", "()"].includes(rust);
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

export class RustAdapter implements LanguageAdapter {
  readonly language = "rust";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

    // Register Rust-specific helpers
    Handlebars.registerHelper("rustType", (tsType: string) => {
      return new Handlebars.SafeString(rustType(tsType, false));
    });
    Handlebars.registerHelper("rustParamType", (tsType: string) => {
      return new Handlebars.SafeString(rustParamType(tsType));
    });
    Handlebars.registerHelper("rustReturnType", (tsType: string) => {
      return new Handlebars.SafeString(rustReturnType(tsType));
    });
    Handlebars.registerHelper("isRustCopyType", (tsType: string) => {
      return isRustCopyType(tsType);
    });
    Handlebars.registerHelper("rustQueryType", (tsType: string) => {
      // Simple type name → use as-is; inline TS type → use serde_json::Value
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tsType))
        return new Handlebars.SafeString(tsType);
      return new Handlebars.SafeString("serde_json::Value");
    });

    const files: EmittedFile[] = [];
    const warnings: string[] = [];
    const schemaNames = new Set(enriched.schemas.map((s) => s.name));
    const clientType = config?.clientType ?? "internal";

    // ── Visibility filtering ────────────────────────────────────────────────
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

    const crateName = enriched.meta.packageName
      .replace(/^@.+\//, "")
      .replace(/-/g, "_");

    // ── Helper ──────────────────────────────────────────────────────────────
    const emit = (
      relativePath: string,
      tplName: string,
      ctx: unknown,
    ): void => {
      try {
        files.push({
          relativePath,
          content: getTemplate("rust", tplName)(ctx),
        });
      } catch (err) {
        warnings.push(
          `${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    // ── Root files ──────────────────────────────────────────────────────────
    emit("Cargo.toml", "cargo", {
      ...enriched.meta,
      crateName,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      crateName,
    });

    // ── src/ files ──────────────────────────────────────────────────────────
    const srcDir = "src";

    emit(join(srcDir, "lib.rs"), "lib", {
      ...enriched.meta,
      groups: visibleGroups,
      hasSSE,
      crateName,
    });

    emit(join(srcDir, "client.rs"), "client", {
      ...enriched.meta,
      groups: visibleGroups,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      crateName,
    });

    emit(join(srcDir, "api", "mod.rs"), "api-mod", {
      groups: visibleGroups,
    });

    emit(join(srcDir, "transport.rs"), "transport", {
      securitySchemes: enriched.securitySchemes,
      crateName,
    });

    emit(join(srcDir, "error.rs"), "error", {
      crateName,
    });

    emit(join(srcDir, "types.rs"), "types", {
      schemas: enriched.schemas,
      crateName,
    });

    // ── Domain files ────────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);
      const transformedOps = group.operations.map((op) => ({
        ...op,
        pathParams: op.pathParams.map((p) => ({
          ...p,
          rustParamType: rustParamType(p.type),
          rustType: rustType(p.type, false),
        })),
        requestBody: op.requestBody
          ? {
              ...op.requestBody,
              rustType: rustType(op.requestBody.type, false),
            }
          : undefined,
        rustResponseType: rustReturnType(op.responseType),
        _queryParams: op.queryParams,
      }));

      emit(join(srcDir, "api", `${snakeCase(group.fileName)}.rs`), "domain", {
        ...group,
        operations: transformedOps,
        imports,
        securitySchemes: enriched.securitySchemes,
        crateName,
      });
    }

    return { files, warnings };
  }
}

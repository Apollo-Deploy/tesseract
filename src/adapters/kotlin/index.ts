/**
 * Kotlin language adapter.
 * Emits a Gradle-based Kotlin SDK with Ktor HTTP client, kotlinx.serialization,
 * and coroutines for async operations.
 */

import { join } from "node:path";
import Handlebars from "handlebars";

import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import { getTemplate, registerHelpers, collectImports } from "../../helpers/handlebars.js";

// ─────────────────────────────────────────────────────────────────────────────
// Kotlin type mapping
// ─────────────────────────────────────────────────────────────────────────────

const KOTLIN_TYPE_MAP: Record<string, string> = {
  string: "String",
  number: "Double",
  integer: "Long",
  boolean: "Boolean",
  any: "kotlinx.serialization.json.JsonElement",
  unknown: "kotlinx.serialization.json.JsonElement",
  void: "Unit",
  null: "Nothing?",
};

function kotlinType(tsType: string): string {
  const t = tsType.trim();

  if (KOTLIN_TYPE_MAP[t]) {
    return KOTLIN_TYPE_MAP[t];
  }

  // Nullable: `T | null` → `T?`
  const nullMatch = t.match(/^(.+?)\s*\|\s*null$/);
  if (nullMatch) {
    return `${kotlinType(nullMatch[1])}?`;
  }

  // Array<T> → List<T>
  const arrMatch = t.match(/^Array<(.+)>$/);
  if (arrMatch) {
    return `List<${kotlinType(arrMatch[1])}>`;
  }

  // Record<K, V> → Map<K, V>
  const recMatch = t.match(/^Record<(.+),\s*(.+)>$/);
  if (recMatch) {
    return `Map<${kotlinType(recMatch[1])}, ${kotlinType(recMatch[2])}>`;
  }

  // Map<T> → Map<String, T>
  const mapMatch = t.match(/^Map<(.+)>$/);
  if (mapMatch) {
    return `Map<String, ${kotlinType(mapMatch[1])}>`;
  }

  // Union type `A | B` → approximate with sealed class ref
  if (t.includes(" | ")) {
    const parts = t.split(" | ").map((p) => kotlinType(p.trim()));
    return parts.join("Or").replace(/\s/g, "");
  }

  // Intersection type — approximate
  if (t.includes(" & ")) {
    return t.replace(/\s*&\s*/g, "And").replace(/\s/g, "");
  }

  // Parenthesized
  if (t.startsWith("(") && t.endsWith(")")) {
    return kotlinType(t.slice(1, -1));
  }

  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

export class KotlinAdapter implements LanguageAdapter {
  readonly language = "kotlin";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

    // Register Kotlin-specific helpers
    Handlebars.registerHelper("kotlinType", (tsType: string) => {
      return new Handlebars.SafeString(kotlinType(tsType));
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

    // ── Package name resolution ─────────────────────────────────────────────
    const pkgName = enriched.meta.packageName
      .replace(/^@.+\//, "")
      .replace(/-/g, ".");

    const pkgPath = pkgName.replace(/\./g, "/");

    const groupId = enriched.meta.packageName.startsWith("@")
      ? enriched.meta.packageName.replace(/^@/, "").replace(/\/.+$/, "")
      : "com.example";

    const artifactId = enriched.meta.packageName
      .replace(/^@.+\//, "")
      .replace(/-/g, "-");

    // ── Helper ──────────────────────────────────────────────────────────────
    const emit = (relativePath: string, tplName: string, ctx: unknown): void => {
      try {
        files.push({
          relativePath,
          content: getTemplate("kotlin", tplName)(ctx),
        });
      } catch (err) {
        warnings.push(
          `${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    // ── Root files ──────────────────────────────────────────────────────────
    emit("build.gradle.kts", "build-gradle", {
      ...enriched.meta,
      groupId,
      artifactId,
    });

    emit("settings.gradle.kts", "settings-gradle", {
      artifactId,
    });

    emit("gradle.properties", "gradle-properties", {
      ...enriched.meta,
      groupId,
      artifactId,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      groupId,
      artifactId,
      packageName: pkgName,
    });

    // ── Source files ────────────────────────────────────────────────────────
    const srcDir = join("src", "main", "kotlin", ...pkgName.split("."));

    emit(join(srcDir, "Client.kt"), "client", {
      ...enriched.meta,
      groups: visibleGroups,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      packageName: pkgName,
    });

    emit(join(srcDir, "Transport.kt"), "transport", {
      securitySchemes: enriched.securitySchemes,
      packageName: pkgName,
    });

    emit(join(srcDir, "Errors.kt"), "errors", {
      packageName: pkgName,
    });

    emit(join(srcDir, "Types.kt"), "types", {
      schemas: enriched.schemas,
      packageName: pkgName,
    });

    // ── Domain files ────────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);
      const transformedOps = group.operations.map((op) => ({
        ...op,
        pathParams: op.pathParams.map((p) => ({
          ...p,
          kotlinType: kotlinType(p.type),
        })),
        requestBody: op.requestBody
          ? {
              ...op.requestBody,
              kotlinType: kotlinType(op.requestBody.type),
            }
          : undefined,
        kotlinResponseType: kotlinType(op.responseType),
        _queryParams: op.queryParams,
      }));

      emit(join(srcDir, `${group.interfaceName}.kt`), "domain", {
        ...group,
        operations: transformedOps,
        imports,
        securitySchemes: enriched.securitySchemes,
        packageName: pkgName,
      });
    }

    return { files, warnings };
  }
}

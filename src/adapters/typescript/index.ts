/**
 * TypeScript language adapter.
 * Orchestrates model emission (ts-morph) and template rendering (Handlebars).
 */

import { join } from "node:path";
import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";

import {
  splitSchemasByOwnership,
  buildExternalImportGroups,
  collectExternalPackages,
  COMMON_TYPE_NAMES,
} from "./shared.js";

import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";

import { formatTypeScript } from "../../utils/format.js";
import { emitTypeScriptModels } from "./emitter/emitTypeScriptModels.js";

export class TypeScriptAdapter implements LanguageAdapter {
  readonly language = "typescript";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

    const sdkStyle = config?.sdkStyle ?? "functional";
    const clientType = config?.clientType ?? "internal";

    const files: EmittedFile[] = [];
    const warnings: string[] = [];

    // ── Schema partition (single pass, avoid repeated scans) ────────────────
    const schemas = enriched.schemas;
    const schemaNames = new Set<string>();
    const externalSchemas: typeof schemas = [];

    for (const s of schemas) {
      schemaNames.add(s.name);
      if (s.ownership?.kind === "external") externalSchemas.push(s);
    }

    const { generatedSchemas } = splitSchemasByOwnership(schemas);

    // ── External imports (stable + deduped) ────────────────────────────────
    const externalImports = buildExternalImportGroups(externalSchemas);

    if (enriched.meta.schemaPackage) {
      const importPath =
        enriched.meta.schemaPackage.importPath ??
        enriched.meta.schemaPackage.name;

      if (!externalImports.some((g) => g.importPath === importPath)) {
        externalImports.unshift({ importPath, exports: [] });
      }
    }

    const externalTypeNames = new Set(externalSchemas.map((s) => s.name));
    const commonTypeExports = COMMON_TYPE_NAMES.filter(
      (n) => !externalTypeNames.has(n),
    );

    const externalPackages = collectExternalPackages(
      schemas,
      enriched.meta.schemaPackage,
    );

    // ── Visibility filter (single pass, avoids map+filter chain) ───────────
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

    // ── Model emission (optional ts-morph stage) ───────────────────────────
    let domainTypeFiles: string[] = [];
    let includeModels = false;

    // Emit models for any inline-generated schemas that are NOT covered by the
    // schema package (ownership !== 'external'). When a schemaPackage is
    // configured and all schemas are external (Zod global registry hit for
    // every body/response), this will be empty and model emission is skipped.
    const hasGeneratedSchemas = enriched.schemas.some(
      (s) => s.ownership?.kind !== "external",
    );

    if (hasGeneratedSchemas) {
      try {
        const res = emitTypeScriptModels(enriched, outputDir);
        files.push(...res.files);
        domainTypeFiles = res.domainTypeFiles;
        includeModels = true;
      } catch (err) {
        warnings.push(
          `ts-morph model emission failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // ── Templates (cached + safe execution) ────────────────────────────────

    const domainTemplate = getTemplate(
      "typescript",
      sdkStyle === "class" ? "domain-class" : "domain",
    );

    for (const group of visibleGroups) {
      try {
        const imports = collectImports(group.operations, schemaNames);
        const groupHasSSE = group.operations.some((op) => op.isEventStream);

        files.push({
          relativePath: join("src", "domain", `${group.fileName}.ts`),
          content: domainTemplate({
            ...group,
            imports,
            hasSSE: groupHasSSE,
            securitySchemes: enriched.securitySchemes,
          }),
        });
      } catch (err) {
        warnings.push(
          `domain/${group.fileName}.ts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const emit = (
      relativePath: string,
      tpl: ReturnType<typeof getTemplate>,
      ctx: unknown,
    ): void => {
      try {
        files.push({
          relativePath,
          content: tpl(ctx),
        });
      } catch (err) {
        warnings.push(
          `${relativePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    emit(
      join("src", "domain", "index.ts"),
      getTemplate("typescript", "domain-index"),
      {
        groups: visibleGroups,
      },
    );

    emit("src/types/common.ts", getTemplate("typescript", "types-common"), {});
    emit("src/types/errors.ts", getTemplate("typescript", "types-errors"), {});
    emit("src/types/index.ts", getTemplate("typescript", "types"), {
      schemas: generatedSchemas,
      externalImports,
      domainTypeFiles,
      commonTypeExports,
      includeModels,
    });

    emit("src/transport/axios.ts", getTemplate("typescript", "transport"), {
      securitySchemes: enriched.securitySchemes,
    });

    if (hasSSE) {
      emit(
        "src/transport/sse.ts",
        getTemplate("typescript", "transport-sse"),
        {},
      );
    }

    emit("src/utils/query.ts", getTemplate("typescript", "utils-query"), {});
    emit("src/utils/index.ts", getTemplate("typescript", "utils-index"), {});

    emit(
      "src/client.ts",
      getTemplate(
        "typescript",
        sdkStyle === "class" ? "client-class" : "client",
      ),
      {
        meta: enriched.meta,
        groups: visibleGroups,
        securitySchemes: enriched.securitySchemes,
        hasSSE,
        clientType,
      },
    );

    emit(
      "index.ts",
      getTemplate("typescript", sdkStyle === "class" ? "index-class" : "index"),
      {
        meta: enriched.meta,
        groups: visibleGroups,
        schemas: schemas,
        hasSSE,
        clientType,
      },
    );

    // ── Package version resolution (parallel-safe) ─────────────────────────
    const resolvedPackageVersion = enriched.meta.packageVersion
      ? enriched.meta.packageVersion
      : await resolveNpmPackageVersion(
          enriched.meta.packageName,
          enriched.meta.version,
          warnings,
          config?.npmToken,
        );

    emit("package.json", getTemplate("typescript", "package-json"), {
      ...enriched.meta,
      packageVersion: resolvedPackageVersion,
      externalPackages,
    });

    emit("tsconfig.json", getTemplate("typescript", "tsconfig"), {});
    emit("README.md", getTemplate("typescript", "readme"), {
      ...enriched.meta,
      groups: visibleGroups,
      schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
    });

    // ── Parallel formatting (major performance win) ────────────────────────
    const formatted = await Promise.all(
      files.map(async (f) => {
        if (!f.relativePath.endsWith(".ts")) return f;
        return {
          ...f,
          content: await formatTypeScript(f.content),
        };
      }),
    );

    return {
      files: formatted,
      warnings,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
function resolveNpmPackageVersion(
  packageName: string,
  fallback: string,
  warnings: string[],
  npmToken?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (npmToken) {
    headers["Authorization"] = `Bearer ${npmToken}`;
  }

  return fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    {
      signal: AbortSignal.timeout(8000),
      headers,
    },
  )
    .then(async (res) => {
      if (res.status === 404) return fallback;
      if (!res.ok) {
        warnings.push(
          `npm registry error ${res.status} for ${packageName}, using fallback`,
        );
        return fallback;
      }
      const data = (await res.json()) as { version?: string };
      if (!data.version) return fallback;
      return bumpPatch(data.version);
    })
    .catch((err) => {
      warnings.push(
        `npm registry unreachable for ${packageName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    });
}

function bumpPatch(version: string): string {
  const base = version.split("-")[0].split("+")[0];
  const parts = base.split(".");
  if (parts.length !== 3) return version;

  const patch = Number(parts[2]);
  if (!Number.isFinite(patch)) return version;

  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}

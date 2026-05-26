/**
 * C# (dotnet) language adapter.
 * Generates an idiomatic C# SDK targeting net8.0 with System.Text.Json.
 */

import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import { join } from "node:path";
import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";
import { pascalCase } from "change-case";

export class CSharpAdapter implements LanguageAdapter {
  readonly language = "csharp";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

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

    // Derive namespace and project name from package name
    const ns = enriched.meta.packageName
      .split("/")
      .map((s: string) => pascalCase(s))
      .join(".");

    const projectName =
      enriched.meta.clientName ||
      enriched.meta.packageName.split("/").pop() ||
      "sdk";
    const pascalProjectName = pascalCase(projectName);

    // ── Emit helper ────────────────────────────────────────────────────────
    const emit = (
      relativePath: string,
      templateName: string,
      ctx: unknown,
    ): void => {
      try {
        const tpl = getTemplate("csharp", templateName);
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
    emit(`${pascalProjectName}.csproj`, "csproj", {
      ...enriched.meta,
      packageName: enriched.meta.packageName,
      packageVersion:
        enriched.meta.packageVersion || enriched.meta.version || "1.0.0",
      projectName: pascalProjectName,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      namespace: ns,
      projectName: pascalProjectName,
    });

    // ── Core source files ──────────────────────────────────────────────────
    emit("Client.cs", "client", {
      ...enriched.meta,
      groups: visibleGroups,
      securitySchemes: enriched.securitySchemes,
      hasSSE,
      namespace: ns,
      clientName: enriched.meta.clientName || pascalProjectName,
    });

    emit("Transport.cs", "transport", {
      securitySchemes: enriched.securitySchemes,
      namespace: ns,
    });

    emit("Errors.cs", "errors", {
      namespace: ns,
    });

    emit("Types.cs", "types", {
      schemas: enriched.schemas,
      namespace: ns,
    });

    // ── Domain files ───────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);
      const groupHasSSE = group.operations.some((op) => op.isEventStream);

      emit(join("Api", `${group.fileName}.cs`), "domain", {
        ...group,
        imports,
        hasSSE: groupHasSSE,
        securitySchemes: enriched.securitySchemes,
        namespace: ns,
      });
    }

    return { files, warnings };
  }
}

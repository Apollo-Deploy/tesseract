/**
 * PHP language adapter.
 * Generates PHP 8.1+ SDKs using Guzzle for HTTP and Composer for package management.
 */

import { join } from "node:path";
import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";
import {
  getTemplate,
  registerHelpers,
  collectImports,
} from "../../helpers/handlebars.js";
import { pascalCase } from "change-case";

export class PHPAdapter implements LanguageAdapter {
  readonly language = "php";

  async emit(
    enriched: EnrichedSDKIR,
    _outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

    const files: EmittedFile[] = [];
    const warnings: string[] = [];
    const schemaNames = new Set(enriched.schemas.map((s) => s.name));

    const clientType = config?.clientType ?? "internal";

    // ── Visibility filter ───────────────────────────────────────────────────
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

    // ── Pre-compute class names for groups ────────────────────────────────
    const groupClassNames: Record<string, string> = {};
    for (const g of visibleGroups) {
      groupClassNames[g.name] = pascalCase(g.fileName);
    }

    // ── Derive namespace from package name ──────────────────────────────────
    const namespace = this._deriveNamespace(enriched.meta.packageName);
    const composerName = enriched.meta.packageName;

    // ── Helper: emit a single file via template ────────────────────────────
    const emit = (
      relativePath: string,
      templateName: string,
      ctx: unknown,
    ): void => {
      try {
        const tpl = getTemplate("php", templateName);
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

    // ── Project files ─────────────────────────────────────────────────────
    emit("composer.json", "composer", {
      ...enriched.meta,
      composerName,
      namespace,
    });

    emit("README.md", "readme", {
      ...enriched.meta,
      groups: visibleGroups.map((g) => ({
        ...g,
        className: groupClassNames[g.name],
      })),
      schemas: enriched.schemas,
      namespace,
      hasSSE,
    });

    // ── Source files ──────────────────────────────────────────────────────
    const srcDir = "src";

    emit(join(srcDir, "Client.php"), "client", {
      ...enriched.meta,
      groups: visibleGroups.map((g) => ({
        ...g,
        className: groupClassNames[g.name],
      })),
      securitySchemes: enriched.securitySchemes ?? [],
      hasSSE,
      namespace,
    });

    emit(join(srcDir, "Transport.php"), "transport", {
      ...enriched.meta,
      securitySchemes: enriched.securitySchemes ?? [],
      namespace,
    });

    emit(join(srcDir, "Errors.php"), "errors", {
      namespace,
    });

    emit(join(srcDir, "Types.php"), "types", {
      schemas: enriched.schemas,
      namespace,
    });

    // ── Domain files ──────────────────────────────────────────────────────
    for (const group of visibleGroups) {
      const imports = collectImports(group.operations, schemaNames);

      const className = pascalCase(group.fileName);

      emit(join(srcDir, "Api", `${className}.php`), "domain", {
        ...group,
        className,
        imports,
        securitySchemes: enriched.securitySchemes ?? [],
        namespace,
        hasSSE,
        // Literal brace characters for PHP path template substitution
        LBRACE: "{",
        RBRACE: "}",
      });
    }

    return { files, warnings };
  }

  /**
   * Derives a PSR-4 namespace from a package name.
   *
   * Example:
   *   @acme/pet-store-api  →  Acme\PetStoreApi
   *   my-org/my-sdk        →  MyOrg\MySdk
   */
  private _deriveNamespace(packageName: string): string {
    return packageName
      .replace(/^@/, "")
      .split(/[/-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("\\");
  }
}

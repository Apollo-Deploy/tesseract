/**
 * Ruby language adapter.
 * Generates a Ruby gem SDK using Faraday for HTTP transport.
 */

import { join } from "node:path";
import type { EnrichedSDKIR } from "../../types/ir.js";
import type { LanguageAdapter, EmitResult } from "../types.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { EmittedFile } from "../../pipeline/write.js";

import { getTemplate, registerHelpers } from "../../helpers/handlebars.js";

export class RubyAdapter implements LanguageAdapter {
  readonly language = "ruby";

  async emit(
    enriched: EnrichedSDKIR,
    outputDir: string,
    config?: ResolvedConfig,
  ): Promise<EmitResult> {
    registerHelpers();

    const clientType = config?.clientType ?? "internal";

    const files: EmittedFile[] = [];
    const warnings: string[] = [];

    // ── Schema name set (for domain template imports) ──────────────────────
    const schemaNames = new Set<string>();
    for (const s of enriched.schemas) {
      schemaNames.add(s.name);
    }

    // ── Visibility filter ──────────────────────────────────────────────────
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

    // ── Naming ─────────────────────────────────────────────────────────────
    const gemName = enriched.meta.packageName;
    const snakeModule = gemName.replace(/-/g, "_");
    const hasSSE = visibleGroups.some((g) =>
      g.operations.some((op) => op.isEventStream),
    );

    const templateCtx = {
      meta: enriched.meta,
      groups: visibleGroups,
      schemas: enriched.schemas,
      schemaNames,
      securitySchemes: enriched.securitySchemes,
      gemName,
      snakeModule,
      clientType,
      hasSSE,
    };

    // ── Safe template emit helper ──────────────────────────────────────────
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

    // ── Emit all files ─────────────────────────────────────────────────────
    emit(`${gemName}.gemspec`, getTemplate("ruby", "gemspec"), templateCtx);

    emit("Gemfile", getTemplate("ruby", "Gemfile"), templateCtx);

    emit("README.md", getTemplate("ruby", "readme"), templateCtx);

    emit(
      join("lib", `${snakeModule}`, "version.rb"),
      getTemplate("ruby", "version"),
      templateCtx,
    );

    emit(
      join("lib", `${snakeModule}.rb`),
      getTemplate("ruby", "index"),
      templateCtx,
    );

    emit(
      join("lib", snakeModule, "client.rb"),
      getTemplate("ruby", "client"),
      templateCtx,
    );

    emit(
      join("lib", snakeModule, "transport.rb"),
      getTemplate("ruby", "transport"),
      templateCtx,
    );

    emit(
      join("lib", snakeModule, "errors.rb"),
      getTemplate("ruby", "errors"),
      templateCtx,
    );

    emit(
      join("lib", snakeModule, "types.rb"),
      getTemplate("ruby", "types"),
      templateCtx,
    );

    // ── Domain files ───────────────────────────────────────────────────────
    const domainTemplate = getTemplate("ruby", "domain");

    for (const group of visibleGroups) {
      const groupHasSSE = group.operations.some((op) => op.isEventStream);

      emit(
        join("lib", snakeModule, "resources", `${group.fileName}.rb`),
        domainTemplate,
        {
          ...group,
          meta: enriched.meta,
          snakeModule,
          hasSSE: groupHasSSE,
          securitySchemes: enriched.securitySchemes,
        },
      );
    }

    return {
      files,
      warnings,
    };
  }
}

/**
 * Tesseract — manifest-first SDK generator.
 * Public API.
 */

import { resolve } from "node:path";
import { intake } from "./pipeline/intake.js";
import { enrich } from "./pipeline/enrich.js";
import { resolveConfig } from "./types/config.js";
import { TypeScriptAdapter } from "./adapters/typescript/index.js";
import type { TesseractConfig } from "./types/config.js";
import type { LanguageAdapter } from "./adapters/types.js";
import { write, compare, type EmittedFile } from "./pipeline/write.js";

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface GenerateResult {
  filesWritten: number;
  filesSkipped: number;
  warnings: string[];
  hasChanges: boolean;
  mode: "write" | "dry-run" | "check";
  changedFiles: string[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface GenerationContext {
  config: ReturnType<typeof resolveConfig>;
  outputDir: string;
  adapter: LanguageAdapter;
}

// ---------------------------------------------------------------------------
// Adapter Registry
// ---------------------------------------------------------------------------

const adapterRegistry = new Map<string, () => LanguageAdapter>();

registerAdapter("typescript", () => new TypeScriptAdapter());

export function registerAdapter(
  language: string,
  factory: () => LanguageAdapter,
): void {
  adapterRegistry.set(language, factory);
}

function resolveAdapter(language: string): LanguageAdapter {
  const factory = adapterRegistry.get(language);

  if (!factory) {
    throw new Error(
      `Unsupported language "${language}". Registered adapters: ${[
        ...adapterRegistry.keys(),
      ].join(", ")}`,
    );
  }

  return factory();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generate(
  config: TesseractConfig,
): Promise<GenerateResult> {
  const ctx = createContext(config);

  // -------------------------------------------------------------------------
  // Intake
  // -------------------------------------------------------------------------

  const ir = intake(ctx.config);

  // -------------------------------------------------------------------------
  // Enrichment
  // -------------------------------------------------------------------------

  const enriched = enrich(ir);

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  const emitResult = await ctx.adapter.emit(
    enriched,
    ctx.outputDir,
    ctx.config,
  );

  // -------------------------------------------------------------------------
  // Persist strategy
  // -------------------------------------------------------------------------

  return persist(
    emitResult.files,
    ctx.outputDir,
    emitResult.warnings,
    ctx.config,
  );
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function createContext(config: TesseractConfig): GenerationContext {
  const resolved = resolveConfig(config);

  return {
    config: resolved,
    outputDir: resolve(resolved.output),
    adapter: resolveAdapter(resolved.language),
  };
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

function persist(
  files: EmittedFile[],
  outputDir: string,
  warnings: string[],
  config: ReturnType<typeof resolveConfig>,
): GenerateResult {
  const mode: GenerateResult["mode"] = config.check
    ? "check"
    : config.dryRun
      ? "dry-run"
      : "write";

  const result =
    mode === "write" ? write(files, outputDir) : compare(files, outputDir);

  return {
    filesWritten: result.written.length,
    filesSkipped: result.skipped.length,
    warnings,
    hasChanges: result.written.length > 0,
    mode,
    changedFiles: result.written,
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { TesseractConfig } from "./types/config.js";
export type { SDKIR, EnrichedSDKIR } from "./types/ir.js";
export type { LanguageAdapter, EmitResult } from "./adapters/types.js";
export type { SDKModuleConfig, SDKRouteConfig } from "./types/sdk-module.js";
export { SDKModule, SDK_MODULE_CONFIG } from "./types/sdk-module.js";
export type { BackendManifest } from "./types/manifest.js";
export type { EmittedFile } from "./pipeline/write.js";

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export { SDKCollector } from "./collector.js";
export type { CollectorOptions, CollectorRouteConfig } from "./collector.js";

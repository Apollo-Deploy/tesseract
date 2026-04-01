/**
 * Tesseract — manifest-first SDK generator.
 * Public API.
 */

import { resolve } from 'node:path';
import { intake } from './pipeline/intake.js';
import { enrich } from './pipeline/enrich.js';
import { write } from './pipeline/write.js';
import { resolveConfig } from './types/config.js';
import { TypeScriptAdapter } from './adapters/typescript/index.js';
import type { TesseractConfig } from './types/config.js';
import type { LanguageAdapter } from './adapters/types.js';

export interface GenerateResult {
  filesWritten: number;
  filesSkipped: number;
  warnings: string[];
}

const adapters: Record<string, () => LanguageAdapter> = {
  typescript: () => new TypeScriptAdapter(),
};

export async function generate(config: TesseractConfig): Promise<GenerateResult> {
  const resolved = resolveConfig(config);

  // 1. Intake: manifest → SDKIR
  const ir = intake(resolved);

  // 2. Enrich: SDKIR → EnrichedSDKIR
  const enriched = enrich(ir);

  // 3. Emit: EnrichedSDKIR → files
  const adapterFactory = adapters[resolved.language];
  if (!adapterFactory) {
    throw new Error(`Unsupported language: "${resolved.language}". Available: ${Object.keys(adapters).join(', ')}`);
  }
  const adapter = adapterFactory();
  const outputDir = resolve(resolved.output);
  const emitResult = await adapter.emit(enriched, outputDir);

  // 4. Write: files → disk
  const writeResult = write(emitResult.files, outputDir);

  return {
    filesWritten: writeResult.written.length,
    filesSkipped: writeResult.skipped.length,
    warnings: emitResult.warnings,
  };
}

// Re-export types
export type { TesseractConfig } from './types/config.js';
export type { SDKIR, EnrichedSDKIR } from './types/ir.js';
export type { LanguageAdapter, EmitResult } from './adapters/types.js';
export type { EmittedFile } from './pipeline/write.js';

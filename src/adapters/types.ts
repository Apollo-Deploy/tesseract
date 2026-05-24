/**
 * Language adapter interface.
 * Each supported language implements this contract.
 */

import type { EnrichedSDKIR } from '../types/ir.js';
import type { ResolvedConfig } from '../types/config.js';
import type { EmittedFile } from '../pipeline/write.js';

export interface EmitResult {
  files: EmittedFile[];
  warnings: string[];
}

export interface LanguageAdapter {
  readonly language: string;
  emit(enriched: EnrichedSDKIR, outputDir: string, config?: ResolvedConfig): Promise<EmitResult>;
}

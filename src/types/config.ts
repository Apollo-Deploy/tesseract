/**
 * Tesseract generator configuration.
 *
 * Manifest-first — no OpenAPI-specific fields.
 */

import type { TargetLanguage } from './ir.js';

export interface TesseractConfig {
  /** Path to the sdk-manifold/v1 manifest JSON file */
  input: string;
  /** Output directory for the generated SDK */
  output: string;
  /** Target SDK language (default: 'typescript') */
  language?: TargetLanguage;

  /** Override the npm package name */
  packageName?: string;
  /** Override the client class name */
  clientName?: string;
  /** Override the base URL */
  baseUrl?: string;

  /** Environment presets */
  environments?: EnvironmentPreset[];

  /** --dry-run: transform only, no I/O */
  dryRun?: boolean;
  /** --check: compare output without writing */
  check?: boolean;
  /** Whether to apply Prettier to TypeScript output (default: true) */
  prettier?: boolean;
}

export interface EnvironmentPreset {
  name: string;
  baseUrl: string;
  description?: string;
}

export interface ResolvedConfig {
  readonly input: string;
  readonly output: string;
  readonly language: TargetLanguage;
  readonly packageName?: string;
  readonly clientName?: string;
  readonly baseUrl?: string;
  readonly dryRun: boolean;
  readonly check: boolean;
  readonly prettier: boolean;
  readonly environments?: EnvironmentPreset[];
}

export function resolveConfig(config: TesseractConfig): ResolvedConfig {
  if (!config.input) throw new Error('Missing required config: input');
  if (!config.output) throw new Error('Missing required config: output');

  return {
    input: config.input,
    output: config.output,
    language: config.language ?? 'typescript',
    packageName: config.packageName,
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    dryRun: config.dryRun ?? false,
    check: config.check ?? false,
    prettier: config.prettier ?? true,
    environments: config.environments,
  };
}

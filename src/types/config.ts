/**
 * Tesseract generator configuration.
 *
 * Manifest-first — no OpenAPI-specific fields.
 */

import type { TargetLanguage } from "./ir.js";
import type { BackendManifest } from "./manifest.js";
import { resolveNpmToken } from "../utils/npm-token.js";

export interface TesseractConfig {
  /** Path to the sdk-manifold/v1 manifest JSON file. Required if `manifest` is not provided. */
  input?: string;
  /** Pre-parsed manifest object. Alternative to `input`. */
  manifest?: BackendManifest;
  /** Output directory for the generated SDK */
  output: string;
  /** Target SDK language (default: 'typescript') */
  language?: TargetLanguage;

  /** Override the npm package name */
  packageName?: string;
  /** Override the generated package version */
  packageVersion?: string;
  /** NPM auth token for resolving private package versions from the registry */
  npmToken?: string;
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
  /** SDK style: 'functional' (factory function, default) or 'class' (Resend-style class instantiation) */
  sdkStyle?: "functional" | "class";
  /** Client type: 'internal' (full options exposed) or 'public' (only auth key, baseUrl baked in) */
  clientType?: "internal" | "public";
}

export interface EnvironmentPreset {
  name: string;
  baseUrl: string;
  description?: string;
}

export interface ResolvedConfig {
  readonly input?: string;
  readonly manifest?: BackendManifest;
  readonly output: string;
  readonly language: TargetLanguage;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly npmToken?: string;
  readonly clientName?: string;
  readonly baseUrl?: string;
  readonly dryRun: boolean;
  readonly check: boolean;
  readonly prettier: boolean;
  readonly sdkStyle: "functional" | "class";
  readonly clientType: "internal" | "public";
  readonly environments?: EnvironmentPreset[];
}

export function resolveConfig(config: TesseractConfig): ResolvedConfig {
  if (!config.input && !config.manifest)
    throw new Error(
      "Missing required config: provide either input (manifest file path) or manifest (object)",
    );
  if (!config.output) throw new Error("Missing required config: output");

  return {
    input: config.input,
    manifest: config.manifest,
    output: config.output,
    language: config.language ?? "typescript",
    packageName: config.packageName,
    packageVersion: config.packageVersion,
    npmToken: resolveNpmToken(config.npmToken),
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    dryRun: config.dryRun ?? false,
    check: config.check ?? false,
    prettier: config.prettier ?? true,
    sdkStyle: config.sdkStyle ?? "functional",
    clientType: config.clientType ?? "internal",
    environments: config.environments,
  };
}

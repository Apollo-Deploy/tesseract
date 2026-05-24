#!/usr/bin/env node
/**
 * Tesseract CLI — manifest-first SDK generator (refactored, scalable).
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { generate } from "./index.js";
import type { TesseractConfig } from "./types/config.js";

type CLIOptions = {
  input: string;
  output: string;
  name?: string;
  packageVersion?: string;
  npmToken?: string;
  clientName?: string;
  baseUrl?: string;
  dryRun?: boolean;
  check?: boolean;
  sdkStyle?: "functional" | "class";
  clientType?: "internal" | "public";
};

type GenerateResult = Awaited<ReturnType<typeof generate>>;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Package metadata loader (isolated for testability + reuse)
 */
function loadPackageVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

/**
 * Shared config builder
 */
function buildConfig(opts: CLIOptions): TesseractConfig {
  return {
    input: resolve(opts.input),
    output: resolve(opts.output),
    language: "typescript",
    packageName: opts.name,
    packageVersion: opts.packageVersion,
    npmToken: opts.npmToken,
    clientName: opts.clientName,
    baseUrl: opts.baseUrl,
    dryRun: opts.dryRun,
    check: opts.check,
    sdkStyle: opts.sdkStyle,
    clientType: opts.clientType,
  };
}

/**
 * Handles CLI output formatting centrally
 */
function printWarnings(warnings: string[]) {
  if (!warnings.length) return;
  console.warn("\nWarnings:");
  for (const w of warnings) {
    console.warn(`  ⚠ ${w}`);
  }
}

function printFileList(files: string[], prefix = "  - ") {
  for (const file of files) {
    console.log(`${prefix}${file}`);
  }
}

/**
 * Handles result modes in a unified way
 */
function handleResult(opts: CLIOptions, result: GenerateResult): void {
  printWarnings(result.warnings);

  switch (result.mode) {
    case "check":
      if (result.hasChanges) {
        console.error(
          `\n✗ Generated output is out of date: ${result.filesWritten} files would change`,
        );
        printFileList(result.changedFiles);
        process.exit(1);
      }

      console.log(`\n✓ Generated output is up to date → ${opts.output}`);
      return;

    case "dry-run":
      console.log(
        `\n✓ Dry run complete: ${result.filesWritten} files would change → ${opts.output}`,
      );

      if (result.changedFiles.length) {
        printFileList(result.changedFiles);
      }

      if (result.filesSkipped > 0) {
        console.log(`  ${result.filesSkipped} files unchanged`);
      }
      return;

    default:
      console.log(
        `\n✓ Generated ${result.filesWritten} files → ${opts.output}`,
      );

      if (result.filesSkipped > 0) {
        console.log(`  ${result.filesSkipped} files unchanged (skipped)`);
      }
  }
}

/**
 * Ensures mutually exclusive flags are valid
 */
function validateFlags(opts: CLIOptions): void {
  if (opts.dryRun && opts.check) {
    console.error("\n✗ --dry-run and --check are mutually exclusive");
    process.exit(1);
  }
}

/**
 * Core generate action
 */
async function handleGenerate(opts: CLIOptions): Promise<void> {
  validateFlags(opts);

  const config = buildConfig(opts);

  try {
    const result = await generate(config);
    handleResult(opts, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Generation failed: ${message}`);
    process.exit(1);
  }
}

/**
 * Run command handler (isolated execution layer)
 */
function handleRun(appPath: string): void {
  const resolved = resolve(appPath);

  const result = spawnSync(process.execPath, [resolved], {
    env: { ...process.env, TESSERACT_GENERATE: "1" },
    stdio: "inherit",
  });

  process.exit(result.status ?? 0);
}

/**
 * CLI bootstrap
 */
function createCLI(): Command {
  const program = new Command();
  const version = loadPackageVersion();

  program
    .name("tesseract")
    .description(
      "Manifest-first SDK generator — turns sdk-manifold/v1 manifests into production-ready TypeScript SDKs",
    )
    .version(version);

  program
    .command("generate")
    .description("Generate an SDK from an sdk-manifold/v1 manifest file")
    .requiredOption(
      "-i, --input <path>",
      "Path to the sdk-manifold/v1 manifest JSON file",
    )
    .requiredOption(
      "-o, --output <dir>",
      "Output directory for the generated SDK",
    )
    .option("-n, --name <name>", "Override the SDK package name")
    .option(
      "--package-version <version>",
      "Override the generated package version",
    )
    .option("--client-name <name>", "Override the client class name")
    .option("--base-url <url>", "Override the base URL")
    .option("--dry-run", "Preview output without writing files")
    .option("--check", "Exit non-zero if generated output is out of date")
    .option(
      "--sdk-style <style>",
      'SDK style: functional (default) or class (Resend-style: new MySDK("key"))',
    )
    .option(
      "--client-type <type>",
      "Client type: internal (full options, default) or public (auth key only, baseUrl baked in)",
    )
    .option(
      "--npm-token <token>",
      "NPM auth token for resolving private package versions (defaults to NPM_TOKEN env var)",
    )
    .action(handleGenerate);

  program
    .command("run")
    .description(
      [
        "Boot an instrumented Fastify app with TESSERACT_GENERATE=1 to collect routes and generate an SDK.",
        "The app must register `tesseractPlugin` from `@apollo-deploy/tesseract/fastify`.",
      ].join("\n"),
    )
    .argument(
      "<app>",
      "Path to the compiled app entry-point (e.g. dist/app.js)",
    )
    .action(handleRun);

  return program;
}

createCLI().parse();

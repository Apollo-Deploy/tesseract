#!/usr/bin/env node
/**
 * Tesseract CLI — manifest-first SDK generator.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generate } from './index.js';
import type { TesseractConfig } from './types/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('tesseract')
  .description('Manifest-first SDK generator — turns sdk-manifold/v1 manifests into production-ready TypeScript SDKs')
  .version(pkg.version);

program
  .command('generate')
  .description('Generate an SDK from an sdk-manifold/v1 manifest')
  .requiredOption('-i, --input <path>', 'Path to the sdk-manifold/v1 manifest JSON file')
  .requiredOption('-o, --output <dir>', 'Output directory for the generated SDK')
  .option('-n, --name <name>', 'Override the SDK package name')
  .option('--package-version <version>', 'Override the generated package version')
  .option('--client-name <name>', 'Override the client class name')
  .option('--base-url <url>', 'Override the base URL')
  .option('--dry-run', 'Preview output without writing files')
  .option('--check', 'Exit non-zero if generated output is out of date')
  .action(async (opts) => {
    if (opts.dryRun && opts.check) {
      console.error('\n✗ --dry-run and --check are mutually exclusive');
      process.exit(1);
    }

    const config: TesseractConfig = {
      input: resolve(opts.input),
      output: resolve(opts.output),
      language: 'typescript',
      packageName: opts.name,
      packageVersion: opts.packageVersion,
      clientName: opts.clientName,
      baseUrl: opts.baseUrl,
      dryRun: opts.dryRun,
      check: opts.check,
    };

    try {
      const result = await generate(config);

      if (result.warnings.length > 0) {
        console.warn('\nWarnings:');
        for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
      }

      if (result.mode === 'check') {
        if (result.hasChanges) {
          console.error(`\n✗ Generated output is out of date: ${result.filesWritten} files would change`);
          for (const file of result.changedFiles) {
            console.error(`  - ${file}`);
          }
          process.exit(1);
        }

        console.log(`\n✓ Generated output is up to date → ${opts.output}`);
        return;
      }

      if (result.mode === 'dry-run') {
        console.log(`\n✓ Dry run complete: ${result.filesWritten} files would change → ${opts.output}`);
        if (result.changedFiles.length > 0) {
          for (const file of result.changedFiles) {
            console.log(`  - ${file}`);
          }
        }
        if (result.filesSkipped > 0) {
          console.log(`  ${result.filesSkipped} files unchanged`);
        }
        return;
      }

      console.log(`\n✓ Generated ${result.filesWritten} files → ${opts.output}`);
      if (result.filesSkipped > 0) {
        console.log(`  ${result.filesSkipped} files unchanged (skipped)`);
      }
    } catch (err) {
      console.error(`\n✗ Generation failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();

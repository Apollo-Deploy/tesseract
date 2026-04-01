/**
 * Write — materializes generated files to disk.
 * Performs diff-aware writes: only touches files whose content has changed.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface EmittedFile {
  relativePath: string;
  content: string;
}

export interface WriteResult {
  written: string[];
  skipped: string[];
  total: number;
}

export function compare(files: EmittedFile[], outputDir: string): WriteResult {
  const result: WriteResult = { written: [], skipped: [], total: files.length };

  for (const file of files) {
    const absPath = join(outputDir, file.relativePath);

    if (existsSync(absPath)) {
      try {
        const existing = readFileSync(absPath, 'utf-8');
        if (existing === file.content) {
          result.skipped.push(file.relativePath);
          continue;
        }
      } catch {
        // If read fails, treat the file as changed.
      }
    }

    result.written.push(file.relativePath);
  }

  return result;
}

export function write(files: EmittedFile[], outputDir: string): WriteResult {
  const result = compare(files, outputDir);
  const changedFiles = new Set(result.written);

  for (const file of files) {
    if (!changedFiles.has(file.relativePath)) {
      continue;
    }

    const absPath = join(outputDir, file.relativePath);
    const dir = dirname(absPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(absPath, file.content, 'utf-8');
  }

  return result;
}

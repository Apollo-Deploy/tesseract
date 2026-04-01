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

export function write(files: EmittedFile[], outputDir: string): WriteResult {
  const result: WriteResult = { written: [], skipped: [], total: files.length };

  for (const file of files) {
    const absPath = join(outputDir, file.relativePath);
    const dir = dirname(absPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Diff-aware: skip if content is identical
    if (existsSync(absPath)) {
      try {
        const existing = readFileSync(absPath, 'utf-8');
        if (existing === file.content) {
          result.skipped.push(file.relativePath);
          continue;
        }
      } catch {
        // If read fails, just write
      }
    }

    writeFileSync(absPath, file.content, 'utf-8');
    result.written.push(file.relativePath);
  }

  return result;
}

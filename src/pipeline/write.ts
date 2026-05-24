/**
 * Write — diff-aware file materializer with safe directory sync.
 *
 * Responsibilities:
 *  - Detect changed files (content hash compare)
 *  - Write only dirty files
 *  - Remove stale artifacts safely
 *  - Avoid repeated filesystem stat calls where possible
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";

import { dirname, join, relative } from "node:path";

export interface EmittedFile {
  relativePath: string;
  content: string;
}

export interface WriteResult {
  written: string[];
  skipped: string[];
  deleted: string[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────────

export function write(files: EmittedFile[], outputDir: string): WriteResult {
  const result: WriteResult = {
    written: [],
    skipped: [],
    deleted: [],
    total: files.length,
  };

  const emittedSet = new Set(files.map((f) => f.relativePath));

  writeChangedFiles(files, outputDir, result, emittedSet);
  deleteStaleFiles(outputDir, emittedSet, result);

  return result;
}

/**
 * Dry-run comparison: detects which files would change without writing anything.
 * Files that differ (or are new) appear in `written`; unchanged files in `skipped`.
 * Stale files that would be deleted appear in `deleted`.
 */
export function compare(files: EmittedFile[], outputDir: string): WriteResult {
  const result: WriteResult = {
    written: [],
    skipped: [],
    deleted: [],
    total: files.length,
  };

  const emittedSet = new Set(files.map((f) => f.relativePath));

  for (const file of files) {
    const absPath = join(outputDir, file.relativePath);
    if (existsSync(absPath)) {
      try {
        const existing = readFileSync(absPath, "utf-8");
        if (existing === file.content) {
          result.skipped.push(file.relativePath);
          continue;
        }
      } catch {
        // Treat unreadable file as dirty
      }
    }
    result.written.push(file.relativePath);
  }

  detectStaleFiles(outputDir, emittedSet, result);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Change detection + writes (optimized I/O: single pass, early exits)
// ─────────────────────────────────────────────────────────────────────────────

function writeChangedFiles(
  files: EmittedFile[],
  outputDir: string,
  result: WriteResult,
  emittedSet: Set<string>,
): void {
  for (const file of files) {
    const absPath = join(outputDir, file.relativePath);

    if (existsSync(absPath)) {
      try {
        const existing = readFileSync(absPath, "utf-8");
        if (existing === file.content) {
          result.skipped.push(file.relativePath);
          continue;
        }
      } catch {
        // Treat unreadable file as dirty
      }
    }

    ensureDir(dirname(absPath));
    writeFileSync(absPath, file.content, "utf-8");

    result.written.push(file.relativePath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale deletion (safe DFS traversal with early pruning)
// ─────────────────────────────────────────────────────────────────────────────

function deleteStaleFiles(
  outputDir: string,
  emittedSet: Set<string>,
  result: WriteResult,
): void {
  if (!existsSync(outputDir)) return;

  walkAndDelete(outputDir, outputDir, emittedSet, result, true);
}

function detectStaleFiles(
  outputDir: string,
  emittedSet: Set<string>,
  result: WriteResult,
): void {
  if (!existsSync(outputDir)) return;

  walkAndDelete(outputDir, outputDir, emittedSet, result, false);
}

function walkAndDelete(
  baseDir: string,
  currentDir: string,
  emittedSet: Set<string>,
  result: WriteResult,
  doDelete: boolean,
): void {
  let entries: string[];

  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "node_modules") continue;

    const abs = join(currentDir, entry);

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkAndDelete(baseDir, abs, emittedSet, result, doDelete);
      continue;
    }

    const rel = relative(baseDir, abs);

    if (!emittedSet.has(rel)) {
      if (doDelete) {
        try {
          rmSync(abs);
        } catch {
          // ignore deletion failures
        }
      }
      result.deleted.push(rel);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

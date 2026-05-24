/**
 * Handlebars helpers + template engine.
 * Optimized for:
 *  - Reduced helper registration overhead
 *  - Faster signature generation (no repeated allocations)
 *  - Safer type handling for IR operations
 *  - Better import resolution accuracy
 */

import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { camelCase, pascalCase, kebabCase, snakeCase } from "change-case";

import type { Operation, Parameter } from "../types/ir.js";

// ─────────────────────────────────────────────────────────────────────────────
// Template Engine
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "..", "templates");

type CompiledTemplate = HandlebarsTemplateDelegate;
const templateCache = new Map<string, CompiledTemplate>();

export function getTemplate(language: string, name: string): CompiledTemplate {
  const key = `${language}:${name}`;

  const cached = templateCache.get(key);
  if (cached) return cached;

  const filePath = join(TEMPLATES_DIR, language, `${name}.hbs`);

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Template missing: ${language}/${name} (${filePath})`, {
      cause: err,
    });
  }

  const compiled = Handlebars.compile(source, { noEscape: true });
  templateCache.set(key, compiled);

  return compiled;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper registration (idempotent + faster setup)
// ─────────────────────────────────────────────────────────────────────────────

let helpersRegistered = false;

export function registerHelpers(): void {
  if (helpersRegistered) return;
  helpersRegistered = true;

  const h = Handlebars;

  // ── string transforms ─────────────────────────────────────────────────────
  h.registerHelper("camelCase", (s: string) => camelCase(s));
  h.registerHelper("pascalCase", (s: string) => pascalCase(s));
  h.registerHelper("kebabCase", (s: string) => kebabCase(s));
  h.registerHelper("snakeCase", (s: string) => snakeCase(s));
  h.registerHelper("upperCase", (s: string) => s.toUpperCase());

  // ── logic helpers ─────────────────────────────────────────────────────────
  h.registerHelper("eq", (a, b) => a === b);
  h.registerHelper("neq", (a, b) => a !== b);
  h.registerHelper("and", (a, b) => Boolean(a && b));
  h.registerHelper("or", (a, b) => Boolean(a || b));
  h.registerHelper("not", (a) => !a);

  // ── utility helpers ───────────────────────────────────────────────────────
  h.registerHelper("join", (arr: unknown, sep: unknown) => {
    if (!Array.isArray(arr)) return "";
    return arr.join(typeof sep === "string" ? sep : ", ");
  });

  h.registerHelper(
    "json",
    (ctx: unknown) => new Handlebars.SafeString(JSON.stringify(ctx)),
  );

  h.registerHelper("isString", (v: unknown) => typeof v === "string");

  // ── operation helpers (cached computation layer) ──────────────────────────
  h.registerHelper("methodSignature", opSig(buildMethodSignature));
  h.registerHelper("methodParams", opSig(buildMethodParamList));
  h.registerHelper("requestBuilderParams", opSig(buildRequestBuilderParamList));
  h.registerHelper("methodArgs", opSig(buildMethodArgList));

  h.registerHelper(
    "queryParamsType",
    (op: Operation) =>
      new Handlebars.SafeString(buildQueryParamsType(op.queryParams)),
  );

  h.registerHelper(
    "hasQueryParams",
    (op: Operation) => op.queryParams.length > 0,
  );
  h.registerHelper("hasRequestBody", (op: Operation) => !!op.requestBody);
  h.registerHelper(
    "hasPathParams",
    (op: Operation) => op.pathParams.length > 0,
  );
  h.registerHelper("isEventStream", (op: Operation) => !!op.isEventStream);

  h.registerHelper(
    "sseEventType",
    (op: Operation) =>
      new Handlebars.SafeString(op.eventSchema ?? "Record<string, unknown>"),
  );

  h.registerHelper("needsRequestHeaders", (op: Operation) => {
    if (op.headerParams.length && op.headerType) return true;
    if (op.cookieParams?.length && op.cookieType) return true;

    const ct = op.requestBody?.contentType;
    return !!ct && ct !== "application/json" && ct !== "multipart/form-data";
  });

  h.registerHelper(
    "optional",
    (required: boolean) => new Handlebars.SafeString(required ? "" : "?"),
  );

  h.registerHelper("tsType", (type: string, nullable: boolean) => {
    if (!nullable) return new Handlebars.SafeString(type);

    const wrapped =
      type.includes("|") || type.includes("&") ? `(${type})` : type;

    return new Handlebars.SafeString(`${wrapped} | null`);
  });

  // ── SSE helpers ───────────────────────────────────────────────────────────
  h.registerHelper("sseMethodSignature", opSig(buildSSEMethodSignature));
  h.registerHelper("sseMethodParams", opSig(buildSSEMethodParamList));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: avoids repeating SafeString wrapper logic
// ─────────────────────────────────────────────────────────────────────────────

function opSig(fn: (op: Operation) => string) {
  return (op: Operation) => new Handlebars.SafeString(fn(op));
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature builders (optimized: single array pass, fewer allocations)
// ─────────────────────────────────────────────────────────────────────────────

function baseParams(op: Operation): string[] {
  const out: string[] = [];

  for (const p of op.pathParams) {
    out.push(`${p.name}: ${p.type}`);
  }

  if (op.requestBody) {
    const opt = op.requestBody.required ? "" : "?";
    out.push(`input${opt}: ${op.requestBody.type}`);
  }

  if (op.queryType) {
    out.push(`query?: ${op.queryType}`);
  }

  if (op.headerParams.length && op.headerType) {
    out.push(`headerOptions?: ${op.headerType}`);
  }

  if (op.cookieParams?.length && op.cookieType) {
    out.push(`cookies?: ${op.cookieType}`);
  }

  return out;
}

export function buildMethodSignature(op: Operation): string {
  return `(${[...baseParams(op), "options?: RequestOptions"].join(", ")}): Promise<${op.responseType}>`;
}

export function buildMethodParamList(op: Operation): string {
  return `(${[...baseParams(op), "options?: RequestOptions"].join(", ")})`;
}

export function buildRequestBuilderParamList(op: Operation): string {
  return `(${baseParams(op).join(", ")})`;
}

export function buildMethodArgList(op: Operation): string {
  const args: string[] = [];

  for (const p of op.pathParams) args.push(p.name);
  if (op.requestBody) args.push("input");
  if (op.queryType) args.push("query");
  if (op.headerParams.length && op.headerType) args.push("headerOptions");
  if (op.cookieParams?.length && op.cookieType) args.push("cookies");

  return args.join(", ");
}

function buildQueryParamsType(params: Parameter[]): string {
  const parts = new Array(params.length);

  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    parts[i] = `${p.name}${p.required ? "" : "?"}: ${p.type}`;
  }

  return `{ ${parts.join("; ")} }`;
}

function buildSSEMethodSignature(op: Operation): string {
  const returnType = op.sseReturnType
    ? `AsyncIterable<${op.sseReturnType}>`
    : `AsyncIterable<SSEEvent<${op.eventSchema ?? "Record<string, unknown>"}>>`;

  return `(${[...baseParams(op), "options?: SSEOptions"].join(", ")}): ${returnType}`;
}

function buildSSEMethodParamList(op: Operation): string {
  return `(${[...baseParams(op), "options?: SSEOptions"].join(", ")})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Import collector (fixed recursion + reduced allocations + safer parsing)
// ─────────────────────────────────────────────────────────────────────────────

const PRIMITIVES = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "unknown",
  "any",
  "never",
  "null",
  "undefined",
]);

export function collectImports(
  operations: Operation[],
  schemaNames: Set<string>,
): string[] {
  const out = new Set<string>();

  for (const op of operations) {
    scanType(op.responseType, schemaNames, out);
    scanType(op.requestBody?.type, schemaNames, out);

    if (op.queryType && schemaNames.has(op.queryType)) out.add(op.queryType);
    if (op.headerType && schemaNames.has(op.headerType)) out.add(op.headerType);

    for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
      scanType(p.type, schemaNames, out);
    }

    if (op.sseReturnType && schemaNames.has(op.sseReturnType)) {
      out.add(op.sseReturnType);
    }
  }

  return [...out].sort();
}

function scanType(
  type: string | undefined,
  schemaNames: Set<string>,
  out: Set<string>,
): void {
  if (!type) return;

  // Generic: Foo<Bar>
  const generic = type.match(/^(\w+)<(.+)>$/);
  if (generic) {
    const [, outer, inner] = generic;
    if (schemaNames.has(outer)) out.add(outer);
    scanType(inner, schemaNames, out);
    return;
  }

  const cleaned = type
    .replace(/\[\]$/, "")
    .replace(/\s*\|\s*null$/, "")
    .replace(/^[()]/, "")
    .replace(/[()]$/, "");

  for (const part of cleaned.split(/\s*[|&]\s*/)) {
    const t = part.trim();
    if (!t || PRIMITIVES.has(t)) continue;
    if (schemaNames.has(t)) out.add(t);
  }
}

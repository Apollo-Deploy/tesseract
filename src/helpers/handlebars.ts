/**
 * Handlebars helpers + template engine.
 * Registers all custom helpers and provides template loading.
 */

import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { camelCase, pascalCase, kebabCase, snakeCase } from 'change-case';
import type { Operation, Parameter } from '../types/ir.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

type CompiledTemplate = HandlebarsTemplateDelegate;
const templateCache = new Map<string, CompiledTemplate>();

// ── Template engine ──────────────────────────────────────────────────────────

export function getTemplate(language: string, name: string): CompiledTemplate {
  const key = `${language}:${name}`;
  const cached = templateCache.get(key);
  if (cached) return cached;

  const filePath = join(TEMPLATES_DIR, language, `${name}.hbs`);
  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Template not found: "${name}" for language "${language}" (expected at ${filePath})`,
      { cause: err },
    );
  }

  const compiled = Handlebars.compile(source, { noEscape: true });
  templateCache.set(key, compiled);
  return compiled;
}

// ── Helper registration ──────────────────────────────────────────────────────

export function registerHelpers(): void {
  Handlebars.registerHelper('camelCase', (str: string) => camelCase(str));
  Handlebars.registerHelper('pascalCase', (str: string) => pascalCase(str));
  Handlebars.registerHelper('kebabCase', (str: string) => kebabCase(str));
  Handlebars.registerHelper('snakeCase', (str: string) => snakeCase(str));
  Handlebars.registerHelper('upperCase', (str: string) => str.toUpperCase());

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (a: unknown, b: unknown) => a && b);
  Handlebars.registerHelper('or', (a: unknown, b: unknown) => a || b);
  Handlebars.registerHelper('not', (a: unknown) => !a);

  Handlebars.registerHelper('join', (arr: string[], sep: string) => {
    if (!Array.isArray(arr)) return '';
    return arr.join(typeof sep === 'string' ? sep : ', ');
  });

  Handlebars.registerHelper('methodSignature', (op: Operation) =>
    new Handlebars.SafeString(buildMethodSignature(op)),
  );
  Handlebars.registerHelper('methodParams', (op: Operation) =>
    new Handlebars.SafeString(buildMethodParamList(op)),
  );
  Handlebars.registerHelper('requestBuilderParams', (op: Operation) =>
    new Handlebars.SafeString(buildRequestBuilderParamList(op)),
  );
  Handlebars.registerHelper('methodArgs', (op: Operation) =>
    new Handlebars.SafeString(buildMethodArgList(op)),
  );
  Handlebars.registerHelper('queryParamsType', (op: Operation) =>
    new Handlebars.SafeString(buildQueryParamsType(op.queryParams)),
  );
  Handlebars.registerHelper('hasQueryParams', (op: Operation) => op.queryParams.length > 0);
  Handlebars.registerHelper('hasRequestBody', (op: Operation) => !!op.requestBody);
  Handlebars.registerHelper('hasPathParams', (op: Operation) => op.pathParams.length > 0);
  Handlebars.registerHelper('isEventStream', (op: Operation) => !!op.isEventStream);
  Handlebars.registerHelper('sseEventType', (op: Operation) =>
    new Handlebars.SafeString(op.eventSchema ?? 'Record<string, unknown>'),
  );
  Handlebars.registerHelper('needsRequestHeaders', (op: Operation) => {
    if (op.headerParams.length > 0 && op.headerType) return true;
    if (op.cookieParams && op.cookieParams.length > 0 && op.cookieType) return true;
    if (
      op.requestBody &&
      op.requestBody.contentType !== 'application/json' &&
      op.requestBody.contentType !== 'multipart/form-data'
    ) return true;
    return false;
  });

  Handlebars.registerHelper('sseMethodSignature', (op: Operation) =>
    new Handlebars.SafeString(buildSSEMethodSignature(op)),
  );
  Handlebars.registerHelper('sseMethodParams', (op: Operation) =>
    new Handlebars.SafeString(buildSSEMethodParamList(op)),
  );

  Handlebars.registerHelper('optional', (required: boolean) =>
    new Handlebars.SafeString(required ? '' : '?'),
  );
  Handlebars.registerHelper('tsType', (type: string, nullable: boolean) => {
    if (nullable) {
      if (type.includes(' | ') || type.includes(' & '))
        return new Handlebars.SafeString(`(${type}) | null`);
      return new Handlebars.SafeString(`${type} | null`);
    }
    return new Handlebars.SafeString(type);
  });
  Handlebars.registerHelper('isString', (val: unknown) => typeof val === 'string');
  Handlebars.registerHelper('json', (context: unknown) =>
    new Handlebars.SafeString(JSON.stringify(context, null, 2)),
  );
}

// ── Signature builders ───────────────────────────────────────────────────────

function buildParamStrings(op: Operation): string[] {
  const params: string[] = [];
  for (const p of op.pathParams) params.push(`${p.name}: ${p.type}`);
  if (op.requestBody) {
    const opt = op.requestBody.required ? '' : '?';
    params.push(`input${opt}: ${op.requestBody.type}`);
  }
  if (op.queryType) params.push(`query?: ${op.queryType}`);
  if (op.headerParams.length > 0 && op.headerType) params.push(`headerOptions?: ${op.headerType}`);
  if (op.cookieParams && op.cookieParams.length > 0 && op.cookieType) params.push(`cookies?: ${op.cookieType}`);
  return params;
}

export function buildMethodSignature(op: Operation): string {
  const params = [...buildParamStrings(op), 'options?: RequestOptions'];
  return `(${params.join(', ')}): Promise<${op.responseType}>`;
}

export function buildMethodParamList(op: Operation): string {
  const params = [...buildParamStrings(op), 'options?: RequestOptions'];
  return `(${params.join(', ')})`;
}

export function buildRequestBuilderParamList(op: Operation): string {
  const params = buildParamStrings(op);
  return `(${params.join(', ')})`;
}

export function buildMethodArgList(op: Operation): string {
  const args: string[] = [];
  for (const p of op.pathParams) args.push(p.name);
  if (op.requestBody) args.push('input');
  if (op.queryType) args.push('query');
  if (op.headerParams.length > 0 && op.headerType) args.push('headerOptions');
  if (op.cookieParams && op.cookieParams.length > 0 && op.cookieType) args.push('cookies');
  return args.join(', ');
}

function buildQueryParamsType(params: Parameter[]): string {
  const props = params.map((p) => {
    const opt = p.required ? '' : '?';
    return `${p.name}${opt}: ${p.type}`;
  });
  return `{ ${props.join('; ')} }`;
}

function buildSSEMethodSignature(op: Operation): string {
  const eventType = op.eventSchema ?? 'Record<string, unknown>';
  const params = [...buildParamStrings(op), 'options?: SSEOptions'];
  return `(${params.join(', ')}): AsyncIterable<SSEEvent<${eventType}>>`;
}

function buildSSEMethodParamList(op: Operation): string {
  const params = [...buildParamStrings(op), 'options?: SSEOptions'];
  return `(${params.join(', ')})`;
}

// ── Import collector ─────────────────────────────────────────────────────────

export function collectImports(
  operations: Operation[],
  schemaNames: Set<string>,
): string[] {
  const imports = new Set<string>();
  for (const op of operations) {
    if (op.responseType !== 'void' && !isPrimitive(op.responseType))
      addTypeImport(op.responseType, schemaNames, imports);
    if (op.requestBody && !isPrimitive(op.requestBody.type))
      addTypeImport(op.requestBody.type, schemaNames, imports);
    if (op.queryType && schemaNames.has(op.queryType)) imports.add(op.queryType);
    if (op.headerType && schemaNames.has(op.headerType)) imports.add(op.headerType);
    for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
      if (!isPrimitive(p.type)) addTypeImport(p.type, schemaNames, imports);
    }
  }
  return Array.from(imports).sort();
}

function addTypeImport(type: string, schemaNames: Set<string>, imports: Set<string>): void {
  const genericMatch = type.match(/^(\w+)<(.+)>$/);
  if (genericMatch) {
    const [, outer, inner] = genericMatch;
    if (schemaNames.has(outer)) imports.add(outer);
    addTypeImport(inner, schemaNames, imports);
    return;
  }
  const cleaned = type.replace(/\[\]$/, '').replace(/ \| null$/, '').replace(/^\(/, '').replace(/\)$/, '');
  for (const part of cleaned.split(/\s*[|&]\s*/)) {
    const trimmed = part.trim();
    if (schemaNames.has(trimmed)) imports.add(trimmed);
  }
}

function isPrimitive(type: string): boolean {
  const primitives = new Set(['string', 'number', 'boolean', 'void', 'unknown', 'any', 'never', 'null', 'undefined']);
  const base = type.replace(/\[\]$/, '').replace(/ \| null$/, '').trim();
  if (base.includes('<')) return false;
  return primitives.has(base) || base.startsWith('Record<') || base.startsWith('{');
}

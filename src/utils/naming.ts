/**
 * Name transformation utilities.
 * Ported from SDK Forge — single source of truth for method naming.
 */

import { camelCase, pascalCase, kebabCase } from 'change-case';

// ── Public name helpers ───────────────────────────────

export function toMethodName(operationId: string): string {
  return camelCase(operationId);
}
export function toInterfaceName(tag: string): string {
  return `${pascalCase(tag)}API`;
}
export function toFactoryName(tag: string): string {
  return `create${pascalCase(tag)}API`;
}
export function toFileName(tag: string): string {
  return kebabCase(tag);
}
export function toTypeName(name: string): string {
  return pascalCase(name);
}
export function toPropertyName(name: string): string {
  return camelCase(name);
}
export function toClientName(title: string): string {
  return pascalCase(title);
}

export function deriveOperationId(method: string, path: string): string {
  const cleaned = path
    .replace(/\{([^}]+)\}/g, 'By_$1')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return camelCase(`${method.toLowerCase()}_${cleaned}`);
}

// ── Verb registry — single source of truth ────────────

const VERB_SYNONYMS: Readonly<Record<string, string>> = {
  get: 'get', retrieve: 'get', fetch: 'get', find: 'get', show: 'get',
  read: 'get', load: 'get', lookup: 'get', view: 'get',
  list: 'list', search: 'list', browse: 'list', index: 'list', query: 'list',
  create: 'create', add: 'create', insert: 'create', make: 'create', register: 'register',
  update: 'update', modify: 'update', edit: 'update', change: 'update', patch: 'update', set: 'set',
  delete: 'delete', remove: 'remove', destroy: 'delete', purge: 'delete', erase: 'delete',
  authenticate: 'authenticate', login: 'login', logout: 'logout',
  authorize: 'authorize', impersonate: 'impersonate', revoke: 'revoke',
  activate: 'activate', deactivate: 'deactivate', enable: 'enable', disable: 'disable',
  start: 'start', stop: 'stop',
  trigger: 'trigger', force: 'force', schedule: 'schedule', submit: 'submit',
  resubmit: 'resubmit', cancel: 'cancel', approve: 'approve', reject: 'reject',
  complete: 'complete', revalidate: 'revalidate', reconcile: 'reconcile',
  export: 'export', import: 'import', download: 'download', upload: 'upload',
  presign: 'presign', generate: 'generate', batch: 'batch', rotate: 'rotate',
  check: 'check', verify: 'verify', validate: 'validate',
  invite: 'invite', accept: 'accept', join: 'join', leave: 'leave', ban: 'ban', unban: 'unban',
  sync: 'sync', refresh: 'refresh', reset: 'reset', send: 'send', request: 'request',
  mark: 'mark', compare: 'compare', switch: 'switch', evaluate: 'evaluate',
};

const ACTION_VERBS = new Set(Object.values(VERB_SYNONYMS));

const ABBREVIATION_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  app: ['application', 'applications'],
  auth: ['authentication', 'authorization'],
  org: ['organization', 'organizations'],
  repo: ['repository', 'repositories'],
  env: ['environment', 'environments'],
  config: ['configuration', 'configurations'],
  admin: ['administrator', 'administrators'],
  msg: ['message', 'messages'],
  notif: ['notification', 'notifications'],
  sub: ['subscription', 'subscriptions'],
  perm: ['permission', 'permissions'],
  dept: ['department', 'departments'],
  acct: ['account', 'accounts'],
  usr: ['user', 'users'],
  doc: ['document', 'documents'],
  txn: ['transaction', 'transactions'],
};

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'to', 'by', 'in', 'on', 'at', 'from',
  'with', 'within', 'between', 'after', 'before', 'into', 'as', 'all',
  'new', 'current', 'currently', 'active', 'specific', 'existing', 'given',
  'individual', 'particular', 'and', 'or', 'this', 'that', 'its',
]);

// ── Tag helpers ───────────────────────────────────────

function getTagForms(tagName: string): string[] {
  const pc = pascalCase(tagName);
  return pc.endsWith('s') ? [pc, pc.slice(0, -1)] : [pc, `${pc}s`];
}

function getTagWordsLower(tagName: string): Set<string> {
  const words = new Set<string>();
  for (const part of tagName.toLowerCase().split(/[\s\-_]+/)) {
    words.add(part);
    addPluralForms(words, part);
    const formsToExpand = new Set([part]);
    if (part.endsWith('ies')) formsToExpand.add(`${part.slice(0, -3)}y`);
    else if (part.endsWith('s') && part.length > 1) formsToExpand.add(part.slice(0, -1));
    else formsToExpand.add(`${part}s`);
    for (const form of formsToExpand) {
      for (const expansion of ABBREVIATION_REGISTRY[form] ?? []) {
        words.add(expansion);
        addPluralForms(words, expansion);
      }
    }
  }
  return words;
}

function addPluralForms(set: Set<string>, word: string): void {
  if (word.endsWith('ies')) set.add(`${word.slice(0, -3)}y`);
  else if (word.endsWith('s')) set.add(word.slice(0, -1));
  else if (word.endsWith('y')) set.add(`${word.slice(0, -1)}ies`);
  else set.add(`${word}s`);
}

// ── HTTP verb mapping ─────────────────────────────────

function mapHttpMethodToVerb(httpMethod: string, isCollection: boolean): string {
  switch (httpMethod.toLowerCase()) {
    case 'get': return isCollection ? 'list' : 'get';
    case 'post': return 'create';
    case 'put': case 'patch': return 'update';
    case 'delete': return 'delete';
    default: return httpMethod.toLowerCase();
  }
}

function isCollectionEndpoint(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  return segments.length === 0 || !segments[segments.length - 1].startsWith('{');
}

// ── Strategy helpers ──────────────────────────────────

function stripTagPrefix(remainder: string, tagForms: string[]): string {
  for (const form of tagForms) {
    if (!remainder.startsWith(form)) continue;
    const after = remainder.slice(form.length);
    if (!after) return '';
    if (after[0] >= 'A' && after[0] <= 'Z') return after;
    if (after[0] === 's') {
      const afterS = after.slice(1);
      if (!afterS || (afterS[0] >= 'A' && afterS[0] <= 'Z')) return afterS;
    }
  }
  return remainder;
}

function stripTagSuffix(remainder: string, tagForms: string[]): string {
  const candidates = [...tagForms, ...tagForms.map((f) => `${f}s`)];
  for (const form of candidates) {
    if (remainder.endsWith(form)) {
      const before = remainder.slice(0, -form.length);
      if (before) return before;
    }
  }
  return remainder;
}

function isActionVerbWord(pcWord: string): boolean {
  return ACTION_VERBS.has(VERB_SYNONYMS[pcWord.toLowerCase()] ?? pcWord.toLowerCase());
}

function isCleanName(name: string): boolean {
  if (/By[A-Z]/.test(name)) return false;
  return (name.match(/[A-Z]/g)?.length ?? 0) <= 3;
}

// ── Strategy 1: clean operationId ────────────────────

function cleanOperationId(opId: string, tagName: string): string {
  const pcOp = pascalCase(opId);
  const tagForms = getTagForms(tagName);
  const verbMatch = pcOp.match(/^(Get|Post|Put|Patch|Delete|List|Create|Update|Remove)/);
  const verb = verbMatch?.[1] ?? '';
  let remainder = verb ? pcOp.slice(verb.length) : pcOp;
  remainder = stripTagPrefix(remainder, tagForms);
  remainder = stripTagSuffix(remainder, tagForms);
  remainder = remainder.replace(/By[A-Z][a-zA-Z]*/g, '');
  if (!remainder) return verb ? verb.toLowerCase() : camelCase(opId);
  if (verb && isActionVerbWord(remainder)) return camelCase(remainder);
  if (!verb) return camelCase(remainder);
  return camelCase(`${verb}${remainder}`);
}

// ── Strategy 2: clean summary ─────────────────────────

function cleanSummary(summary: string, tagName: string): string | null {
  const cleaned = summary.trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/'s\b/g, '')
    .replace(/\bby\s+\w+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/);
  if (!words.length) return null;

  let verb: string;
  let objectStartIdx: number;
  const first = words[0].toLowerCase();
  const second = words[1]?.toLowerCase();
  if (first === 'log' && second === 'out') { verb = 'logOut'; objectStartIdx = 2; }
  else { verb = VERB_SYNONYMS[first] ?? camelCase(first); objectStartIdx = 1; }

  const tagWords = getTagWordsLower(tagName);
  const objectWords = words.slice(objectStartIdx)
    .map((w) => w.toLowerCase())
    .filter((w) => !FILLER_WORDS.has(w) && !tagWords.has(w))
    .slice(0, 3);
  return objectWords.length ? camelCase(`${verb} ${objectWords.join(' ')}`) : verb;
}

// ── Strategy 3: path-derived ──────────────────────────

function cleanPathDerived(path: string, httpMethod: string, tagName: string): string {
  const tagWords = getTagWordsLower(tagName);
  const meaningful = path.split('/').filter((s) => s && !s.startsWith('{') && !tagWords.has(s.toLowerCase()));
  if (meaningful.length > 0) {
    const last = meaningful[meaningful.length - 1];
    if (isActionVerbWord(pascalCase(last))) {
      const action = meaningful.pop()!;
      return meaningful.length ? camelCase(`${action} ${meaningful.join(' ')}`) : camelCase(action);
    }
  }
  const verb = mapHttpMethodToVerb(httpMethod, isCollectionEndpoint(path));
  return meaningful.length ? camelCase(`${verb} ${meaningful.join(' ')}`) : verb;
}

// ── Public: derive clean method name ─────────────────

export interface CleanMethodNameParams {
  operationId?: string;
  summary?: string;
  path: string;
  httpMethod: string;
  tagName: string;
}

export function deriveCleanMethodName(params: CleanMethodNameParams): string {
  const { operationId, summary, path, httpMethod, tagName } = params;
  if (operationId) {
    const candidate = cleanOperationId(operationId, tagName);
    if (isCleanName(candidate)) return candidate;
  }
  if (summary) {
    const candidate = cleanSummary(summary, tagName);
    if (candidate) return candidate;
  }
  return cleanPathDerived(path, httpMethod, tagName);
}

// ── Deduplication ─────────────────────────────────────

/**
 * Deduplicate method names within a group.
 * Takes an array of names, returns a deduplicated array of the same length.
 */
export function deduplicateMethodNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);

  const result = [...names];
  const seen = new Map<string, number>();

  for (let i = 0; i < result.length; i++) {
    const name = result[i];
    if ((counts.get(name) ?? 0) <= 1) continue;

    const idx = (seen.get(name) ?? 0) + 1;
    seen.set(name, idx);

    if (idx > 1) {
      result[i] = `${name}${idx}`;
    }
  }

  return result;
}

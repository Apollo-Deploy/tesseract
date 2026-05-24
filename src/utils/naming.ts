/**
 * Name transformation utilities.
 * Ported from SDK Forge — single source of truth for method naming.
 */

import { camelCase, pascalCase, kebabCase } from "change-case";

// ─────────────────────────────────────────────────────────────
// CACHES (performance-critical)
// ─────────────────────────────────────────────────────────────

const memo = new Map<string, string>();

function cached(key: string, fn: () => string): string {
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const val = fn();
  memo.set(key, val);
  return val;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC HELPERS
// ─────────────────────────────────────────────────────────────

export function toMethodName(operationId: string): string {
  return cached(`method:${operationId}`, () => camelCase(operationId));
}

export function toInterfaceName(tag: string): string {
  return cached(`iface:${tag}`, () => `${pascalCase(tag)}API`);
}

export function toFactoryName(tag: string): string {
  return cached(`factory:${tag}`, () => `create${pascalCase(tag)}API`);
}

export function toFileName(tag: string): string {
  return cached(`file:${tag}`, () => kebabCase(tag));
}

export function toTypeName(name: string): string {
  return cached(`type:${name}`, () => pascalCase(name));
}

export function toPropertyName(name: string): string {
  return cached(`prop:${name}`, () => camelCase(name));
}

export function toClientName(title: string): string {
  return cached(`client:${title}`, () => pascalCase(title));
}

// ─────────────────────────────────────────────────────────────
// OPERATION ID DERIVATION (FIXED & OPTIMIZED)
// ─────────────────────────────────────────────────────────────

const PATH_PARAM_REGEX = /\{([^}]+)\}/g;
const CLEAN_PATH_REGEX = /[^a-zA-Z0-9_]/g;
const MULTI_UNDERSCORE = /_+/g;

export function deriveOperationId(method: string, path: string): string {
  const cleaned = path
    .replace(PATH_PARAM_REGEX, "By_$1")
    .replace(CLEAN_PATH_REGEX, "_")
    .replace(MULTI_UNDERSCORE, "_")
    .replace(/^_|_$/g, "");

  return camelCase(`${method.toLowerCase()}_${cleaned}`);
}

// ─────────────────────────────────────────────────────────────
// VERB SYSTEM (OPTIMIZED LOOKUPS)
// ─────────────────────────────────────────────────────────────

const VERB_SYNONYMS: Record<string, string> = {
  get: "get",
  retrieve: "get",
  fetch: "get",
  find: "get",
  show: "get",
  read: "get",
  load: "get",
  lookup: "get",
  view: "get",

  list: "list",
  search: "list",
  browse: "list",
  index: "list",
  query: "list",

  create: "create",
  add: "create",
  insert: "create",
  make: "create",
  register: "create",

  update: "update",
  modify: "update",
  edit: "update",
  change: "update",
  patch: "update",
  set: "set",

  delete: "delete",
  remove: "delete",
  destroy: "delete",
  purge: "delete",
  erase: "delete",

  authenticate: "authenticate",
  login: "login",
  logout: "logout",
  authorize: "authorize",
  impersonate: "impersonate",
  revoke: "revoke",

  activate: "activate",
  deactivate: "deactivate",
  enable: "enable",
  disable: "disable",

  start: "start",
  stop: "stop",

  trigger: "trigger",
  force: "force",
  schedule: "schedule",
  submit: "submit",
  resubmit: "resubmit",
  cancel: "cancel",
  approve: "approve",
  reject: "reject",

  complete: "complete",
  revalidate: "revalidate",
  reconcile: "reconcile",

  export: "export",
  import: "import",
  download: "download",
  upload: "upload",

  presign: "presign",
  generate: "generate",
  batch: "batch",
  rotate: "rotate",

  check: "check",
  verify: "verify",
  validate: "validate",

  invite: "invite",
  accept: "accept",
  join: "join",
  leave: "leave",
  ban: "ban",
  unban: "unban",

  sync: "sync",
  refresh: "refresh",
  reset: "reset",
  send: "send",
  request: "request",

  mark: "mark",
  compare: "compare",
  switch: "switch",
  evaluate: "evaluate",
};

const ACTION_VERBS = new Set(Object.values(VERB_SYNONYMS));

const FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "by",
  "in",
  "on",
  "at",
  "from",
  "with",
  "within",
  "between",
  "after",
  "before",
  "into",
  "as",
  "all",
  "new",
  "current",
  "currently",
  "active",
  "specific",
  "existing",
  "given",
  "individual",
  "particular",
  "and",
  "or",
  "this",
  "that",
  "its",
]);

const ABBREV: Record<string, readonly string[]> = {
  app: ["application", "applications"],
  auth: ["authentication", "authorization"],
  org: ["organization", "organizations"],
  repo: ["repository", "repositories"],
  env: ["environment", "environments"],
  config: ["configuration", "configurations"],
  admin: ["administrator", "administrators"],
  msg: ["message", "messages"],
  notif: ["notification", "notifications"],
  sub: ["subscription", "subscriptions"],
  perm: ["permission", "permissions"],
  dept: ["department", "departments"],
  acct: ["account", "accounts"],
  usr: ["user", "users"],
  doc: ["document", "documents"],
  txn: ["transaction", "transactions"],
};

// ─────────────────────────────────────────────────────────────
// TAG ANALYSIS (OPTIMIZED, LESS ALLOCATION)
// ─────────────────────────────────────────────────────────────

function splitWords(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(Boolean);
}

function addPlural(word: string, out: Set<string>): void {
  if (word.endsWith("ies")) out.add(word.slice(0, -3) + "y");
  else if (word.endsWith("y")) out.add(word.slice(0, -1) + "ies");
  else if (word.endsWith("s")) out.add(word.slice(0, -1));
  else out.add(word + "s");
}

function getTagWordsLower(tagName: string): Set<string> {
  const words = new Set<string>();
  const parts = splitWords(tagName);

  for (const part of parts) {
    words.add(part);
    addPlural(part, words);

    const expanded = ABBREV[part];
    if (expanded) {
      for (const e of expanded) {
        words.add(e);
        addPlural(e, words);
      }
    }
  }

  return words;
}

function getTagForms(tagName: string): string[] {
  const pc = pascalCase(tagName);
  return pc.endsWith("s") ? [pc, pc.slice(0, -1)] : [pc, `${pc}s`];
}

// ─────────────────────────────────────────────────────────────
// HTTP / PATH ANALYSIS
// ─────────────────────────────────────────────────────────────

function mapHttpMethodToVerb(method: string, isCollection: boolean): string {
  const m = method.toLowerCase();
  if (m === "get") return isCollection ? "list" : "get";
  if (m === "post") return "create";
  if (m === "put" || m === "patch") return "update";
  if (m === "delete") return "delete";
  return m;
}

function isCollectionEndpoint(path: string): boolean {
  const last = path.split("/").filter(Boolean).pop();
  return !last || !last.startsWith("{");
}

// ─────────────────────────────────────────────────────────────
// CLEANING STRATEGIES (FIXED LOGIC)
// ─────────────────────────────────────────────────────────────

function stripTagEdges(input: string, forms: string[]): string {
  let out = input;

  for (const f of forms) {
    if (out.startsWith(f)) {
      const next = out.slice(f.length);
      if (next && /[A-Z]/.test(next[0])) out = next;
      else if (next.startsWith("s") && /[A-Z]/.test(next[1] ?? ""))
        out = next.slice(1);
    }

    if (out.endsWith(f)) {
      const before = out.slice(0, -f.length);
      if (before) out = before;
    }
  }

  return out;
}

function isActionVerb(word: string): boolean {
  const v = VERB_SYNONYMS[word.toLowerCase()] ?? word.toLowerCase();
  return ACTION_VERBS.has(v);
}

function isCleanName(name: string): boolean {
  if (/By[A-Z]/.test(name)) return false;
  return (name.match(/[A-Z]/g)?.length ?? 0) <= 3;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY 1: OPERATION ID
// ─────────────────────────────────────────────────────────────

function cleanOperationId(opId: string, tag: string): string {
  const pc = pascalCase(opId);
  const forms = getTagForms(tag);

  const verbMatch = pc.match(
    /^(Get|Post|Put|Patch|Delete|List|Create|Update|Remove)/,
  );
  const verb = verbMatch?.[1] ?? "";

  let remainder = verb ? pc.slice(verb.length) : pc;

  remainder = stripTagEdges(remainder, forms);
  remainder = remainder.replace(/By[A-Z][a-zA-Z]*/g, "");

  if (!remainder) return verb ? verb.toLowerCase() : camelCase(opId);
  if (verb && isActionVerb(remainder)) return camelCase(remainder);

  return verb ? camelCase(`${verb}${remainder}`) : camelCase(remainder);
}

// ─────────────────────────────────────────────────────────────
// STRATEGY 2: SUMMARY
// ─────────────────────────────────────────────────────────────

function cleanSummary(summary: string, tag: string): string | null {
  const cleaned = summary
    .trim()
    .replace(/\([^)]*\)/g, "")
    .replace(/'s\b/g, "")
    .replace(/\bby\s+\w+$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ");
  if (!words.length) return null;

  const first = words[0].toLowerCase();
  const second = words[1]?.toLowerCase();

  let verb: string;
  let idx = 1;

  if (first === "log" && second === "out") {
    verb = "logOut";
    idx = 2;
  } else {
    verb = VERB_SYNONYMS[first] ?? camelCase(first);
  }

  const tagWords = getTagWordsLower(tag);

  const objectWords = words
    .slice(idx)
    .map((w) => w.toLowerCase())
    .filter((w) => !FILLER_WORDS.has(w) && !tagWords.has(w))
    .slice(0, 3);

  return objectWords.length
    ? camelCase(`${verb} ${objectWords.join(" ")}`)
    : verb;
}

// ─────────────────────────────────────────────────────────────
// STRATEGY 3: PATH
// ─────────────────────────────────────────────────────────────

function cleanPathDerived(path: string, method: string, tag: string): string {
  const tagWords = getTagWordsLower(tag);

  const meaningful = path
    .split("/")
    .filter((s) => s && !s.startsWith("{") && !tagWords.has(s.toLowerCase()));

  const verb = mapHttpMethodToVerb(method, isCollectionEndpoint(path));

  return meaningful.length
    ? camelCase(`${verb} ${meaningful.join(" ")}`)
    : verb;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

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
    const c = cleanOperationId(operationId, tagName);
    if (isCleanName(c)) return c;
  }

  if (summary) {
    const c = cleanSummary(summary, tagName);
    if (c) return c;
  }

  return cleanPathDerived(path, httpMethod, tagName);
}

// ─────────────────────────────────────────────────────────────
// DEDUPLICATION (FIXED + STABLE)
// ─────────────────────────────────────────────────────────────

export function deduplicateMethodNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);

  const seen = new Map<string, number>();
  const out = new Array(names.length);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];

    if ((counts.get(name) ?? 0) <= 1) {
      out[i] = name;
      continue;
    }

    const idx = (seen.get(name) ?? 0) + 1;
    seen.set(name, idx);

    out[i] = idx === 1 ? name : `${name}${idx}`;
  }

  return out;
}

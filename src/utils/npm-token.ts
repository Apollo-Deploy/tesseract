/**
 * Resolves a private npm registry auth token from multiple sources.
 *
 * Works across npm, yarn, pnpm, and bun — all respect .npmrc files.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_HOST = "//registry.npmjs.org/";
const AUTH_TOKEN_KEY = `${REGISTRY_HOST}:_authToken`;

/**
 * Resolves the npm auth token for registry.npmjs.org.
 *
 * Tries sources in order:
 * 1. Explicit token (passed by user)
 * 2. NPM_TOKEN environment variable
 * 3. `npm config get` (works with npm installed alongside any runtime)
 * 4. User-level ~/.npmrc (parsed directly — works for npm, yarn, pnpm, bun)
 * 5. Project-local .npmrc
 *
 * Returns undefined if no token is found (caller falls back gracefully).
 */
export function resolveNpmToken(explicitToken?: string): string | undefined {
  // 1. Explicit token passed by user
  if (explicitToken) return explicitToken;

  // 2. Environment variable (most common in CI/CD)
  const envToken = process.env.NPM_TOKEN;
  if (envToken) return envToken;

  // 3. npm config get — authoritative source for npm-based setups.
  //    Uses execSync so it works synchronously in config resolution.
  try {
    const token = execSync(`npm config get ${JSON.stringify(AUTH_TOKEN_KEY)}`, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // npm config get returns the literal string "undefined" when unset
    if (token && token !== "undefined") return token;
  } catch {
    // npm not available, timed out, or failed — fall through
  }

  // 4. Parse ~/.npmrc directly (universal — all package managers respect this)
  try {
    const token = parseNpmrcForToken(join(homedir(), ".npmrc"));
    if (token) return token;
  } catch {
    // file doesn't exist or can't be read
  }

  // 5. Project-local .npmrc
  try {
    const token = parseNpmrcForToken(".npmrc");
    if (token) return token;
  } catch {
    // no local .npmrc
  }

  return undefined;
}

/**
 * Parses an .npmrc-style file for the auth token of registry.npmjs.org.
 *
 * Supported formats:
 *   //registry.npmjs.org/:_authToken=npm_abc123
 *   //registry.npmjs.org/:_authToken = npm_abc123
 */
function parseNpmrcForToken(filePath: string): string | undefined {
  const contents = readFileSync(filePath, "utf-8");

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (key === AUTH_TOKEN_KEY && value) {
      return value;
    }
  }

  return undefined;
}

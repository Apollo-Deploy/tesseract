/**
 * Stable name reservation utility.
 */

export function reserveName(name: string, used: Set<string>): string {
  let candidate = name;
  let i = 2;

  while (used.has(candidate)) {
    candidate = `${name}${i++}`;
  }

  used.add(candidate);
  return candidate;
}

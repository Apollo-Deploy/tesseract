/**
 * Pure string parsers (no ts-morph, no IR knowledge).
 */

export function splitTopLevel(
  input: string,
  separator: "|" | "&" | ";" | ",",
): string[] {
  const out: string[] = [];
  let buf = "";

  let curly = 0,
    angle = 0,
    paren = 0,
    bracket = 0;
  let quote: string | undefined;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = input[i - 1];

    if (quote) {
      buf += ch;
      if (ch === quote && prev !== "\\") quote = undefined;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }

    switch (ch) {
      case "{":
        curly++;
        break;
      case "}":
        curly--;
        break;
      case "<":
        angle++;
        break;
      case ">":
        angle--;
        break;
      case "(":
        paren++;
        break;
      case ")":
        paren--;
        break;
      case "[":
        bracket++;
        break;
      case "]":
        bracket--;
        break;
    }

    if (
      ch === separator &&
      curly === 0 &&
      angle === 0 &&
      paren === 0 &&
      bracket === 0
    ) {
      out.push(buf.trim());
      buf = "";
      continue;
    }

    buf += ch;
  }

  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [input.trim()];
}

export function parseGenericArgs(
  type: string,
  name: string,
): string[] | undefined {
  const prefix = `${name}<`;
  if (!type.startsWith(prefix) || !type.endsWith(">")) return;

  return splitTopLevel(type.slice(prefix.length, -1), ",");
}

export function isWrappedBy(
  input: string,
  open: string,
  close: string,
): boolean {
  return input.startsWith(open) && input.endsWith(close);
}

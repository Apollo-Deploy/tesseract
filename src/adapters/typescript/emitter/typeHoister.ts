/**
 * Inline type normalization + hoisting.
 */

import { splitTopLevel, parseGenericArgs, isWrappedBy } from "./parsers.js";
import type { EmitContext } from "./emitSchema.js";
import { reserveName } from "./nameAllocator.js";

export function hoistInlineTypes(
  type: string,
  preferred: string,
  ctx: EmitContext,
): string {
  const t = type.trim();
  if (!t) return t;

  const unions = splitTopLevel(t, "|");
  if (unions.length > 1) {
    return unions
      .map((u, i) => hoistInlineTypes(u, `${preferred}U${i}`, ctx))
      .join(" | ");
  }

  const inters = splitTopLevel(t, "&");
  if (inters.length > 1) {
    return inters
      .map((u, i) => hoistInlineTypes(u, `${preferred}I${i}`, ctx))
      .join(" & ");
  }

  if (t.endsWith("[]")) {
    const inner = hoistInlineTypes(t.slice(0, -2), `${preferred}Item`, ctx);
    return `${inner}[]`;
  }

  const arr = parseGenericArgs(t, "Array");
  if (arr) {
    return `Array<${hoistInlineTypes(arr[0], `${preferred}Item`, ctx)}>`;
  }

  const rec = parseGenericArgs(t, "Record");
  if (rec) {
    return `Record<${rec[0]}, ${hoistInlineTypes(rec[1], `${preferred}Value`, ctx)}>`;
  }

  if (isWrappedBy(t, "{", "}")) {
    return emitInlineObject(preferred, ctx);
  }

  return t;
}

function emitInlineObject(
  preferred: string,
  ctx: EmitContext,
): string {
  const name = reserveName(preferred, ctx.reservedNames);

  ctx.sourceFile.addInterface({
    name,
    isExported: true,
  });

  return name;
}

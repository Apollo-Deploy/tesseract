/**
 * Schema emission layer.
 */

import { pascalCase } from "change-case";
import type {
  SourceFile,
  OptionalKind,
  PropertySignatureStructure,
} from "ts-morph";
import { SchemaDefinition, SchemaProperty } from "../../../types/ir.js";
import { hoistInlineTypes } from "./typeHoister.js";

export interface EmitContext {
  sourceFile: SourceFile;
  reservedNames: Set<string>;
}

export function createEmitContext(
  sourceFile: SourceFile,
  reserved: Set<string>,
): EmitContext {
  return { sourceFile, reservedNames: new Set(reserved) };
}

export function emitSchema(
  sf: SourceFile,
  schema: SchemaDefinition,
  ctx: EmitContext,
): void {
  if (schema.isEnum) return emitEnum(sf, schema);
  if (schema.isTypeAlias || schema.isUnionType || schema.isIntersectionType)
    return emitTypeAlias(sf, schema, ctx);

  return emitInterface(sf, schema, ctx);
}

function emitEnum(sf: SourceFile, schema: SchemaDefinition): void {
  const values = schema.enumValues ?? [];
  if (!values.length) return;

  const allStrings = values.every((v) => typeof v === "string");

  if (allStrings) {
    const members = values.map((v) => {
      const key = String(v)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^(\d)/, "_$1")
        .toUpperCase();

      return `  ${key}: ${JSON.stringify(v)}`;
    });

    sf.addStatements([
      schema.description ? `/** ${schema.description} */` : "",
      `export const ${schema.name} = {`,
      members.join(",\n"),
      `} as const;`,
      `export type ${schema.name} = (typeof ${schema.name})[keyof typeof ${schema.name}];`,
      "",
    ]);

    return;
  }

  sf.addEnum({
    name: schema.name,
    isExported: true,
    members: values.map((v) => ({
      name: `VALUE_${String(v).replace(/[^a-zA-Z0-9_]/g, "_")}`,
      value: typeof v === "string" ? JSON.stringify(v) : String(v),
    })),
  });
}

function emitTypeAlias(
  sf: SourceFile,
  schema: SchemaDefinition,
  ctx: EmitContext,
): void {
  let type = "unknown";

  if (schema.isUnionType) {
    type = (schema.unionMembers ?? [])
      .map((m, i) => hoistInlineTypes(m, `${schema.name}U${i}`, ctx))
      .join(" | ");
  }

  if (schema.isIntersectionType) {
    type = (schema.intersectionMembers ?? [])
      .map((m, i) => hoistInlineTypes(m, `${schema.name}I${i}`, ctx))
      .join(" & ");
  }

  if (schema.additionalPropertiesType) {
    type = `Record<string, ${hoistInlineTypes(
      schema.additionalPropertiesType,
      `${schema.name}Value`,
      ctx,
    )}>`;
  }

  sf.addTypeAlias({
    name: schema.name,
    isExported: true,
    type,
  });
}

function emitInterface(
  sf: SourceFile,
  schema: SchemaDefinition,
  ctx: EmitContext,
): void {
  const props = schema.properties.map((p) => buildProp(schema.name, p, ctx));

  const iface = sf.addInterface({
    name: schema.name,
    isExported: true,
    properties: props,
  });

  if (schema.additionalPropertiesType) {
    iface.addIndexSignature({
      keyName: "key",
      keyType: "string",
      returnType: hoistInlineTypes(
        schema.additionalPropertiesType,
        `${schema.name}Value`,
        ctx,
      ),
    });
  }
}

function buildProp(
  owner: string,
  prop: SchemaProperty,
  ctx: EmitContext,
): OptionalKind<PropertySignatureStructure> {
  const type = prop.nullable ? `${prop.type} | null` : prop.type;

  return {
    name: prop.name,
    type: hoistInlineTypes(type, `${owner}${pascalCase(prop.name)}`, ctx),
    hasQuestionToken: !prop.required,
    isReadonly: prop.readOnly ?? false,
  };
}

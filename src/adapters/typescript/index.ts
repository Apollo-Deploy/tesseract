/**
 * TypeScript language adapter.
 * Orchestrates model emission (ts-morph) and template rendering (Handlebars).
 */

import { join } from 'node:path';
import type { EnrichedSDKIR } from '../../types/ir.js';
import type { LanguageAdapter, EmitResult } from '../types.js';
import type { EmittedFile } from '../../pipeline/write.js';
import { emitTypeScriptModels } from './model-emitter.js';
import { splitSchemasByOwnership, buildExternalImportGroups, collectExternalPackages, COMMON_TYPE_NAMES } from './shared.js';
import { getTemplate, registerHelpers, collectImports } from '../../helpers/handlebars.js';
import { formatTypeScript } from '../../utils/format.js';

export class TypeScriptAdapter implements LanguageAdapter {
  readonly language = 'typescript';

  async emit(enriched: EnrichedSDKIR, outputDir: string): Promise<EmitResult> {
    registerHelpers();

    const files: EmittedFile[] = [];
    const warnings: string[] = [];

    const { generatedSchemas, externalSchemas } = splitSchemasByOwnership(enriched.schemas);
    const schemaNames = new Set(enriched.schemas.map((s) => s.name));
    const externalImports = buildExternalImportGroups(externalSchemas);
    const externalTypeNames = new Set(externalSchemas.map((s) => s.name));
    const commonTypeExports = COMMON_TYPE_NAMES.filter((name) => !externalTypeNames.has(name));
    const externalPackages = collectExternalPackages(enriched.schemas, enriched.meta.schemaPackage);
    const hasSSE = enriched.groups.some((g) => g.operations.some((op) => op.isEventStream));

    // ── ts-morph: model type files ───────────────────────────────────────────
    let domainTypeFiles: string[] = [];
    try {
      const { files: modelFiles, domainTypeFiles: dtf } = emitTypeScriptModels(enriched, outputDir);
      files.push(...modelFiles);
      domainTypeFiles = dtf;
    } catch (err) {
      warnings.push(`ts-morph model emission failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Handlebars: all other TypeScript files ───────────────────────────────

    // Domain files
    const domainTemplate = getTemplate('typescript', 'domain');
    for (const group of enriched.groups) {
      try {
        const imports = collectImports(group.operations, schemaNames);
        const groupHasSSE = group.operations.some((op) => op.isEventStream);
        files.push({
          relativePath: join('src', 'domain', `${group.fileName}.ts`),
          content: domainTemplate({ ...group, imports, hasSSE: groupHasSSE }),
        });
      } catch (err) {
        warnings.push(`domain/${group.fileName}.ts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Domain index barrel
    tryEmit(files, warnings, join('src', 'domain', 'index.ts'), () =>
      getTemplate('typescript', 'domain-index')({ groups: enriched.groups }));

    // Types
    tryEmit(files, warnings, join('src', 'types', 'common.ts'), () =>
      getTemplate('typescript', 'types-common')({}));
    tryEmit(files, warnings, join('src', 'types', 'errors.ts'), () =>
      getTemplate('typescript', 'types-errors')({}));
    tryEmit(files, warnings, join('src', 'types', 'index.ts'), () =>
      getTemplate('typescript', 'types')({
        schemas: generatedSchemas,
        externalImports,
        domainTypeFiles,
        commonTypeExports,
      }));

    // Transport
    tryEmit(files, warnings, join('src', 'transport', 'axios.ts'), () =>
      getTemplate('typescript', 'transport')({ securitySchemes: enriched.securitySchemes }));

    // SSE transport
    if (hasSSE) {
      tryEmit(files, warnings, join('src', 'transport', 'sse.ts'), () =>
        getTemplate('typescript', 'transport-sse')({}));
    }

    // Utils
    tryEmit(files, warnings, join('src', 'utils', 'query.ts'), () =>
      getTemplate('typescript', 'utils-query')({}));
    tryEmit(files, warnings, join('src', 'utils', 'index.ts'), () =>
      getTemplate('typescript', 'utils-index')({}));

    // Client, index, package.json, tsconfig, README
    tryEmit(files, warnings, join('src', 'client.ts'), () =>
      getTemplate('typescript', 'client')({
        meta: enriched.meta,
        groups: enriched.groups,
        securitySchemes: enriched.securitySchemes,
        hasSSE,
      }));
    tryEmit(files, warnings, 'index.ts', () =>
      getTemplate('typescript', 'index')({
        meta: enriched.meta,
        groups: enriched.groups,
        schemas: enriched.schemas,
        hasSSE,
      }));
    tryEmit(files, warnings, 'package.json', () =>
      getTemplate('typescript', 'package-json')({ ...enriched.meta, externalPackages }));
    tryEmit(files, warnings, 'tsconfig.json', () =>
      getTemplate('typescript', 'tsconfig')({}));
    tryEmit(files, warnings, 'README.md', () =>
      getTemplate('typescript', 'readme')({
        ...enriched.meta,
        groups: enriched.groups,
        schemas: enriched.schemas,
        securitySchemes: enriched.securitySchemes,
        hasSSE,
      }));

    // Format TypeScript files
    const formatted: EmittedFile[] = [];
    for (const file of files) {
      if (file.relativePath.endsWith('.ts')) {
        formatted.push({ ...file, content: await formatTypeScript(file.content) });
      } else {
        formatted.push(file);
      }
    }

    return { files: formatted, warnings };
  }
}

function tryEmit(
  files: EmittedFile[],
  warnings: string[],
  relativePath: string,
  render: () => string,
): void {
  try {
    files.push({ relativePath, content: render() });
  } catch (err) {
    warnings.push(`${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

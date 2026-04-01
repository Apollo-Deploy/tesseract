/**
 * Code formatting via Prettier.
 */

import prettier from 'prettier';

const PRETTIER_OPTIONS: prettier.Options = {
  parser: 'typescript',
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
};

export async function formatTypeScript(content: string): Promise<string> {
  try {
    return await prettier.format(content, PRETTIER_OPTIONS);
  } catch {
    return content;
  }
}

/**
 * Tesseract Elysia integration.
 *
 * Provides a `tesseractPlugin()` factory that returns an Elysia plugin and a
 * paired `SDKCollector`. Register the plugin with your app, then annotate
 * routes with the collector. The plugin triggers SDK generation automatically
 * when `TESSERACT_GENERATE=1` is set.
 *
 * ```ts
 * import { Elysia } from 'elysia';
 * import { tesseractPlugin } from '@apollo-deploy/tesseract/elysia';
 *
 * const { plugin, collector } = tesseractPlugin({
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 *
 * collector.domain('/users', { domain: 'users', description: 'User management' });
 * collector.route('/users/:id', 'GET', { sdk: { methodName: 'getUser' } });
 * collector.route('/users', 'POST', { sdk: { methodName: 'createUser' } });
 *
 * const app = new Elysia()
 *   .use(plugin)
 *   .get('/users/:id', ({ params }) => getUser(params.id))
 *   .post('/users', ({ body }) => createUser(body))
 *   .listen(3000);
 * ```
 *
 * **Triggering generation:**
 * ```bash
 * TESSERACT_GENERATE=1 bun run dist/app.js
 * ```
 */

import { SDKCollector } from './collector.js';
import type { CollectorOptions } from './collector.js';

export { SDKCollector } from './collector.js';
export type { CollectorOptions, CollectorRouteConfig } from './collector.js';

/**
 * Minimal Elysia plugin type — typed as `unknown` to avoid requiring a hard
 * dependency on the `elysia` package.
 */
type ElysiaLike = {
  onStart(handler: () => void | Promise<void>): unknown;
};

export interface TesseractElysiaPlugin {
  /** The Elysia plugin. Pass to `.use(plugin)` on your app. */
  plugin: (app: ElysiaLike) => ElysiaLike;
  /** The collector. Register domains and routes on this before your app starts. */
  collector: SDKCollector;
}

/**
 * Create a Tesseract Elysia plugin and a paired `SDKCollector`.
 *
 * The plugin registers an `onStart` hook that triggers SDK generation when
 * `TESSERACT_GENERATE=1` is set. It is a no-op otherwise.
 *
 * @example
 * ```ts
 * const { plugin, collector } = tesseractPlugin({ info: { ... }, output: './sdk' });
 * collector.route('/users/:id', 'GET', { sdk: { methodName: 'getUser' } });
 * new Elysia().use(plugin).get('/users/:id', handler).listen(3000);
 * ```
 */
export function tesseractPlugin(opts: CollectorOptions): TesseractElysiaPlugin {
  const collector = new SDKCollector(opts);

  const plugin = (app: ElysiaLike): ElysiaLike => {
    app.onStart(async () => {
      if (!process.env.TESSERACT_GENERATE) return;

      if (collector['_routes'].length === 0) {
        console.error(
          '\n[tesseract] No SDK routes found. Call collector.route() before the app starts.',
        );
        process.exit(1);
      }

      const result = await collector.generate();
      for (const w of result.warnings) console.warn(`  ⚠  ${w}`);
      console.log(
        `\n[tesseract] ${collector['_routes'].length} route(s) → ${opts.output}`,
      );
      console.log(`[tesseract] ✓ ${result.filesWritten} files written\n`);
      process.exit(0);
    });

    return app;
  };

  return { plugin, collector };
}

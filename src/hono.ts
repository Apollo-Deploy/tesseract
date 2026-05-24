/**
 * Tesseract Hono integration.
 *
 * Re-exports `SDKCollector` and adds a `HonoSDKCollector` subclass with a
 * `.honoMiddleware()` helper that registers a route with the collector and
 * returns a no-op Hono middleware handler for inline placement.
 *
 * Because Hono has no route-registration hook, routes are registered with the
 * collector explicitly. Generation is triggered by calling
 * `collector.tryGenerate()` after all routes are set up.
 *
 * ```ts
 * import { Hono } from 'hono';
 * import { HonoSDKCollector } from '@apollo-deploy/tesseract/hono';
 *
 * const app = new Hono();
 * const collector = new HonoSDKCollector({
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 *
 * collector.domain('/users', { domain: 'users', description: 'User management' });
 *
 * app.get('/users/:id',
 *   collector.honoMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
 *   (c) => c.json(getUser(c.req.param('id'))),
 * );
 *
 * // After all routes are registered:
 * if (await collector.tryGenerate()) process.exit(0);
 *
 * export default app;
 * ```
 *
 * **Triggering generation:**
 * ```bash
 * TESSERACT_GENERATE=1 node dist/app.js
 * ```
 */

import { SDKCollector } from './collector.js';
import type { CollectorRouteConfig } from './collector.js';

export { SDKCollector } from './collector.js';
export type { CollectorOptions, CollectorRouteConfig } from './collector.js';

/** Minimal Hono middleware type — avoids a hard import of the `hono` package. */
type HonoMiddleware = (c: unknown, next: () => Promise<void>) => Promise<void> | void;

/**
 * `SDKCollector` subclass with a Hono-specific `.honoMiddleware()` helper.
 *
 * `.honoMiddleware()` registers a route with the collector **and** returns a
 * no-op Hono middleware for inline placement in `app.get()` / `app.post()` etc.
 */
export class HonoSDKCollector extends SDKCollector {
  /**
   * Register a route with the collector and return a no-op Hono middleware.
   *
   * ```ts
   * app.get('/users/:id',
   *   collector.honoMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
   *   (c) => c.json(getUser(c.req.param('id'))),
   * );
   * ```
   */
  honoMiddleware(url: string, method: string, config: CollectorRouteConfig): HonoMiddleware {
    this.route(url, method, config);
    return (_c, next) => next();
  }
}

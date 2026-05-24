/**
 * Tesseract Express integration.
 *
 * Re-exports `SDKCollector` and adds an `ExpressSDKCollector` subclass with a
 * `.expressRoute()` helper that registers a route with the collector and returns
 * a no-op Express middleware in a single call — keeping SDK metadata co-located
 * with the route definition.
 *
 * Because Express has no route-registration hook, routes are registered with the
 * collector explicitly. Generation is triggered by calling
 * `collector.tryGenerate()` after all routes are set up.
 *
 * ```ts
 * import express from 'express';
 * import { ExpressSDKCollector } from '@apollo-deploy/tesseract/express';
 *
 * const app = express();
 * const collector = new ExpressSDKCollector({
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 *
 * collector.domain('/users', { domain: 'users', description: 'User management' });
 *
 * app.get('/users/:id',
 *   collector.expressRoute('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
 *   getUserHandler,
 * );
 *
 * app.post('/users',
 *   collector.expressRoute('/users', 'POST', { sdk: { methodName: 'createUser' } }),
 *   createUserHandler,
 * );
 *
 * // After all routes are registered:
 * if (await collector.tryGenerate()) process.exit(0);
 *
 * app.listen(3000);
 * ```
 *
 * **Triggering generation:**
 * ```bash
 * TESSERACT_GENERATE=1 node dist/app.js
 * ```
 */

import { SDKCollector } from './collector.js';
import type { CollectorRouteConfig } from './collector.js';

/** Minimal Express RequestHandler type — avoids a hard import of the `express` package. */
type RequestHandler = (req: unknown, res: unknown, next: () => void) => void;

export { SDKCollector } from './collector.js';
export type { CollectorOptions, CollectorRouteConfig } from './collector.js';

/**
 * `SDKCollector` subclass with an Express-specific `.expressRoute()` helper.
 *
 * `.expressRoute()` registers a route with the collector **and** returns a
 * no-op `RequestHandler` for inline placement in `app.get()` / `router.post()` etc.
 */
export class ExpressSDKCollector extends SDKCollector {
  /**
   * Register a route with the collector and return a no-op Express middleware.
   *
   * Placing the returned middleware in your route definition keeps the SDK
   * metadata co-located with the handler:
   *
   * ```ts
   * app.get('/users/:id', collector.expressRoute('/users/:id', 'GET', {
   *   sdk: { methodName: 'getUser' },
   *   schema: { response: { 200: { $ref: 'User' } } },
   * }), handler);
   * ```
   */
  expressRoute(url: string, method: string, config: CollectorRouteConfig): RequestHandler {
    this.route(url, method, config);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  }
}

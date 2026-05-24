/**
 * Tesseract Koa integration.
 *
 * Re-exports `SDKCollector` and adds a `KoaSDKCollector` subclass with a
 * `.koaMiddleware()` helper that registers a route with the collector and
 * returns a no-op Koa middleware for inline placement with `@koa/router`.
 *
 * Because Koa has no route-registration hook, routes are registered with the
 * collector explicitly. Generation is triggered by calling
 * `collector.tryGenerate()` after all routes are set up.
 *
 * ```ts
 * import Koa from 'koa';
 * import Router from '@koa/router';
 * import { KoaSDKCollector } from '@apollo-deploy/tesseract/koa';
 *
 * const app = new Koa();
 * const router = new Router();
 * const collector = new KoaSDKCollector({
 *   info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *   output: './packages/api-sdk',
 * });
 *
 * collector.domain('/users', { domain: 'users', description: 'User management' });
 *
 * router.get('/users/:id',
 *   collector.koaMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
 *   getUserHandler,
 * );
 *
 * app.use(router.routes());
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

export { SDKCollector } from './collector.js';
export type { CollectorOptions, CollectorRouteConfig } from './collector.js';

/** Minimal Koa middleware type — avoids a hard import of the `koa` package. */
type KoaMiddleware = (ctx: unknown, next: () => Promise<void>) => Promise<void> | void;

/**
 * `SDKCollector` subclass with a Koa-specific `.koaMiddleware()` helper.
 *
 * `.koaMiddleware()` registers a route with the collector **and** returns a
 * no-op Koa middleware for inline placement with `@koa/router`.
 */
export class KoaSDKCollector extends SDKCollector {
  /**
   * Register a route with the collector and return a no-op Koa middleware.
   *
   * ```ts
   * router.get('/users/:id',
   *   collector.koaMiddleware('/users/:id', 'GET', { sdk: { methodName: 'getUser' } }),
   *   getUserHandler,
   * );
   * ```
   */
  koaMiddleware(url: string, method: string, config: CollectorRouteConfig): KoaMiddleware {
    this.route(url, method, config);
    return (_ctx, next) => next();
  }
}

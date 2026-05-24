/**
 * Tesseract NestJS integration.
 *
 * Provides:
 * - `@SDKMethod(config)` — method decorator to attach SDK metadata to a controller handler
 * - `@SDKDomain(config)` — class decorator to attach domain metadata to a controller
 * - `collectFromNestControllers(controllers, collector)` — reads decorator metadata and
 *   registers routes with an `SDKCollector`
 *
 * Requires `reflect-metadata` (already a standard NestJS dependency) and
 * `emitDecoratorMetadata: true` in `tsconfig.json`.
 *
 * ```ts
 * // users.controller.ts
 * import { Controller, Get, Post, Param, Body } from '@nestjs/common';
 * import { SDKMethod, SDKDomain } from '@apollo-deploy/tesseract/nestjs';
 *
 * @Controller('users')
 * @SDKDomain({ domain: 'users', description: 'User management' })
 * export class UsersController {
 *   @Get(':id')
 *   @SDKMethod({ methodName: 'getUser', schema: { response: { 200: { $ref: 'User' } } } })
 *   getUser(@Param('id') id: string) { ... }
 *
 *   @Post()
 *   @SDKMethod({ methodName: 'createUser' })
 *   createUser(@Body() body: CreateUserDto) { ... }
 * }
 *
 * // main.ts
 * import { NestFactory } from '@nestjs/core';
 * import { AppModule } from './app.module';
 * import { SDKCollector, collectFromNestControllers } from '@apollo-deploy/tesseract/nestjs';
 * import { UsersController } from './users/users.controller';
 *
 * async function bootstrap() {
 *   const app = await NestFactory.create(AppModule);
 *   await app.init();
 *
 *   if (process.env.TESSERACT_GENERATE) {
 *     const collector = new SDKCollector({
 *       info: { title: 'My API', version: '1.0.0', baseUrl: 'https://api.example.com' },
 *       output: './packages/api-sdk',
 *     });
 *     collectFromNestControllers([UsersController], collector);
 *     await collector.generate();
 *     await app.close();
 *     process.exit(0);
 *   }
 *
 *   await app.listen(3000);
 * }
 * bootstrap();
 * ```
 *
 * **Triggering generation:**
 * ```bash
 * TESSERACT_GENERATE=1 node dist/main.js
 * ```
 */

// Extend the global Reflect interface to include the reflect-metadata API.
// NestJS apps always import 'reflect-metadata', but Tesseract itself doesn't
// depend on it — we just declare the shape we need.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Reflect {
    function defineMetadata(key: unknown, value: unknown, target: object, propertyKey?: string | symbol): void;
    function getMetadata(key: unknown, target: object, propertyKey?: string | symbol): unknown;
  }
}

import { SDKCollector } from './collector.js';
import type { CollectorRouteConfig } from './collector.js';
import type { SDKRouteConfig, SDKModuleConfig } from './types/sdk-module.js';
import type { ManifestRouteSchema } from './types/manifest.js';

export { SDKCollector } from './collector.js';
export type { CollectorOptions, CollectorRouteConfig } from './collector.js';

// ── Metadata keys ─────────────────────────────────────────────────────────────

const SDK_METHOD_META = Symbol('tesseract:sdkMethod');
const SDK_DOMAIN_META = Symbol('tesseract:sdkDomain');

// NestJS stores route metadata under these well-known string keys
const NEST_PATH_META = 'path';
const NEST_METHOD_META = 'method';

// NestJS RequestMethod enum values
const NEST_HTTP_METHODS: Record<number, string> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  5: 'ALL',
  6: 'OPTIONS',
  7: 'HEAD',
};

// ── Decorators ────────────────────────────────────────────────────────────────

export interface SDKMethodConfig extends SDKRouteConfig {
  /** Explicit JSON Schema for this route — params, querystring, body, headers, response. */
  schema?: ManifestRouteSchema;
}

/**
 * Method decorator — attach SDK generation config to a NestJS controller handler.
 *
 * ```ts
 * @Get(':id')
 * @SDKMethod({ methodName: 'getUser', schema: { response: { 200: { $ref: 'User' } } } })
 * getUser(@Param('id') id: string) { ... }
 * ```
 */
export function SDKMethod(config: SDKMethodConfig): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SDK_METHOD_META, config, target, propertyKey as string);
  };
}

/**
 * Class decorator — attach domain metadata to a NestJS controller.
 *
 * ```ts
 * @Controller('users')
 * @SDKDomain({ domain: 'users', description: 'User management' })
 * export class UsersController { ... }
 * ```
 */
export function SDKDomain(config: Omit<SDKModuleConfig, 'prefix'>): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SDK_DOMAIN_META, config, target);
  };
}

// ── Route collector ───────────────────────────────────────────────────────────

/**
 * Read `@SDKMethod` and `@SDKDomain` metadata from the given controller classes
 * and register each decorated route with the provided `SDKCollector`.
 *
 * Pass the controller **classes** (not instances).
 *
 * ```ts
 * collectFromNestControllers([UsersController, OrdersController], collector);
 * ```
 */
export function collectFromNestControllers(
  controllers: Function[],
  collector: SDKCollector,
): void {
  for (const ControllerClass of controllers) {
    // NestJS stores the controller path prefix under 'path' metadata on the class
    const rawPrefix = (Reflect.getMetadata(NEST_PATH_META, ControllerClass) ?? '') as string;
    const prefix = rawPrefix.startsWith('/') ? rawPrefix : '/' + rawPrefix;

    const domainMeta = Reflect.getMetadata(SDK_DOMAIN_META, ControllerClass) as
      | Omit<SDKModuleConfig, 'prefix'>
      | undefined;
    collector.domain(prefix, domainMeta);

    const prototype = ControllerClass.prototype as object;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue;

      const sdkConfig = Reflect.getMetadata(SDK_METHOD_META, prototype, key) as
        | SDKMethodConfig
        | undefined;
      if (!sdkConfig || sdkConfig.exclude) continue;

      const nestMethod = Reflect.getMetadata(NEST_METHOD_META, prototype, key) as
        | number
        | undefined;
      const nestPath = (Reflect.getMetadata(NEST_PATH_META, prototype, key) ?? '') as string;

      const method = nestMethod !== undefined ? (NEST_HTTP_METHODS[nestMethod] ?? 'GET') : 'GET';
      const rawTail = nestPath.startsWith('/') ? nestPath : '/' + nestPath;
      const url = prefix === '/' ? rawTail : prefix + (rawTail === '/' ? '' : rawTail);

      const { schema, ...routeSdk } = sdkConfig;
      const routeConfig: CollectorRouteConfig = { sdk: routeSdk, schema };
      collector.route(url, method, routeConfig);
    }
  }
}

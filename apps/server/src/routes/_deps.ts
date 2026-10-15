/**
 * 路由依赖契约 —— buildApiRoutes(deps) 注入给各路由模块的共享上下文。
 *
 * app-kit 的 createApp({ routes: (deps) => ... }) 会把 db/storage 汇总进 deps，
 * 本项目在此之上加 repos/profile 中间件所需依赖，统一类型。
 */
import type { Hono } from 'hono';
import type { FileStorage } from '@homurajs/storage';
import type { Repos } from '../repos/types.js';
import type { AuthBundle } from '../auth/build.js';

export interface RouteDeps {
  repos: Repos;
  storage: FileStorage;
  auth: AuthBundle;
}

/** 路由模块工厂签名：接收 deps，返回挂载用的 Hono 子应用 */
export type RouteFactory = (deps: RouteDeps) => Hono<any, any, any>;

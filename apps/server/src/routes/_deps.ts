/**
 * 路由依赖契约 —— buildApiRoutes(deps) 注入给各路由模块的共享上下文。
 *
 * app-kit 的 createApp({ routes: (deps) => ... }) 会把 db/storage 汇总进 deps，
 * 本项目在此之上加 repos/profile 中间件所需依赖，统一类型。
 *
 * ⚠ platform 走本接口而非 app-kit 的 createApp({thirdParty})：后者的 platform 只在
 * `routes: (deps) => Hono` 回调形式下通过 deps.platform 暴露，而本项目传的是
 * 已构造好的 Hono 实例（buildApp 里先 buildApiRoutes(deps) 再交给 createApp），拿不到。
 * 故由 bootstrap 构造后经 RouteDeps 注入，路由层同样用 supports() 协商能力。
 */
import type { Hono } from 'hono';
import type { FileStorage } from '@homurajs/storage';
import type { Repos } from '../repos/types.js';
import type { AuthBundle } from '../auth/build.js';
import type { PlatformBundle } from '../platform/build.js';
import type { NotifyService } from '../services/notify.js';

export interface RouteDeps {
  repos: Repos;
  storage: FileStorage;
  auth: AuthBundle;
  /** 钉钉平台（凭证未配则 platform=null，路由据此降级） */
  platform: PlatformBundle;
  /** 通知服务（发送 + 回执 + 补发；供路由触发手动发送/补发） */
  notify: NotifyService;
}

/** 路由模块工厂签名：接收 deps，返回挂载用的 Hono 子应用 */
export type RouteFactory = (deps: RouteDeps) => Hono<any, any, any>;

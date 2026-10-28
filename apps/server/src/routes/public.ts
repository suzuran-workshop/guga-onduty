/**
 * 公开路由 —— 挂在 requireProfile 守卫**之前**（app.ts 注册顺序保证），免登录可访问。
 *
 *  - GET /api/public/dingtalk/status：钉钉登录可用性探测（登录页据此渲染「钉钉登录」按钮）。
 *    只暴露布尔开关，不泄露任何凭证/内部信息。
 */
import { Hono } from 'hono';
import { ok } from '../http/respond.js';
import type { AuthBundle } from '../auth/build.js';

export interface PublicRouteDeps {
  auth: AuthBundle;
}

export function createPublicRoutes(deps: PublicRouteDeps): Hono {
  const app = new Hono();

  app.get('/api/public/dingtalk/status', (c) => {
    return ok(c, { oauthLogin: deps.auth.oauthEnabled });
  });

  return app;
}

/**
 * auth 业务路由 —— 桥接 auth SDK 与业务档案。
 *
 * 登录/刷新/登出由 SDK 的 authRoutes 处理（挂在根 /auth/*，见 app.ts）：
 *  - POST /auth/password/login → {ok:true} + Set-Cookie（access+refresh）
 *  - POST /auth/refresh、POST /auth/logout
 * 本模块只补业务侧：
 *  - GET /api/v1/auth/me → { user, profile, campusName }（身份 + 档案聚合）
 *  - GET /api/v1/auth/profile → profile（轻量，前端 RBAC 用）
 *
 * 契约变更（docs §4）：登录路径从 /api/v1/auth/login 迁到 SDK 的 /auth/password/login。
 * 前端 client 相应改走 cookie（credentials:'include'），不再手动管 token。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile } from '../middleware/profile.js';
import { ok, ApiError } from '../http/respond.js';

export function createAuthRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET /me —— 身份 + 档案 + 校区名
  app.get('/me', async (c) => {
    const profile = getProfile(c);
    const me = await repos.users.findMe(profile.userId);
    if (!me) throw ApiError.notFound('用户不存在');
    return ok(c, me);
  });

  // GET /profile —— 轻量业务档案（前端 RBAC / 校区上下文）
  app.get('/profile', async (c) => {
    return ok(c, getProfile(c));
  });

  return app;
}

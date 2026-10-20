/**
 * API 路由装配 —— 把路由模块挂到 /api/v1/*，统一前置 requireProfile。
 *
 * 中间件链（app-kit createApp 已装好全局部分）：
 *   [createApp] requestId+日志 → healthz → sessionMiddleware(SDK, 设 c.auth) → authRoutes(SDK, /auth/*)
 *   → [本文件 businessRoutes] requireProfile(设 c.profile) → /api/v1/* 各路由
 *   → static → SPA fallback → onError
 *
 * 关键：
 *  - requireProfile 在业务路由前统一跑（读 c.auth.sub → 查 userProfiles → c.set('profile')）。
 *  - SDK 的登录路由 /auth/password/login 由 createApp 单独挂（不经 requireProfile，登录时无 profile）。
 *  - 所有 /api/v1/* 业务路由都要求已登录且有 profile。
 *  - businessRoutes 挂在 '/'（createApp 内部），故此处每个模块都带完整 /api/v1/<res> 前缀。
 *
 * 域划分（值班域，从 guga-onduty-w 拆分而来）：
 *  - 基础：campuses/users/settings/auth(me)
 *  - 值班核心：/api/v1/duty/* —— 排班/打卡/巡查/调班/矩阵/到岗率。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';

import { createAuthRoutes } from './auth.js';
import { createCampusRoutes } from './campuses.js';
import { createUserRoutes } from './users.js';
import { createSettingRoutes } from './settings.js';
import { createDutyRoutes } from './duty.js';

/** 组装业务 API 路由（挂到 createApp 的 routes） */
export function buildApiRoutes(deps: RouteDeps): Hono {
  const api = new Hono();

  // requireProfile 由 app.ts 在 business 层按 /api/* 与 /files/* 前置挂载
  // （不再用 use('*')，否则会挡掉 SPA 的 / 、/login 与 /assets/* 静态请求）。

  // ── 基础（校区/用户/设置）──
  api.route('/api/v1/auth', createAuthRoutes(deps));
  api.route('/api/v1/campuses', createCampusRoutes(deps));
  api.route('/api/v1/users', createUserRoutes(deps));
  api.route('/api/v1/settings', createSettingRoutes(deps));

  // ── 值班域（区域/地点/时段/排班/打卡/巡查/调班/矩阵/到岗率）──
  api.route('/api/v1/duty', createDutyRoutes(deps));

  return api;
}

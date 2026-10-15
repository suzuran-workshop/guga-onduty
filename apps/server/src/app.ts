/**
 * App 装配 —— @homurajs/app-kit 的 createApp 中间件链。
 *
 * 固定链（app-kit 内部）：
 *   basePath → requestId+访问日志 → healthz（豁免守卫）→ sessionMiddleware(SDK)
 *   → authRoutes(SDK /auth/*) → [本项目 businessRoutes: requireProfile + /api/v1/* + /files]
 *   → 静态资源 → SPA fallback → onError
 *
 * 修复的现有缺陷：
 *  - CORS 硬编码 localhost → 读 CORS_ORIGINS env。
 *  - 无 onError（DELETE 外键错误直接 500 泄栈）→ 统一 ApiError 转 JSON，未知错误不泄栈。
 *  - 无静态托管/SPA fallback（前端要单独部署）→ app-kit staticDir 提供，生产同源托管。
 *  - healthz 由 app-kit 按形态注册（standalone /healthz，qw-pages /_healthz），带 db 探活。
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { createApp } from '@homurajs/app-kit';
import type { HomuraApp } from '@homurajs/app-kit';
import type { Logger } from '@homurajs/core';

import type { AppConfig } from './config.js';
import type { DbHandle } from './db/client.js';
import { pingDb } from './db/client.js';
import type { AuthBundle } from './auth/build.js';
import { buildApiRoutes } from './routes/index.js';
import { buildFileRoutes } from './storage/build.js';
import type { FileStorage } from '@homurajs/storage';
import type { Repos } from './repos/types.js';
import { ApiError, isUniqueViolation } from './http/respond.js';

export interface BuildAppOptions {
  cfg: AppConfig;
  handle: DbHandle;
  auth: AuthBundle;
  repos: Repos;
  storage: FileStorage;
  logger: Logger;
  /** 前端静态资源目录（adapter.assetsDir 算出）；提供则挂 static + SPA fallback */
  staticDir?: string;
  /** cookie Secure（adapter.trustProxy 接线） */
  secure: boolean;
}

export function buildApp(opts: BuildAppOptions): HomuraApp {
  const { cfg, handle, auth, repos, storage, logger, staticDir, secure } = opts;

  const corsOrigins = cfg.get('corsOrigins').split(',').map((s) => s.trim()).filter(Boolean);

  // 业务路由 + /files 代理（同一棵 Hono，交给 createApp 的 routes）
  const business = new Hono();
  // CORS 仅作用于业务/文件路由（SDK auth 路由的 cookie 由 sessionMiddleware 处理）
  business.use('*', cors({ origin: corsOrigins, credentials: true }));
  // REVIEW #17：全局请求体上限 50MB（图片上传 9×5MB=45MB + 余量）。
  // 修复：旧代码图片全量进内存、无 bodyLimit，并发大上传可耗尽内存（DoS）。
  business.use('*', bodyLimit({
    maxSize: 50 * 1024 * 1024,
    onError: () => Response.json(
      { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体超过 50MB 上限' } },
      { status: 413 },
    ),
  }));
  business.route('/', buildApiRoutes({ repos, storage, auth }));
  // /files/<key> 代理下载（createFileProxyRoutes 内部已注册 /files/:key，故挂根路径 '/'）
  // objectKey 为 uuid 前缀不可猜；<img> 同源自动带 cookie。修复旧代码图片死数据 bug。
  business.route('/', buildFileRoutes(storage));

  // app-kit 的 createApp 对**每个**进入 onError 的错误都先 logger.error('unhandled', …) 再委托给
  // 我们的 onError。但本项目大量用 ApiError 表达预期的 4xx（404/403/409），这些不该进 error 级监控
  // （会淹没真实 500）。故传一个 logger 适配器：把 app-kit 那句通用 'unhandled' 降级为 warn，
  // 真实未知错误仍由我们 onError 里的 logger.error（下方）以 error 级记录 —— 单一权威来源。
  const kitLogger: Logger = {
    ...logger,
    error: (msg, fields) => {
      if (msg === 'unhandled') logger.warn('handled-by-onError', fields);
      else logger.error(msg, fields);
    },
  };

  return createApp({
    runtime: (cfg.get('runtime') as 'standalone' | 'qw-pages' | undefined) || 'auto',
    logger: kitLogger,
    auth: {
      sessions: auth.sessions,
      sessionMiddleware: auth.sessionMiddleware,
      authRoutes: auth.authRoutes,
    },
    storage,
    db: handle.kind === 'drizzle' ? (handle.db as unknown as Record<string, unknown>) : undefined,
    healthz: {
      checks: [{ name: 'db', check: () => pingDb(handle) }],
    },
    staticDir,
    routes: business,
    onError: (err, { path }) => {
      // 已知业务错误 → 结构化 JSON
      if (err instanceof ApiError) {
        return Response.json(
          { success: false, error: { code: err.code, message: err.message, details: err.details } },
          { status: err.status },
        );
      }
      // 唯一约束冲突 → 409（部分 repo 未显式转 ApiError 时的兜底）
      if (isUniqueViolation(err)) {
        return Response.json(
          { success: false, error: { code: 'CONFLICT', message: '资源已存在（唯一约束冲突）' } },
          { status: 409 },
        );
      }
      // 未知错误 → 500，不泄堆栈
      logger.error('unhandled', { err: err.message, path });
      return Response.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
        { status: 500 },
      );
    },
  });
}

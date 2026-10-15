/**
 * 认证装配 —— @homurajs/auth 的 SessionManager + PasswordProvider + SDK 路由。
 *
 * 身份模型（docs/MIGRATION-HOMURA.md §2.2）：
 *  - auth SDK 的 `users`/`passwords`/`refresh_tokens` 表管「你是谁」（uuid 身份锚点 + scrypt 密码）。
 *  - 业务 `userProfiles` 表管「你能做什么」（role / campusId / displayName / groupId）。
 *  - session.sub = users.id(uuid)；业务中间件 requireProfile 再查 userProfiles 补角色/校区。
 *
 * store 按数据方言选（drizzle 版 for sqlite/pg，rest 版 for qw-pages），接口语义严格对齐。
 *
 * 登录走 SDK 的 `POST /auth/password/login`（scrypt 校验 + 下发 access/refresh cookie）。
 * 注册**不走** SDK 自助注册（allowRegister=false）——值班系统是 admin 建号带 role/campus，
 * 由业务路由 POST /api/v1/users 调 passwordProvider.register + 建 profile（见 routes/users.ts）。
 */
import { Hono, type MiddlewareHandler } from 'hono';
import {
  SessionManager,
  PasswordProvider,
  createDrizzleSessionStore,
  createDrizzleUserStore,
  createDrizzlePasswordStore,
  createRestSessionStore,
  createRestUserStore,
  createRestPasswordStore,
  type UserStore,
} from '@homurajs/auth';
import { createAuthRoutes, sessionMiddleware } from '@homurajs/auth/hono';

import type { DbHandle } from '../db/client.js';
import type { AppConfig } from '../config.js';

export interface AuthBundle {
  sessions: SessionManager;
  sessionMiddleware: MiddlewareHandler;
  /** SDK 路由：/auth/password/login、/auth/refresh、/auth/logout（挂到根，非 /api/v1） */
  authRoutes: Hono;
  /** 业务建号用（admin 创建用户）：register 建 user+password，profile 另建 */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export interface BuildAuthOptions {
  /** cookie Secure：qw-pages/https 传 true，本地 http dev 传 false（由 adapter.trustProxy 接线） */
  secure: boolean;
  /** 未登录页面请求 302 的目标（SDK 不渲染登录页，指向 SPA 登录路由） */
  loginPath: string;
}

export function buildAuth(handle: DbHandle, cfg: AppConfig, opts: BuildAuthOptions): AuthBundle {
  const secret = cfg.get('sessionSecret');

  // store 按方言选：drizzle(sqlite/pg) vs rest(qw-pages)
  const sessionStore =
    handle.kind === 'rest'
      ? createRestSessionStore(handle.rest)
      : createDrizzleSessionStore(handle.db as never);
  const userStore =
    handle.kind === 'rest'
      ? createRestUserStore(handle.rest)
      : createDrizzleUserStore(handle.db as never);
  const passwordStore =
    handle.kind === 'rest'
      ? createRestPasswordStore(handle.rest)
      : createDrizzlePasswordStore(handle.db as never);

  const sessions = new SessionManager({ secret }, sessionStore);
  const passwordProvider = new PasswordProvider({ userStore, passwordStore });

  const mw = sessionMiddleware(sessions, { bearer: true, secure: opts.secure });

  const authRoutes = createAuthRoutes({
    sessions,
    password: passwordProvider,
    allowRegister: false, // 值班系统：admin 建号，禁自助注册
    secure: opts.secure,
  });

  return { sessions, sessionMiddleware: mw, authRoutes, passwordProvider, userStore };
}

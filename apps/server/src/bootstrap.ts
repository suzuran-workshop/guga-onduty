/**
 * 启动装配 —— 把 config/db/auth/repos/storage/app 串成完整应用（双入口共用）。
 *
 * 顺序（docs §2.5）：
 *   loadConfig → logger → openDatabase(按方言) → migrate(drizzle 轨建表) →
 *   buildAuth(SessionManager+PasswordProvider+SDK路由) → createRepos(注入 auth 依赖) →
 *   buildStorage(local-fs) → buildApp(app-kit createApp)
 *
 * secure 由 adapter.trustProxy() 接线（qw-pages 恒 true，standalone 由 TRUST_PROXY=1）。
 */
import type { HomuraApp } from '@homurajs/app-kit';
import type { Logger } from '@homurajs/core';
import { loadConfig, createAppLogger, type AppConfig } from './config.js';
import { openDatabase, migrate, closeDatabase, type DbHandle } from './db/client.js';
import { buildAuth, type AuthBundle } from './auth/build.js';
import { createRepos } from './repos/index.js';
import type { Repos } from './repos/types.js';
import { buildStorage } from './storage/build.js';
import type { FileStorage } from '@homurajs/storage';
import { buildApp } from './app.js';

export interface Bootstrapped {
  cfg: AppConfig;
  logger: Logger;
  handle: DbHandle;
  auth: AuthBundle;
  repos: Repos;
  storage: FileStorage;
  homura: HomuraApp;
  /** 优雅关闭（关 db 连接） */
  shutdown(): void;
}

export interface BootstrapOptions {
  /** cookie Secure（adapter.trustProxy()） */
  secure: boolean;
  /** 前端静态资源目录（adapter.assetsDir(process.env)） */
  staticDir?: string;
  /** 未登录页面请求 302 目标（SPA 登录路由） */
  loginPath?: string;
}

export async function bootstrap(opts: BootstrapOptions): Promise<Bootstrapped> {
  const cfg = loadConfig();
  const logger = createAppLogger(cfg);

  const handle = await openDatabase(cfg);
  await migrate(handle);
  logger.info('database ready', { dialect: handle.dialect });

  const auth = buildAuth(handle, cfg, { secure: opts.secure, loginPath: opts.loginPath ?? '/login' });
  const repos = createRepos(handle, {
    passwordProvider: auth.passwordProvider,
    userStore: auth.userStore,
  });
  const storage = buildStorage(cfg, handle, logger);

  const homura = buildApp({
    cfg,
    handle,
    auth,
    repos,
    storage,
    logger,
    staticDir: opts.staticDir,
    secure: opts.secure,
  });

  return {
    cfg,
    logger,
    handle,
    auth,
    repos,
    storage,
    homura,
    shutdown: () => closeDatabase(handle),
  };
}

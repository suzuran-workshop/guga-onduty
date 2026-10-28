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
import { seedRest } from './repos/rest/seed.js';
import { buildPlatform, type PlatformBundle } from './platform/build.js';
import { createNotifyService, type NotifyService } from './services/notify.js';

export interface Bootstrapped {
  cfg: AppConfig;
  logger: Logger;
  handle: DbHandle;
  auth: AuthBundle;
  repos: Repos;
  storage: FileStorage;
  /** 钉钉平台（凭证未配则 platform=null，推送降级为 pending） */
  platform: PlatformBundle;
  /** 通知服务（发送/回执/补发） */
  notify: NotifyService;
  homura: HomuraApp;
  /** 优雅关闭（关 db 连接） */
  shutdown(): void;
}

export interface BootstrapOptions {
  /**
   * cookie Secure。缺省取 cfg.get('trustProxy')（.env 由 defineConfig.load 装载，
   * adapter.trustProxy() 只认 process.env 读不到 .env，故 standalone 入口不再传此参）。
   */
  secure?: boolean;
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

  const secure = opts.secure ?? cfg.get('trustProxy');
  const auth = buildAuth(handle, cfg, { secure, loginPath: opts.loginPath ?? '/login', logger });
  const repos = createRepos(handle, {
    passwordProvider: auth.passwordProvider,
    userStore: auth.userStore,
  });

  // rest 轨（qw-pages）幂等种子：默认校区 + admin + semester_start（drizzle 轨种子仍走 db:seed 脚本）
  if (handle.kind === 'rest') {
    const s = await seedRest(handle.rest);
    if (s.seeded) logger.info('rest seed inserted', { adminUserId: s.adminUserId, campusId: s.campusId });
  }

  const storage = buildStorage(cfg, handle, logger);

  // 钉钉平台（凭证未配 → platform=null，通知服务据此降级为 pending，不阻塞启动）
  const platform = buildPlatform(cfg, logger);
  const notify = createNotifyService({ repos, platform, logger });

  const homura = buildApp({
    cfg,
    handle,
    auth,
    repos,
    storage,
    platform,
    notify,
    logger,
    staticDir: opts.staticDir,
    secure,
  });

  return {
    cfg,
    logger,
    handle,
    auth,
    repos,
    storage,
    platform,
    notify,
    homura,
    shutdown: () => closeDatabase(handle),
  };
}

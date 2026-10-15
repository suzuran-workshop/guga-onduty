/**
 * qw-pages 入口 —— 平台动态页形态（rest 数据轨 + 网关反代）。
 *
 * 平台拉起 `node <entrypoint>` 常驻进程，注入 PORT(8081)/HOST，网关流量反代到该 socket。
 * 与 standalone 差异全走 adapter（createQwPagesAdapter）：
 *  - trustProxy() 恒 true（网关后、公网 https）→ cookie secure=true。
 *  - assetsDir(env) 缺省 client（平台产物布局）。
 *  - 端口缺省 8081（实测平台注入；9000 被禁）。
 *
 * ⚠ 数据轨：qw-pages 上 sqlite/pg 均不可用（应用根只读、5432 出网封），须 DB_DIALECT=rest
 *   + SUPABASE_URL/SUPABASE_ANON_KEY（平台自动注入）。rest 轨 repo 于 P4 实现；
 *   在 rest repo 就绪前，本入口 createRepos 会抛「rest 轨尚未实现」——属预期（形态未接通）。
 *
 * 部署期前置（App 无 DDL 权限）：业务表 + auth 表 + RLS policy 须用平台受控迁移
 * 执行 drizzle/pg 的 SQL 预建（见 @homurajs/db README、MIGRATION §2.1）。
 */
import { createQwPagesAdapter } from '@homurajs/app-kit/qw-pages';
import { bootstrap } from './bootstrap.js';

async function main() {
  const adapter = createQwPagesAdapter();
  const secure = adapter.trustProxy(); // qw-pages 恒 true
  const staticDir = adapter.assetsDir(process.env); // 缺省 client

  const { cfg, logger, homura, shutdown } = await bootstrap({ secure, staticDir, loginPath: '/login' });

  const port = cfg.get('port');
  const ac = new AbortController();

  await adapter.start(homura.app, { port, signal: ac.signal });
  logger.info('校园值班应用（qw-pages 形态）已启动', {
    runtime: homura.runtime.target,
    port,
    secure,
    staticDir,
    healthz: homura.healthzPath, // qw-pages 用 /_healthz（/healthz 被网关保留）
  });

  const stop = (sig: string) => {
    logger.info('正在关闭服务', { sig });
    ac.abort();
    shutdown();
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

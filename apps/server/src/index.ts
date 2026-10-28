/**
 * standalone 入口 —— 独立部署形态（sqlite/pg + local-fs storage）。
 *
 * RuntimeAdapter（createNodeAdapter）：assetsDir/trustProxy/启动监听。
 *  - start(app, {port})：读 PORT/HOST，@hono/node-server 监听，支持 AbortSignal 优雅关闭。
 *  - trustProxy()：standalone 由 TRUST_PROXY=1 开启 → 接到 auth cookie 的 secure 选项。
 *  - assetsDir(env)：前端静态资源目录（缺省 dist/client）→ 接到 createApp 的 staticDir。
 *
 * 冷启动：pnpm db:seed && pnpm dev（见 AGENTS.md）。
 */
import { createNodeAdapter } from '@homurajs/app-kit/serve';
import { bootstrap } from './bootstrap.js';

async function main() {
  const adapter = createNodeAdapter();
  const staticDir = adapter.assetsDir(process.env);
  // secure 以配置为准：adapter.trustProxy() 只认 process.env，而 .env 由 defineConfig.load()
  // 内部装载（不经 process.env），.env 部署场景下 adapter 会误读为 false → cookie 不带 Secure。
  const { cfg, logger, homura, shutdown } = await bootstrap({ staticDir, loginPath: '/login' });
  const secure = cfg.get('trustProxy');

  const port = cfg.get('port');
  const ac = new AbortController();

  await adapter.start(homura.app, { port, signal: ac.signal });
  logger.info('校园值班应用服务端已启动', {
    port,
    secure,
    staticDir,
    healthz: homura.healthzPath,
  });

  // 优雅关闭
  const stop = (sig: string) => {
    logger.info('正在关闭服务', { sig });
    ac.abort();
    shutdown();
    // 给 adapter 一点时间 flush，再退出
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

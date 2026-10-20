/**
 * 对象存储装配 —— 双后端：standalone 走 local-fs，qw-pages（rest 轨）走 DB 分块存储。
 *
 * 迁移要点：
 *  - 图片统一走 storage.uploadFile + /files/<key> 代理（objectKey 存表，非自造相对路径）。
 *  - 值班域两个命名空间：duty-checkin（执勤打卡照片）、duty-inspect（巡查照片）。
 *
 * 形态边界：
 *  - standalone（sqlite/pg）：local-fs 后端（rootDir 可写）。
 *  - qw-pages（rest 轨）：应用根只读，改用 @homurajs/storage ./db 的 createRestFileStore ——
 *    把二进制以 base64 分块写进 Postgres（homura_files 清单表 + homura_file_chunks 块表），
 *    绕开 PostgREST 单值 ~1MB 限制；照片随库持久，跨发布不清空。
 *    （前置：两表须由平台受控迁移预建并授权 anon 角色；见 migration / @homurajs/storage/tables。）
 */
import type { FileStorage } from '@homurajs/storage';
import { createLocalStorage } from '@homurajs/storage/local';
import { createRestFileStore } from '@homurajs/storage/db';
import { createFileProxyRoutes } from '@homurajs/storage/proxy';
import { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DbHandle } from '../db/client.js';

/**
 * 构造存储后端。
 *  - standalone（sqlite/pg）：local-fs，rootDir 取 STORAGE_ROOT（缺省 ./data/files）。
 *  - qw-pages（rest 轨）：createRestFileStore(handle.rest)，DB 分块持久化（表由平台迁移预建）。
 */
export function buildStorage(cfg: AppConfig, handle: DbHandle, logger?: { warn: (m: string, f?: any) => void; info?: (m: string, f?: any) => void }): FileStorage {
  if (handle.kind === 'rest') {
    logger?.info?.('storage: rest 轨使用 DB 分块后端（homura_files / homura_file_chunks）');
    return createRestFileStore(handle.rest);
  }
  return createLocalStorage({ rootDir: cfg.get('storageRoot') });
}

/**
 * /files/<key> 代理下载路由 + 校区鉴权（REVIEW #5：修复跨校区图片泄漏）。
 *
 * objectKey 格式：`<domain>/<campusId>/files/<ts>_<name>`（上传时命名空间已校区限定）。
 * 鉴权中间件按 key 的 campusId 段做 O(1) 隔离（无需查库）：
 *  - 未认证 → 401。
 *  - 非 admin 且 key 校区 ≠ 本人校区 → 404（不泄露跨校区文件存在性）。
 *  - 结构不符（遗留/伪造 key）→ 仅 admin 放行，其余 fail-closed 404。
 */
const FILE_DOMAINS = ['duty-checkin', 'duty-inspect'];

export function buildFileRoutes(storage: FileStorage): Hono {
  const app = new Hono();
  app.use('/files/*', async (c, next) => {
    const profile = c.get('profile') as import('@guga-onduty/shared').UserProfile | undefined;
    if (!profile) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } }, 401);
    }
    const pathname = new URL(c.req.url).pathname;
    const objectKey = decodeURIComponent(pathname.replace(/^\/files\//, ''));
    const segs = objectKey.split('/');
    // 期望 [<domain>, <campusId>, 'files', ...]
    const wellFormed = segs.length >= 3 && FILE_DOMAINS.includes(segs[0]) && segs[2] === 'files';
    if (!wellFormed) {
      if (profile.role !== 'admin') {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
      }
      return next();
    }
    const fileCampusId = segs[1];
    if (profile.role !== 'admin' && fileCampusId !== profile.campusId) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
    }
    return next();
  });
  app.route('/', createFileProxyRoutes(storage));
  return app;
}

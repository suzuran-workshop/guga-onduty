/**
 * settings 路由 —— 系统设置（key-value）。
 *
 * 迁移要点（对照旧 routes/settings.ts）：
 *  - GET 返回 key-value map（非数组，复刻旧语义）。
 *  - **PUT 收紧为 admin only**（修复旧代码 student 可改系统设置的越权）。
 *  - upsertMany 事务化（repo 已实现，修复旧代码批量循环无事务的部分更新）。
 *  - 读走 resolveCampusId 隔离；写校区走 resolveWriteCampusId（admin 可指定）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, ApiError } from '../http/respond.js';

export function createSettingRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区设置 map
  app.get('/', async (c) => {
    const map = await repos.settings.getMap(resolveCampusId(c));
    return ok(c, map);
  });

  // PUT / —— admin 批量 upsert 设置
  app.put('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; settings: { key: string; value: string }[] }>()
      .catch(() => null as any);
    if (!body?.settings || !Array.isArray(body.settings)) {
      throw ApiError.badRequest('缺少 settings 数组');
    }
    // key 白名单 + 值校验：semester_start 驱动值班单双周锚点（resolveParityAnchor），
    // 写错值会让全校单双周判定错乱且静默，故限定 YYYY-MM-DD。
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const validated: { key: string; value: string }[] = [];
    for (const e of body.settings) {
      const key = String(e?.key ?? '');
      const value = String(e?.value ?? '');
      switch (key) {
        case 'semester_start':
          if (!DATE_RE.test(value)) {
            throw ApiError.badRequest(`semester_start 须为 YYYY-MM-DD，收到：${value}`);
          }
          break;
        default:
          throw ApiError.badRequest(`未知设置项：${key}（白名单：semester_start）`);
      }
      validated.push({ key, value });
    }
    const campusId = resolveWriteCampusId(c, body.campus_id);
    await repos.settings.upsertMany(campusId, validated);
    return ok(c, { updated: true });
  });

  return app;
}

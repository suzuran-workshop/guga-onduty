/**
 * settings repo（rest 实现）—— key-value，语义对齐 drizzle/settings-repo.ts。
 *
 *  - getMap：查该校区全行，JS reduce 成 Record<string,string>。
 *  - upsertMany：无事务，逐条「select(campusId,key) 有→update、无→insert」。
 *    PostgREST upsertOn 只支持单列，(campusId,key) 组合唯一键手动补偿；
 *    中途失败会部分更新（rest 轨 best-effort，调用方重跑幂等）。
 */
import type { RestFilters } from '@homurajs/db';
import type { SettingsRepo } from '../types.js';
import type { RestCtx } from './_base.js';
import { tbl, uuid } from './_base.js';

export function createSettingsRepo(ctx: RestCtx): SettingsRepo {
  const settings = tbl(ctx.rest, 'settings');

  return {
    async getMap(campusId): Promise<Record<string, string>> {
      const rows = (await settings.select({ campusId })) as any[];
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return map;
    },

    async upsertMany(campusId, entries): Promise<void> {
      for (const e of entries) {
        const existing = (await settings.select({ campusId, key: e.key } as RestFilters, { limit: 1 })) as any[];
        if (existing[0]) {
          await settings.update({ value: e.value }, { id: existing[0].id });
        } else {
          await settings.insert({ id: uuid(), campusId, key: e.key, value: e.value });
        }
      }
    },
  };
}

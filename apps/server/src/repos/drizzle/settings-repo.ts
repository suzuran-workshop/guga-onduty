/**
 * settings repo（drizzle 实现）—— key-value，getMap + upsertMany。
 * 迁移要点（对照旧 routes/settings.ts）：
 *  - getMap 查该校区所有行，JS 侧 reduce 成 Record<string,string>（复刻旧返回 map 语义）。
 *  - upsertMany 用事务 + onConflictDoUpdate(campusId,key)（复刻旧 ON CONFLICT upsert），
 *    修复旧代码「批量循环无事务」——中途失败会部分更新。entries 为空时事务内 no-op 正常返回。
 *  - set 用字面量 value（双方言通用；不用 excluded.value 以避开 pg/sqlite 差异）。
 */
import { eq } from 'drizzle-orm';
import type { SettingsRepo } from '../types.js';
import { DrizzleCtx } from './_base.js';

export function createSettingsRepo(ctx: DrizzleCtx): SettingsRepo {
  const db = ctx.db as any;
  const { settings } = ctx.tables;

  return {
    async getMap(campusId): Promise<Record<string, string>> {
      const rows = await db.select().from(settings).where(eq(settings.campusId, campusId));
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return map;
    },

    async upsertMany(campusId, entries): Promise<void> {
      if (entries.length === 0) return;
      await ctx.tx(async (tx: any) => {
        for (const e of entries) {
          await tx
            .insert(settings)
            .values({ id: crypto.randomUUID(), campusId, key: e.key, value: e.value })
            .onConflictDoUpdate({
              target: [settings.campusId, settings.key],
              set: { value: e.value },
            })
            .run();
        }
      });
    },
  };
}

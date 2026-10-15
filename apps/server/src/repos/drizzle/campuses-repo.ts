/**
 * campuses repo（drizzle 实现）—— 简单 CRUD。
 * 迁移要点（对照旧 routes/campuses.ts）：id 为 uuid；listAll orderBy id；
 * admin 看全部、非 admin 看自己校区（分支在路由，repo 只提供 listAll/listForCampus）。
 */
import { asc, eq } from 'drizzle-orm';
import type { Campus } from '@guga-onduty/shared';
import type { CampusesRepo } from '../types.js';
import { DrizzleCtx, num } from './_base.js';

function toCampus(r: any): Campus {
  return { id: r.id, name: r.name, code: r.code, createdAt: num(r.createdAt) };
}

export function createCampusesRepo(ctx: DrizzleCtx): CampusesRepo {
  const db = ctx.db as any;
  const { campuses } = ctx.tables;

  return {
    async listAll(): Promise<Campus[]> {
      const rows = await db.select().from(campuses).orderBy(asc(campuses.id));
      return rows.map(toCampus);
    },

    async listForCampus(campusId): Promise<Campus[]> {
      const rows = await db.select().from(campuses).where(eq(campuses.id, campusId)).orderBy(asc(campuses.id));
      return rows.map(toCampus);
    },

    async findById(id): Promise<Campus | null> {
      const rows = await db.select().from(campuses).where(eq(campuses.id, id)).limit(1);
      return rows[0] ? toCampus(rows[0]) : null;
    },

    async create(input): Promise<Campus> {
      const id = crypto.randomUUID();
      await db.insert(campuses).values({ id, name: input.name, code: input.code }).run();
      const found = await this.findById(id);
      if (!found) throw new Error('校区创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Campus | null> {
      await db.update(campuses).set({ name: input.name, code: input.code }).where(eq(campuses.id, id)).run();
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await db.delete(campuses).where(eq(campuses.id, id)).run();
    },
  };
}

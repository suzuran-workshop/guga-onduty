/**
 * campuses repo（rest 实现）—— 简单 CRUD，语义对齐 drizzle/campuses-repo.ts。
 *
 *  - listAll orderBy id（PostgREST order 串）。
 *  - create 显式给 id（uuid）+ createdAt（PostgREST 不保证触发 DB default 时 mock/旧表兼容）。
 *  - code UNIQUE 冲突由真实 PostgREST 抛错（message 含 duplicate key / 23505），
 *    路由层 isUniqueViolation 转 409 —— repo 不吞错。
 */
import type { Campus } from '@guga-onduty/shared';
import type { CampusesRepo } from '../types.js';
import type { RestCtx } from './_base.js';
import { tbl, ts, uuid, nowIso } from './_base.js';

function toCampus(r: any): Campus {
  return { id: r.id, name: r.name, code: r.code, createdAt: ts(r.createdAt) };
}

export function createCampusesRepo(ctx: RestCtx): CampusesRepo {
  const campuses = tbl(ctx.rest, 'campuses');

  return {
    async listAll(): Promise<Campus[]> {
      const rows = await campuses.select(undefined, { order: 'id.asc' });
      return rows.map(toCampus);
    },

    async listForCampus(campusId): Promise<Campus[]> {
      const rows = await campuses.select({ id: campusId }, { order: 'id.asc' });
      return rows.map(toCampus);
    },

    async findById(id): Promise<Campus | null> {
      const rows = await campuses.select({ id }, { limit: 1 });
      return rows[0] ? toCampus(rows[0]) : null;
    },

    async create(input): Promise<Campus> {
      const id = uuid();
      await campuses.insert({ id, name: input.name, code: input.code, createdAt: nowIso() });
      const found = await this.findById(id);
      if (!found) throw new Error('校区创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Campus | null> {
      await campuses.update({ name: input.name, code: input.code }, { id });
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await campuses.remove({ id });
    },
  };
}

/**
 * campuses 路由 —— 校区 CRUD。
 *
 * 迁移要点（对照旧 routes/campuses.ts）：
 *  - id 为 uuid；GET admin 看全部（listAll）、非 admin 看自己（listForCampus）。
 *  - 写端点 admin only（旧代码已如此，保留）。
 *  - campuses 是顶层资源，PUT/DELETE 无需 campusId 归属校验。
 *  - 唯一约束冲突（code 重复）转 409。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';

export function createCampusRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— admin 看全部，非 admin 看自己校区
  app.get('/', async (c) => {
    const profile = getProfile(c);
    const campuses =
      profile.role === 'admin'
        ? await repos.campuses.listAll()
        : await repos.campuses.listForCampus(profile.campusId);
    return ok(c, campuses);
  });

  // POST / —— admin 建校区
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ name: string; code: string }>().catch(() => null as any);
    if (!body?.name || !body.code) throw ApiError.badRequest('缺少 name / code');
    try {
      const campus = await repos.campuses.create({ name: body.name, code: body.code });
      return created(c, campus);
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('校区代号已存在');
      throw e;
    }
  });

  // PUT /:id —— admin 改校区
  app.put('/:id', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ name: string; code: string }>().catch(() => null as any);
    if (!body?.name || !body.code) throw ApiError.badRequest('缺少 name / code');
    try {
      const campus = await repos.campuses.update(c.req.param('id'), { name: body.name, code: body.code });
      if (!campus) throw ApiError.notFound('校区不存在');
      return ok(c, campus);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (isUniqueViolation(e)) throw ApiError.conflict('校区代号已存在');
      throw e;
    }
  });

  // DELETE /:id —— admin 删校区
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const campus = await repos.campuses.findById(id);
    if (!campus) throw ApiError.notFound('校区不存在');
    // 引用守卫（homura 无 DB FK，完整性靠应用层）——校区下有区域/用户则拒删，防孤儿子行
    const areas = await repos.duty.areas.listByCampus(id);
    if (areas.length > 0) throw ApiError.conflict(`该校区下仍有 ${areas.length} 个值班区域，无法删除`);
    const users = await repos.users.list(id);
    if (users.length > 0) throw ApiError.conflict(`该校区下仍有 ${users.length} 个用户，无法删除`);
    await repos.campuses.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}

/**
 * users 路由 —— admin 管理用户（建号带 role/campus）。
 *
 * 迁移要点（对照旧 routes/users.ts + routes/auth.ts 的 register）：
 *  - 建号走 users-repo.create（auth SDK register + userProfiles），密码 scrypt（非 bcryptjs）。
 *  - 全部端点 requireRole('admin')（旧代码已如此，保留）。
 *  - campusId：resolveWriteCampusId（admin 可跨校区建号，符合旧 register 语义）。
 *  - 合并旧 auth.ts 的 POST /register 到此处 POST /（都是 admin 建号，去重）。
 *  - 角色变更即时生效（profile 每请求查库，无旧 JWT 缓存问题）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';
import type { UserRole } from '@guga-onduty/shared';

/** 值班域可建角色：admin / teacher（student 属值周域，拆分后不在本产品） */
const VALID_ROLES: UserRole[] = ['admin', 'teacher'];

export function createUserRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // 全部端点仅 admin
  app.use('*', requireRole('admin'));

  // GET / —— 用户列表（可按 campus/role 过滤）
  app.get('/', async (c) => {
    const campusId = c.req.query('campus_id') || undefined;
    const role = c.req.query('role') as UserRole | undefined;
    const users = await repos.users.list(campusId, role);
    return ok(c, users);
  });

  // POST / —— 建号（auth register + profile）
  app.post('/', async (c) => {
    const body = await c.req.json<{
      campus_id?: string; username: string; password?: string;
      display_name: string; role: UserRole; can_inspect?: boolean;
    }>().catch(() => null as any);
    if (!body?.username || !body.display_name || !body.role) {
      throw ApiError.badRequest('缺少 username / display_name / role');
    }
    if (!VALID_ROLES.includes(body.role)) {
      throw ApiError.badRequest(`role 非法（应 admin/teacher）`);
    }
    const campusId = resolveWriteCampusId(c, body.campus_id);
    try {
      const user = await repos.users.create({
        campusId,
        username: body.username,
        password: body.password || '123456',
        displayName: body.display_name,
        role: body.role,
        canInspect: body.can_inspect ? 1 : 0,
      });
      return created(c, user);
    } catch (e) {
      // username 占用（SDK UsernameTakenError 或唯一约束）→ 409
      if (isUniqueViolation(e) || (e as any)?.name === 'UsernameTakenError') {
        throw ApiError.conflict('用户名已存在');
      }
      throw e;
    }
  });

  // PUT /:id —— 改档案（displayName/role/canInspect）
  app.put('/:id', async (c) => {
    const body = await c.req.json<{ display_name: string; role: UserRole; can_inspect?: boolean }>().catch(() => null as any);
    if (!body?.display_name || !body.role) throw ApiError.badRequest('缺少 display_name / role');
    if (!VALID_ROLES.includes(body.role)) throw ApiError.badRequest('role 非法');
    const user = await repos.users.update(c.req.param('id'), {
      displayName: body.display_name,
      role: body.role,
      canInspect: body.can_inspect === undefined ? undefined : (body.can_inspect ? 1 : 0),
    });
    if (!user) throw ApiError.notFound('用户不存在');
    return ok(c, user);
  });

  // DELETE /:id —— 删用户（身份 + 档案 + 凭证）
  app.delete('/:id', async (c) => {
    await repos.users.remove(c.req.param('id'));
    return ok(c, { deleted: true });
  });

  return app;
}

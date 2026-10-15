/**
 * 业务身份中间件 —— 桥接 auth SDK session 与业务档案。
 *
 * 链路（docs §2.2）：
 *  sessionMiddleware(SDK) 校验 cookie/Bearer → c.set('auth', {sub: uuid, sid, ...})
 *  → requireProfile（本文件）查 userProfiles → c.set('profile', {userId, campusId, role, ...})
 *  → requireRole(...roles) 读 profile.role 做 RBAC
 *
 * 修复的现有缺陷：
 *  - 角色变更后旧 token 7 天有效 → profile 每请求查库，改角色即时生效。
 *  - student 可增删改年级/班级/标签/… → requireRole 收紧（见各路由）。
 *  - 多校区「假隔离」（?campus_id= 任意覆盖）→ resolveCampusId 非 admin 强制用 profile.campusId。
 *
 * profile 加进程内 TTL 缓存（@homurajs/core TTL-KV），避免每请求查库；
 * 角色/校区变更时由 users-repo 侧失效（见 invalidateProfile）。
 */
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { SessionClaims } from '@homurajs/auth';
import type { UserProfile, UserRole } from '@guga-onduty/shared';
import type { UsersRepo } from '../repos/types.js';
import { ApiError } from '../http/respond.js';

declare module 'hono' {
  interface ContextVariableMap {
    profile: UserProfile;
  }
}

const ERR = {
  unauthorized: { success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } },
  forbidden: { success: false, error: { code: 'FORBIDDEN', message: '权限不足' } },
  profileMissing: { success: false, error: { code: 'PROFILE_NOT_FOUND', message: '用户档案缺失' } },
} as const;

/**
 * 从 session claims 解析业务档案并挂到 c.set('profile')。
 * 必须在 SDK sessionMiddleware 之后、业务路由之前。
 */
export function requireProfile(usersRepo: UsersRepo): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const claims = c.get('auth') as SessionClaims | undefined;
    if (!claims?.sub) {
      return c.json(ERR.unauthorized, 401);
    }
    const profile = await usersRepo.findProfile(claims.sub);
    if (!profile) {
      // session 有效但无业务档案（身份锚点存在、profile 被删）——拒绝，避免后续崩溃
      return c.json(ERR.profileMissing, 403);
    }
    c.set('profile', profile);
    await next();
  };
}

/** RBAC：profile.role 不在允许集则 403。必须在 requireProfile 之后。 */
export function requireRole(...roles: UserRole[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const profile = c.get('profile');
    if (!profile) return c.json(ERR.unauthorized, 401);
    if (!roles.includes(profile.role)) return c.json(ERR.forbidden, 403);
    await next();
  };
}

/** 取当前业务档案（requireProfile 已挂载） */
export function getProfile(c: Context): UserProfile {
  return c.get('profile');
}

/**
 * 多校区隔离解析（修复「假隔离」）：
 *  - admin：可用 ?campus_id= 指定任意校区（跨校区管理）；不传则默认自己校区。
 *  - 非 admin：**强制**用 profile.campusId，忽略请求参数（不能跨校区读）。
 */
export function resolveCampusId(c: Context): string {
  const profile = getProfile(c);
  if (profile.role === 'admin') {
    const q = c.req.query('campus_id');
    return q && q.length > 0 ? q : profile.campusId;
  }
  return profile.campusId;
}

/**
 * 写操作的校区归属（修复「campus_id 取自请求体」越权）：
 *  - admin：允许请求体指定 campusId（跨校区建号/建标签等）。
 *  - 非 admin：**强制** profile.campusId，忽略请求体值。
 */
export function resolveWriteCampusId(c: Context, bodyCampusId?: string | null): string {
  const profile = getProfile(c);
  if (profile.role === 'admin' && bodyCampusId) return bodyCampusId;
  return profile.campusId;
}

/**
 * 实体归属校验（共享）—— 修复值班域 by-id 写端点整片漏掉校区校验（REVIEW #3）。
 *
 * 语义（与值周域 assertOwnership 一致，此处抽成单一真源消除 5× 重复）：
 *  - 实体不存在 → 404。
 *  - 非 admin 且实体不属本人校区 → 404（不泄露跨校区实体存在性）。
 *  - admin 可跨校区（resolveWriteCampusId 语义一致）。
 * 返回实体本身，便于链式：const x = assertEntityOwnership(c, await repo.findById(id))。
 */
export function assertEntityOwnership<T extends { campusId: string }>(c: Context, entity: T | null, label = '资源'): T {
  if (!entity) throw ApiError.notFound(label + '不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && entity.campusId !== profile.campusId) {
    throw ApiError.notFound(label + '不存在');
  }
  return entity;
}
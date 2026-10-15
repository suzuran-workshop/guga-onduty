/**
 * users repo（drizzle 实现）—— 唯一横跨 auth 身份锚点与业务档案的 repo。
 *
 * 身份模型：
 *  - auth SDK `users` 表 = 身份锚点（id uuid / username / nickname）。
 *  - auth SDK `passwords` 表 = scrypt 密码凭证（由 PasswordProvider 管，repo 不碰哈希）。
 *  - 业务 `userProfiles` 表 = role / campusId / displayName / canInspect。
 *
 * create 流程：passwordProvider.register（建 users+passwords）→ 建 userProfiles。
 * 两步跨 SDK/业务边界无法同事务，故 profile 失败时 best-effort 清理孤儿 auth user
 * （照 PasswordProvider.register 对 user/password 的清理先例）。
 *
 * list/findMe 的 username 来自 auth users，displayName/role/campusId/canInspect 来自 userProfiles，
 * createdAt 用 auth users.createdAt（userProfiles 无该列）。
 */
import { eq, and, asc, sql, inArray } from 'drizzle-orm';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { UserView, UserProfile, User, UserRole } from '@guga-onduty/shared';
import type { UsersRepo } from '../types.js';
import { DrizzleCtx, whereAll, num } from './_base.js';

export interface UsersRepoAuthDeps {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

function toView(r: any): UserView {
  return {
    id: r.userId,
    username: r.username ?? null,
    campusId: r.campusId,
    displayName: r.displayName,
    role: r.role as UserRole,
    campusName: r.campusName ?? '',
    canInspect: num(r.canInspect),
    createdAt: num(r.createdAt),
  };
}

export function createUsersRepo(ctx: DrizzleCtx, auth: UsersRepoAuthDeps): UsersRepo {
  const { tables: T, authTables: A } = ctx;
  const db = ctx.db as any;
  const { userProfiles, campuses } = T;
  const users = A.users;

  /** userProfiles + users(username/createdAt) + campuses 的 join 投影 */
  const projection = {
    userId: userProfiles.userId,
    username: users.username,
    campusId: userProfiles.campusId,
    displayName: userProfiles.displayName,
    role: userProfiles.role,
    canInspect: userProfiles.canInspect,
    campusName: campuses.name,
    createdAt: users.createdAt,
  };

  const joined = () =>
    db
      .select(projection)
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .innerJoin(campuses, eq(userProfiles.campusId, campuses.id));

  return {
    async list(campusId, role): Promise<UserView[]> {
      const cond = whereAll([
        campusId ? eq(userProfiles.campusId, campusId) : undefined,
        role ? eq(userProfiles.role, role) : undefined,
      ]);
      const q = joined();
      const rows = cond
        ? await q.where(cond).orderBy(asc(userProfiles.campusId), asc(userProfiles.role), asc(userProfiles.userId))
        : await q.orderBy(asc(userProfiles.campusId), asc(userProfiles.role), asc(userProfiles.userId));
      return rows.map(toView);
    },

    async findProfile(userId): Promise<UserProfile | null> {
      const rows = await db
        .select({
          userId: userProfiles.userId,
          campusId: userProfiles.campusId,
          displayName: userProfiles.displayName,
          role: userProfiles.role,
          canInspect: userProfiles.canInspect,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      const r = rows[0];
      return r
        ? {
            userId: r.userId, campusId: r.campusId, displayName: r.displayName,
            role: r.role as UserRole, canInspect: num(r.canInspect),
          }
        : null;
    },

    async create(input): Promise<UserView> {
      // 1. auth SDK 建身份锚点 + 密码（username 占用会抛 UsernameTakenError，路由转 409）
      const localUser = await auth.passwordProvider.register({
        username: input.username,
        password: input.password,
        nickname: input.displayName,
      });
      // 2. 建业务档案；失败则 best-effort 清理孤儿 auth user
      try {
        await db.insert(userProfiles).values({
          userId: localUser.id,
          campusId: input.campusId,
          displayName: input.displayName,
          role: input.role,
          canInspect: input.canInspect ?? 0,
        }).run();
      } catch (e) {
        try { await auth.passwordProvider.deletePassword(localUser.id); } catch { /* 尽力清理 */ }
        try { await auth.userStore.delete(localUser.id); } catch { /* 尽力清理 */ }
        throw e;
      }
      const view = await this.listByIds([localUser.id]);
      if (!view[0]) throw new Error('用户创建后回查失败');
      return view[0];
    },

    async update(userId, input): Promise<UserView | null> {
      const patch: any = { displayName: input.displayName, role: input.role };
      if (input.canInspect !== undefined) patch.canInspect = input.canInspect;
      await db.update(userProfiles)
        .set(patch)
        .where(eq(userProfiles.userId, userId))
        .run();
      // nickname 同步到 auth users（displayName 与 nickname 保持一致，登录页展示用）
      try { await auth.userStore.update(userId, { nickname: input.displayName }); } catch { /* 非致命 */ }
      const view = await this.listByIds([userId]);
      return view[0] ?? null;
    },

    async remove(userId): Promise<void> {
      // 删除顺序修复「账号变砖」——旧代码先删 profile 再 best-effort 删 auth user，
      // 若 auth user 删失败则：auth 锚点在、profile 没了 → requireProfile 永久 403 PROFILE_NOT_FOUND，
      // 且 username 仍被占（无法重建）。改为**先删 auth 身份锚点**：
      //  - auth user 删失败 → 抛错，profile 保留，账号仍可用（不 brick）。
      //  - auth user 删成功但 profile 删失败 → 孤儿 profile（无 auth 锚点，登录即失败，惰性无害），
      //    且 username 已释放可重建 —— 严格优于 brick 态。
      await auth.userStore.delete(userId); // 锚点先删；失败则整体抛错，profile 不动
      try { await auth.passwordProvider.deletePassword(userId); } catch { /* 可能无密码记录 */ }
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId)).run();
    },

    async findMe(userId): Promise<{ user: User; profile: UserProfile; campusName: string } | null> {
      const rows = await db
        .select({
          // auth users
          id: users.id, username: users.username, nickname: users.nickname,
          avatarUrl: users.avatarUrl, userCreatedAt: users.createdAt, userUpdatedAt: users.updatedAt,
          // profile
          campusId: userProfiles.campusId, displayName: userProfiles.displayName,
          role: userProfiles.role, canInspect: userProfiles.canInspect,
          campusName: campuses.name,
        })
        .from(users)
        .innerJoin(userProfiles, eq(users.id, userProfiles.userId))
        .innerJoin(campuses, eq(userProfiles.campusId, campuses.id))
        .where(eq(users.id, userId))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        user: {
          id: r.id, username: r.username ?? null, nickname: r.nickname ?? null,
          avatarUrl: r.avatarUrl ?? null, createdAt: num(r.userCreatedAt), updatedAt: num(r.userUpdatedAt),
        },
        profile: {
          userId: r.id, campusId: r.campusId, displayName: r.displayName,
          role: r.role as UserRole, canInspect: num(r.canInspect),
        },
        campusName: r.campusName ?? '',
      };
    },

    /** 内部助手：按 id 集合取 UserView（create/update 回查用） */
    async listByIds(ids: string[]): Promise<UserView[]> {
      if (ids.length === 0) return [];
      const rows = await joined().where(inArray(userProfiles.userId, ids));
      return rows.map(toView);
    },
  } as UsersRepo & { listByIds(ids: string[]): Promise<UserView[]> };
}

/**
 * users repo（rest 实现）—— 唯一横跨 auth 身份锚点与业务档案的 repo。
 * 语义严格对齐 drizzle/users-repo.ts（含注释里的顺序语义），差异仅实现手段：
 *
 *  - join（userProfiles × auth users × campuses）→ 三次单表查 + JS 拼接
 *    （userProfiles 页查询 → indexByIds 批查 users/campuses，避免 N+1）。
 *  - create：passwordProvider.register（users+passwords）→ insert userProfiles；
 *    profile 失败 best-effort 清理孤儿 auth user（照 drizzle 版）。
 *  - update：patch userProfiles + userStore.update 同步 nickname（非致命）。
 *  - remove：先删 auth 锚点（userStore.delete，失败整体抛错、profile 不动）→
 *    deletePassword（可能无密码记录）→ 删 profile。
 *  - username 占用：register 抛 UsernameTakenError，路由转 409（与 drizzle 轨一致）。
 */
import type { RestDb } from '@homurajs/db';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { UserView, UserProfile, User, UserRole } from '@guga-onduty/shared';
import type { UsersRepo } from '../types.js';
import { tbl, indexByIds, num } from './_base.js';

export interface UsersRepoAuthDeps {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createUsersRepo(rest: RestDb, auth: UsersRepoAuthDeps): UsersRepo {
  const userProfiles = tbl<any>(rest, 'userProfiles');
  const users = tbl<any>(rest, 'users');
  const campuses = tbl<any>(rest, 'campuses');

  /** profile 行 → UserView（需要已批查的 users/campuses 索引；缺 user/campus 视为不存在，对齐 innerJoin） */
  function toView(r: any, user?: any, campus?: any): UserView | null {
    if (!user || !campus) return null;
    return {
      id: r.userId,
      username: user.username ?? null,
      campusId: r.campusId,
      displayName: r.displayName,
      role: r.role as UserRole,
      campusName: campus.name ?? '',
      canInspect: num(r.canInspect),
      createdAt: num(user.createdAt),
    };
  }

  /** profiles 页 + 批查 join → UserView[]（list / listByIds 共用） */
  async function joinedList(filters?: Record<string, unknown>): Promise<UserView[]> {
    const profiles = await userProfiles.select(filters as any, { order: 'campusId.asc,role.asc,userId.asc' });
    const userMap = await indexByIds(users, 'id', profiles.map((p: any) => p.userId));
    const campusMap = await indexByIds(campuses, 'id', profiles.map((p: any) => p.campusId));
    const out: UserView[] = [];
    for (const p of profiles) {
      const v = toView(p, userMap.get(p.userId), campusMap.get(p.campusId));
      if (v) out.push(v);
    }
    return out;
  }

  return {
    async list(campusId, role): Promise<UserView[]> {
      const filters: Record<string, unknown> = {};
      if (campusId) filters.campusId = campusId;
      if (role) filters.role = role;
      return joinedList(Object.keys(filters).length ? filters : undefined);
    },

    async findProfile(userId): Promise<UserProfile | null> {
      const rows = await userProfiles.select({ userId }, { limit: 1 });
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
        await userProfiles.insert({
          userId: localUser.id,
          campusId: input.campusId,
          displayName: input.displayName,
          role: input.role,
          canInspect: input.canInspect ?? 0,
        }, { upsertOn: 'userId' }); // userProfiles PK = userId（非 id）；显式指定避免键错位
      } catch (e) {
        try { await auth.passwordProvider.deletePassword(localUser.id); } catch { /* 尽力清理 */ }
        try { await auth.userStore.delete(localUser.id); } catch { /* 尽力清理 */ }
        throw e;
      }
      const view = await joinedList({ userId: localUser.id });
      if (!view[0]) throw new Error('用户创建后回查失败');
      return view[0];
    },

    async update(userId, input): Promise<UserView | null> {
      const patch: any = { displayName: input.displayName, role: input.role };
      if (input.canInspect !== undefined) patch.canInspect = input.canInspect;
      await userProfiles.update(patch, { userId });
      // nickname 同步到 auth users（displayName 与 nickname 保持一致，登录页展示用）
      try { await auth.userStore.update(userId, { nickname: input.displayName }); } catch { /* 非致命 */ }
      const view = await joinedList({ userId });
      return view[0] ?? null;
    },

    async remove(userId): Promise<void> {
      // 删除顺序对齐 drizzle 版注释：先删 auth 身份锚点（失败则整体抛错，profile 保留，账号不 brick）；
      // 锚点删成功但 profile 删失败 → 孤儿 profile（惰性无害，username 已释放可重建）。
      await auth.userStore.delete(userId);
      try { await auth.passwordProvider.deletePassword(userId); } catch { /* 可能无密码记录 */ }
      await userProfiles.remove({ userId });
    },

    async findMe(userId): Promise<{ user: User; profile: UserProfile; campusName: string } | null> {
      const profileRows = await userProfiles.select({ userId }, { limit: 1 });
      const p = profileRows[0];
      if (!p) return null;
      const userRows = await users.select({ id: userId }, { limit: 1 });
      const u = userRows[0];
      const campusRows = await campuses.select({ id: p.campusId }, { limit: 1 });
      const c = campusRows[0];
      if (!u || !c) return null;
      return {
        user: {
          id: u.id, username: u.username ?? null, nickname: u.nickname ?? null,
          avatarUrl: u.avatarUrl ?? null, createdAt: num(u.createdAt), updatedAt: num(u.updatedAt),
        },
        profile: {
          userId: p.userId, campusId: p.campusId, displayName: p.displayName,
          role: p.role as UserRole, canInspect: num(p.canInspect),
        },
        campusName: c.name ?? '',
      };
    },
  };
}

/**
 * 钉钉扫码登录 —— JIT 建户（「通讯录即账号白名单」）。
 *
 * 产品流程（admin 零人工）：管理员同步钉钉通讯录 → 老师扫码 → 钉钉 userid 精确命中
 * 通讯录 → 自动创建系统账号（username=钉钉 userid，displayName=通讯录姓名，默认校区 +
 * teacher 角色）→ 写 oauth2_identity_links 绑定 → 登录。此后扫码按绑定表 userid 精确命中，
 * 不再走建户路径。
 *
 * 匹配键就是 userid 本身（IdP 的 sub=企业 userid，通讯录主键=userid，天然精确对应），
 * 无需姓名模糊匹配；sub 为 unionid 形态时按通讯录 unionId 列兜底。
 *
 * fail-closed 边界：
 *  - 不在通讯录（外部人员/已离职/家校群）→ 拒绝，绝不建户；
 *  - JIT 建的账号固定 teacher + 默认校区，提权必须 admin 在管理面手工调整；
 *  - rest 轨（qw-pages）无通讯录缓存，维持拒绝。
 *
 * 返回 LocalUser 表示可登录；返回字符串为拒绝原因（仅进服务端日志，严禁透出到用户页面）。
 */
import { eq, asc } from 'drizzle-orm';
import type { OAuth2LinkStore, UserStore, LocalUser } from '@homurajs/auth';
import type { DrizzleHandle } from '../db/client.js';
import type { Logger } from '@homurajs/core';

/** 拒绝原因（内部日志用） */
export type JitBlock =
  | 'no_contact' // sub 不在通讯录缓存（外部人员 / 未同步 / IdP sub 回退异常形态）
  | 'no_campus'; // 系统尚无任何校区（未初始化种子），profile 无法落

export type JitResult = LocalUser | JitBlock;

export function isJitBlock(r: JitResult): r is JitBlock {
  return typeof r === 'string';
}

/**
 * 通讯录命中 → 建户 + 绑定（幂等：账号已存在则复用，绑定已存在则复用）。
 * 仅 drizzle 轨（sqlite/pg）可用——rest 轨无通讯录缓存，维持 fail-closed。
 */
export async function jitProvision(
  handle: DrizzleHandle,
  stores: { linkStore: OAuth2LinkStore; userStore: UserStore },
  provider: string,
  providerSub: string,
  logger?: Logger,
): Promise<JitResult> {
  const { linkStore, userStore } = stores;
  const { dingtalkContacts, userProfiles, campuses } = handle.tables;
  // Database 是 sqlite/pg 联合类型，select 链无法静态匹配 4 组合 → repo 层同款「转型一次」
  const db = handle.db as any;

  // 并发窗口复查：另一请求可能刚完成建户+绑定，直接复用
  const raced = await linkStore.findByProvider(provider, providerSub);
  if (raced) {
    const user = await userStore.findById(raced.userId);
    if (user) return user;
  }

  // 1. userid 精确命中通讯录（miss 再按 unionId 兜底——兼容 sub 形态回退）
  let contacts = await db
    .select()
    .from(dingtalkContacts)
    .where(eq(dingtalkContacts.userId, providerSub))
    .limit(1);
  if (contacts.length === 0) {
    contacts = await db
      .select()
      .from(dingtalkContacts)
      .where(eq(dingtalkContacts.unionId, providerSub))
      .limit(1);
  }
  const contact = contacts[0];
  const name = (contact?.name ?? '').trim();
  if (!contact || !name) return 'no_contact';

  // 2. 默认校区：最早创建的（单校区部署即唯一校区；多校区时 admin 可在管理面调）
  const campusRows = await db
    .select()
    .from(campuses)
    .orderBy(asc(campuses.createdAt))
    .limit(1);
  const campusId = campusRows[0]?.id;
  if (!campusId) return 'no_campus';

  // 3. 建户（幂等）：username=钉钉 userid（企业内唯一），历史上建过但绑定丢失则复用
  let user: LocalUser;
  try {
    user = await userStore.create({
      username: providerSub,
      nickname: name,
      avatarUrl: contact.avatarUrl ?? null,
    });
  } catch {
    const existing = await userStore.findByUsername(providerSub);
    if (!existing) return 'no_contact';
    user = existing;
  }

  // 4. 业务档案：displayName=通讯录姓名（改了名字下次同步会更新通讯录，这里以扫码时刻为准）
  const profiles = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, user.id))
    .limit(1);
  if (profiles.length === 0) {
    await db.insert(userProfiles).values({
      userId: user.id,
      campusId,
      displayName: name,
      role: 'teacher', // JIT 固定最低权限角色；提权走管理面
      canInspect: 0,
    });
  }

  // 5. 写绑定（唯一约束兜底并发竞态；冲突后复查归属一致即复用）
  try {
    await linkStore.create({ userId: user.id, provider, providerSub });
  } catch {
    const dup = await linkStore.findByProvider(provider, providerSub);
    if (!dup || dup.userId !== user.id) return 'no_contact';
  }

  logger?.info('dingtalk jit user provisioned', {
    userId: user.id,
    username: providerSub,
    displayName: name,
    campusId,
    provider,
  });
  return user;
}

/**
 * 钉钉扫码登录 —— 新用户自动匹配（自「admin 手动预绑定」放宽）。
 *
 * 背景：JIT 建户仍然关闭（钉钉身份拿不到 role/campusId，系统账号必须 admin 建号），
 * 但「已同步进通讯录、且系统里有同名账号」的人不该再让 admin 逐个手动绑定——
 * 扫码时自动完成 oauth2_identity_links 写入，一次成功后永久生效。
 *
 * 匹配链（fail-closed，宁可不登也不错绑）：
 *   1. providerSub（钉钉企业 userid）必须存在于 dingtalkContacts（IdP sub 不在通讯录 → block）
 *   2. 通讯录姓名 ↔ userProfiles.displayName 精确匹配，且**全库唯一**（0 人或多人重名 → block）
 *   3. 该系统账号尚未绑定其他钉钉身份（已绑 → block，防抢占）
 *   4. 通过 → linkStore.create 自动绑定（唯一约束冲突按竞态处理：复查后归属不一致仍 block）
 *
 * 返回 LocalUser 表示匹配成功（可直接登录）；返回字符串为 block 原因（用于日志，
 * **严禁**透出到面向用户的页面——非技术人员不需要也不该看到技术细节）。
 */
import { eq } from 'drizzle-orm';
import type { OAuth2LinkStore, UserStore, LocalUser } from '@homurajs/auth';
import type { DrizzleHandle } from '../db/client.js';
import type { Logger } from '@homurajs/core';

/** block 原因（内部日志用） */
export type AutoLinkBlock =
  | 'no_contact' // sub 不在通讯录缓存（未同步 / 外部联系人）
  | 'no_profile' // 通讯录有此人，但系统没有同名账号（admin 尚未建号）
  | 'ambiguous' // 同名账号多个，无法确定绑定谁
  | 'conflict'; // 该系统账号已绑了别的钉钉身份 / 绑定竞态归属不一致

export type AutoLinkResult = LocalUser | AutoLinkBlock;

export function isAutoLinkBlock(r: AutoLinkResult): r is AutoLinkBlock {
  return typeof r === 'string';
}

/**
 * 尝试自动匹配绑定。仅在 drizzle 轨（sqlite/pg）可用——rest 轨无通讯录缓存，维持 fail-closed。
 */
export async function tryAutoLink(
  handle: DrizzleHandle,
  stores: { linkStore: OAuth2LinkStore; userStore: UserStore },
  provider: string,
  providerSub: string,
  logger?: Logger,
): Promise<AutoLinkResult> {
  const { linkStore, userStore } = stores;
  const { dingtalkContacts, userProfiles } = handle.tables;
  // Database 是 sqlite/pg 联合类型，select 链无法静态匹配 4 组合 → repo 层同款「转型一次」
  const db = handle.db as any;

  // 1. IdP 给的 userid 必须在通讯录缓存里（通讯录是「哪些人属于本校」的唯一事实源）
  const contacts = await db
    .select()
    .from(dingtalkContacts)
    .where(eq(dingtalkContacts.userId, providerSub))
    .limit(1);
  const name = (contacts[0]?.name ?? '').trim();
  if (!name) return 'no_contact';

  // 2. 姓名 ↔ displayName 精确唯一匹配
  const profiles = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.displayName, name));
  if (profiles.length === 0) return 'no_profile';
  if (profiles.length > 1) return 'ambiguous';
  const userId = profiles[0].userId;

  // 3. 该账号不能已绑其他钉钉身份（防抢占；同 sub 已绑的在上游 findByProvider 已命中）
  const existing = await linkStore.findByUserId(userId);
  if (existing.some((l) => l.provider === provider)) return 'conflict';

  // 4. 自动绑定（(provider, providerSub) 唯一约束兜底并发竞态）
  try {
    await linkStore.create({ userId, provider, providerSub });
  } catch {
    const dup = await linkStore.findByProvider(provider, providerSub);
    if (!dup || dup.userId !== userId) return 'conflict';
  }

  logger?.info('dingtalk identity auto-linked', { userId, provider, providerSub });
  const user = await userStore.findById(userId);
  return user ?? 'no_profile';
}

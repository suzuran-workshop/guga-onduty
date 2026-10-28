/**
 * 教师身份解析 —— 「当前登录用户」→「钉钉 userid」（自 guga-onduty-w 移植）。
 *
 * 系统内登录态是 profile.userId（本系统 users.id），而钉钉推送目标 / 绑定键是钉钉 userid。
 * 二者经 auth SDK 的 oauth2_identity_links 表关联：教师用钉钉扫码登录后，SDK 会写入
 * {userId, provider:'dingtalk', providerSub}；admin 也可在管理面手动预绑定。
 * 解析路径：profile.userId → linkStore.findByUserId → provider==='dingtalk' 的 link.providerSub
 *
 * ⚠ 关键不确定性（同 w 仓库 ADR-8）：providerSub 是否等于钉钉**企业内 userid**，
 * 取决于 oauth2-dingtalk IdP 的 mapUser 实现。因此本函数是 **best-effort**：
 * 解析不出就返回 null，调用方必须 fail-closed（不放行）。
 */
import type { OAuth2LinkStore } from '@homurajs/auth';

/** 钉钉在 oauth2_identity_links 里的 provider 标识（与 auth/build.ts 装配时一致） */
export const DINGTALK_PROVIDER = 'dingtalk';

/**
 * 解析登录用户的钉钉 userid。返回 null 表示无法解析（未走钉钉登录 / 无 link）。
 */
export async function resolveDingtalkUserId(
  linkStore: OAuth2LinkStore,
  userId: string,
): Promise<string | null> {
  const links = await linkStore.findByUserId(userId);
  const dt = links.find((l) => l.provider === DINGTALK_PROVIDER);
  return dt?.providerSub || null;
}

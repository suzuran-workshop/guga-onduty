/**
 * 令牌工具 —— 免登录令牌的哈希（自 guga-onduty-w 移植的钉钉域基建）。
 *
 * 令牌**只存 SHA-256 哈希**：明文仅在创建时返回一次，数据库泄漏也无法反推可用链接。
 * 校验侧收到明文 token 后哈希再查，两端共用此函数。
 */
import { createHash } from 'node:crypto';

/** SHA-256 hex（64 字符） */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

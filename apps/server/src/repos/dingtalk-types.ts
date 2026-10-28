/**
 * 钉钉域 repo 契约 —— 通讯录缓存 / 通知日志 / 免登录令牌。
 *
 * 自 guga-onduty-w 移植（基建）。分层原则同 duty-types.ts：repo 只负责「取行/写行」。
 */
import type {
  DingtalkContact, DingtalkContactInput, NotificationLog, NotificationLogInput, NotificationLogPatch,
  NotificationKind, NotificationStatus,
} from '@guga-onduty/shared';
import type { Paged } from './types.js';

// ── 钉钉通讯录缓存 ──────────────────────────────────────────────────
export interface DingtalkContactsRepo {
  /** 批量 upsert（按 userId 主键；钉钉侧改名/换部门以最新为准）。返回写入条数 */
  upsertMany(contacts: DingtalkContactInput[]): Promise<number>;
  list(filter?: { nameLike?: string; limit?: number }): Promise<DingtalkContact[]>;
  findByUserId(userId: string): Promise<DingtalkContact | null>;
  /** 重名会返回多条——由调用方决定（下拉选人可让用户挑） */
  findByName(name: string): Promise<DingtalkContact[]>;
}

// ── 通知日志 ────────────────────────────────────────────────────────
export interface NotificationsRepo {
  /**
   * 入库（status 恒从 pending 起步）。带 dedupeKey 时：已存在同 key → 返回 null（幂等跳过，
   * 「管理员补发」可安全重复点击），不抛错。
   */
  create(input: NotificationLogInput): Promise<NotificationLog | null>;
  /** 部分更新（回执/失败回写；只改传入字段） */
  update(id: string, patch: NotificationLogPatch): Promise<void>;
  findById(id: string): Promise<NotificationLog | null>;
  list(filter: {
    campusId: string;
    status?: NotificationStatus;
    kind?: NotificationKind;
    recordId?: string;
    page: number;
    pageSize: number;
  }): Promise<Paged<NotificationLog>>;
  listPending(campusId?: string, limit?: number): Promise<NotificationLog[]>;
}

// ── 免登录令牌（基建预留；本仓库暂无业务消费方）────────────────────
export interface AppealTokensRepo {
  /** 明文令牌只在返回值里出现一次（调用方拼进消息链接；库里只有 SHA-256 哈希） */
  create(input: { recordId?: string | null; teacherDingtalkId: string; expiresAt: number }): Promise<{ plainToken: string }>;
  /** 原子消费：WHERE consumedAt IS NULL + 检查影响行数（并发点击同链接不会重复消费） */
  consume(tokenHash: string): Promise<
    { ok: true; recordId: string | null; teacherDingtalkId: string }
    | { ok: false; reason: 'not_found' | 'expired' | 'consumed' }
  >;
  peek(tokenHash: string): Promise<
    { ok: true; recordId: string | null; teacherDingtalkId: string }
    | { ok: false; reason: 'not_found' | 'expired' | 'consumed' }
  >;
  /** 清理：已过期 + 已消费超 7 天的。返回删除行数 */
  purgeExpired(now?: number): Promise<number>;
}

/** 钉钉域 repo 集合 */
export interface DingtalkRepos {
  contacts: DingtalkContactsRepo;
  notifications: NotificationsRepo;
  appealTokens: AppealTokensRepo;
}

/**
 * 钉钉域 schema（sqlite 方言）—— 与 pg.dingtalk.ts **严格镜像**（parity 门禁校验表名/列名/主键）。
 * 差异仅类型：uuid→text、jsonb→text+JSON 编解码、epochMs→integer。
 */
import { sqliteCol, sqliteTable, sqliteJson } from '@homurajs/db/schema-helpers';
import { check, index, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { NOTIFICATION_KINDS, NOTIFICATION_STATUSES, sqlInList } from './enums.js';

const ref = (name: string) => text(name).notNull();
const optRef = (name: string) => text(name);

// ── 钉钉通讯录缓存 ──────────────────────────────────────────────────
export const dingtalkContacts = sqliteTable(
  'dingtalkContacts',
  {
    userId: sqliteCol.text('userId').primaryKey(), // 钉钉 userid（企业内唯一，非本系统 users.id）
    unionId: sqliteCol.text('unionId'),
    name: sqliteCol.text('name').notNull(),
    mobile: sqliteCol.text('mobile'),
    title: sqliteCol.text('title'),
    avatarUrl: sqliteCol.text('avatarUrl'),
    /** 所属部门 id 列表（同一人可属多部门） */
    deptIds: sqliteJson<number[]>('deptIds'),
    /** 部门名路径（冗余存储，避免每次展示都重建部门树） */
    deptNames: sqliteJson<string[]>('deptNames'),
    syncedAt: sqliteCol.epochMs('syncedAt').notNull(),
  },
  (t) => [index('dingtalk_contacts_name_idx').on(t.name)],
);

// ── 通知日志 ────────────────────────────────────────────────────────
export const notificationLogs = sqliteTable(
  'notificationLogs',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    /** 收件人：本系统 users.id（可空——通讯录里的人可能还没有系统账号） */
    recipientUserId: optRef('recipientUserId'),
    /** 收件人钉钉 userid（推送实际目标） */
    recipientPlatformId: sqliteCol.text('recipientPlatformId').notNull(),
    kind: sqliteCol.text('kind').notNull(),
    status: sqliteCol.text('status').notNull().default('pending'),
    /** 关联业务对象 id（预留列：接业务推送时启用，当前恒 null） */
    recordId: optRef('recordId'),
    /** 关联周次（预留列，当前恒 null） */
    week: sqliteCol.text('week'),
    /** 消息摘要（便于管理员在后台看到推了什么，不存敏感全文） */
    title: sqliteCol.text('title'),
    /** 幂等键（独立可空列 + 唯一索引；不填幂等键的通知为 NULL，互不冲突） */
    dedupeKey: sqliteCol.text('dedupeKey'),
    /** 钉钉 asyncsend_v2 返回的 task_id（查回执用） */
    providerTaskId: sqliteCol.text('providerTaskId'),
    /** 失败原因（钉钉 errmsg 或回执里的 invalid/failed 归类） */
    error: sqliteCol.text('error'),
    createdAt: sqliteCol.createdAt('createdAt'),
    sentAt: sqliteCol.epochMs('sentAt'),
  },
  (t) => [
    check('notification_logs_kind_check', sql`kind IN (${sql.raw(sqlInList(NOTIFICATION_KINDS))})`),
    check('notification_logs_status_check', sql`status IN (${sql.raw(sqlInList(NOTIFICATION_STATUSES))})`),
    uniqueIndex('notification_logs_dedupe_uidx').on(t.dedupeKey),
    index('notification_logs_campus_idx').on(t.campusId),
    index('notification_logs_status_idx').on(t.status),
    index('notification_logs_record_idx').on(t.recordId),
  ],
);

// ── 免登录令牌（基建预留）───────────────────────────────────────────
export const appealTokens = sqliteTable(
  'appealTokens',
  {
    /** 令牌哈希（SHA-256 hex），不存明文——泄漏数据库也无法直接构造可用链接 */
    tokenHash: sqliteCol.text('tokenHash').primaryKey(),
    /** 关联业务对象 id（预留列，当前恒 null；接业务时收紧） */
    recordId: optRef('recordId'),
    /** 令牌归属人的钉钉 userid（text 而非 uuid——钉钉 userid 非 uuid 形态） */
    teacherDingtalkId: sqliteCol.text('teacherDingtalkId').notNull(),
    expiresAt: sqliteCol.epochMs('expiresAt').notNull(),
    /** 一次性消费标记 */
    consumedAt: sqliteCol.epochMs('consumedAt'),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [
    index('appeal_tokens_record_idx').on(t.recordId),
    index('appeal_tokens_expires_idx').on(t.expiresAt),
  ],
);

/** sqlite 钉钉域表集合 */
export const sqliteDingtalkSchema = {
  dingtalkContacts,
  notificationLogs,
  appealTokens,
};

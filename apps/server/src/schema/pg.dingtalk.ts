/**
 * 钉钉域 schema（pg 方言）—— 通讯录缓存 / 通知日志 / 免登录令牌 三表。
 * 自 guga-onduty-w 移植（自 e74c6d92 起引入的钉钉域基建），约定同 pg.ts：
 * camelCase 列名、uuid PK、无 drizzle references、迁移由 drizzle-kit 生成。
 */
import { pgCol, pgTable, pgJson } from '@homurajs/db/schema-helpers';
import { check, index, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { NOTIFICATION_KINDS, NOTIFICATION_STATUSES, sqlInList } from './enums.js';

/** 引用列（NOT NULL uuid）—— 引用另一表的 uuid 主键，完整性由 repo 层保证 */
const ref = (name: string) => uuid(name).notNull();
const optRef = (name: string) => uuid(name);

// ── 钉钉通讯录缓存 ──────────────────────────────────────────────────
// 管理员「引入整个组织通讯录（不含家校）」的本地索引。钉钉无「按姓名查 userid」API，
// 后续任何推送/绑定都依赖这份缓存。upsertMany 按 userId 主键 upsert（钉钉侧改名/换部门后以最新为准）。
// ⚠ userId 是钉钉企业 userid（形如 5314054424-444663015，非 uuid），故用 text 主键。
// ⚠ 通讯录同步是**组织级**的（钉钉通讯录无校区维度），联系人可被任意校区使用。
export const dingtalkContacts = pgTable(
  'dingtalkContacts',
  {
    userId: pgCol.text('userId').primaryKey(), // 钉钉 userid（企业内唯一，非本系统 users.id）
    unionId: pgCol.text('unionId'),
    name: pgCol.text('name').notNull(),
    mobile: pgCol.text('mobile'),
    title: pgCol.text('title'),
    avatarUrl: pgCol.text('avatarUrl'),
    /** 所属部门 id 列表（同一人可属多部门） */
    deptIds: pgJson<number[]>('deptIds'),
    /** 部门名路径（冗余存储，避免每次展示都重建部门树） */
    deptNames: pgJson<string[]>('deptNames'),
    syncedAt: pgCol.epochMs('syncedAt').notNull(),
  },
  (t) => [index('dingtalk_contacts_name_idx').on(t.name)],
);

// ── 通知日志 ────────────────────────────────────────────────────────
// 推送的异步队列 + 幂等 + 审计。缺它则：凭证未配时无法落库补发、失败无法重试。
// 本仓库（值班域）当前无业务自动推送消费方，管理面可手动发通知/补发 pending。
export const notificationLogs = pgTable(
  'notificationLogs',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    /** 收件人：本系统 users.id（可空——通讯录里的人可能还没有系统账号） */
    recipientUserId: optRef('recipientUserId'),
    /** 收件人钉钉 userid（推送实际目标） */
    recipientPlatformId: pgCol.text('recipientPlatformId').notNull(),
    kind: pgCol.text('kind').notNull(),
    status: pgCol.text('status').notNull().default('pending'),
    /** 关联业务对象 id（预留列：接业务推送时启用，当前恒 null） */
    recordId: optRef('recordId'),
    /** 关联周次（预留列，当前恒 null） */
    week: pgCol.text('week'),
    /** 消息摘要（便于管理员在后台看到推了什么，不存敏感全文） */
    title: pgCol.text('title'),
    /**
     * 幂等键（形如 `<kind>:<campusId>:<platformId>:<bizKey>`）。
     * 独立可空列 + 唯一索引：不填幂等键的通知为 NULL，sqlite/pg 下 NULL 互不冲突。
     */
    dedupeKey: pgCol.text('dedupeKey'),
    /** 钉钉 asyncsend_v2 返回的 task_id（查回执用） */
    providerTaskId: pgCol.text('providerTaskId'),
    /** 失败原因（钉钉 errmsg 或回执里的 invalid/failed 归类） */
    error: pgCol.text('error'),
    createdAt: pgCol.createdAt('createdAt'),
    sentAt: pgCol.epochMs('sentAt'),
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
// 自 w 仓库移植的基建：签名 token 只存 SHA-256 哈希，一次性原子消费。
// ⚠ 本仓库（值班域）暂无免登录业务消费方（值周域的免登录申诉不适用），
//   表与 repo 先行就位；recordId 预留为可空，接业务时按业务收紧语义。
export const appealTokens = pgTable(
  'appealTokens',
  {
    /** 令牌哈希（SHA-256 hex），不存明文——泄漏数据库也无法直接构造可用链接 */
    tokenHash: pgCol.text('tokenHash').primaryKey(),
    /** 关联业务对象 id（预留列，当前恒 null；接业务时收紧） */
    recordId: optRef('recordId'),
    /**
     * 令牌归属人的**钉钉 userid**（非本系统 users.id）。
     * ⚠ 用 text 而非 ref()：ref() 在 pg 是 uuid，而钉钉 userid 形如 `5314054424-444663015` 非 uuid。
     */
    teacherDingtalkId: pgCol.text('teacherDingtalkId').notNull(),
    expiresAt: pgCol.epochMs('expiresAt').notNull(),
    /** 一次性消费标记 */
    consumedAt: pgCol.epochMs('consumedAt'),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [
    index('appeal_tokens_record_idx').on(t.recordId),
    index('appeal_tokens_expires_idx').on(t.expiresAt),
  ],
);

/** pg 钉钉域表集合 */
export const pgDingtalkSchema = {
  dingtalkContacts,
  notificationLogs,
  appealTokens,
};

/**
 * PostgreSQL 轨 schema —— 业务表（pg 方言）。
 *
 * 设计约束（见 docs/ARCHITECTURE.md）：
 *  - 列名一律 camelCase（homura pgCol/sqliteCol 缺省列名 = JS 属性名；rest 轨 restSchemaFromPg 派生同名）。
 *  - 迁移 SQL 由 `drizzle-kit generate` 生成本文件的元数据，**绝不手写 DDL**。
 *  - 主键统一 uuid（pgCol.id() = uuid defaultRandom）；引用列用裸 uuid（不用 references，
 *    遵循 @homurajs/auth 先例：rest 轨无 FK 概念，三轨语义一致靠应用层 repo+事务保证完整性）。
 *  - check 约束的列名均为小写单词（role/kind/status/category/action），SQL 字面量双方言通用。
 *  - auth 5 表由 `pgAuthTables` spread 进 pgSchema（见 ./index.ts），不在本文件重复定义。
 *
 * 本仓库（值班域）从原融合仓库 guga-onduty-w 拆分而来，只保留值班域 + 共享基础表：
 *  - 共享基础表：campuses / userProfiles / settings
 *  - 值班 7 表：见 ./pg.duty.ts
 */
import { pgCol, pgTable, pgJson } from '@homurajs/db/schema-helpers';
import { check, index, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ROLES, sqlInList } from './enums.js';
import {
  dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules,
  dutyCheckins, dutyInspections, dutySwaps,
} from './pg.duty.js';
import { dingtalkContacts, notificationLogs, appealTokens } from './pg.dingtalk.js';
// 再导出，使 Tables(=typeof pgTables) 含值班/钉钉表，repo 层可经 ctx.tables.dutyXxx 访问
export {
  dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules, dutyCheckins, dutyInspections, dutySwaps,
  dingtalkContacts, notificationLogs, appealTokens,
};

/** 引用列（NOT NULL uuid）—— 引用另一表的 uuid 主键，完整性由 repo 层保证 */
const ref = (name: string) => uuid(name).notNull();

// ── 校区 ────────────────────────────────────────────────────────────
export const campuses = pgTable(
  'campuses',
  {
    id: pgCol.id(),
    name: pgCol.text('name').notNull(),
    code: pgCol.text('code').notNull(),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [uniqueIndex('campuses_code_uidx').on(t.code)],
);

// ── 用户业务档案（身份锚点 users 由 auth SDK 提供，此处存 role/campus 等业务属性）──
export const userProfiles = pgTable(
  'userProfiles',
  {
    /** PK = auth users.id（uuid），1:1 */
    userId: uuid('userId').primaryKey(),
    campusId: ref('campusId'),
    displayName: pgCol.text('displayName').notNull(),
    role: pgCol.text('role').notNull(),
    /** 领导巡查权限（0/1）：teacher 且被授权者可巡查在岗 */
    canInspect: pgCol.int('canInspect').notNull().default(0),
  },
  (t) => [
    check('user_profiles_role_check', sql`role IN (${sql.raw(sqlInList(ROLES))})`),
    index('user_profiles_campus_idx').on(t.campusId),
  ],
);

// ── 系统设置（key-value）────────────────────────────────────────────
export const settings = pgTable(
  'settings',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    key: pgCol.text('key').notNull(),
    value: pgCol.text('value').notNull(),
  },
  (t) => [
    uniqueIndex('settings_campus_key_uidx').on(t.campusId, t.key),
    index('settings_campus_idx').on(t.campusId),
  ],
);

/** pg 业务表集合（auth 表在 ./index.ts spread 合并） */
export const pgBusinessSchema = {
  campuses,
  userProfiles,
  settings,
  // ── 值班域 7 表（区域/地点/时段/排班/打卡/巡查/调班）──
  dutyAreas,
  dutyLocations,
  dutyTimeSlots,
  dutySchedules,
  dutyCheckins,
  dutyInspections,
  dutySwaps,
  // ── 钉钉域 3 表（通讯录/通知日志/免登录令牌）──
  dingtalkContacts,
  notificationLogs,
  appealTokens,
};

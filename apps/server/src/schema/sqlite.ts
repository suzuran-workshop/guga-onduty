/**
 * SQLite 轨 schema —— 业务表（sqlite 方言）。
 *
 * 与 pg.ts **严格镜像**：表名、列名、主键完全一致（`assertSchemaParity` 门禁校验这三样）。
 * 差异仅在类型映射（homura schema-helpers 已封装）：
 *  - pgCol.id() = uuid defaultRandom  ↔  sqliteCol.id() = text + randomUUID（运行时都是 string uuid）
 *  - pgJson (jsonb)  ↔  sqliteJson (text + JSON 编解码)
 *  - 引用列 uuid  ↔  text
 *  - pgCol.createdAt = timestamptz  ↔  sqliteCol.createdAt = integer(timestamp_ms)
 *  - pgCol.epochMs = bigint  ↔  sqliteCol.epochMs = integer
 * check 约束列名均为小写单词，SQL 字面量双方言通用（与 enums.ts 共享单一真源）。
 */
import { sqliteCol, sqliteTable } from '@homurajs/db/schema-helpers';
import { check, index, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ROLES, sqlInList } from './enums.js';
import {
  dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules,
  dutyCheckins, dutyInspections, dutySwaps,
} from './sqlite.duty.js';
// 再导出，使 Tables(=typeof sqliteTables) 含值班表，repo 层可经 ctx.tables.dutyXxx 访问
export { dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules, dutyCheckins, dutyInspections, dutySwaps };

/** 引用列（NOT NULL text，存 uuid）—— 完整性由 repo 层保证 */
const ref = (name: string) => text(name).notNull();

// ── 校区 ────────────────────────────────────────────────────────────
export const campuses = sqliteTable(
  'campuses',
  {
    id: sqliteCol.id(),
    name: sqliteCol.text('name').notNull(),
    code: sqliteCol.text('code').notNull(),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [uniqueIndex('campuses_code_uidx').on(t.code)],
);

// ── 用户业务档案（身份锚点 users 由 auth SDK 提供，此处存 role/campus 等业务属性）──
export const userProfiles = sqliteTable(
  'userProfiles',
  {
    userId: text('userId').primaryKey(),
    campusId: ref('campusId'),
    displayName: sqliteCol.text('displayName').notNull(),
    role: sqliteCol.text('role').notNull(),
    canInspect: sqliteCol.int('canInspect').notNull().default(0),
  },
  (t) => [
    check('user_profiles_role_check', sql`role IN (${sql.raw(sqlInList(ROLES))})`),
    index('user_profiles_campus_idx').on(t.campusId),
  ],
);

// ── 系统设置（key-value）────────────────────────────────────────────
export const settings = sqliteTable(
  'settings',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    key: sqliteCol.text('key').notNull(),
    value: sqliteCol.text('value').notNull(),
  },
  (t) => [
    uniqueIndex('settings_campus_key_uidx').on(t.campusId, t.key),
    index('settings_campus_idx').on(t.campusId),
  ],
);

/** sqlite 业务表集合（auth 表在 ./index.ts spread 合并） */
export const sqliteBusinessSchema = {
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
};

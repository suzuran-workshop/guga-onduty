/**
 * 值班域 schema（pg 方言）—— 7 表，融合方案的排班/履职/监督/变更层。
 * 见 docs/DUTY-FUSION.md §2。约定同 pg.ts：camelCase 列名、uuid PK、check 约束、
 * 无 drizzle references（三轨一致，完整性靠 repo+事务）、迁移由 drizzle-kit 生成。
 */
import { pgCol, pgTable, pgJson } from '@homurajs/db/schema-helpers';
import { check, index, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  DUTY_KINDS, WEEK_PARITIES, SWAP_TYPES, SWAP_STATUSES, INSPECT_STATUSES, sqlInList,
} from './enums.js';

const ref = (name: string) => uuid(name).notNull();
const optRef = (name: string) => uuid(name);

// ── 区域（年级组/学部维度）──────────────────────────────────────────
export const dutyAreas = pgTable(
  'dutyAreas',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    sortOrder: pgCol.int('sortOrder').notNull().default(0),
  },
  (t) => [
    uniqueIndex('duty_areas_campus_name_uidx').on(t.campusId, t.name),
    index('duty_areas_campus_idx').on(t.campusId),
  ],
);

// ── 值班地点（执勤岗位）─────────────────────────────────────────────
export const dutyLocations = pgTable(
  'dutyLocations',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    areaId: ref('areaId'),
    name: pgCol.text('name').notNull(),
  },
  (t) => [
    uniqueIndex('duty_locations_campus_area_name_uidx').on(t.campusId, t.areaId, t.name),
    index('duty_locations_campus_idx').on(t.campusId),
    index('duty_locations_area_idx').on(t.areaId),
  ],
);

// ── 值班时段 ────────────────────────────────────────────────────────
export const dutyTimeSlots = pgTable(
  'dutyTimeSlots',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    areaId: ref('areaId'),
    name: pgCol.text('name').notNull(),
    startMinute: pgCol.int('startMinute'),
    endMinute: pgCol.int('endMinute'),
    priority: pgCol.int('priority').notNull().default(0),
  },
  (t) => [index('duty_timeslots_campus_idx').on(t.campusId), index('duty_timeslots_area_idx').on(t.areaId)],
);

// ── 值班排班表（核心周期模板）───────────────────────────────────────
export const dutySchedules = pgTable(
  'dutySchedules',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    /** teaching=教师执勤（校园地点巡查）—— 拆分后唯一类型；列保留供未来扩展 */
    kind: pgCol.text('kind').notNull().default('teaching'),
    areaId: ref('areaId'),
    timeSlotId: optRef('timeSlotId'),
    locationId: optRef('locationId'),
    dateStart: pgCol.text('dateStart').notNull(), // YYYY-MM-DD 学期起
    dateEnd: pgCol.text('dateEnd').notNull(),     // YYYY-MM-DD 学期止
    weekday: pgCol.int('weekday').notNull(),       // 0=周日..6=周六
    weekParity: pgCol.text('weekParity').notNull().default('everyweek'),
    countersign: pgCol.int('countersign').notNull().default(0), // 会签：同一时空允许多人
    /** 被排班者 userId(uuid) 数组（会签多人） */
    assigneeIds: pgJson<string[]>('assigneeIds').notNull(),
    note: pgCol.text('note'),
  },
  (t) => [
    check('duty_schedules_kind_check', sql`kind IN (${sql.raw(sqlInList(DUTY_KINDS))})`),
    check('duty_schedules_parity_check', sql`weekParity IN (${sql.raw(sqlInList(WEEK_PARITIES))})`),
    index('duty_schedules_campus_kind_idx').on(t.campusId, t.kind),
    index('duty_schedules_area_idx').on(t.areaId),
  ],
);

// ── 执勤打卡（粗粒度履职，精确到人）─────────────────────────────────
export const dutyCheckins = pgTable(
  'dutyCheckins',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    scheduleId: ref('scheduleId'),
    dutyDate: pgCol.text('dutyDate').notNull(), // 实际执勤日 YYYY-MM-DD
    teacherId: ref('teacherId'),               // 打卡人=本人（非整条排班全部教师）
    locationName: pgCol.text('locationName').notNull(), // 快照
    timeSlotName: pgCol.text('timeSlotName'),           // 快照
    situation: pgCol.text('situation'),
    photos: pgJson<string[]>('photos').notNull(), // 现场照片 objectKey 数组（必填≥1）
    checkedInAt: pgCol.epochMs('checkedInAt').notNull(),
  },
  (t) => [
    // 会签格多人各自独立打卡，防重复：同一排班+日期+教师只能一条
    uniqueIndex('duty_checkins_uniq').on(t.scheduleId, t.dutyDate, t.teacherId),
    index('duty_checkins_campus_date_idx').on(t.campusId, t.dutyDate),
    index('duty_checkins_teacher_idx').on(t.teacherId),
  ],
);

// ── 巡查记录（领导抽样查在岗，items 为子表 JSON）────────────────────
export const dutyInspections = pgTable(
  'dutyInspections',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    inspectorId: ref('inspectorId'),
    inspectDate: pgCol.text('inspectDate').notNull(),
    areaId: ref('areaId'),
    /** 子表：[{locationName,teacherName,teacherId,status,photoKeys[],scheduleId,dutyDate}]（逐记录展开，防笛卡尔积） */
    items: pgJson<unknown[]>('items').notNull(),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [index('duty_inspections_campus_date_idx').on(t.campusId, t.inspectDate)],
);

// ── 调班申请（工作流 + 叠加层，不回改原排班）────────────────────────
export const dutySwaps = pgTable(
  'dutySwaps',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    type: pgCol.text('type').notNull(), // swap=交换、proxy=代理
    applicantId: ref('applicantId'),
    applicantScheduleId: ref('applicantScheduleId'),
    applicantDate: pgCol.text('applicantDate').notNull(), // 叠加生效日
    targetId: ref('targetId'),
    targetScheduleId: optRef('targetScheduleId'),
    targetDate: pgCol.text('targetDate'),
    reason: pgCol.text('reason').notNull(),
    status: pgCol.text('status').notNull().default('pending'),
    reviewerId: optRef('reviewerId'),
    reviewComment: pgCol.text('reviewComment'),
    createdAt: pgCol.createdAt('createdAt'),
    reviewedAt: pgCol.epochMs('reviewedAt'),
  },
  (t) => [
    check('duty_swaps_type_check', sql`type IN (${sql.raw(sqlInList(SWAP_TYPES))})`),
    check('duty_swaps_status_check', sql`status IN (${sql.raw(sqlInList(SWAP_STATUSES))})`),
    index('duty_swaps_campus_status_idx').on(t.campusId, t.status),
    index('duty_swaps_applicant_idx').on(t.applicantId),
  ],
);

/** 巡查子表项状态枚举（前端/repo 复用；items 是 JSON 子表，无独立表约束，故仅导出常量） */
export const INSPECT_ITEM_STATUSES = INSPECT_STATUSES;

/** pg 值班域表集合 */
export const pgDutySchema = {
  dutyAreas,
  dutyLocations,
  dutyTimeSlots,
  dutySchedules,
  dutyCheckins,
  dutyInspections,
  dutySwaps,
};

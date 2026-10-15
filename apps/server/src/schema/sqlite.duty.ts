/**
 * 值班域 schema（sqlite 方言）—— 与 pg.duty.ts **严格镜像**（parity 门禁校验表名/列名/主键）。
 * 差异仅类型：uuid→text、jsonb→text+JSON 编解码、epochMs→integer。见 docs/DUTY-FUSION.md §2。
 */
import { sqliteCol, sqliteTable, sqliteJson } from '@homurajs/db/schema-helpers';
import { check, index, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  DUTY_KINDS, WEEK_PARITIES, SWAP_TYPES, SWAP_STATUSES, INSPECT_STATUSES, sqlInList,
} from './enums.js';

const ref = (name: string) => text(name).notNull();
const optRef = (name: string) => text(name);

// ── 区域 ────────────────────────────────────────────────────────────
export const dutyAreas = sqliteTable(
  'dutyAreas',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    sortOrder: sqliteCol.int('sortOrder').notNull().default(0),
  },
  (t) => [
    uniqueIndex('duty_areas_campus_name_uidx').on(t.campusId, t.name),
    index('duty_areas_campus_idx').on(t.campusId),
  ],
);

// ── 值班地点 ────────────────────────────────────────────────────────
export const dutyLocations = sqliteTable(
  'dutyLocations',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    areaId: ref('areaId'),
    name: sqliteCol.text('name').notNull(),
  },
  (t) => [
    uniqueIndex('duty_locations_campus_area_name_uidx').on(t.campusId, t.areaId, t.name),
    index('duty_locations_campus_idx').on(t.campusId),
    index('duty_locations_area_idx').on(t.areaId),
  ],
);

// ── 值班时段 ────────────────────────────────────────────────────────
export const dutyTimeSlots = sqliteTable(
  'dutyTimeSlots',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    areaId: ref('areaId'),
    name: sqliteCol.text('name').notNull(),
    startMinute: sqliteCol.int('startMinute'),
    endMinute: sqliteCol.int('endMinute'),
    priority: sqliteCol.int('priority').notNull().default(0),
  },
  (t) => [index('duty_timeslots_campus_idx').on(t.campusId), index('duty_timeslots_area_idx').on(t.areaId)],
);

// ── 值班排班表（核心周期模板；kind=teaching，拆分后唯一类型，列保留供扩展）──
export const dutySchedules = sqliteTable(
  'dutySchedules',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    kind: sqliteCol.text('kind').notNull().default('teaching'),
    areaId: ref('areaId'),
    timeSlotId: optRef('timeSlotId'),
    locationId: optRef('locationId'),
    dateStart: sqliteCol.text('dateStart').notNull(),
    dateEnd: sqliteCol.text('dateEnd').notNull(),
    weekday: sqliteCol.int('weekday').notNull(),
    weekParity: sqliteCol.text('weekParity').notNull().default('everyweek'),
    countersign: sqliteCol.int('countersign').notNull().default(0),
    assigneeIds: sqliteJson<string[]>('assigneeIds').notNull(),
    note: sqliteCol.text('note'),
  },
  (t) => [
    check('duty_schedules_kind_check', sql`kind IN (${sql.raw(sqlInList(DUTY_KINDS))})`),
    check('duty_schedules_parity_check', sql`weekParity IN (${sql.raw(sqlInList(WEEK_PARITIES))})`),
    index('duty_schedules_campus_kind_idx').on(t.campusId, t.kind),
    index('duty_schedules_area_idx').on(t.areaId),
  ],
);

// ── 执勤打卡（精确到人）─────────────────────────────────────────────
export const dutyCheckins = sqliteTable(
  'dutyCheckins',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    scheduleId: ref('scheduleId'),
    dutyDate: sqliteCol.text('dutyDate').notNull(),
    teacherId: ref('teacherId'),
    locationName: sqliteCol.text('locationName').notNull(),
    timeSlotName: sqliteCol.text('timeSlotName'),
    situation: sqliteCol.text('situation'),
    photos: sqliteJson<string[]>('photos').notNull(),
    checkedInAt: sqliteCol.epochMs('checkedInAt').notNull(),
  },
  (t) => [
    uniqueIndex('duty_checkins_uniq').on(t.scheduleId, t.dutyDate, t.teacherId),
    index('duty_checkins_campus_date_idx').on(t.campusId, t.dutyDate),
    index('duty_checkins_teacher_idx').on(t.teacherId),
  ],
);

// ── 巡查记录（items 子表 JSON）──────────────────────────────────────
export const dutyInspections = sqliteTable(
  'dutyInspections',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    inspectorId: ref('inspectorId'),
    inspectDate: sqliteCol.text('inspectDate').notNull(),
    areaId: ref('areaId'),
    items: sqliteJson<unknown[]>('items').notNull(),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [index('duty_inspections_campus_date_idx').on(t.campusId, t.inspectDate)],
);

// ── 调班申请（工作流 + 叠加层）──────────────────────────────────────
export const dutySwaps = sqliteTable(
  'dutySwaps',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    type: sqliteCol.text('type').notNull(),
    applicantId: ref('applicantId'),
    applicantScheduleId: ref('applicantScheduleId'),
    applicantDate: sqliteCol.text('applicantDate').notNull(),
    targetId: ref('targetId'),
    targetScheduleId: optRef('targetScheduleId'),
    targetDate: sqliteCol.text('targetDate'),
    reason: sqliteCol.text('reason').notNull(),
    status: sqliteCol.text('status').notNull().default('pending'),
    reviewerId: optRef('reviewerId'),
    reviewComment: sqliteCol.text('reviewComment'),
    createdAt: sqliteCol.createdAt('createdAt'),
    reviewedAt: sqliteCol.epochMs('reviewedAt'),
  },
  (t) => [
    check('duty_swaps_type_check', sql`type IN (${sql.raw(sqlInList(SWAP_TYPES))})`),
    check('duty_swaps_status_check', sql`status IN (${sql.raw(sqlInList(SWAP_STATUSES))})`),
    index('duty_swaps_campus_status_idx').on(t.campusId, t.status),
    index('duty_swaps_applicant_idx').on(t.applicantId),
  ],
);

export const INSPECT_ITEM_STATUSES = INSPECT_STATUSES;

/** sqlite 值班域表集合 */
export const sqliteDutySchema = {
  dutyAreas,
  dutyLocations,
  dutyTimeSlots,
  dutySchedules,
  dutyCheckins,
  dutyInspections,
  dutySwaps,
};

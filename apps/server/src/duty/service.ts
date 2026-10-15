/**
 * 值班域 service —— 引擎(D2) + repo(D3) 的组合层。
 *
 * repo 只取行/写行、引擎只算不发 I/O，service 负责把两者粘起来产出业务能力：
 *  - getWeekMatrix：某周某校区的值班大表（展开模板 → 叠加调班 → 打卡状态 → 矩阵）
 *  - getTodayTasks：某教师今日执勤任务（打卡工作台）
 *  - getAttendance：到岗率统计（应到/实到，报表用）
 *
 * 这是「状态不持久化、实时计算」哲学的落点：矩阵/任务/统计都是查询时由引擎实时算，
 * DB 只存周期模板 + 打卡 + 已批准调班（叠加层），不存展开后的实例。
 */
import type { Repos } from '../repos/types.js';
import { expandWeek, expandSchedules } from './expand.js';
import { buildSwapOverlay, applySwapOverlay } from './swap-overlay.js';
import { buildScheduleDoneChecker } from './checkin-index.js';
import { buildMatrix, matrixSummary } from './matrix.js';
import { weekDates, mondayOf, dateKey, startOfDay, parseDate } from './date.js';
import type { DutyMatrix, DutyInstance, DutyKind, CheckinRow } from './types.js';

export interface DutyServiceDeps {
  repos: Repos;
}

export interface MatrixQuery {
  campusId: string;
  /** 周内任意一天（自动归一到周一）；缺省今天 */
  anchor?: Date;
  kind?: DutyKind;
  areaId?: string;
}

export interface MatrixView {
  matrix: DutyMatrix;
  summary: { total: number; done: number; pending: number; swapped: number };
  weekMonday: string;
}

/**
 * 校区级单双周锚点（REVIEW #4）——从 settings.semester_start 读，缺省 null（回退排班自身 dateStart）。
 *
 * 为什么必须统一：矩阵展开、打卡守卫、到岗率三处都调 expand；若各自用不同锚点，
 * 会出现「矩阵说今天你值班、打卡守卫说你不值班」的自相矛盾。故三处共用此锚点。
 * 管理员在系统设置里配 `semester_start`（YYYY-MM-DD）即可让全校单双周对齐。
 */
export async function resolveParityAnchor(repos: Repos, campusId: string): Promise<Date | undefined> {
  try {
    const map = await repos.settings.getMap(campusId);
    const s = map?.semester_start;
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return parseDate(s);
  } catch { /* 无设置表或读取失败 → 回退排班 dateStart */ }
  return undefined;
}

/**
 * 值班大表矩阵视图（核心）。
 * 组合：listForExpand(模板) → expandWeek(展开) → listApproved+buildSwapOverlay(叠加)
 *      → applySwapOverlay → listByCampusDate(打卡)+buildScheduleDoneChecker → buildMatrix。
 */
export async function getWeekMatrix(deps: DutyServiceDeps, q: MatrixQuery): Promise<MatrixView> {
  const { repos } = deps;
  const anchor = q.anchor ?? new Date();
  const monday = mondayOf(anchor);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fromKey = dateKey(monday);
  const toKey = dateKey(sunday);

  // 1. 取该周可能命中的排班模板（日期相交过滤）
  const templates = await repos.duty.schedules.listForExpand({
    campusId: q.campusId,
    kind: q.kind,
    areaId: q.areaId,
    dateFrom: fromKey,
    dateTo: toKey,
  });

  // 2. 展开成该周实例（单双周锚点：校区级 semester_start，REVIEW #4）
  const parityAnchor = await resolveParityAnchor(repos, q.campusId);
  const instances = expandWeek(templates, monday, { kind: q.kind, areaId: q.areaId, parityAnchor });

  // 3. 调班叠加层（已批准）
  const approvedSwaps = await repos.duty.swaps.listApproved(q.campusId);
  const overlay = buildSwapOverlay(approvedSwaps);

  // 4. 用户名映射（pill 显示 + swapHint）
  const users = await repos.users.list(q.campusId);
  const userNames = new Map<string, string>();
  for (const u of users) userNames.set(u.id, u.displayName);

  // 5. 应用叠加
  const effective = applySwapOverlay(instances, overlay, userNames);

  // 6. 打卡状态（该周范围）
  const checkins = await repos.duty.checkins.listByCampusDate(q.campusId, fromKey, toKey);
  const doneChecker = buildScheduleDoneChecker(checkins);

  // 7. 地点名映射
  const locs = await repos.duty.locations.listByCampus(q.campusId);
  const locationNames = new Map<string, string>();
  for (const l of locs) locationNames.set(l.id, l.name);

  // 8. 组装矩阵
  const matrix = buildMatrix(effective, doneChecker, {
    columns: weekDates(monday),
    today: anchor,
    userNames,
    locationNames,
  });

  return { matrix, summary: matrixSummary(matrix), weekMonday: fromKey };
}

export interface TodayTask {
  scheduleId: string;
  date: string;
  areaId: string;
  locationId: string | null;
  locationName: string;
  timeSlotName: string | null;
  kind: DutyKind;
  /** 本人是否已打卡 */
  checkedIn: boolean;
  checkinId?: string;
  /** 该班次是否经调班由本人接手（叠加后实际值班人是本人） */
  viaSwap: boolean;
  swapHint?: string;
}

/**
 * 某教师今日执勤任务（打卡工作台）。
 * 展开今日实例 → 叠加调班 → 筛「实际值班人含本人」的班次 → 标注是否已打卡。
 */
export async function getTodayTasks(deps: DutyServiceDeps, campusId: string, teacherId: string, date?: Date): Promise<TodayTask[]> {
  const { repos } = deps;
  const day = date ? startOfDay(date) : startOfDay(new Date());
  const dayKey = dateKey(day);

  const templates = await repos.duty.schedules.listForExpand({ campusId, dateFrom: dayKey, dateTo: dayKey });
  const instances = expandSchedules(templates, { from: day, to: day, parityAnchor: await resolveParityAnchor(repos, campusId) });

  const approvedSwaps = await repos.duty.swaps.listApproved(campusId);
  const users = await repos.users.list(campusId);
  const userNames = new Map<string, string>();
  for (const u of users) userNames.set(u.id, u.displayName);
  const effective = applySwapOverlay(instances, buildSwapOverlay(approvedSwaps), userNames);

  const checkins = await repos.duty.checkins.listByCampusDate(campusId, dayKey, dayKey);
  const doneChecker = buildScheduleDoneChecker(checkins);

  const locs = await repos.duty.locations.listByCampus(campusId);
  const locNames = new Map<string, string>();
  for (const l of locs) locNames.set(l.id, l.name);
  const slots = await repos.duty.timeSlots.listByCampus(campusId);
  const slotNames = new Map<string, string>();
  for (const s of slots) slotNames.set(s.id, s.name);

  const tasks: TodayTask[] = [];
  for (const inst of effective) {
    const assignees = inst.effectiveAssigneeIds ?? inst.assigneeIds;
    if (!assignees.includes(teacherId)) continue; // 只看本人实际要执勤的
    // 是否经调班接手（本人不在原名单、在叠加后名单）
    const viaSwap = Boolean(inst.swapApplied) && !inst.assigneeIds.includes(teacherId);
    const ck = doneChecker.get(inst.scheduleId, inst.date, teacherId);
    tasks.push({
      scheduleId: inst.scheduleId,
      date: inst.date,
      areaId: inst.areaId,
      locationId: inst.locationId,
      locationName: inst.locationId ? (locNames.get(inst.locationId) ?? '') : '',
      timeSlotName: inst.timeSlotId ? (slotNames.get(inst.timeSlotId) ?? null) : null,
      kind: inst.kind,
      checkedIn: Boolean(ck),
      checkinId: ck?.id,
      viaSwap,
      swapHint: inst.swapHint,
    });
  }
  return tasks;
}

export interface AttendanceStats {
  /** 应到人次（展开实例 × 实际值班人数） */
  scheduled: number;
  /** 实到人次（打卡数，精确到人） */
  checkedIn: number;
  /** 到岗率 0-1 */
  rate: number;
  /** 按教师明细 */
  byTeacher: { teacherId: string; teacherName: string; scheduled: number; checkedIn: number }[];
}

/**
 * 到岗率统计（值班统计报表）：应到（排班展开人次）vs 实到（打卡人次），精确到人。
 */
export async function getAttendance(deps: DutyServiceDeps, campusId: string, dateFrom: string, dateTo: string, kind?: DutyKind): Promise<AttendanceStats> {
  const { repos } = deps;
  const templates = await repos.duty.schedules.listForExpand({ campusId, kind, dateFrom, dateTo });
  const instances = expandSchedules(templates, { from: parseDate(dateFrom), to: parseDate(dateTo), kind, parityAnchor: await resolveParityAnchor(repos, campusId) });

  const approvedSwaps = await repos.duty.swaps.listApproved(campusId);
  const users = await repos.users.list(campusId);
  const userNames = new Map<string, string>();
  for (const u of users) userNames.set(u.id, u.displayName);
  const effective = applySwapOverlay(instances, buildSwapOverlay(approvedSwaps), userNames);

  const checkins = await repos.duty.checkins.listByCampusDate(campusId, dateFrom, dateTo);
  const doneChecker = buildScheduleDoneChecker(checkins);

  // 应到/实到按人聚合
  const schedCount = new Map<string, number>();
  const doneCount = new Map<string, number>();
  let scheduled = 0, checkedIn = 0;
  for (const inst of effective) {
    const assignees = inst.effectiveAssigneeIds ?? inst.assigneeIds;
    for (const uid of assignees) {
      scheduled++;
      schedCount.set(uid, (schedCount.get(uid) ?? 0) + 1);
      if (doneChecker.isCheckedIn(inst.scheduleId, inst.date, uid)) {
        checkedIn++;
        doneCount.set(uid, (doneCount.get(uid) ?? 0) + 1);
      }
    }
  }

  const byTeacher = Array.from(schedCount.keys()).map((uid) => ({
    teacherId: uid,
    teacherName: userNames.get(uid) ?? uid,
    scheduled: schedCount.get(uid) ?? 0,
    checkedIn: doneCount.get(uid) ?? 0,
  })).sort((a, b) => b.scheduled - a.scheduled);

  return { scheduled, checkedIn, rate: scheduled === 0 ? 0 : checkedIn / scheduled, byTeacher };
}

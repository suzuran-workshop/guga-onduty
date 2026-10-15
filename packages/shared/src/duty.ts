/**
 * 值班域 wire 契约类型 —— 前后端共享。
 *
 * 这些是 API 响应/请求的类型（前端页面消费），与 server 的 duty/service.ts + duty/types.ts
 * 返回结构对齐。「值班大表矩阵 / 打卡任务 / 调班 / 巡查 / 到岗率」都经此契约。
 *
 * ⚠ 与 server 内部引擎类型（DutyInstance/DutyScheduleRow）结构一致但独立声明——
 *   前端不跨 app 边界 import server 内部模块，shared 持有 wire 契约单一真源。
 */

/** 排班类型：teaching=教师执勤（拆分后唯一类型；保留类型别名供未来扩展） */
export type DutyKind = 'teaching';
export type WeekParity = 'everyweek' | 'odd' | 'even';
export type SwapType = 'swap' | 'proxy';
export type SwapStatus = 'pending' | 'approved' | 'rejected';
export type InspectStatus = 'present' | 'absent';
export type PillState = 'swapped' | 'done' | 'pending';

// ── 配置实体 ────────────────────────────────────────────────────────
export interface DutyArea {
  id: string; campusId: string; name: string; sortOrder: number;
}
export interface DutyLocation {
  id: string; campusId: string; areaId: string; name: string; areaName?: string;
}
export interface DutyTimeSlot {
  id: string; campusId: string; areaId: string; name: string;
  startMinute: number | null; endMinute: number | null; priority: number;
}

// ── 排班模板 ────────────────────────────────────────────────────────
export interface DutySchedule {
  id: string; campusId: string; kind: DutyKind; areaId: string;
  timeSlotId: string | null; locationId: string | null;
  dateStart: string; dateEnd: string; weekday: number; weekParity: WeekParity;
  countersign: number; assigneeIds: string[]; note: string | null;
  /** 管理列表附带 */
  areaName?: string; locationName?: string; timeSlotName?: string;
}

// ── 大表矩阵（核心视图）──────────────────────────────────────────────
export interface MatrixPill {
  userId: string;
  userName: string;
  state: PillState;
  swapHint?: string;
  scheduleId: string;
  date: string;
}
export interface MatrixCell {
  locationId: string | null;
  date: string;
  dateTs: number;
  pills: MatrixPill[];
  isToday: boolean;
}
export interface DutyMatrix {
  columns: { date: string; weekdayName: string; isToday: boolean }[];
  rows: { locationId: string | null; locationName: string; cells: MatrixCell[] }[];
}
export interface MatrixView {
  matrix: DutyMatrix;
  summary: { total: number; done: number; pending: number; swapped: number };
  weekMonday: string;
}

// ── 执勤打卡 ────────────────────────────────────────────────────────
export interface CheckinRecord {
  id: string; campusId: string; scheduleId: string; dutyDate: string;
  teacherId: string; locationName: string; timeSlotName: string | null;
  situation: string | null; photos: string[]; checkedInAt: number;
}
export interface TodayTask {
  scheduleId: string; date: string; areaId: string;
  locationId: string | null; locationName: string; timeSlotName: string | null;
  kind: DutyKind; checkedIn: boolean; checkinId?: string;
  viaSwap: boolean; swapHint?: string;
}

// ── 巡查 ────────────────────────────────────────────────────────────
export interface InspectionItem {
  locationName: string; teacherName: string; teacherId: string;
  status: InspectStatus; photoKeys: string[]; scheduleId: string; dutyDate: string;
}
export interface InspectionRecord {
  id: string; campusId: string; inspectorId: string; inspectDate: string;
  areaId: string; items: InspectionItem[]; createdAt: number;
}

// ── 调班 ────────────────────────────────────────────────────────────
export interface SwapRecord {
  id: string; campusId: string; type: SwapType;
  applicantId: string; applicantScheduleId: string; applicantDate: string;
  targetId: string; targetScheduleId: string | null; targetDate: string | null;
  reason: string; status: SwapStatus;
  reviewerId: string | null; reviewComment: string | null;
  createdAt: number; reviewedAt: number | null;
}

// ── 到岗率统计 ──────────────────────────────────────────────────────
export interface AttendanceStats {
  scheduled: number;
  checkedIn: number;
  rate: number;
  byTeacher: { teacherId: string; teacherName: string; scheduled: number; checkedIn: number }[];
}

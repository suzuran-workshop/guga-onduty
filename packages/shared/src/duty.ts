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

// ── 钉钉域（自 guga-onduty-w 移植的基建）────────────────────────────
// 与 server/src/schema/enums.ts 的 NOTIFICATION_KINDS / NOTIFICATION_STATUSES 单一真源对齐。

/** 通知种类（值班域收敛为通用工作通知；值周仓库的 record_deduction/weekly_report 不适用） */
export type NotificationKind = 'notice';

/**
 * 通知状态。⚠ `sent` 的判定不能只看 asyncsend_v2 的 errcode:0——那是「已受理」，
 * 发给不存在的 userid 也返 0；必须查 getsendresult 回执确认已投递才置 sent。
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** 钉钉通讯录联系人（本地缓存，源自组织通讯录，**不含家校通讯录**） */
export interface DingtalkContact {
  /** 钉钉 userid（企业内唯一，非本系统 users.id） */
  userId: string;
  unionId: string | null;
  name: string;
  mobile: string | null;
  title: string | null;
  avatarUrl: string | null;
  /** 所属部门 id 列表（同一人可属多部门） */
  deptIds: number[] | null;
  /** 部门名路径（冗余存储，展示用） */
  deptNames: string[] | null;
  syncedAt: number;
}

/** 通讯录写入入参（同步时用） */
export interface DingtalkContactInput {
  userId: string;
  unionId?: string | null;
  name: string;
  mobile?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  deptIds?: number[] | null;
  deptNames?: string[] | null;
  syncedAt: number;
}

/** 通讯录同步结果（管理员在设置里触发「引入整个组织通讯录」） */
export interface ContactsSyncResult {
  /** 本次写入/更新的联系人数 */
  synced: number;
  /** 拉到的部门数 */
  depts: number;
  /** 个别部门拉取失败（尽力而为，不中断整体） */
  truncated: boolean;
  errors: Array<{ deptId: number; message: string }>;
  /** 家校通讯录（本系统**不引入**；此处仅回报探测结果供管理员知情） */
  family: { included: false; reason: string };
  syncedAt: number;
}

/** 通知日志领域对象 */
export interface NotificationLog {
  id: string;
  campusId: string;
  /** 收件人本系统 users.id（可空：通讯录里的人可能还没有系统账号） */
  recipientUserId: string | null;
  /** 收件人钉钉 userid（推送实际目标） */
  recipientPlatformId: string;
  kind: NotificationKind;
  status: NotificationStatus;
  /** 预留列（接业务推送时启用，当前恒 null） */
  recordId: string | null;
  /** 预留列（当前恒 null） */
  week: string | null;
  title: string | null;
  /** 幂等键（需要防重复投递的通知填写） */
  dedupeKey: string | null;
  /** 钉钉 asyncsend_v2 的 task_id */
  providerTaskId: string | null;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
}

/** 通知入库入参 */
export interface NotificationLogInput {
  campusId: string;
  recipientUserId?: string | null;
  recipientPlatformId: string;
  kind: NotificationKind;
  recordId?: string | null;
  week?: string | null;
  title?: string | null;
  dedupeKey?: string | null;
}

/** 通知状态补丁（回执/失败回写） */
export interface NotificationLogPatch {
  status?: NotificationStatus;
  providerTaskId?: string | null;
  error?: string | null;
  sentAt?: number | null;
}

/**
 * 值班域纯函数引擎的类型契约（docs/DUTY-FUSION.md §3）。
 *
 * 这些类型是**引擎层的领域模型**，与 DB 行（schema）解耦：
 *  - DutyScheduleRow：repo 查出的排班模板行（camelCase，对齐 drizzle/rest 列名）。
 *  - DutyInstance：展开引擎产出的「具体日期排班实例」（不持久化，实时计算）。
 *  - SwapOverlay：调班叠加层（实际值班人映射）。
 *  - MatrixCell：大表矩阵单元格（地点×日期，含履职者 pill 三态）。
 *
 * 引擎全纯函数：输入这些类型 → 输出这些类型，无 I/O，可单测。
 */

/** weekday 约定：JS Date.getDay()（0=周日..6=周六） */
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 排班类型：teaching=教师执勤（拆分后唯一类型；保留类型别名供未来扩展） */
export type DutyKind = 'teaching';
export type WeekParity = 'everyweek' | 'odd' | 'even';
export type SwapType = 'swap' | 'proxy';
export type SwapStatus = 'pending' | 'approved' | 'rejected';
export type InspectStatus = 'present' | 'absent';

/** 排班模板行（repo 查出；assigneeIds 已反序列化为数组） */
export interface DutyScheduleRow {
  id: string;
  campusId: string;
  kind: DutyKind;
  areaId: string;
  timeSlotId: string | null;
  locationId: string | null;
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;
  weekday: Weekday;
  weekParity: WeekParity;
  countersign: number; // 0/1
  assigneeIds: string[]; // 被排班者 userId 数组（会签多人）
  note: string | null;
}

/** 展开后的排班实例（具体某天某时空由谁执勤）—— 不持久化 */
export interface DutyInstance {
  scheduleId: string;
  date: string;      // YYYY-MM-DD
  dateTs: number;    // 本地午夜 epoch（叠加 key 用）
  kind: DutyKind;
  campusId: string;
  areaId: string;
  timeSlotId: string | null;
  locationId: string | null;
  weekday: Weekday;
  weekdayName: string;
  countersign: boolean;
  /** 原始被排班者（叠加前） */
  assigneeIds: string[];
  /** 调班叠加后的实际值班人（applySwapOverlay 填充；缺省 = assigneeIds） */
  effectiveAssigneeIds?: string[];
  /** 叠加命中的调班信息（pill 悬浮提示「原X→Y」用） */
  swapApplied?: { type: SwapType; originalIds: string[] };
  /** 调班悬浮提示文案「原 X → Y（交换/代理）」（叠加命中时填充） */
  swapHint?: string;
  note: string | null;
}

/** 调班申请行（repo 查出，仅 status=approved 参与叠加） */
export interface SwapRow {
  id: string;
  campusId: string;
  type: SwapType;
  applicantId: string;
  applicantScheduleId: string;
  applicantDate: string; // YYYY-MM-DD（叠加生效日）
  targetId: string;
  targetScheduleId: string | null;
  targetDate: string | null;
  reason: string;
  status: SwapStatus;
  reviewerId: string | null;
  reviewComment: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

/** 打卡行（repo 查出） */
export interface CheckinRow {
  id: string;
  campusId: string;
  scheduleId: string;
  dutyDate: string;   // YYYY-MM-DD
  teacherId: string;  // 打卡人本人
  locationName: string;
  timeSlotName: string | null;
  situation: string | null;
  photos: string[];   // objectKey 数组
  checkedInAt: number;
}

/** 巡查子表项（dutyInspections.items 的元素） */
export interface InspectionItem {
  locationName: string;
  teacherName: string;
  teacherId: string;
  status: InspectStatus;
  photoKeys: string[];
  scheduleId: string;
  dutyDate: string;
}

/** 巡查行（repo 查出） */
export interface InspectionRow {
  id: string;
  campusId: string;
  inspectorId: string;
  inspectDate: string;
  areaId: string;
  items: InspectionItem[];
  createdAt: number;
}

// ── 大表矩阵视图（§3.4）──────────────────────────────────────────────

/** 履职者 pill 的三态（对齐外部 PRD：已换班/已执勤/未执勤） */
export type PillState = 'swapped' | 'done' | 'pending';

/** 矩阵单元格里的一个履职者 pill */
export interface MatrixPill {
  userId: string;
  userName: string;        // 实际值班人（叠加后）
  state: PillState;
  /** 调班悬浮提示「原X→Y（交换/代理）」 */
  swapHint?: string;
  scheduleId: string;
  date: string;
}

/** 矩阵单元格（地点 × 日期） */
export interface MatrixCell {
  locationId: string | null;
  date: string;
  dateTs: number;
  pills: MatrixPill[];
  isToday: boolean;
}

/** 大表矩阵（行=地点，列=一周 7 天） */
export interface DutyMatrix {
  /** 列：7 天日期（周一起） */
  columns: { date: string; weekdayName: string; isToday: boolean }[];
  /** 行：每地点 × 7 天单元格 */
  rows: { locationId: string | null; locationName: string; cells: MatrixCell[] }[];
}

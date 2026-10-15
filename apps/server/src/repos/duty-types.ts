/**
 * 值班域 repo 契约 —— db 无关接口（docs/DUTY-FUSION.md §4）。
 *
 * 分层原则：repo 只负责「取行/写行」，**不做展开/叠加/矩阵计算**——那些是 src/duty/* 纯函数引擎，
 * 由 service/route 层组合（repo 取模板行 → expandSchedules → applySwapOverlay → buildMatrix）。
 * 这样引擎可单测（已 31 绿），repo 只管数据。
 *
 * 复用 src/duty/types.ts 的领域类型（DutyScheduleRow/CheckinRow/InspectionRow/SwapRow），
 * 使 repo 产出直接喂给引擎，无中间转换。
 */
import type {
  DutyScheduleRow, DutyKind, SwapRow, SwapType, SwapStatus, CheckinRow, InspectionRow, InspectionItem,
} from '../duty/types.js';
import type { Pagination } from '@guga-onduty/shared';
import type { Paged } from './types.js';

// ── 配置实体（区域/地点/时段）────────────────────────────────────────
export interface DutyArea {
  id: string; campusId: string; name: string; sortOrder: number;
}
export interface DutyLocation {
  id: string; campusId: string; areaId: string; name: string;
  areaName?: string;
}
export interface DutyTimeSlot {
  id: string; campusId: string; areaId: string; name: string;
  startMinute: number | null; endMinute: number | null; priority: number;
}

export interface DutyAreaRepo {
  listByCampus(campusId: string): Promise<DutyArea[]>;
  findById(id: string): Promise<DutyArea | null>;
  create(input: { campusId: string; name: string; sortOrder?: number }): Promise<DutyArea>;
  update(id: string, input: { name: string; sortOrder?: number }): Promise<DutyArea | null>;
  remove(id: string): Promise<void>;
}

export interface DutyLocationRepo {
  listByCampus(campusId: string, areaId?: string): Promise<DutyLocation[]>;
  findById(id: string): Promise<DutyLocation | null>;
  create(input: { campusId: string; areaId: string; name: string }): Promise<DutyLocation>;
  update(id: string, input: { name: string; areaId?: string }): Promise<DutyLocation | null>;
  remove(id: string): Promise<void>;
}

export interface DutyTimeSlotRepo {
  listByCampus(campusId: string, areaId?: string): Promise<DutyTimeSlot[]>;
  findById(id: string): Promise<DutyTimeSlot | null>;
  create(input: { campusId: string; areaId: string; name: string; startMinute?: number | null; endMinute?: number | null; priority?: number }): Promise<DutyTimeSlot>;
  update(id: string, input: { name?: string; startMinute?: number | null; endMinute?: number | null; priority?: number }): Promise<DutyTimeSlot | null>;
  remove(id: string): Promise<void>;
}

// ── 排班模板 ────────────────────────────────────────────────────────
export interface DutyScheduleRepo {
  /** 供展开引擎：按校区/kind/区域取模板（可选与日期范围相交过滤，减少扫描） */
  listForExpand(filter: { campusId: string; kind?: DutyKind; areaId?: string; dateFrom?: string; dateTo?: string }): Promise<DutyScheduleRow[]>;
  /** 管理列表（带地点/区域名） */
  list(filter: { campusId: string; kind?: DutyKind; areaId?: string; page?: number; pageSize?: number }): Promise<Paged<DutyScheduleRow & { areaName?: string; locationName?: string; timeSlotName?: string }>>;
  findById(id: string): Promise<DutyScheduleRow | null>;
  create(input: Omit<DutyScheduleRow, 'id'> & { id?: string }): Promise<DutyScheduleRow>;
  update(id: string, input: Partial<Omit<DutyScheduleRow, 'id'>>): Promise<DutyScheduleRow | null>;
  remove(id: string): Promise<void>;
  /** Excel 导入：批量插入（事务），返回插入数 */
  bulkCreate(rows: (Omit<DutyScheduleRow, 'id'>)[]): Promise<number>;
}

// ── 执勤打卡 ────────────────────────────────────────────────────────
export interface DutyCheckinRepo {
  /** 创建打卡（UNIQUE(schedule,date,teacher) 冲突 → 抛，路由转 409「已打卡」） */
  create(input: Omit<CheckinRow, 'id' | 'checkedInAt'> & { checkedInAt?: number }): Promise<CheckinRow>;
  /** 某人某天/某范围的打卡（打卡工作台、日志报表） */
  listByTeacher(teacherId: string, opts?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<Paged<CheckinRow>>;
  /** 某校区某天全部打卡（矩阵 done 态、统计报表） */
  listByCampusDate(campusId: string, dateFrom: string, dateTo: string): Promise<CheckinRow[]>;
  findById(id: string): Promise<CheckinRow | null>;
}

// ── 巡查记录 ────────────────────────────────────────────────────────
export interface DutyInspectionRepo {
  create(input: { campusId: string; inspectorId: string; inspectDate: string; areaId: string; items: InspectionItem[] }): Promise<InspectionRow>;
  listByCampus(campusId: string, opts?: { areaId?: string; page?: number; pageSize?: number }): Promise<Paged<InspectionRow>>;
  findById(id: string): Promise<InspectionRow | null>;
}

// ── 调班申请 ────────────────────────────────────────────────────────
export interface DutySwapRepo {
  create(input: {
    campusId: string; type: SwapType; applicantId: string; applicantScheduleId: string; applicantDate: string;
    targetId: string; targetScheduleId?: string | null; targetDate?: string | null; reason: string;
  }): Promise<SwapRow>;
  /** 列表：我发起的 / 待我审的 / 全部（按角色） */
  list(filter: { campusId?: string; applicantId?: string; targetId?: string; status?: SwapStatus; page?: number; pageSize?: number }): Promise<Paged<SwapRow>>;
  findById(id: string): Promise<SwapRow | null>;
  /** 审批（仅 pending → approved/rejected），事务更新 + reviewedAt */
  review(id: string, reviewerId: string, decision: 'approved' | 'rejected', reviewComment?: string | null): Promise<SwapRow | null>;
  /** 供叠加引擎：某校区全部已批准调班（按 createdAt 升序） */
  listApproved(campusId: string): Promise<SwapRow[]>;
}

/** 值班域 repo 集合（挂在 Repos.duty 下） */
export interface DutyRepos {
  areas: DutyAreaRepo;
  locations: DutyLocationRepo;
  timeSlots: DutyTimeSlotRepo;
  schedules: DutyScheduleRepo;
  checkins: DutyCheckinRepo;
  inspections: DutyInspectionRepo;
  swaps: DutySwapRepo;
}

export type { Pagination };

/**
 * 打卡状态索引引擎（纯函数）—— docs/DUTY-FUSION.md §3.3。
 *
 * 吸收外部 PRD 的关键修复（自主实现）：
 *  - **打卡状态精确到人**：done 图 key = `scheduleId|date|teacherId`。
 *    会签格里 A 打卡不会把 B 也标绿（外部 PRD 的 P1「会签打卡状态串台」修复）。
 *  - **历史脏数据兜底**：无 teacherId 的老记录回退整格标记（cellDone），避免误显示为缺勤。
 *
 * 为什么用 scheduleId 维度（而非 locationId/timeSlotId）：CheckinRow 存的是
 * scheduleId + dutyDate + teacherId（locationName/timeSlotName 只是文本快照，非 id）。
 * matrix 层展开实例时天然带 scheduleId，故 scheduleId+date+teacherId 是最可靠的精确到人键。
 *
 * 纯函数：输入打卡行数组 → 输出 O(1) 查询器。
 */
import type { CheckinRow } from './types.js';

/** 精确到人的打卡 key */
export function personKey(scheduleId: string, date: string, teacherId: string): string {
  return `${scheduleId}|${date}|${teacherId}`;
}

/** 整格兜底 key（历史无 teacherId 的脏数据） */
export function cellKey(scheduleId: string, date: string): string {
  return `${scheduleId}|${date}`;
}

export interface ScheduleDoneChecker {
  /** 精确到人：会签格里 A 打卡不影响 B */
  isPersonDone(scheduleId: string, date: string, teacherId: string): boolean;
  /** 整格兜底（历史脏数据无 teacherId） */
  isCellDone(scheduleId: string, date: string): boolean;
  /** 综合：精确优先，回退整格 */
  isCheckedIn(scheduleId: string, date: string, teacherId: string): boolean;
  /** 取某人某排班某日的打卡行（详情用） */
  get(scheduleId: string, date: string, teacherId: string): CheckinRow | undefined;
  /** 打卡总数（统计用） */
  readonly size: number;
}

/** 从打卡行构建 O(1) 查询器 */
export function buildScheduleDoneChecker(checkins: CheckinRow[]): ScheduleDoneChecker {
  const byPerson = new Map<string, CheckinRow>();
  const cellDone = new Set<string>();

  for (const c of checkins) {
    if (c.teacherId) {
      byPerson.set(personKey(c.scheduleId, c.dutyDate, c.teacherId), c);
    } else {
      cellDone.add(cellKey(c.scheduleId, c.dutyDate));
    }
  }

  return {
    isPersonDone(scheduleId, date, teacherId) {
      return byPerson.has(personKey(scheduleId, date, teacherId));
    },
    isCellDone(scheduleId, date) {
      return cellDone.has(cellKey(scheduleId, date));
    },
    isCheckedIn(scheduleId, date, teacherId) {
      return this.isPersonDone(scheduleId, date, teacherId) || this.isCellDone(scheduleId, date);
    },
    get(scheduleId, date, teacherId) {
      return byPerson.get(personKey(scheduleId, date, teacherId));
    },
    get size() {
      return byPerson.size + cellDone.size;
    },
  };
}

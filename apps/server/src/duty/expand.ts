/**
 * 排班展开引擎（纯函数）—— 周期模板 → 具体日期的排班实例。
 *
 * 吸收外部 PRD 的设计哲学（「状态不持久化，实时计算」「排班模板+调班叠加=最终值班表」），
 * 但用本项目自己的纯函数 + 三轨 repo 重新实现，绝不照搬宜搭 oyd.jsx。
 *
 * 一条 DutySchedule（周期模板）= 「每周{weekday}、{timeSlot}、{location}、由{assignees}执勤，
 * {weekParity} 规则，在 [dateStart,dateEnd] 学期内生效」。展开 = 对日期范围内每个匹配日生成一个实例。
 *
 * 匹配规则（对齐外部 PRD recordMatchesCell，但自主实现）：
 *  1. date ∈ [dateStart, dateEnd]
 *  2. weekdayOf(date) === schedule.weekday
 *  3. 单双周：semesterWeekNo(date, parityAnchor) 的奇偶匹配 weekParity（parityAnchor 缺省=排班 dateStart，REVIEW #4 建议传校区级统一锚点）
 *  4. 会签：assigneeIds 多人 → 一个实例多履职者（不拆成多实例）
 */
import { DutyScheduleRow, DutyInstance, WEEKDAY_NAMES, DutyKind } from './types.js';
import { startOfDay, parseDate, dateKey, inDateRange, matchesParity } from './date.js';

export interface ExpandOptions {
  /** 展开的日期范围（含端点）。通常是某一周或自定义区间。 */
  from: Date;
  to: Date;
  /** 只展开某类排班；缺省全部 */
  kind?: DutyKind;
  /** 按区域过滤（缺省全部） */
  areaId?: string;
  /**
   * 单双周锚点（学期第 1 周的基准日）。REVIEW #4：
   * 缺省时回退到「每条排班自己的 dateStart」——但两条 odd 排班若 dateStart 不同，
   * 会对「哪周是奇数周」判断不一致，导致同张单周班表里排班错位（右人错周）。
   * 传入校区级统一锚点（settings.semester_start）可消除该不一致。
   */
  parityAnchor?: Date;
}

/**
 * 把一组周期排班模板展开成 [from, to] 内的具体排班实例。
 * 纯函数：无 I/O，输入模板数组 + 日期范围，输出实例数组。可单测（边界/单双周/会签）。
 *
 * @param schedules 排班模板（repo 查出的 DutyScheduleRow[]）
 * @returns 展开的实例，按 date 升序、同日内按 schedule 原序
 */
export function expandSchedules(schedules: DutyScheduleRow[], opts: ExpandOptions): DutyInstance[] {
  const from = startOfDay(opts.from);
  const to = startOfDay(opts.to);
  const out: DutyInstance[] = [];

  for (const s of schedules) {
    // 过滤器
    if (opts.kind && s.kind !== opts.kind) continue;
    if (opts.areaId && s.areaId !== opts.areaId) continue;

    const semStart = parseDate(s.dateStart);
    const semEnd = parseDate(s.dateEnd);
    // 单双周锚点：优先用校区级统一锚点（REVIEW #4），缺省回退排班自身 dateStart
    const parityAnchor = opts.parityAnchor ?? semStart;

    // 逐日扫描 [max(from,semStart), min(to,semEnd)]
    const cursor = new Date(Math.max(from.getTime(), startOfDay(semStart).getTime()));
    const upper = new Date(Math.min(to.getTime(), startOfDay(semEnd).getTime()));

    while (cursor.getTime() <= upper.getTime()) {
      if (matchesCell(cursor, s, parityAnchor)) {
        out.push(toInstance(s, cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // 按日期升序稳定排序（同日保持模板原序 —— Array.sort 在 V8 稳定）
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/** 单日 × 单模板是否匹配（weekday + 单双周） */
function matchesCell(date: Date, s: DutyScheduleRow, semesterStart: Date): boolean {
  if (date.getDay() !== s.weekday) return false;
  return matchesParity(date, semesterStart, s.weekParity);
}

/** 模板 + 具体日期 → 实例（会签多人不拆，assigneeIds 原样带上） */
function toInstance(s: DutyScheduleRow, date: Date): DutyInstance {
  return {
    scheduleId: s.id,
    date: dateKey(date),
    dateTs: startOfDay(date).getTime(),
    kind: s.kind,
    campusId: s.campusId,
    areaId: s.areaId,
    timeSlotId: s.timeSlotId ?? null,
    locationId: s.locationId ?? null,
    weekday: s.weekday,
    weekdayName: WEEKDAY_NAMES[s.weekday] ?? '',
    countersign: s.countersign === 1,
    // 原始被排班者（叠加层应用前）；effectiveAssigneeIds 由 applySwapOverlay 计算
    assigneeIds: Array.isArray(s.assigneeIds) ? s.assigneeIds : parseJsonArray(s.assigneeIds),
    note: s.note ?? null,
  };
}

/** JSON 列兜底解析（sqlite text / pg jsonb 都已由 drizzle 反序列化，rest 轨可能是字符串） */
function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/**
 * 便捷：展开「某一周」（周一起 7 天）的排班。大表矩阵/打卡工作台常用。
 */
export function expandWeek(schedules: DutyScheduleRow[], monday: Date, opts?: Omit<ExpandOptions, 'from' | 'to'>): DutyInstance[] {
  const from = new Date(monday);
  const to = new Date(monday);
  to.setDate(monday.getDate() + 6);
  return expandSchedules(schedules, { ...opts, from, to });
}

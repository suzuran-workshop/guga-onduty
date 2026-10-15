/**
 * 值班域日期工具（纯函数）—— 排班展开/单双周/周导航的日期计算单一真源。
 *
 * ⚠ 全部用**本地日历日**归一（startOfDay），避免外部 PRD 记录的 P2 bug：
 *   「日期区间比较隐性依赖本地午夜存储，UTC 存储会丢学期首末日」。
 * 周锚点：周一为一周之始（周日归上一周），对齐外部 PRD 的 goWeek 语义。
 * weekday 约定：JS Date.getDay()（0=周日..6=周六），排班表 weekday 字段同此。
 */

/** YYYY-MM-DD（本地日历日） */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地午夜 Date（不用 UTC，避免时区偏移丢日） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** 归一到本地午夜（去掉时分秒，用于日期比较） */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 该日期所在周的周一（本地午夜）。周日归上一周。 */
export function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  const dow = day.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // 周日回退 6 天到周一
  day.setDate(day.getDate() + diff);
  return day;
}

/** 两个本地日历日相差的整天数（b - a） */
export function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

/**
 * 学期第几周（1-based，周一锚点）。
 * week 1 = 含 semesterStart 的那一周。用于单双周判定。
 */
export function semesterWeekNo(date: Date, semesterStart: Date): number {
  const w0 = mondayOf(semesterStart);
  const w1 = mondayOf(date);
  return Math.floor(daysBetween(w0, w1) / 7) + 1;
}

/**
 * 单双周判定：某日期在给定 weekParity 规则下是否生效。
 *  - everyweek：恒真
 *  - odd：学期第奇数周（week%2===1）
 *  - even：学期第偶数周
 */
export function matchesParity(date: Date, semesterStart: Date, weekParity: 'everyweek' | 'odd' | 'even'): boolean {
  if (weekParity === 'everyweek') return true;
  const wk = semesterWeekNo(date, semesterStart);
  return weekParity === 'odd' ? wk % 2 === 1 : wk % 2 === 0;
}

/** 一周 7 天日期数组（从给定周的周一起，本地日历日） */
export function weekDates(anchor: Date): Date[] {
  const mon = mondayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

/** 周偏移导航：以 anchor 所在周为基准，偏移 off 周，返回该周 7 天 */
export function weekDatesOffset(anchor: Date, off: number): Date[] {
  const mon = mondayOf(anchor);
  mon.setDate(mon.getDate() + off * 7);
  return weekDates(mon);
}

/** date ∈ [start, end]（含端点，本地日历日比较） */
export function inDateRange(date: Date, start: Date, end: Date): boolean {
  const d = startOfDay(date).getTime();
  return d >= startOfDay(start).getTime() && d <= startOfDay(end).getTime();
}

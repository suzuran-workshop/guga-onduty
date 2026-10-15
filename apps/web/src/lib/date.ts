/**
 * 日期工具（前端）—— 与后端 src/duty/date.ts 口径一致（本地日历日）。
 *
 * 一律用**本地日历日**（startOfDay 归一），避免 UTC 存储丢学期首末日。
 */

/** YYYY-MM-DD（本地日历日，与后端 dateKey 一致） */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地午夜（不用 UTC，避免时区偏移丢日） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** 归一到本地午夜 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 该日期所在周的周一（周日归上一周）——与后端 mondayOf 一致 */
export function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  const dow = day.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  day.setDate(day.getDate() + diff);
  return day;
}

/** 以 anchor 所在周为基准偏移 off 周，返回该周周一 */
export function mondayOffset(anchor: Date, off: number): Date {
  const mon = mondayOf(anchor);
  mon.setDate(mon.getDate() + off * 7);
  return mon;
}

/** MM-DD 短格式（矩阵列头展示） */
export function shortDate(s: string): string {
  return s.slice(5);
}

/** 分钟数 → HH:mm（时段展示，480 → 08:00） */
export function minuteToHHmm(min: number | null): string {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** epoch 毫秒 → 本地时间字符串（打卡日志展示） */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('zh-CN', { hour12: false });
}

/** 到岗率 → 百分比字符串 */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

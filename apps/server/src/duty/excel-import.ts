/**
 * Excel 排班导入引擎 —— 「岗位×周几→教师」总表解析（自主实现，非照搬外部 PRD 的 Python openpyxl）。
 *
 * 功能需求（吸收外部 PRD 数据语义，docs/DUTY-FUSION.md §4）：
 *  - 解析长格式排班表：开始日期/结束日期/周内日/区域/时间段/值班地点/值班教师/单双周/会签模式。
 *  - Excel 序列日期 → YYYY-MM-DD（本地日历日，避免 UTC 偏移丢日）。
 *  - 周内日中文（周一~周日）→ weekday 数字（0=周日..6=周六）。
 *  - 教师姓名（多人 、，, 分隔）→ userId：靠通讯录同名匹配（displayName）；重名/未匹配收集为告警。
 *  - 区域/地点/时段：按名解析为 id，缺失则**自动创建**（叠加合并语义）。
 *  - 输出 DutyScheduleRow[]（不含 id，bulkCreate 事务批量插入）。
 *
 * ⚠ 只依赖 SheetJS(xlsx) 解析二维表；不复制外部 PRD 的合并单元格/行范围硬编码等实现细节。
 */
import * as XLSX from 'xlsx';
import type { DutyScheduleRow, WeekParity } from './types.js';
import { dateKey } from './date.js';

/**
 * Excel 序列号 → YYYY-MM-DD（1900 date system）。
 *
 * ⚠ 修复 REVIEW #5：旧实现用 `new Date(ms)`（UTC 瞬时）再读本地 getFullYear/Month/Date，
 *   在西区时区（UTC-x）会 off-by-one（UTC 午夜 = 本地前一日）。此处用 **UTC getter**
 *   读取（Excel 序列号本就是无时区的「日历日」计数），与部署时区无关，恒定正确。
 *
 * 已知边界：Excel 1900 系统有个历史 bug——它错误地把 1900 当闰年，序列号 60 = 虚构的
 *   1900-02-29。故序列号 < 60（即 1900-03-01 之前）本公式会差一天。值班排班日期恒为
 *   现代日期（序列号 ~46000），永不触及此边界，无需补偿（补偿反而会弄错现代日期）。
 */
export function excelSerialToDate(serial: number): string {
  // Excel epoch: 1899-12-30（补偿 1900 闰年 bug）；ms 为 UTC 午夜瞬时
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  // 用 UTC getter（序列号是纯日历日计数，不含时区语义）
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 单元格值 → YYYY-MM-DD（兼容 Excel 序列号 / 已是日期串 / Date） */
export function cellToDate(v: unknown): string {
  if (v instanceof Date) return dateKey(v);
  if (typeof v === 'number') return excelSerialToDate(v);
  const s = String(v ?? '').trim();
  // 已是 YYYY-MM-DD 或 YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return s;
}

const WEEKDAY_MAP: Record<string, number> = {
  周日: 0, 周天: 0, 星期日: 0, 星期天: 0,
  周一: 1, 星期一: 1, 周二: 2, 星期二: 2, 周三: 3, 星期三: 3,
  周四: 4, 星期四: 4, 周五: 5, 星期五: 5, 周六: 6, 星期六: 6,
};

/** 周内日中文 → 0-6（0=周日）；无法识别返回 -1 */
export function parseWeekday(v: unknown): number {
  const s = String(v ?? '').trim();
  if (WEEKDAY_MAP[s] !== undefined) return WEEKDAY_MAP[s];
  const n = Number(s);
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  return -1;
}

/** 单双周中文 → WeekParity */
export function parseParity(v: unknown): WeekParity {
  const s = String(v ?? '').trim();
  if (s.includes('奇') || s.toLowerCase() === 'odd') return 'odd';
  if (s.includes('偶') || s.toLowerCase() === 'even') return 'even';
  return 'everyweek';
}

/** 会签：是/否 → 0/1 */
export function parseCountersign(v: unknown): number {
  const s = String(v ?? '').trim();
  return s === '是' || s === '1' || s.toLowerCase() === 'true' || s.toLowerCase() === 'yes' ? 1 : 0;
}

/** 教师姓名串 → 姓名数组（、，,/ 空白 分隔） */
export function splitTeachers(v: unknown): string[] {
  return String(v ?? '')
    .split(/[、，,/\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 列名别名（容错不同表头写法） */
const COL_ALIASES: Record<string, string[]> = {
  dateStart: ['开始日期', '起始日期', '开始'],
  dateEnd: ['结束日期', '截止日期', '结束'],
  weekday: ['周内日', '星期', '周几'],
  area: ['区域', '年级组'],
  timeSlot: ['时间段', '时段', '值班时间'],
  location: ['值班地点', '地点', '岗位'],
  teacher: ['值班教师', '教师', '值班人'],
  weekParity: ['单双周', '周次'],
  countersign: ['会签模式', '会签'],
};

function resolveCol(header: string[], key: keyof typeof COL_ALIASES): number {
  const aliases = COL_ALIASES[key];
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] ?? '').trim();
    if (aliases.some((a) => h === a || h.includes(a))) return i;
  }
  return -1;
}

export interface ParsedRow {
  dateStart: string;
  dateEnd: string;
  weekday: number;
  areaName: string;
  timeSlotName: string;
  locationName: string;
  teacherNames: string[];
  weekParity: WeekParity;
  countersign: number;
  rowNo: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** 解析告警（无法识别的行、缺列等） */
  warnings: string[];
}

/**
 * 解析 Excel buffer → ParsedRow[]（纯解析，不碰 DB）。
 * 区域/地点/时段/教师都还是**名字**，由 importSchedulesFromExcel 解析成 id。
 */
export function parseScheduleExcel(buf: Uint8Array | Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  // 取第一个 sheet（或名为「值班排班表」的）
  const sheetName = wb.SheetNames.find((n) => n.includes('排班') || n.includes('值班')) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  if (raw.length === 0) return { rows, warnings: ['Excel 为空'] };

  // 找表头行（含「区域」或「值班地点」的行）
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const joined = raw[i].map(String).join('|');
    if (joined.includes('区域') || joined.includes('值班地点') || joined.includes('周内日')) { headerIdx = i; break; }
  }
  const header = raw[headerIdx].map((h: any) => String(h ?? '').trim());

  const ci = {
    dateStart: resolveCol(header, 'dateStart'),
    dateEnd: resolveCol(header, 'dateEnd'),
    weekday: resolveCol(header, 'weekday'),
    area: resolveCol(header, 'area'),
    timeSlot: resolveCol(header, 'timeSlot'),
    location: resolveCol(header, 'location'),
    teacher: resolveCol(header, 'teacher'),
    weekParity: resolveCol(header, 'weekParity'),
    countersign: resolveCol(header, 'countersign'),
  };

  // 必备列检查
  const required: (keyof typeof ci)[] = ['dateStart', 'dateEnd', 'weekday', 'area', 'location', 'teacher'];
  for (const k of required) {
    if (ci[k] < 0) warnings.push(`缺少必备列：${COL_ALIASES[k][0]}`);
  }
  if (warnings.length > 0) return { rows, warnings };

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    const areaName = String(r[ci.area] ?? '').trim();
    const teacherRaw = r[ci.teacher];
    // 跳过空行 / 脚注（无区域或无教师）
    if (!areaName || !teacherRaw || String(teacherRaw).trim() === '') continue;
    const weekday = parseWeekday(r[ci.weekday]);
    if (weekday < 0) { warnings.push(`第${i + 1}行 周内日无法识别：${r[ci.weekday]}，已跳过`); continue; }
    const dateStart = cellToDate(r[ci.dateStart]);
    const dateEnd = cellToDate(r[ci.dateEnd]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
      warnings.push(`第${i + 1}行 日期无法解析：${r[ci.dateStart]}~${r[ci.dateEnd]}，已跳过`);
      continue;
    }
    rows.push({
      dateStart, dateEnd, weekday,
      areaName,
      timeSlotName: ci.timeSlot >= 0 ? String(r[ci.timeSlot] ?? '').trim() : '',
      locationName: String(r[ci.location] ?? '').trim(),
      teacherNames: splitTeachers(teacherRaw),
      weekParity: ci.weekParity >= 0 ? parseParity(r[ci.weekParity]) : 'everyweek',
      countersign: ci.countersign >= 0 ? parseCountersign(r[ci.countersign]) : 0,
      rowNo: i + 1,
    });
  }

  return { rows, warnings };
}

/** 姓名 → userId 解析器（由调用方注入，通常查 users 表） */
export type NameResolver = (name: string) => string | undefined;

/**
 * ParsedRow[] → DutyScheduleRow[]（解析名字为 id）。
 * @param rows parseScheduleExcel 的结果
 * @param resolveArea 区域名 → id（缺失时调用方应先建）
 * @param resolveLocation 地点名 → id
 * @param resolveTimeSlot 时段名 → id（可空）
 * @param resolveTeacher 教师名 → userId
 * @param campusId 目标校区
 */
/** 区域限定的名字解析器（location/timeSlot 的唯一约束是 campusId+areaId+name，故需 areaId 上下文，REVIEW #6） */
export type ScopedNameResolver = (name: string, areaId: string) => string | undefined;

export function buildScheduleRows(
  rows: ParsedRow[],
  campusId: string,
  resolve: {
    area: NameResolver; location: ScopedNameResolver; timeSlot: ScopedNameResolver; teacher: NameResolver;
  },
  warnings: string[],
): Omit<DutyScheduleRow, 'id'>[] {
  const out: Omit<DutyScheduleRow, 'id'>[] = [];
  for (const r of rows) {
    const areaId = resolve.area(r.areaName);
    if (!areaId) { warnings.push(`第${r.rowNo}行 区域「${r.areaName}」未找到，已跳过`); continue; }
    // location/timeSlot 按 (name, areaId) 解析，避免同名地点跨区域被合并成一行
    const locationId = resolve.location(r.locationName, areaId);
    if (!locationId) { warnings.push(`第${r.rowNo}行 地点「${r.locationName}」未找到，已跳过`); continue; }
    const timeSlotId = r.timeSlotName ? (resolve.timeSlot(r.timeSlotName, areaId) ?? null) : null;
    const assigneeIds: string[] = [];
    for (const name of r.teacherNames) {
      const uid = resolve.teacher(name);
      if (uid) assigneeIds.push(uid);
      else warnings.push(`第${r.rowNo}行 教师「${name}」未在通讯录匹配，已忽略该人`);
    }
    if (assigneeIds.length === 0) { warnings.push(`第${r.rowNo}行 无有效教师，已跳过`); continue; }
    out.push({
      campusId, kind: 'teaching', areaId, timeSlotId, locationId,
      dateStart: r.dateStart, dateEnd: r.dateEnd, weekday: r.weekday as DutyScheduleRow['weekday'],
      weekParity: r.weekParity, countersign: r.countersign, assigneeIds, note: null,
    });
  }
  return out;
}

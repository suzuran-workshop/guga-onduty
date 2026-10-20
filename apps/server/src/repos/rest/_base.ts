/**
 * rest repo 共享基座 —— PostgREST（qw-pages 轨）的应用侧查询引擎。
 *
 * 为什么需要（docs §2.1）：homura RestTable 只有单表 select/insert/update/remove，
 * **无 join、无聚合、无 offset、无 count、无事务**。故 rest 轨在应用侧补偿：
 *  - join：先查主表页，再按外键批量查关联表（inArray 单次），JS 侧 map 拼接（避免 N+1）。
 *  - 聚合：全量拉相关行到 JS，reduce 计算（校内规模可接受；大表需 PostgREST 视图，见 MIGRATION §7）。
 *  - 分页：JS 侧 slice（先过滤+排序，再切页）；total = 过滤后数组长度。
 *  - 事务：无。多语句操作 best-effort 顺序执行 + 幂等设计（UNIQUE 冲突静默跳过）补偿。
 *
 * 列名 = camelCase（restSchemaFromPg 从 pg 元数据派生，与 drizzle 侧同名）。
 */
import type { RestDb, RestTable, RestRow, RestFilters } from '@homurajs/db';
import type { Pagination } from '@guga-onduty/shared';

export interface RestCtx {
  rest: RestDb;
}

/** 取表（带行类型） */
export function tbl<T extends RestRow = RestRow>(rest: RestDb, name: string): RestTable<T> {
  return rest.table<T>(name);
}

/** JS 侧分页（对齐 drizzle 的 limit/offset 语义） */
export function paginateRows<T>(rows: T[], page: number, pageSize: number): { data: T[]; pagination: Pagination } {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);
  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/**
 * 批量取关联行并按 id 建索引（join 用，单次 inArray 查询避免 N+1）。
 * @param table 关联表
 * @param keyCol 关联表的主键列名
 * @param ids 外键值集合（自动去重、过滤空值）
 * @returns Map<id, row>
 */
export async function indexByIds<T extends RestRow>(
  table: RestTable<T>,
  keyCol: string,
  ids: (string | null | undefined)[],
): Promise<Map<string, T>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  const map = new Map<string, T>();
  if (uniq.length === 0) return map;
  const rows = await table.select({ [keyCol]: uniq } as RestFilters);
  for (const r of rows) map.set(String((r as any)[keyCol]), r);
  return map;
}

/** 数值化（PostgREST 返回的 bigint/numeric 可能是 string） */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * timestamptz 列写入值：PostgREST 拒收 epoch number（400 / 22008 invalid_datetime_format），
 * 必须给 ISO 字符串。仅用于 pg 侧 timestamp with time zone 列（campuses/dutyInspections/dutySwaps.createdAt）；
 * epochMs(bigint) 列（checkedInAt/reviewedAt）仍写 Date.now() 数值。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * timestamptz 列读取归一：PostgREST 返回 ISO 字符串，wire 契约是 epoch ms number。
 * 数字直通；ISO 串 Date.parse；纯数字串 Number；无法解析 → 0。
 */
export function ts(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(String(v));
  return Number.isNaN(d) ? 0 : d;
}

/** JSON 列解析（rest 轨 JSON 列以 text 存，PostgREST 返回字符串或已解析对象，两者都兜底） */
export function jsonArr(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : null; } catch { return null; }
  }
  return null;
}

/** 生成 uuid（rest 轨 insert 需显式给 id，PostgREST 不一定有 default） */
export function uuid(): string {
  return crypto.randomUUID();
}

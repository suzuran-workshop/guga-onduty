/**
 * drizzle repo 共享基座 —— sqlite/pg 双方言复用同一份源码。
 *
 * 为什么用 `any` db：`Database = PgDatabase | SqliteDatabase` 是联合类型，
 * `db.select().from(table)` 无法静态匹配「db 方言 × table 方言」4 组合（2 个非法），
 * 故 homura 提供 DrizzleQueryable（全 any）让 repo「转型一次」。本基座在此基础上
 * 提供动态 where 构建、分页、epoch 数值化等领域助手，结果显式映射到 shared 类型保证类型安全。
 *
 * ⚠ 两条 P1 验收发现的硬约束（所有 drizzle repo 必须遵守）：
 *  1. select 对象里的 sql 片段不自动生成 AS 别名 → ORDER BY 必须重复完整表达式，不能引用字段 key。
 *  2. pg 严格要求 groupBy 含所有非聚合 select 列（sqlite 宽松）→ 一律按最严格的 pg 写全。
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Database, DrizzleQueryable } from '@homurajs/db';
import type { sqliteAuthTables } from '@homurajs/auth/tables';
import type { Tables } from '../../db/client.js';
import type { Pagination } from '@guga-onduty/shared';

/** auth SDK 5 表的规范类型（以 sqlite 侧为准；pg 侧装配时 cast，parity 保证列一致） */
export type AuthTables = typeof sqliteAuthTables;

export interface DrizzleCtx {
  /** 真实 drizzle 实例（联合类型，repo 内 as any 用其完整 query builder） */
  db: Database;
  /** 方言匹配的业务表对象（parity 保证 sqlite/pg 列名一致） */
  tables: Tables;
  /** 方言匹配的 auth SDK 表（users 身份锚点等；users-repo join 用） */
  authTables: AuthTables;
  /** 事务包装（统一 await，屏蔽 sqlite 同步 / pg 异步差异） */
  tx<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

/** 动态 where：把非空条件累积成 AND 链（复刻现有路由的动态拼接，但参数化） */
export function whereAll(conds: (SQL | undefined | false | null)[]): SQL | undefined {
  const valid = conds.filter((c): c is SQL => Boolean(c));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return and(...valid);
}

/** 可选 eq：值存在才生成条件 */
export function eqIf<T>(col: any, val: T | undefined | null): SQL | undefined {
  return val === undefined || val === null || val === '' ? undefined : eq(col, val as any);
}

/** 分页元数据 */
export function paginate(page: number, pageSize: number, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * node:sqlite 的 epochMs(bigint) / SUM(...) 可能返回 bigint 或 string；pg 返回 number。
 * 统一数值化，避免前端收到 "3" 或 3n。
 */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** COUNT(*) 表达式（双方言通用） */
export const countAll = sql<number>`COUNT(*)`;

/** queryable 便捷别名（少数只需最小接口的场景） */
export type Q = DrizzleQueryable;

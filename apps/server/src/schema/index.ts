/**
 * Schema 双方言装配入口 —— 单一真源。
 *
 *  - `pgSchema`     = pg 业务表 + auth SDK 6 表（pgAuthTables spread）
 *  - `sqliteSchema` = sqlite 业务表 + auth SDK 6 表（sqliteAuthTables spread）
 *
 * 启动期硬门禁 `assertSchemaParity(pgSchema, sqliteSchema)`：表名集合 / 列名集合 / 主键
 * 三者不一致即抛错，防止双方言 schema 漂移（见 @homurajs/db README）。
 */
import { assertSchemaParity } from '@homurajs/db';
import { pgAuthTables } from '@homurajs/auth/tables';
import { sqliteAuthTables } from '@homurajs/auth/tables';

import { pgBusinessSchema } from './pg.js';
import { sqliteBusinessSchema } from './sqlite.js';

/** pg 轨完整 schema（业务表 + auth 表） */
export const pgSchema = {
  ...pgBusinessSchema,
  ...pgAuthTables,
} as const;

/** sqlite 轨完整 schema（业务表 + auth 表） */
export const sqliteSchema = {
  ...sqliteBusinessSchema,
  ...sqliteAuthTables,
} as const;

// ── 启动期硬门禁：双方言 parity ──────────────────────────────────────
// 表名/列名/主键任一漂移即抛错（fail fast，不带病上线）。
assertSchemaParity(pgSchema, sqliteSchema);

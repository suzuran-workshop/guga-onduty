/**
 * Schema 三轨装配入口 —— 单一真源。
 *
 *  - `pgSchema`     = pg 业务表 + auth SDK 5 表（pgAuthTables spread）
 *  - `sqliteSchema` = sqlite 业务表 + auth SDK 5 表（sqliteAuthTables spread）
 *  - `restSchema`   = 由 pgSchema 派生（restSchemaFromPg，不手写第三份）
 *
 * 启动期硬门禁 `assertSchemaParity(pgSchema, sqliteSchema)`：表名集合 / 列名集合 / 主键
 * 三者不一致即抛错，防止双方言 schema 漂移（见 @homurajs/db README）。
 *
 * ⚠ storage 的 db 后端表（homura_files / homura_file_chunks）在 @homurajs/storage@26.10.15
 *   发布中缺失（./tables、./db 子路径文件未打进 dist —— 发包 bug）。本次用 local-fs 后端，
 *   不依赖这两张表，故不纳入 schema。若将来切 db 后端（qw-pages），需待该包修复后补入。
 */
import { assertSchemaParity, restSchemaFromPg } from '@homurajs/db';
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

/** rest 轨 schema（从 pg 元数据派生；列名 = PG 真实列名 = camelCase 属性名） */
export const restSchema = restSchemaFromPg(pgSchema);


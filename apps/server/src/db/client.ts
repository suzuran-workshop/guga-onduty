/**
 * 数据库客户端工厂 —— 三轨装配（sqlite / pg / rest）。
 *
 * 设计（见 docs/MIGRATION-HOMURA.md §2.1）：
 *  - sqlite / pg 共享一套 drizzle repo 源码：`DrizzleQueryable` 擦除 db 方言类型，
 *    表对象按方言运行时注入（pg 用 pgSchema、sqlite 用 sqliteSchema，parity 保证列名一致）。
 *  - rest 是另一套 API（RestTable.select/insert/update/remove），独立 repo 实现。
 *
 * 关键坑（P1 验收发现，所有 repo 必须遵守）：
 *  1. drizzle select 对象里的 sql 片段不自动生成 AS 别名 → ORDER BY 必须重复完整表达式，
 *     不能引用字段 key。
 *  2. pg 严格要求 groupBy 含所有非聚合 select 列（sqlite 宽松）→ 三轨按最严格的 pg 写。
 *  3. node:sqlite 的 $client 是同步 DatabaseSync；事务 `db.transaction(cb)` 的 cb 在
 *     sqlite 下同步执行、pg 下异步，故一律 `await db.transaction(async (tx) => {...})`。
 */
import { createDb, createRestDb, loadPostgrestEnv, runMigrations, isSqlite } from '@homurajs/db';
import type { Database, RestDb, DrizzleQueryable } from '@homurajs/db';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AppConfig } from '../config.js';
import { pgSchema } from '../schema/index.js';
import { sqliteSchema } from '../schema/index.js';
import * as pgTables from '../schema/pg.js';
import * as sqliteTables from '../schema/sqlite.js';

/**
 * 业务表集（drizzle 表对象的规范类型）。
 * 以 sqlite 表类型为规范（本地可端到端验证的主路径）；pg 表在装配时 cast 进来。
 * parity 门禁保证两套表的列名/主键完全一致，故同一份 repo 源码对方言无感。
 */
export type Tables = typeof sqliteTables;

/** drizzle 形态句柄（sqlite / pg 共用） */
export interface DrizzleHandle {
  kind: 'drizzle';
  db: Database;
  /** 转型一次：repo 层用此最小接口，方言无关 */
  queryable: DrizzleQueryable;
  tables: Tables;
  dialect: 'sqlite' | 'pg';
  /** 事务包装（统一 await，屏蔽 sqlite 同步 / pg 异步差异） */
  tx<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  /** 迁移目录（runMigrations 用） */
  migrationsDir: string;
}

/** rest 形态句柄（qw-pages） */
export interface RestHandle {
  kind: 'rest';
  rest: RestDb;
  dialect: 'rest';
}

export type DbHandle = DrizzleHandle | RestHandle;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 迁移目录：dist 与 src 布局下都指向 apps/server/drizzle/<dialect> */
function migrationsDir(dialect: 'sqlite' | 'pg'): string {
  // src/db/client.ts → ../../drizzle/<dialect>；dist/db/client.js → ../../drizzle/<dialect>
  return `${__dirname}/../../drizzle/${dialect}`;
}

/**
 * 按配置打开数据库。
 *  - dialect=sqlite：createDb + 建目录（data/）
 *  - dialect=pg：createDb（需 import '@homurajs/db/pg' 注册 driver，见 registerPgDriver 调用方）
 *  - dialect=rest：createRestDb（读 SUPABASE_URL + SUPABASE_ANON_KEY）
 * 不在此处跑迁移（迁移由 index.ts 启动流程显式调用，便于控制时机与 rest 轨跳过）。
 */
export async function openDatabase(cfg: AppConfig): Promise<DbHandle> {
  const dialect = cfg.get('dbDialect') as 'sqlite' | 'pg' | 'rest';

  if (dialect === 'rest') {
    const rest = createRestDb(loadPostgrestEnv(process.env));
    return { kind: 'rest', rest, dialect: 'rest' };
  }

  if (dialect === 'pg') {
    const url = cfg.get('databaseUrl');
    if (!url) throw new Error('DB_DIALECT=pg 需要 DATABASE_URL');
    // 副作用 import 注册 pg driver —— 仅此分支加载，保证 sqlite/rest 形态零 postgres 依赖
    await import('@homurajs/db/pg');
    const db = createDb({ dialect: 'pg', url });
    return drizzleHandle(db, 'pg');
  }

  // sqlite（默认）
  const path = cfg.get('dbPath');
  mkdirSync(dirname(path), { recursive: true });
  const db = createDb({ dialect: 'sqlite', path });
  return drizzleHandle(db, 'sqlite');
}

function drizzleHandle(db: Database, dialect: 'sqlite' | 'pg'): DrizzleHandle {
  const tables = (dialect === 'pg' ? pgTables : sqliteTables) as Tables;
  return {
    kind: 'drizzle',
    db,
    queryable: db as unknown as DrizzleQueryable,
    tables,
    dialect,
    migrationsDir: migrationsDir(dialect),
    tx: (fn) => (db as any).transaction(fn),
  };
}

/** 跑迁移（drizzle 轨）；rest 轨无 DDL 权限，由平台受控迁移预建，此处跳过 */
export async function migrate(handle: DbHandle): Promise<void> {
  if (handle.kind === 'rest') return; // rest 轨：表由部署期平台迁移建好
  await runMigrations(handle.db, handle.migrationsDir);
}

/** 探活（healthz check 用） */
export async function pingDb(handle: DbHandle): Promise<boolean> {
  try {
    if (handle.kind === 'rest') {
      await handle.rest.ping('campuses');
      return true;
    }
    if (isSqlite(handle.db)) {
      (handle.db as any).$client.prepare('SELECT 1').get();
      return true;
    }
    // pg：用 queryable 跑一条 select
    await (handle.queryable as any).select().from(handle.tables.campuses).limit(1);
    return true;
  } catch {
    return false;
  }
}

/** 关闭连接（优雅退出用；sqlite 关 $client，pg 由 postgres-js 池管理） */
export function closeDatabase(handle: DbHandle): void {
  if (handle.kind === 'drizzle' && isSqlite(handle.db)) {
    try {
      (handle.db as any).$client.close?.();
    } catch {
      /* 已关闭 */
    }
  }
}

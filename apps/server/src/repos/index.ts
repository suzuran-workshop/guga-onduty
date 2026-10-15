/**
 * repo 装配入口 —— 按数据形态派发（docs §2.1）。
 *
 *  - drizzle（sqlite/pg）：createDrizzleRepos，注入方言匹配的 tables + authTables。
 *  - rest（qw-pages）：createRestRepos（P4 实现）。
 *
 * 路由层只依赖 Repos 接口（repos/types.ts），不感知形态。
 */
import { pgAuthTables, sqliteAuthTables } from '@homurajs/auth/tables';
import * as pgTables from '../schema/pg.js';
import * as sqliteTables from '../schema/sqlite.js';
import type { DbHandle, Tables } from '../db/client.js';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { Repos } from './types.js';
import { createDrizzleRepos } from './drizzle/index.js';

export interface CreateReposOptions {
  /** users-repo 需要的 auth 依赖（PasswordProvider + UserStore） */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createRepos(handle: DbHandle, opts: CreateReposOptions): Repos {
  if (handle.kind === 'rest') {
    // P4：rest 轨 repo（PostgREST API，无 join/事务，聚合在 JS 侧）
    throw new Error('rest 轨 repo 尚未实现（P4）；qw-pages 形态待接入');
  }

  // drizzle 轨：按方言注入表对象（sqlite 用 sqliteTables/sqliteAuthTables，pg 用 pg*）
  const tables: Tables =
    handle.dialect === 'pg' ? (pgTables as unknown as Tables) : (sqliteTables as Tables);
  const authTables =
    handle.dialect === 'pg'
      ? (pgAuthTables as unknown as typeof sqliteAuthTables)
      : sqliteAuthTables;

  return createDrizzleRepos({
    db: handle.db,
    tables,
    authTables,
    tx: handle.tx,
    passwordProvider: opts.passwordProvider,
    userStore: opts.userStore,
  });
}

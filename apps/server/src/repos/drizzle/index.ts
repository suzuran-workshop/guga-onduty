/**
 * drizzle repo 装配 —— sqlite/pg 双方言共用这一份装配。
 *
 * ctx 由调用方（repos/index.ts）按方言注入 db + tables + authTables：
 *  - sqlite：tables = sqliteSchema 业务表，authTables = sqliteAuthTables
 *  - pg：tables = pgSchema 业务表，authTables = pgAuthTables
 * parity 门禁保证两套表列名/主键一致，故 repo 源码对方言无感。
 */
import type { Database } from '@homurajs/db';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { Tables } from '../../db/client.js';
import type { Repos } from '../types.js';
import type { DrizzleCtx, AuthTables } from './_base.js';

import { createCampusesRepo } from './campuses-repo.js';
import { createUsersRepo } from './users-repo.js';
import { createSettingsRepo } from './settings-repo.js';
import { createDutyRepos } from './duty-repo.js';

export interface CreateDrizzleReposOptions {
  db: Database;
  tables: Tables;
  authTables: AuthTables;
  tx<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  /** users-repo 需要的 auth 依赖（PasswordProvider + UserStore） */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createDrizzleRepos(opts: CreateDrizzleReposOptions): Repos {
  const ctx: DrizzleCtx = {
    db: opts.db,
    tables: opts.tables,
    authTables: opts.authTables,
    tx: opts.tx,
  };

  return {
    campuses: createCampusesRepo(ctx),
    users: createUsersRepo(ctx, { passwordProvider: opts.passwordProvider, userStore: opts.userStore }),
    settings: createSettingsRepo(ctx),
    duty: createDutyRepos(ctx),
  };
}

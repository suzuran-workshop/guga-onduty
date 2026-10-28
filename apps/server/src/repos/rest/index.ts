/**
 * rest repo 装配 —— qw-pages 轨（PostgREST API）。
 *
 * 签名对齐 drizzle/index.ts 的 createDrizzleRepos：handle 为 rest 形态句柄，
 * auth 依赖（PasswordProvider + UserStore）由调用方注入（bootstrap buildAuth 的 rest store 组合）。
 */
import type { RestDb } from '@homurajs/db';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { Repos } from '../types.js';

import { createCampusesRepo } from './campuses-repo.js';
import { createUsersRepo, type UsersRepoAuthDeps } from './users-repo.js';
import { createSettingsRepo } from './settings-repo.js';
import { createDutyRepos } from './duty-repo.js';
import {
  createRestDingtalkContactsRepo, createRestNotificationsRepo, createRestAppealTokensRepo,
} from './dingtalk-repo.js';

export interface CreateRestReposOptions {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createRestRepos(rest: RestDb, opts: CreateRestReposOptions): Repos {
  const authDeps: UsersRepoAuthDeps = {
    passwordProvider: opts.passwordProvider,
    userStore: opts.userStore,
  };
  return {
    campuses: createCampusesRepo({ rest }),
    users: createUsersRepo(rest, authDeps),
    settings: createSettingsRepo({ rest }),
    duty: createDutyRepos(rest),
    dingtalk: {
      contacts: createRestDingtalkContactsRepo({ rest }),
      notifications: createRestNotificationsRepo({ rest }),
      appealTokens: createRestAppealTokensRepo({ rest }),
    },
  };
}

/**
 * rest 轨种子（qw-pages）—— 幂等冷启动数据。
 *
 * 与 db/seed.ts（drizzle 轨）的差异：
 *  - 只种最小可用集：默认校区 + admin 用户（auth register + profile）+ semester_start 设置。
 *  - 幂等守卫：campuses 非空则跳过（与 drizzle 轨同一语义）。
 *  - admin 用户名/密码/昵称可经环境变量覆盖（SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD /
 *    SEED_ADMIN_DISPLAY_NAME；config.ts 未定义 SEED 键，故直接读 env，缺省与 drizzle 轨一致）。
 *
 * 由 bootstrap.ts 在 rest 形态时调用（qw-pages 无 DDL，表已由平台受控迁移预建）。
 */
import type { RestDb } from '@homurajs/db';
import { PasswordProvider, createRestUserStore, createRestPasswordStore } from '@homurajs/auth';
import { createRestRepos } from './index.js';

export interface SeedRestResult {
  /** true = 本次执行了种子；false = 已有数据跳过 */
  seeded: boolean;
  /** admin 用户 id（本次创建时返回） */
  adminUserId?: string;
  campusId?: string;
}

export async function seedRest(rest: RestDb): Promise<SeedRestResult> {
  // auth 依赖：与 auth/build.ts 的 rest 分支同构（PasswordProvider 跑在 rest 表上）
  const userStore = createRestUserStore(rest);
  const passwordStore = createRestPasswordStore(rest);
  const passwordProvider = new PasswordProvider({ userStore, passwordStore });
  const repos = createRestRepos(rest, { passwordProvider, userStore });

  // 幂等守卫：campuses 非空则跳过
  const existing = await repos.campuses.listAll();
  if (existing.length > 0) return { seeded: false };

  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || '123456';
  const adminDisplayName = process.env.SEED_ADMIN_DISPLAY_NAME || '系统管理员';

  // 默认校区
  const campus = await repos.campuses.create({ name: '默认校区', code: 'campus_01' });

  // admin 用户（auth register + profile；username 占用会抛 UsernameTakenError ——
  // 守卫已保证空库，此处直接抛给调用方即可）
  const admin = await repos.users.create({
    campusId: campus.id,
    username: adminUsername,
    password: adminPassword,
    displayName: adminDisplayName,
    role: 'admin',
  });

  // 设置：semester_start 驱动单双周锚点（缺省与 drizzle 轨种子一致）
  const semesterStart = process.env.SEED_SEMESTER_START || '2026-09-01';
  await repos.settings.upsertMany(campus.id, [{ key: 'semester_start', value: semesterStart }]);

  return { seeded: true, adminUserId: admin.id, campusId: campus.id };
}

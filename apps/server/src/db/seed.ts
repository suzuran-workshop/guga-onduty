/**
 * 种子数据 —— 冷启动测试数据（值班域）。
 *
 *  - 全部 id 为 uuid；用户经 users-repo.create（auth SDK register + scrypt 密码 + profile）。
 *  - 密码统一 123456（测试用）。
 *  - 幂等守卫：campuses 非空则跳过。
 *  - 显式 main() + import.meta 守卫（不 import 即执行）。
 *
 * 运行：pnpm db:seed（= tsx src/db/seed.ts）。
 */
import { loadConfig, createAppLogger } from '../config.js';
import { openDatabase, migrate, closeDatabase } from './client.js';
import { buildAuth } from '../auth/build.js';
import { createRepos } from '../repos/index.js';
import { pathToFileURL } from 'node:url';

export async function seed(): Promise<void> {
  const cfg = loadConfig();
  const logger = createAppLogger(cfg);
  const handle = await openDatabase(cfg);
  await migrate(handle);

  if (handle.kind === 'rest') {
    logger.warn('seed: rest 轨（qw-pages）种子待 P4 rest repo 就绪后支持');
    return;
  }

  const auth = buildAuth(handle, cfg, { secure: false, loginPath: '/login' });
  const R = createRepos(handle, { passwordProvider: auth.passwordProvider, userStore: auth.userStore });

  // 幂等守卫
  const existing = await R.campuses.listAll();
  if (existing.length > 0) {
    logger.info('Database already seeded, skipping.');
    closeDatabase(handle);
    return;
  }

  const PW = '123456';

  // ── 校区 ──
  const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
  const c2 = await R.campuses.create({ name: '第二校区', code: 'campus_02' });

  // ── 用户（auth register + profile）──
  const admin = await R.users.create({ campusId: c1.id, username: 'admin', password: PW, displayName: '系统管理员', role: 'admin' });
  const teacher1 = await R.users.create({ campusId: c1.id, username: 'teacher1', password: PW, displayName: '李老师', role: 'teacher', canInspect: 1 });
  const teacher2 = await R.users.create({ campusId: c1.id, username: 'teacher2', password: PW, displayName: '王老师', role: 'teacher' });
  await R.users.create({ campusId: c2.id, username: 'admin2', password: PW, displayName: '二校区管理员', role: 'admin' });
  const teacher3 = await R.users.create({ campusId: c2.id, username: 'teacher3', password: PW, displayName: '赵老师', role: 'teacher' });

  // ── 值班配置（区域 + 地点 + 时段）────────────────────────────────────
  const SEM_START = '2026-09-01';
  const SEM_END = '2027-01-31';

  // 区域（年级组维度）+ 地点（执勤岗位）：教学楼/校门口/操场——比班级更粗粒度的巡查对象
  const areaPrimary = await R.duty.areas.create({ campusId: c1.id, name: '小学部', sortOrder: 1 });
  const gateLoc = await R.duty.locations.create({ campusId: c1.id, areaId: areaPrimary.id, name: '校门口' });
  const bldgLoc = await R.duty.locations.create({ campusId: c1.id, areaId: areaPrimary.id, name: '教学楼A一层' });
  const yardLoc = await R.duty.locations.create({ campusId: c1.id, areaId: areaPrimary.id, name: '操场' });
  // 时段
  const allDay = await R.duty.timeSlots.create({ campusId: c1.id, areaId: areaPrimary.id, name: '全天值日', priority: 0 });
  await R.duty.timeSlots.create({ campusId: c1.id, areaId: areaPrimary.id, name: '早读', startMinute: 480, endMinute: 510, priority: 1 });

  // 教师执勤排班：teacher1 周一/周三 守校门口，teacher2 周二 守教学楼
  await R.duty.schedules.create({
    campusId: c1.id, kind: 'teaching', areaId: areaPrimary.id, locationId: gateLoc.id, timeSlotId: allDay.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 1, weekParity: 'everyweek', countersign: 0,
    assigneeIds: [teacher1.id], note: '周一校门口执勤',
  });
  await R.duty.schedules.create({
    campusId: c1.id, kind: 'teaching', areaId: areaPrimary.id, locationId: gateLoc.id, timeSlotId: allDay.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 3, weekParity: 'everyweek', countersign: 0,
    assigneeIds: [teacher1.id], note: '周三校门口执勤',
  });
  await R.duty.schedules.create({
    campusId: c1.id, kind: 'teaching', areaId: areaPrimary.id, locationId: bldgLoc.id, timeSlotId: allDay.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 2, weekParity: 'everyweek', countersign: 0,
    assigneeIds: [teacher2.id], note: '周二教学楼执勤',
  });
  // 会签示例：周五校门口两人同岗
  await R.duty.schedules.create({
    campusId: c1.id, kind: 'teaching', areaId: areaPrimary.id, locationId: gateLoc.id, timeSlotId: allDay.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 5, weekParity: 'everyweek', countersign: 1,
    assigneeIds: [teacher1.id, teacher2.id], note: '周五校门口双人执勤',
  });
  // 单双周示例：teacher2 奇数周巡查操场
  await R.duty.schedules.create({
    campusId: c1.id, kind: 'teaching', areaId: areaPrimary.id, locationId: yardLoc.id, timeSlotId: allDay.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 4, weekParity: 'odd', countersign: 0,
    assigneeIds: [teacher2.id], note: '单周四操场巡查',
  });

  // c2 也建一套（多校区隔离演示）：teacher3 南门执勤
  const areaC2 = await R.duty.areas.create({ campusId: c2.id, name: '中学部', sortOrder: 1 });
  const gateC2 = await R.duty.locations.create({ campusId: c2.id, areaId: areaC2.id, name: '南门' });
  const slotC2 = await R.duty.timeSlots.create({ campusId: c2.id, areaId: areaC2.id, name: '全天值日', priority: 0 });
  await R.duty.schedules.create({
    campusId: c2.id, kind: 'teaching', areaId: areaC2.id, locationId: gateC2.id, timeSlotId: slotC2.id,
    dateStart: SEM_START, dateEnd: SEM_END, weekday: 3, weekParity: 'everyweek', countersign: 0,
    assigneeIds: [teacher3.id], note: '二校区周三南门执勤',
  });

  // ── 设置：semester_start 驱动全校单双周锚点（resolveParityAnchor）──
  await R.settings.upsertMany(c1.id, [{ key: 'semester_start', value: SEM_START }]);
  await R.settings.upsertMany(c2.id, [{ key: 'semester_start', value: SEM_START }]);

  logger.info('Duty seed inserted: teaching 排班 + 单双周 + 会签示例');

  logger.info('Seed data inserted successfully.');
  console.log('Default passwords: 123456 for all users.');
  console.log('Accounts: admin, teacher1(领导巡查), teacher2 (campus 1)');
  console.log('Accounts: admin2, teacher3 (campus 2)');
  console.log(`admin user id: ${admin.id}`);

  closeDatabase(handle);
}

// 直接运行守卫（ESM 标准 idiom）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().catch((e) => {
    console.error('Seed 失败:', e);
    process.exit(1);
  });
}

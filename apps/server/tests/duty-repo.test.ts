/**
 * D3 验收：值班域 repo 端到端（经 createRepos 真实装配，sqlite）。
 * 覆盖：配置实体 CRUD、排班模板（listForExpand/bulkCreate 事务）、打卡（UNIQUE 防重）、
 *      巡查（items JSON 子表）、调班（create/review 仅 pending/listApproved）、campus 隔离。
 * repo 只验数据存取；展开/叠加/矩阵的算法正确性由 duty-engine.test.ts（31 绿）覆盖。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('dutyrepo');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

describe('配置实体（区域/地点/时段）', () => {
  it('区域 create + listByCampus', async () => {
    const R = h.booted.repos;
    const a = await R.duty.areas.create({ campusId: seed.c1.id, name: '一年级组', sortOrder: 1 });
    expect(a.id).toBeTruthy();
    const list = await R.duty.areas.listByCampus(seed.c1.id);
    expect(list.map((x) => x.name)).toContain('一年级组');
  });

  it('地点 create + listByCampus 带 areaName（join）', async () => {
    const R = h.booted.repos;
    const area = await R.duty.areas.create({ campusId: seed.c1.id, name: '小学部' });
    const loc = await R.duty.locations.create({ campusId: seed.c1.id, areaId: area.id, name: '校门口' });
    const list = await R.duty.locations.listByCampus(seed.c1.id);
    const found = list.find((x) => x.id === loc.id);
    expect(found?.areaName).toBe('小学部');
  });

  it('时段 create（startMinute/endMinute 可空）+ 按 priority 排序', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    await R.duty.timeSlots.create({ campusId: seed.c1.id, areaId: area.id, name: '早读', startMinute: 480, endMinute: 510, priority: 1 });
    await R.duty.timeSlots.create({ campusId: seed.c1.id, areaId: area.id, name: '全天值日', priority: 0 });
    const list = await R.duty.timeSlots.listByCampus(seed.c1.id);
    expect(list[0].name).toBe('全天值日'); // priority 0 在前
    expect(list.find((x) => x.name === '早读')?.startMinute).toBe(480);
  });

  it('campus 隔离：c2 看不到 c1 的区域', async () => {
    const R = h.booted.repos;
    const c1Areas = await R.duty.areas.listByCampus(seed.c1.id);
    const c2Areas = await R.duty.areas.listByCampus(seed.c2.id);
    expect(c1Areas.length).toBeGreaterThan(0);
    expect(c2Areas.length).toBe(0);
  });
});

describe('排班模板', () => {
  it('create + findById（assigneeIds JSON 往返）', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const loc = (await R.duty.locations.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, locationId: loc.id, timeSlotId: null,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: 3, weekParity: 'everyweek',
      countersign: 1, assigneeIds: [seed.teacher.id, seed.teacher2.id], note: null,
    });
    const found = await R.duty.schedules.findById(s.id);
    expect(found?.assigneeIds).toEqual([seed.teacher.id, seed.teacher2.id]); // JSON 数组往返
    expect(found?.countersign).toBe(1);
    expect(found?.weekday).toBe(3);
  });

  it('listForExpand 按 kind + 日期相交过滤', async () => {
    const R = h.booted.repos;
    const teaching = await R.duty.schedules.listForExpand({ campusId: seed.c1.id, kind: 'teaching' });
    expect(teaching.length).toBeGreaterThan(0);
    expect(teaching.every((s) => s.kind === 'teaching')).toBe(true);
    // 日期相交：查询范围与模板 [9/1,1/31] 无交集 → 空
    const none = await R.duty.schedules.listForExpand({ campusId: seed.c1.id, dateFrom: '2030-01-01', dateTo: '2030-06-01' });
    expect(none.length).toBe(0);
  });

  it('bulkCreate 事务批量（Excel 导入路径）', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const before = await R.duty.schedules.listForExpand({ campusId: seed.c1.id, kind: 'teaching' });
    const rows = Array.from({ length: 5 }, (_, i) => ({
      campusId: seed.c1.id, kind: 'teaching' as const, areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: (i % 5 + 1) as any, weekParity: 'everyweek' as const,
      countersign: 0, assigneeIds: [seed.teacher2.id], note: null,
    }));
    const n = await R.duty.schedules.bulkCreate(rows);
    expect(n).toBe(5);
    const after = await R.duty.schedules.listForExpand({ campusId: seed.c1.id, kind: 'teaching' });
    expect(after.length).toBe(before.length + 5); // 批量累加（叠加语义，不删旧）
  });

  it('update 部分字段 + remove', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 1, weekParity: 'odd', countersign: 0,
      assigneeIds: [seed.teacher.id], note: 'x',
    });
    const upd = await R.duty.schedules.update(s.id, { note: '改', weekParity: 'even' });
    expect(upd?.note).toBe('改');
    expect(upd?.weekParity).toBe('even');
    await R.duty.schedules.remove(s.id);
    expect(await R.duty.schedules.findById(s.id)).toBeNull();
  });
});

describe('执勤打卡（UNIQUE 防重 + 精确到人）', () => {
  it('create + listByTeacher', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 3, weekParity: 'everyweek', countersign: 0,
      assigneeIds: [seed.teacher.id], note: null,
    });
    const ck = await R.duty.checkins.create({
      campusId: seed.c1.id, scheduleId: s.id, dutyDate: '2026-09-02', teacherId: seed.teacher.id,
      locationName: '校门口', timeSlotName: '全天', situation: '一切正常', photos: ['k1', 'k2'],
    });
    expect(ck.photos).toEqual(['k1', 'k2']);
    const list = await R.duty.checkins.listByTeacher(seed.teacher.id);
    expect(list.data.map((x) => x.id)).toContain(ck.id);
  });

  it('同一 schedule+date+teacher 重复打卡 → UNIQUE 冲突（isUniqueViolation 可判）', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 4, weekParity: 'everyweek', countersign: 0,
      assigneeIds: [seed.teacher2.id], note: null,
    });
    await R.duty.checkins.create({
      campusId: seed.c1.id, scheduleId: s.id, dutyDate: '2026-09-03', teacherId: seed.teacher2.id,
      locationName: 'L', timeSlotName: null, situation: null, photos: ['k'],
    });
    // 第二次同人同排班同日 → 抛
    await expect(R.duty.checkins.create({
      campusId: seed.c1.id, scheduleId: s.id, dutyDate: '2026-09-03', teacherId: seed.teacher2.id,
      locationName: 'L', timeSlotName: null, situation: null, photos: ['k'],
    })).rejects.toThrow();
  });

  it('listByCampusDate 范围查询', async () => {
    const R = h.booted.repos;
    const rows = await R.duty.checkins.listByCampusDate(seed.c1.id, '2026-09-01', '2026-09-30');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.campusId === seed.c1.id)).toBe(true);
  });
});

describe('巡查记录（items JSON 子表）', () => {
  it('create + findById（items 往返，逐记录展开的多行）', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const items = [
      { locationName: '校门口', teacherName: '张老师', teacherId: seed.teacher.id, status: 'present' as const, photoKeys: ['p1'], scheduleId: 's-x', dutyDate: '2026-09-02' },
      { locationName: '教学楼', teacherName: '王老师', teacherId: seed.teacher2.id, status: 'absent' as const, photoKeys: [], scheduleId: 's-y', dutyDate: '2026-09-02' },
    ];
    const ins = await R.duty.inspections.create({
      campusId: seed.c1.id, inspectorId: seed.admin.id, inspectDate: '2026-09-02', areaId: area.id, items,
    });
    const found = await R.duty.inspections.findById(ins.id);
    expect(found?.items).toHaveLength(2);
    expect(found?.items[0].status).toBe('present');
    expect(found?.items[1].teacherId).toBe(seed.teacher2.id);
  });

  it('listByCampus 分页', async () => {
    const R = h.booted.repos;
    const list = await R.duty.inspections.listByCampus(seed.c1.id, { page: 1, pageSize: 10 });
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.pagination.page).toBe(1);
  });
});

describe('调班申请（工作流 + 叠加数据源）', () => {
  it('create（status=pending）+ list(applicantId)', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 2, weekParity: 'everyweek', countersign: 0,
      assigneeIds: [seed.teacher.id], note: null,
    });
    const sw = await R.duty.swaps.create({
      campusId: seed.c1.id, type: 'proxy', applicantId: seed.teacher.id, applicantScheduleId: s.id,
      applicantDate: '2026-09-08', targetId: seed.teacher2.id, reason: '有事',
    });
    expect(sw.status).toBe('pending');
    const mine = await R.duty.swaps.list({ applicantId: seed.teacher.id });
    expect(mine.data.map((x) => x.id)).toContain(sw.id);
    return { sw, s };
  });

  it('review：pending→approved，仅 pending 可改（重复审批不覆盖）', async () => {
    const R = h.booted.repos;
    const area = (await R.duty.areas.listByCampus(seed.c1.id))[0];
    const s = await R.duty.schedules.create({
      campusId: seed.c1.id, kind: 'teaching', areaId: area.id, timeSlotId: null, locationId: null,
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 5, weekParity: 'everyweek', countersign: 0,
      assigneeIds: [seed.teacher.id], note: null,
    });
    const sw = await R.duty.swaps.create({
      campusId: seed.c1.id, type: 'swap', applicantId: seed.teacher.id, applicantScheduleId: s.id,
      applicantDate: '2026-09-04', targetId: seed.teacher2.id, targetScheduleId: s.id, targetDate: '2026-09-05', reason: 'r',
    });
    const approved = await R.duty.swaps.review(sw.id, seed.admin.id, 'approved', '同意');
    expect(approved?.status).toBe('approved');
    expect(approved?.reviewerId).toBe(seed.admin.id);
    // 再次审批（已非 pending）→ WHERE status='pending' 不命中，状态不变
    const again = await R.duty.swaps.review(sw.id, seed.admin.id, 'rejected', '反悔');
    expect(again?.status).toBe('approved'); // 仍是 approved，未被覆盖
  });

  it('listApproved：只返回 approved（叠加层数据源）', async () => {
    const R = h.booted.repos;
    const approved = await R.duty.swaps.listApproved(seed.c1.id);
    expect(approved.every((s) => s.status === 'approved')).toBe(true);
    expect(approved.length).toBeGreaterThan(0);
    // 按 createdAt 升序（叠加后者覆盖前者的前提）
    const times = approved.map((s) => s.createdAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

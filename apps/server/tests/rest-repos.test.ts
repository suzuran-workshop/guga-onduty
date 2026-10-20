/**
 * rest 轨 repo 测试 —— mock-rest 内存 RestDb + 真实 createRestRepos + 真实 PasswordProvider。
 *
 * 覆盖：campuses CRUD、settings getMap/upsertMany 幂等、users create/list/update/findProfile/findMe、
 * duty 的 areas/locations/timeSlots/schedules CRUD + checkins 重复打卡冲突 + swaps review 仅 pending、
 * 以及 seedRest 幂等种子。语义基准 = drizzle 轨（duty-repo.test.ts / duty-http.test.ts）。
 */
import { describe, it, expect } from 'vitest';
import {
  PasswordProvider, createRestUserStore, createRestPasswordStore, UsernameTakenError,
} from '@homurajs/auth';
import { createMockRestDb } from './helpers/mock-rest.js';
import { createRestRepos } from '../src/repos/rest/index.js';
import { seedRest } from '../src/repos/rest/seed.js';
import { isUniqueViolation } from '../src/http/respond.js';

function setup() {
  const rest = createMockRestDb();
  const userStore = createRestUserStore(rest);
  const passwordStore = createRestPasswordStore(rest);
  const passwordProvider = new PasswordProvider({ userStore, passwordStore });
  const repos = createRestRepos(rest, { passwordProvider, userStore });
  return { rest, repos, userStore };
}

describe('rest campuses repo', () => {
  it('CRUD 全链路 + listAll 按 id 排序', async () => {
    const { repos } = setup();
    const c1 = await repos.campuses.create({ name: '第一校区', code: 'campus_01' });
    const c2 = await repos.campuses.create({ name: '第二校区', code: 'campus_02' });
    expect(c1.id).toBeTruthy();
    expect(c1.createdAt).toBeGreaterThan(0);

    const all = await repos.campuses.listAll();
    expect([...all.map((c) => c.code)].sort()).toEqual(['campus_01', 'campus_02']);

    expect((await repos.campuses.findById(c2.id))?.name).toBe('第二校区');
    expect((await repos.campuses.listForCampus(c1.id)).map((c) => c.id)).toEqual([c1.id]);

    const upd = await repos.campuses.update(c1.id, { name: '一校区', code: 'campus_01' });
    expect(upd?.name).toBe('一校区');
    expect(await repos.campuses.update('no-such-id', { name: 'x', code: 'x' })).toBeNull();

    await repos.campuses.remove(c2.id);
    expect(await repos.campuses.findById(c2.id)).toBeNull();
  });
});

describe('rest settings repo', () => {
  it('getMap + upsertMany 幂等（同 key 不重复插行）', async () => {
    const { rest, repos } = setup();
    const c = await repos.campuses.create({ name: '校区', code: 'k' });

    expect(await repos.settings.getMap(c.id)).toEqual({});

    await repos.settings.upsertMany(c.id, [
      { key: 'semester_start', value: '2026-09-01' },
      { key: 'foo', value: 'bar' },
    ]);
    expect(await repos.settings.getMap(c.id)).toEqual({ semester_start: '2026-09-01', foo: 'bar' });

    // 幂等：upsert 已存在的 key → update，不新增行
    await repos.settings.upsertMany(c.id, [{ key: 'semester_start', value: '2027-03-01' }]);
    expect(await repos.settings.getMap(c.id)).toEqual({ semester_start: '2027-03-01', foo: 'bar' });
    expect(rest._tables.get('settings')!.rows.length).toBe(2);
  });
});

describe('rest users repo', () => {
  it('create/list/update/findProfile/findMe', async () => {
    const { rest, repos, userStore } = setup();
    const c1 = await repos.campuses.create({ name: '一', code: 'c1' });
    const c2 = await repos.campuses.create({ name: '二', code: 'c2' });

    const admin = await repos.users.create({ campusId: c1.id, username: 'admin', password: 'p1', displayName: '管理员', role: 'admin' });
    const t1 = await repos.users.create({ campusId: c1.id, username: 'teacher1', password: 'p2', displayName: '李老师', role: 'teacher', canInspect: 1 });
    await repos.users.create({ campusId: c2.id, username: 'teacher2', password: 'p3', displayName: '王老师', role: 'teacher' });

    // username 占用 → UsernameTakenError
    await expect(repos.users.create({ campusId: c1.id, username: 'admin', password: 'x', displayName: 'x', role: 'admin' }))
      .rejects.toThrow(UsernameTakenError);

    // list：campus 过滤 + role 过滤；campusName 来自 join
    const listC1 = await repos.users.list(c1.id);
    expect(listC1.map((u) => u.username).sort()).toEqual(['admin', 'teacher1']);
    expect(listC1.find((u) => u.id === t1.id)).toMatchObject({ campusName: '一', displayName: '李老师', canInspect: 1 });
    expect((await repos.users.list(c1.id, 'admin')).map((u) => u.username)).toEqual(['admin']);
    expect((await repos.users.list()).length).toBe(3);

    // update：profile 变更 + nickname 同步到 auth users
    const upd = await repos.users.update(t1.id, { displayName: '李大老师', role: 'teacher', canInspect: 0 });
    expect(upd).toMatchObject({ displayName: '李大老师', canInspect: 0 });
    const authUser = (rest._tables.get('users')!.rows as any[]).find((r) => r.id === t1.id);
    expect(authUser.nickname).toBe('李大老师');

    // findProfile / findMe
    const prof = await repos.users.findProfile(admin.id);
    expect(prof).toMatchObject({ userId: admin.id, campusId: c1.id, role: 'admin' });
    const me = await repos.users.findMe(t1.id);
    expect(me!.user.username).toBe('teacher1');
    expect(me!.profile.displayName).toBe('李大老师');
    expect(me!.campusName).toBe('一');
    expect(await repos.users.findProfile('no-such')).toBeNull();
    expect(await repos.users.findMe('no-such')).toBeNull();

    // remove：auth 锚点 + profile 均删；username 释放可重建
    await repos.users.remove(t1.id);
    expect(await repos.users.findProfile(t1.id)).toBeNull();
    expect(userStore).toBeTruthy();
    await expect(repos.users.create({ campusId: c1.id, username: 'teacher1', password: 'p', displayName: '新李', role: 'teacher' }))
      .resolves.toMatchObject({ displayName: '新李' });
  });
});

describe('rest duty repos', () => {
  async function seedBase() {
    const { rest, repos } = setup();
    const campus = await repos.campuses.create({ name: '一', code: 'c1' });
    const teacher = await repos.users.create({ campusId: campus.id, username: 't1', password: 'p', displayName: '李', role: 'teacher' });
    const other = await repos.users.create({ campusId: campus.id, username: 't2', password: 'p', displayName: '王', role: 'teacher' });
    return { rest, repos, campus, teacher, other };
  }

  it('areas/locations/timeSlots CRUD + join areaName + 排序', async () => {
    const { repos, campus } = await seedBase();
    const a1 = await repos.duty.areas.create({ campusId: campus.id, name: '小学部', sortOrder: 2 });
    const a2 = await repos.duty.areas.create({ campusId: campus.id, name: '中学部', sortOrder: 1 });
    expect((await repos.duty.areas.listByCampus(campus.id)).map((a) => a.name)).toEqual(['中学部', '小学部']);
    expect((await repos.duty.areas.findById(a1.id))?.sortOrder).toBe(2);
    expect((await repos.duty.areas.update(a1.id, { name: '小学部A', sortOrder: 0 }))?.sortOrder).toBe(0);

    const l1 = await repos.duty.locations.create({ campusId: campus.id, areaId: a1.id, name: '校门口' });
    const l2 = await repos.duty.locations.create({ campusId: campus.id, areaId: a2.id, name: '南门' });
    const locs = await repos.duty.locations.listByCampus(campus.id);
    expect(locs.map((l) => l.name)).toEqual(['南门', '校门口']);
    expect(locs.find((l) => l.id === l1.id)?.areaName).toBe('小学部A');
    expect((await repos.duty.locations.listByCampus(campus.id, a2.id)).map((l) => l.id)).toEqual([l2.id]);
    expect((await repos.duty.locations.update(l1.id, { name: '北门' }))?.name).toBe('北门');

    const s1 = await repos.duty.timeSlots.create({ campusId: campus.id, areaId: a1.id, name: '早读', startMinute: 480, endMinute: 510, priority: 1 });
    await repos.duty.timeSlots.create({ campusId: campus.id, areaId: a1.id, name: '全天值日', priority: 0 });
    expect((await repos.duty.timeSlots.listByCampus(campus.id)).map((s) => s.name)).toEqual(['全天值日', '早读']);
    expect((await repos.duty.timeSlots.findById(s1.id))?.startMinute).toBe(480);
    expect((await repos.duty.timeSlots.update(s1.id, { priority: 5 }))?.priority).toBe(5);

    // remove 级联不做（repo 层只删自身行）
    await repos.duty.timeSlots.remove(s1.id);
    expect(await repos.duty.timeSlots.findById(s1.id)).toBeNull();
  });

  it('schedules CRUD + list join 名称 + 分页 + listForExpand 日期相交', async () => {
    const { repos, campus, teacher } = await seedBase();
    const area = await repos.duty.areas.create({ campusId: campus.id, name: '小学部' });
    const loc = await repos.duty.locations.create({ campusId: campus.id, areaId: area.id, name: '校门口' });
    const slot = await repos.duty.timeSlots.create({ campusId: campus.id, areaId: area.id, name: '全天值日' });

    for (const wd of [3, 1, 2]) {
      await repos.duty.schedules.create({
        campusId: campus.id, kind: 'teaching', areaId: area.id, locationId: loc.id, timeSlotId: slot.id,
        dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: wd, weekParity: 'everyweek',
        countersign: 0, assigneeIds: [teacher.id], note: `周${wd}`,
      });
    }
    // 不相交的旧学期排班（listForExpand 应排除）
    await repos.duty.schedules.create({
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateStart: '2020-01-01', dateEnd: '2020-07-01', weekday: 1, weekParity: 'everyweek',
      countersign: 0, assigneeIds: [], note: '旧学期',
    });

    // list：weekday 升序 + join 名称 + 分页
    const p1 = await repos.duty.schedules.list({ campusId: campus.id, page: 1, pageSize: 2 });
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(p1.data.map((r) => r.weekday)).toEqual([1, 1]);
    // 旧学期行（无地点/时段）排在最前：join 名字 undefined（对齐 leftJoin 语义）
    expect(p1.data[0].locationName).toBeUndefined();
    expect(p1.data[0].note).toBe('旧学期');
    const p2 = await repos.duty.schedules.list({ campusId: campus.id, page: 2, pageSize: 2 });
    expect(p2.data.map((r) => r.weekday)).toEqual([2, 3]);
    expect(p2.data[0]).toMatchObject({ areaName: '小学部', locationName: '校门口', timeSlotName: '全天值日' });

    // listForExpand：日期相交过滤（旧学期被排除）+ kind/areaId 过滤
    const expand = await repos.duty.schedules.listForExpand({
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateFrom: '2026-10-01', dateTo: '2026-10-15',
    });
    expect(expand.length).toBe(3);
    expect(expand.every((r) => r.assigneeIds.includes(teacher.id))).toBe(true);

    // update / findById / remove
    const sid = p2.data[0].id;
    const upd = await repos.duty.schedules.update(sid, { note: '改备注', countersign: 1 });
    expect(upd).toMatchObject({ note: '改备注', countersign: 1 });
    expect((await repos.duty.schedules.findById(sid))?.countersign).toBe(1);
    await repos.duty.schedules.remove(sid);
    expect(await repos.duty.schedules.findById(sid)).toBeNull();

    // bulkCreate
    const n = await repos.duty.schedules.bulkCreate([{
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: 5, weekParity: 'odd',
      countersign: 0, assigneeIds: [], note: null,
    }]);
    expect(n).toBe(1);
  });

  it('checkins：创建/查询 + 重复打卡抛唯一冲突错误', async () => {
    const { repos, campus, teacher, other } = await seedBase();
    const area = await repos.duty.areas.create({ campusId: campus.id, name: '小学部' });
    const sch = await repos.duty.schedules.create({
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: 1, weekParity: 'everyweek',
      countersign: 0, assigneeIds: [teacher.id],
    });

    const c1 = await repos.duty.checkins.create({
      campusId: campus.id, scheduleId: sch.id, dutyDate: '2026-10-12', teacherId: teacher.id,
      locationName: '校门口', timeSlotName: '全天值日', situation: '正常', photos: ['a.jpg'],
    });
    expect(c1.checkedInAt).toBeGreaterThan(0);
    expect(c1.photos).toEqual(['a.jpg']);

    // 重复打卡：冲突错误可被 isUniqueViolation 识别（路由转 409）
    await expect(repos.duty.checkins.create({
      campusId: campus.id, scheduleId: sch.id, dutyDate: '2026-10-12', teacherId: teacher.id,
      locationName: '校门口', photos: ['b.jpg'],
    })).rejects.toThrow(/UNIQUE constraint failed/);

    // 不同人/不同日期不冲突
    await expect(repos.duty.checkins.create({
      campusId: campus.id, scheduleId: sch.id, dutyDate: '2026-10-12', teacherId: other.id,
      locationName: '校门口', photos: [],
    })).resolves.toBeTruthy();

    // listByTeacher：日期范围过滤 + 倒序分页
    const page = await repos.duty.checkins.listByTeacher(teacher.id, {
      dateFrom: '2026-10-01', dateTo: '2026-10-31', page: 1, pageSize: 10,
    });
    expect(page.pagination.total).toBe(1);
    expect((await repos.duty.checkins.listByTeacher(other.id)).pagination.total).toBe(1);

    // listByCampusDate
    const all = await repos.duty.checkins.listByCampusDate(campus.id, '2026-10-12', '2026-10-12');
    expect(all.length).toBe(2);
    expect(await repos.duty.checkins.findById(c1.id)).toMatchObject({ situation: '正常' });
  });

  it('inspections：create + listByCampus', async () => {
    const { repos, campus, teacher } = await seedBase();
    const area = await repos.duty.areas.create({ campusId: campus.id, name: '小学部' });
    const insp = await repos.duty.inspections.create({
      campusId: campus.id, inspectorId: teacher.id, inspectDate: '2026-10-12', areaId: area.id,
      items: [{ locationName: '校门口', teacherName: '李', teacherId: teacher.id, status: '正常', photoKeys: [], scheduleId: 's', dutyDate: '2026-10-12' }],
    });
    expect(insp.items.length).toBe(1);
    expect((await repos.duty.inspections.findById(insp.id))?.inspectDate).toBe('2026-10-12');
    const page = await repos.duty.inspections.listByCampus(campus.id, { page: 1, pageSize: 10 });
    expect(page.pagination.total).toBe(1);
  });

  it('swaps：create/list/review 仅 pending 可改/listApproved 升序', async () => {
    const { repos, campus, teacher, other } = await seedBase();
    const area = await repos.duty.areas.create({ campusId: campus.id, name: '小学部' });
    const sA = await repos.duty.schedules.create({
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: 1, weekParity: 'everyweek',
      countersign: 0, assigneeIds: [teacher.id],
    });
    const sB = await repos.duty.schedules.create({
      campusId: campus.id, kind: 'teaching', areaId: area.id,
      dateStart: '2026-09-01', dateEnd: '2027-01-31', weekday: 2, weekParity: 'everyweek',
      countersign: 0, assigneeIds: [other.id],
    });

    const sw = await repos.duty.swaps.create({
      campusId: campus.id, type: 'swap', applicantId: teacher.id, applicantScheduleId: sA.id, applicantDate: '2026-10-12',
      targetId: other.id, targetScheduleId: sB.id, targetDate: '2026-10-13', reason: '有事',
    });
    expect(sw.status).toBe('pending');
    expect(sw.createdAt).toBeGreaterThan(0);

    // list 过滤
    expect((await repos.duty.swaps.list({ campusId: campus.id, status: 'pending' })).pagination.total).toBe(1);
    expect((await repos.duty.swaps.list({ applicantId: teacher.id })).pagination.total).toBe(1);
    expect((await repos.duty.swaps.list({ targetId: teacher.id })).pagination.total).toBe(0);

    // review 仅 pending：批准成功
    const approved = await repos.duty.swaps.review(sw.id, other.id, 'approved', '同意');
    expect(approved).toMatchObject({ status: 'approved', reviewerId: other.id, reviewComment: '同意' });
    expect(approved!.reviewedAt).toBeGreaterThan(0);

    // 再次 review：非 pending → 返回原值不变（对齐 drizzle WHERE status='pending' 语义）
    const again = await repos.duty.swaps.review(sw.id, teacher.id, 'rejected', '反悔');
    expect(again!.status).toBe('approved');
    expect(again!.reviewerId).toBe(other.id);
    expect(again!.reviewComment).toBe('同意');

    // 不存在的 swap → null
    expect(await repos.duty.swaps.review('no-such', other.id, 'approved')).toBeNull();

    // listApproved：升序（再建一条 approved）
    const sw2 = await repos.duty.swaps.create({
      campusId: campus.id, type: 'proxy', applicantId: other.id, applicantScheduleId: sB.id, applicantDate: '2026-10-14',
      targetId: teacher.id, reason: '病假',
    });
    await repos.duty.swaps.review(sw2.id, teacher.id, 'approved');
    const list = await repos.duty.swaps.listApproved(campus.id);
    expect(list.map((s) => s.id)).toEqual([sw.id, sw2.id]);
  });
});

describe('rest seedRest', () => {
  it('幂等：首次种入默认校区+admin+设置，二次跳过', async () => {
    const { rest, repos } = setup();
    const r1 = await seedRest(rest);
    expect(r1.seeded).toBe(true);
    expect(r1.adminUserId).toBeTruthy();

    const campuses = await repos.campuses.listAll();
    expect(campuses).toHaveLength(1);
    const admin = await repos.users.findProfile(r1.adminUserId!);
    expect(admin).toMatchObject({ role: 'admin' });
    expect(await repos.settings.getMap(r1.campusId!)).toEqual({ semester_start: '2026-09-01' });

    const r2 = await seedRest(rest);
    expect(r2.seeded).toBe(false);
    expect(await repos.campuses.listAll()).toHaveLength(1);
  });
});

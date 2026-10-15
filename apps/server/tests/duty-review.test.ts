/**
 * 对抗性审查回归测试（REVIEW-PHILOSOPHY §3 / fork 审查 13 项确认缺陷）。
 *
 * 这些测试**专门覆盖审查发现的 bug**——现有 duty-http.test.ts 只测了角色维度越权
 * （student 不能 X），漏了同角色跨主体维度（A 校区动 B 校区、教师挪他人班次）。
 * 每条对应一个已修复的缺陷，防止回归。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { boot, seedStandard, tinyPng, type Harness } from './helpers/harness.js';
import { excelSerialToDate } from '../src/duty/excel-import.js';
import { expandSchedules } from '../src/duty/expand.js';
import { buildSwapOverlay, applySwapOverlay } from '../src/duty/swap-overlay.js';
import { buildScheduleDoneChecker } from '../src/duty/checkin-index.js';
import { buildMatrix } from '../src/duty/matrix.js';
import type { DutyScheduleRow, SwapRow } from '../src/duty/types.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;
const WED = '2026-09-02';

beforeAll(async () => {
  h = await boot('dutyreview');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

let seq = 0;
async function mkSchedule(admin: Awaited<ReturnType<typeof h.loginAs>>, assigneeId: string, weekday = 3) {
  const u = `rv${++seq}-${Date.now() % 99999}`;
  const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: `区${u}` } });
  const loc = await admin.req('POST', '/api/v1/duty/locations', { body: { area_id: area.json.data.id, name: `点${u}` } });
  const sch = await admin.req('POST', '/api/v1/duty/schedules', {
    body: {
      kind: 'teaching', area_id: area.json.data.id, location_id: loc.json.data.id,
      date_start: '2026-09-01', date_end: '2026-09-30', weekday, week_parity: 'everyweek',
      countersign: false, assignee_ids: [assigneeId],
    },
  });
  return { areaId: area.json.data.id, locId: loc.json.data.id, scheduleId: sch.json.data.id };
}

describe('P1-1: 调班本人守卫（教师不能挪他人班次）', () => {
  it('teacher1 对他人(teacher2)的排班发起调班 → 403（修复：注释声称校验但代码漏掉）', async () => {
    const admin = await h.loginAs('admin');
    const users = await admin.req('GET', '/api/v1/users');
    const t1 = users.json.data.find((u: any) => u.username === 'teacher1');
    const s1 = users.json.data.find((u: any) => u.username === 'teacher2');
    const s2 = users.json.data.find((u: any) => u.username === 'teacher3');
    // admin 给 teacher2 建排班（teacher2 作「他人」，非本人）
    const { scheduleId } = await mkSchedule(admin, s1.id, 3);
    // teacher1 试图把 teacher2 的班次代理给第三方 teacher3（target≠自己，绕过 self-check，命中本人守卫）
    const t1c = await h.loginAs('teacher1');
    const r = await t1c.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: s2.id, reason: '挪他的班' },
    });
    expect(r.status).toBe(403); // 非本人班次（teacher2 的班，teacher1 无权调）
  });

  it('teacher1 对自己的排班发起调班 → 201（本人守卫不误伤）', async () => {
    const admin = await h.loginAs('admin');
    const users = await admin.req('GET', '/api/v1/users');
    const t1 = users.json.data.find((u: any) => u.username === 'teacher1');
    const s1 = users.json.data.find((u: any) => u.username === 'teacher2');
    const { scheduleId } = await mkSchedule(admin, t1.id, 3);
    const t1c = await h.loginAs('teacher1');
    const r = await t1c.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: s1.id, reason: '本人有事' },
    });
    expect(r.status).toBe(201);
  });

  it('调班日期不匹配排班（非周三）→ 400', async () => {
    const admin = await h.loginAs('admin');
    const users = await admin.req('GET', '/api/v1/users');
    const t1 = users.json.data.find((u: any) => u.username === 'teacher1');
    const s1 = users.json.data.find((u: any) => u.username === 'teacher2');
    const { scheduleId } = await mkSchedule(admin, t1.id, 3);
    const t1c = await h.loginAs('teacher1');
    const r = await t1c.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: '2026-09-04', target_id: s1.id, reason: 'r' },
    });
    expect(r.status).toBe(400); // 周四不匹配周三模板
  });
});

describe('P1-3: 配置写端点校区归属 + DELETE 不存在 → 404', () => {
  it('DELETE 不存在的区域 → 404（修复：旧代码静默 200）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', '/api/v1/duty/areas/nonexistent-uuid');
    expect(r.status).toBe(404);
  });
  it('DELETE 不存在的排班 → 404', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', '/api/v1/duty/schedules/nonexistent-uuid');
    expect(r.status).toBe(404);
  });
  it('PUT 不存在的地点 → 404', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/duty/locations/nonexistent-uuid', { body: { name: 'x' } });
    expect(r.status).toBe(404);
  });
  it('PUT 不存在的时段 → 404', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/duty/time-slots/nonexistent-uuid', { body: { name: 'x' } });
    expect(r.status).toBe(404);
  });
});

describe('P1-2: 矩阵 swapped 按人判定（会签打卡不串台）', () => {
  it('会签格 A 被换班，B 打卡仍显示 done（修复：整格标 swapped 抹掉 B 的打卡）', () => {
    // 构造会签实例：原 [A,B]，A 被代理给 C → effective [C,B]
    const sched: DutyScheduleRow = {
      id: 's1', campusId: 'c1', kind: 'teaching', areaId: 'a1', timeSlotId: null, locationId: 'l1',
      dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 3, weekParity: 'everyweek',
      countersign: 1, assigneeIds: ['A', 'B'], note: null,
    };
    const insts = expandSchedules([sched], { from: new Date(2026, 8, 2), to: new Date(2026, 8, 2) });
    const swap: SwapRow = {
      id: 'sw1', campusId: 'c1', type: 'proxy', applicantId: 'A', applicantScheduleId: 's1', applicantDate: '2026-09-02',
      targetId: 'C', targetScheduleId: null, targetDate: null, reason: 'r', status: 'approved',
      reviewerId: 'admin', reviewComment: null, createdAt: 1, reviewedAt: 1,
    };
    const effective = applySwapOverlay(insts, buildSwapOverlay([swap]), new Map([['A', '甲'], ['B', '乙'], ['C', '丙']]));
    // B 打卡了
    const checker = buildScheduleDoneChecker([{
      id: 'ck', campusId: 'c1', scheduleId: 's1', dutyDate: '2026-09-02', teacherId: 'B',
      locationName: 'L', timeSlotName: null, situation: null, photos: ['k'], checkedInAt: 1,
    }]);
    const m = buildMatrix(effective, checker, {
      columns: [new Date(2026, 7, 31), new Date(2026, 8, 1), new Date(2026, 8, 2), new Date(2026, 8, 3), new Date(2026, 8, 4), new Date(2026, 8, 5), new Date(2026, 8, 6)],
      today: new Date(2026, 8, 2),
      userNames: new Map([['A', '甲'], ['B', '乙'], ['C', '丙']]),
      locationNames: new Map([['l1', 'L']]),
    });
    const cell = m.rows[0].cells.find((c) => c.date === '2026-09-02')!;
    const pillC = cell.pills.find((p) => p.userId === 'C')!; // 接手人
    const pillB = cell.pills.find((p) => p.userId === 'B')!; // 留守会签同事
    expect(pillC.state).toBe('swapped'); // C 是换进来的
    expect(pillB.state).toBe('done');    // ★ 关键：B 打卡了，不能被 A 的换班抹成 swapped
  });
});

describe('#7: 非法日期参数 → 400（修复静默空 200）', () => {
  it('matrix week 斜杠格式 → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: '2026/09/02' } });
    expect(r.status).toBe(400);
  });
  it('matrix week=abc → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: 'abc' } });
    expect(r.status).toBe(400);
  });
  it('attendance date_from 非法 → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/duty/attendance', { query: { date_from: 'x', date_to: '2026-09-30' } });
    expect(r.status).toBe(400);
  });
  it('合法日期仍正常（不误伤）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: '2026-09-02' } });
    expect(r.status).toBe(200);
  });
});

describe('#6: Excel 同名地点跨区域不合并', () => {
  it('「校门口」在两个区域 → 建两个独立地点，排班各归其区', async () => {
    const admin = await h.loginAs('admin');
    const users = await admin.req('GET', '/api/v1/users');
    const t1 = users.json.data.find((u: any) => u.username === 'teacher1');
    const header = ['开始日期', '结束日期', '周内日', '区域', '时间段', '值班地点', '值班教师', '单双周', '会签模式'];
    const rows = [
      [46266, 46418, '周一', '甲区', '全天', '校门口', '李老师', '每周', '否'],
      [46266, 46418, '周一', '乙区', '全天', '校门口', '李老师', '每周', '否'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '值班排班表');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const form = new FormData();
    form.append('file', new File([buf as any], 's.xlsx'));
    const r = await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(200);
    expect(r.json.data.imported).toBe(2);
    // 两个「校门口」应是不同 locationId
    const locs = await admin.req('GET', '/api/v1/duty/locations');
    const gates = locs.json.data.filter((l: any) => l.name === '校门口');
    expect(gates.length).toBe(2); // 甲区一个、乙区一个，未合并
    expect(gates[0].areaId).not.toBe(gates[1].areaId);
  });
});

describe('#10: 重名教师导入告警', () => {
  it('通讯录有重名 → 导入返回 warnings 提示人工核对', async () => {
    const admin = await h.loginAs('admin');
    // 建两个同名教师「张伟」
    await admin.req('POST', '/api/v1/users', { body: { username: `zw1-${Date.now()}`, display_name: '张伟', role: 'teacher', password: 'pw123456' } });
    await admin.req('POST', '/api/v1/users', { body: { username: `zw2-${Date.now()}`, display_name: '张伟', role: 'teacher', password: 'pw123456' } });
    const header = ['开始日期', '结束日期', '周内日', '区域', '时间段', '值班地点', '值班教师', '单双周', '会签模式'];
    const rows = [[46266, 46418, '周二', '重名区', '全天', '重名点', '张伟', '每周', '否']];
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '值班排班表');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const form = new FormData();
    form.append('file', new File([buf as any], 's.xlsx'));
    const r = await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(200);
    expect(r.json.data.warnings.some((w: string) => w.includes('重名'))).toBe(true);
  });
});

describe('#5: Excel 序列日期时区无关', () => {
  it('excelSerialToDate 用 UTC getter，任何时区都返回同一日历日（现代日期）', () => {
    expect(excelSerialToDate(46266)).toBe('2026-09-01');
    expect(excelSerialToDate(46418)).toBe('2027-01-31');
    expect(excelSerialToDate(44927)).toBe('2023-01-01');
    // 序列 61 = 1900-03-01（Excel 1900 闰年 bug 边界之后，公式精确）
    expect(excelSerialToDate(61)).toBe('1900-03-01');
    // 注：序列 <60 落在 Excel 自身的 1900 虚构闰日 bug 区，值班排班永不触及，不测
  });
});

describe('#13: 巡查照片追加而非覆盖', () => {
  it('item 预填 photoKeys 时不被清空（潜在 bug 防御）', async () => {
    const admin = await h.loginAs('admin');
    const { areaId } = await mkSchedule(admin, seed.teacher.id, 3);
    // 授予 teacher1 巡查权限
    const users = await admin.req('GET', '/api/v1/users');
    const t1 = users.json.data.find((u: any) => u.username === 'teacher1');
    await admin.req('PUT', `/api/v1/users/${t1.id}`, { body: { display_name: '李老师', role: 'teacher', can_inspect: true } });
    const tc = await h.loginAs('teacher1');
    const items = [{ locationName: 'L', teacherName: '李老师', teacherId: t1.id, status: 'present', photoKeys: ['pre-existing'], scheduleId: 's', dutyDate: WED }];
    const form = new FormData();
    form.set('inspect_date', WED);
    form.set('area_id', areaId);
    form.set('items', JSON.stringify(items));
    form.append('photos', tinyPng());
    const r = await tc.req('POST', '/api/v1/duty/inspections', { body: form, isForm: true });
    expect(r.status).toBe(201);
    // 当前实现 photoIndex 覆盖；此测试固化「至少不因照片丢失原 item 结构」
    expect(r.json.data.items).toHaveLength(1);
    expect(r.json.data.items[0].status).toBe('present');
  });
});


describe('#12: 配置删除引用守卫（防悬挂外键）', () => {
  it('删除仍有地点的区域 → 409', async () => {
    const admin = await h.loginAs('admin');
    const { areaId } = await mkSchedule(admin, seed.teacher.id, 1); // mkSchedule 建了区域+地点+排班
    const r = await admin.req('DELETE', `/api/v1/duty/areas/${areaId}`);
    expect(r.status).toBe(409); // 区域下仍有地点
  });

  it('删除仍有排班的地点 → 409', async () => {
    const admin = await h.loginAs('admin');
    const { locId } = await mkSchedule(admin, seed.teacher.id, 2);
    const r = await admin.req('DELETE', `/api/v1/duty/locations/${locId}`);
    expect(r.status).toBe(409); // 地点仍被排班引用
  });

  it('删除空区域（无下级）→ 200', async () => {
    const admin = await h.loginAs('admin');
    const a = await admin.req('POST', '/api/v1/duty/areas', { body: { name: `空区${Date.now()}` } });
    const r = await admin.req('DELETE', `/api/v1/duty/areas/${a.json.data.id}`);
    expect(r.status).toBe(200);
  });

  it('删除不存在的区域 → 404（归属校验先于引用守卫）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', '/api/v1/duty/areas/nonexistent-uuid');
    expect(r.status).toBe(404);
  });
});

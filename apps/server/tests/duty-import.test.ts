/**
 * D5 验收：Excel 排班导入端到端（真实 HTTP + SheetJS 生成 xlsx）。
 *
 * 覆盖外部 PRD「排班导入」功能语义的自有实现：
 *  - 长格式表解析（开始/结束日期 Excel 序列号、周内日中文、区域/时段/地点、教师多人、单双周、会签）。
 *  - 缺失区域/地点/时段自动创建（叠加合并）。
 *  - 教师姓名同名匹配通讯录；未匹配收集告警不阻断。
 *  - 事务批量插入 → 导入后矩阵可展开。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { boot, seedStandard, type Harness } from './helpers/harness.js';
import { excelSerialToDate, parseWeekday, splitTeachers, parseParity } from '../src/duty/excel-import.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('dutyimport');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

/** 生成一个长格式排班 xlsx buffer（对齐真实 04_值班排班表.xlsx 结构） */
function makeXlsx(rows: any[][]): Uint8Array {
  const header = ['开始日期', '结束日期', '周内日', '区域', '时间段', '值班地点', '值班教师', '单双周', '会签模式'];
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '值班排班表');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

describe('Excel 解析纯函数', () => {
  it('excelSerialToDate：46266 → 2026-09-01', () => {
    expect(excelSerialToDate(46266)).toBe('2026-09-01');
    expect(excelSerialToDate(46418)).toBe('2027-01-31');
  });
  it('parseWeekday：中文 → 数字（0=周日）', () => {
    expect(parseWeekday('周一')).toBe(1);
    expect(parseWeekday('周五')).toBe(5);
    expect(parseWeekday('周日')).toBe(0);
    expect(parseWeekday('星期三')).toBe(3);
    expect(parseWeekday('无效')).toBe(-1);
  });
  it('splitTeachers：、，,/ 空白 分隔多人', () => {
    expect(splitTeachers('张三、李四,王五')).toEqual(['张三', '李四', '王五']);
    expect(splitTeachers('张三')).toEqual(['张三']);
    expect(splitTeachers('')).toEqual([]);
  });
  it('parseParity：奇/偶/每周', () => {
    expect(parseParity('奇数周')).toBe('odd');
    expect(parseParity('偶数周')).toBe('even');
    expect(parseParity('每周')).toBe('everyweek');
  });
});

describe('Excel 导入 HTTP 端点', () => {
  it('admin 导入 → 自动建区域/地点/时段 + 匹配教师 + 批量插入排班', async () => {
    const admin = await h.loginAs('admin');
    // seed 里 teacher1=李老师、teacher2=王老师。用真实姓名匹配。
    const xlsx = makeXlsx([
      // 46266=2026-09-01, 46418=2027-01-31
      [46266, 46418, '周一', '一年级组', '全天值日', '乐学楼一层', '李老师', '每周', '否'],
      [46266, 46418, '周三', '一年级组', '全天值日', '乐学楼一层', '王老师', '每周', '否'],
      [46266, 46418, '周五', '二年级组', '早读', '学校南门', '李老师、王老师', '每周', '是'], // 会签多人
    ]);
    const form = new FormData();
    form.append('file', new File([xlsx as any], 'schedule.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const r = await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(200);
    expect(r.json.data.parsed).toBe(3);
    expect(r.json.data.imported).toBe(3);
    expect(r.json.data.skipped).toBe(0);

    // 自动创建了区域（一年级组/二年级组）、地点（乐学楼一层/学校南门）、时段（全天值日/早读）
    const areas = await admin.req('GET', '/api/v1/duty/areas');
    const areaNames = areas.json.data.map((a: any) => a.name);
    expect(areaNames).toContain('一年级组');
    expect(areaNames).toContain('二年级组');
    const locs = await admin.req('GET', '/api/v1/duty/locations');
    const locNames = locs.json.data.map((l: any) => l.name);
    expect(locNames).toContain('乐学楼一层');
    expect(locNames).toContain('学校南门');
  });

  it('导入后排班可在矩阵展开（周一/周三/周五命中）', async () => {
    const admin = await h.loginAs('admin');
    // 2026-08-31 周一那一周
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: '2026-09-02' } });
    expect(m.status).toBe(200);
    // 会签行（周五 李老师+王老师）应产生 2 个 pill 在同一格
    const friCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === '2026-09-04');
    const friPills = m.json.data.matrix.rows.flatMap((row: any) => row.cells[friCol].pills);
    expect(friPills.length).toBeGreaterThanOrEqual(2); // 会签多人
  });

  it('教师姓名未匹配 → 告警但不阻断（该行忽略该教师）', async () => {
    const admin = await h.loginAs('admin');
    const xlsx = makeXlsx([
      [46266, 46418, '周二', '测试区', '全天', '测试点', '不存在的人', '每周', '否'],
    ]);
    const form = new FormData();
    form.append('file', new File([xlsx as any], 's.xlsx'));
    const r = await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(200);
    expect(r.json.data.imported).toBe(0); // 无有效教师 → 跳过
    expect(r.json.data.skipped).toBe(1);
    expect(r.json.data.warnings.some((w: string) => w.includes('不存在的人'))).toBe(true);
  });

  it('teacher2（非 admin）不能导入（403）', async () => {
    const stu = await h.loginAs('teacher2');
    const xlsx = makeXlsx([[46266, 46418, '周一', 'x', 'y', 'z', '李老师', '每周', '否']]);
    const form = new FormData();
    form.append('file', new File([xlsx as any], 's.xlsx'));
    const r = await stu.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(403);
  });

  it('缺 file → 400', async () => {
    const admin = await h.loginAs('admin');
    const form = new FormData();
    const r = await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    expect(r.status).toBe(400);
  });

  it('叠加语义：二次导入不删旧排班（累加）', async () => {
    const admin = await h.loginAs('admin');
    const before = await admin.req('GET', '/api/v1/duty/schedules', { query: { pageSize: 500 } });
    const n1 = before.json.pagination.total;
    const xlsx = makeXlsx([[46266, 46418, '周四', '叠加区', '全天', '叠加点', '李老师', '每周', '否']]);
    const form = new FormData();
    form.append('file', new File([xlsx as any], 's.xlsx'));
    await admin.req('POST', '/api/v1/duty/schedules/import', { body: form, isForm: true });
    const after = await admin.req('GET', '/api/v1/duty/schedules', { query: { pageSize: 500 } });
    expect(after.json.pagination.total).toBe(n1 + 1); // 累加，非替换
  });
});

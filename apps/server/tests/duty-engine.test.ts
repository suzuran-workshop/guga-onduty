/**
 * D2 验收：值班域纯函数引擎单测。
 *
 * 证明从外部 PRD 吸收并**自主重实现**的核心算法行为正确（非照搬）：
 *  - 排班展开：周期模板 → 具体日期实例（weekday + 日期区间匹配）
 *  - 单双周：odd/even/everyweek 的学期周奇偶判定
 *  - 调班叠加：代理(单向)/交换(双向)/按具体日期命中/后者覆盖前者/不回改原模板
 *  - 打卡精确到人：会签格 A 打卡不影响 B（外部 PRD 的 P1 串台修复）
 *  - 矩阵三态 pill：swapped/done/pending
 */
import { describe, it, expect } from 'vitest';
import { parseDate, dateKey, mondayOf, semesterWeekNo, matchesParity, weekDates, inDateRange } from '../src/duty/date.js';
import { expandSchedules, expandWeek } from '../src/duty/expand.js';
import { buildSwapOverlay, applySwapOverlay, swapKey } from '../src/duty/swap-overlay.js';
import { buildScheduleDoneChecker } from '../src/duty/checkin-index.js';
import { buildMatrix, matrixSummary } from '../src/duty/matrix.js';
import type { DutyScheduleRow, SwapRow, CheckinRow } from '../src/duty/types.js';

/** 造一条排班模板（默认每周三、每周、单人） */
function sched(over: Partial<DutyScheduleRow> = {}): DutyScheduleRow {
  return {
    id: 's1', campusId: 'c1', kind: 'teaching', areaId: 'a1',
    timeSlotId: 't1', locationId: 'l1',
    dateStart: '2026-09-01', dateEnd: '2027-01-31',
    weekday: 3, // 周三
    weekParity: 'everyweek', countersign: 0,
    assigneeIds: ['u1'], note: null,
    ...over,
  };
}

describe('date 工具（本地日历日归一）', () => {
  it('parseDate/dateKey 往返一致（不受时区影响）', () => {
    expect(dateKey(parseDate('2026-09-01'))).toBe('2026-09-01');
    expect(dateKey(parseDate('2026-12-31'))).toBe('2026-12-31');
  });

  it('mondayOf：周日归上一周', () => {
    // 2026-09-06 是周日 → 周一应是 2026-08-31
    expect(dateKey(mondayOf(parseDate('2026-09-06')))).toBe('2026-08-31');
    // 2026-09-02 是周三 → 周一 2026-08-31
    expect(dateKey(mondayOf(parseDate('2026-09-02')))).toBe('2026-08-31');
  });

  it('weekDates 返回周一起 7 天', () => {
    const w = weekDates(parseDate('2026-09-02')); // 周三 → 该周
    expect(w).toHaveLength(7);
    expect(dateKey(w[0])).toBe('2026-08-31'); // 周一
    expect(dateKey(w[6])).toBe('2026-09-06'); // 周日
  });

  it('inDateRange 含端点', () => {
    expect(inDateRange(parseDate('2026-09-01'), parseDate('2026-09-01'), parseDate('2026-09-30'))).toBe(true);
    expect(inDateRange(parseDate('2026-09-30'), parseDate('2026-09-01'), parseDate('2026-09-30'))).toBe(true);
    expect(inDateRange(parseDate('2026-10-01'), parseDate('2026-09-01'), parseDate('2026-09-30'))).toBe(false);
  });
});

describe('单双周判定（学期周奇偶）', () => {
  // 学期起始 2026-09-01（周二），week1 = 含它的那周（周一 2026-08-31）
  const semStart = parseDate('2026-09-01');

  it('semesterWeekNo：起始周=1，逐周递增', () => {
    expect(semesterWeekNo(parseDate('2026-09-02'), semStart)).toBe(1); // 第1周
    expect(semesterWeekNo(parseDate('2026-09-09'), semStart)).toBe(2); // 第2周
    expect(semesterWeekNo(parseDate('2026-09-16'), semStart)).toBe(3); // 第3周
  });

  it('odd 只在奇数周生效', () => {
    expect(matchesParity(parseDate('2026-09-02'), semStart, 'odd')).toBe(true);  // week1 奇
    expect(matchesParity(parseDate('2026-09-09'), semStart, 'odd')).toBe(false); // week2 偶
    expect(matchesParity(parseDate('2026-09-16'), semStart, 'odd')).toBe(true);  // week3 奇
  });

  it('even 只在偶数周生效', () => {
    expect(matchesParity(parseDate('2026-09-02'), semStart, 'even')).toBe(false);
    expect(matchesParity(parseDate('2026-09-09'), semStart, 'even')).toBe(true);
  });

  it('everyweek 恒真', () => {
    expect(matchesParity(parseDate('2026-09-02'), semStart, 'everyweek')).toBe(true);
    expect(matchesParity(parseDate('2026-09-09'), semStart, 'everyweek')).toBe(true);
  });
});

describe('排班展开引擎', () => {
  it('周三模板在某周内只展开出 1 个实例（那周周三）', () => {
    const insts = expandWeek([sched()], parseDate('2026-09-02')); // 该周周一 2026-08-31
    expect(insts).toHaveLength(1);
    expect(insts[0].date).toBe('2026-09-02'); // 周三
    expect(insts[0].weekday).toBe(3);
    expect(insts[0].assigneeIds).toEqual(['u1']);
  });

  it('跨多周展开：每周三各 1 个实例', () => {
    const insts = expandSchedules([sched()], { from: parseDate('2026-09-01'), to: parseDate('2026-09-30') });
    // 2026-09 的周三：2, 9, 16, 23, 30 → 5 个
    expect(insts).toHaveLength(5);
    expect(insts.map((i) => i.date)).toEqual(['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']);
  });

  it('odd 模板只展开奇数周的周三', () => {
    const insts = expandSchedules([sched({ weekParity: 'odd' })], { from: parseDate('2026-09-01'), to: parseDate('2026-09-30') });
    // week1(9/2)奇✓ week2(9/9)偶✗ week3(9/16)奇✓ week4(9/23)偶✗ week5(9/30)奇✓
    expect(insts.map((i) => i.date)).toEqual(['2026-09-02', '2026-09-16', '2026-09-30']);
  });

  it('日期区间裁剪：超出 [dateStart,dateEnd] 不展开', () => {
    const insts = expandSchedules([sched({ dateStart: '2026-09-10', dateEnd: '2026-09-20' })], {
      from: parseDate('2026-09-01'), to: parseDate('2026-09-30'),
    });
    // 只有 9/16 周三落在 [9/10,9/20]
    expect(insts.map((i) => i.date)).toEqual(['2026-09-16']);
  });

  it('kind 过滤：teaching 过滤器命中 teaching 排班（拆分后唯一类型，保留过滤路径覆盖）', () => {
    const s = [sched({ id: 't1', kind: 'teaching', weekday: 1 }), sched({ id: 't2', kind: 'teaching' })];
    const insts = expandWeek(s, parseDate('2026-09-02'), { kind: 'teaching' });
    expect(insts).toHaveLength(2);
    expect(insts.map((i) => i.kind).every((k) => k === 'teaching')).toBe(true);
  });

  it('会签多人：一个实例带多个 assigneeIds（不拆成多实例）', () => {
    const insts = expandWeek([sched({ countersign: 1, assigneeIds: ['u1', 'u2', 'u3'] })], parseDate('2026-09-02'));
    expect(insts).toHaveLength(1);
    expect(insts[0].countersign).toBe(true);
    expect(insts[0].assigneeIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('结果按日期升序', () => {
    const insts = expandSchedules([sched({ weekday: 5 }), sched({ id: 's2', weekday: 1 })], {
      from: parseDate('2026-09-01'), to: parseDate('2026-09-13'),
    });
    const dates = insts.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe('调班叠加层（不回改原模板，按具体日期命中）', () => {
  const approvedSwap = (over: Partial<SwapRow> = {}): SwapRow => ({
    id: 'sw1', campusId: 'c1', type: 'proxy',
    applicantId: 'u1', applicantScheduleId: 's1', applicantDate: '2026-09-02',
    targetId: 'u2', targetScheduleId: null, targetDate: null,
    reason: 'r', status: 'approved', reviewerId: 'admin', reviewComment: null,
    createdAt: 1000, reviewedAt: 1000,
    ...over,
  });

  it('代理：申请人排班那天，实际值班人 → 被申请人', () => {
    const insts = expandWeek([sched()], parseDate('2026-09-02')); // 9/2 周三 u1 值班
    const overlay = buildSwapOverlay([approvedSwap({ type: 'proxy' })]);
    const result = applySwapOverlay(insts, overlay, new Map([['u1', '张'], ['u2', '李']]));
    const target = result.find((i) => i.date === '2026-09-02')!;
    expect(target.effectiveAssigneeIds).toEqual(['u2']); // u1 → u2
    expect(target.swapApplied?.type).toBe('proxy');
    expect(target.swapHint).toContain('张');
    expect(target.swapHint).toContain('李');
  });

  it('代理只作用具体那天，不污染其他周同班次', () => {
    const insts = expandSchedules([sched()], { from: parseDate('2026-09-01'), to: parseDate('2026-09-30') });
    const overlay = buildSwapOverlay([approvedSwap({ applicantDate: '2026-09-02' })]);
    const result = applySwapOverlay(insts, overlay);
    // 只有 9/2 被叠加，其他周三仍是 u1
    expect(result.find((i) => i.date === '2026-09-02')!.effectiveAssigneeIds).toEqual(['u2']);
    expect(result.find((i) => i.date === '2026-09-09')!.effectiveAssigneeIds).toEqual(['u1']);
    expect(result.find((i) => i.date === '2026-09-16')!.effectiveAssigneeIds).toEqual(['u1']);
  });

  it('交换：双向对调（申请人那天→对方，对方那天→申请人）', () => {
    // u1 周三(s1)值班，u2 周五(s2)值班；交换 9/2(u1) 与 9/4(u2)
    const s1 = sched({ id: 's1', weekday: 3, assigneeIds: ['u1'] });
    const s2 = sched({ id: 's2', weekday: 5, assigneeIds: ['u2'] });
    const insts = expandWeek([s1, s2], parseDate('2026-09-02'));
    const swap = approvedSwap({
      type: 'swap',
      applicantId: 'u1', applicantScheduleId: 's1', applicantDate: '2026-09-02',
      targetId: 'u2', targetScheduleId: 's2', targetDate: '2026-09-04',
    });
    const overlay = buildSwapOverlay([swap]);
    const result = applySwapOverlay(insts, overlay);
    expect(result.find((i) => i.scheduleId === 's1' && i.date === '2026-09-02')!.effectiveAssigneeIds).toEqual(['u2']);
    expect(result.find((i) => i.scheduleId === 's2' && i.date === '2026-09-04')!.effectiveAssigneeIds).toEqual(['u1']);
  });

  it('后者覆盖前者（同 key 多条调班按 createdAt）', () => {
    const insts = expandWeek([sched()], parseDate('2026-09-02'));
    const overlay = buildSwapOverlay([
      approvedSwap({ id: 'sw1', targetId: 'u2', createdAt: 1000 }),
      approvedSwap({ id: 'sw2', targetId: 'u3', createdAt: 2000 }), // 更晚，覆盖
    ]);
    const result = applySwapOverlay(insts, overlay);
    expect(result.find((i) => i.date === '2026-09-02')!.effectiveAssigneeIds).toEqual(['u3']);
  });

  it('pending/rejected 调班不叠加（只 approved 生效）', () => {
    const insts = expandWeek([sched()], parseDate('2026-09-02'));
    const overlay = buildSwapOverlay([approvedSwap({ status: 'pending' })]);
    const result = applySwapOverlay(insts, overlay);
    expect(result.find((i) => i.date === '2026-09-02')!.effectiveAssigneeIds).toEqual(['u1']); // 不变
  });

  it('原模板不被回改（叠加是纯函数，实例是副本）', () => {
    const original = sched();
    const insts = expandWeek([original], parseDate('2026-09-02'));
    applySwapOverlay(insts, buildSwapOverlay([approvedSwap()]));
    expect(original.assigneeIds).toEqual(['u1']); // 模板原样
  });

  it('swapKey 按具体日期归一（同 schedule 不同日期 → 不同 key）', () => {
    expect(swapKey('s1', '2026-09-02')).not.toBe(swapKey('s1', '2026-09-09'));
    expect(swapKey('s1', '2026-09-02')).toBe(swapKey('s1', parseDate('2026-09-02').getTime()));
  });
});

describe('打卡状态精确到人（会签不串台）', () => {
  const checkin = (over: Partial<CheckinRow> = {}): CheckinRow => ({
    id: 'ck1', campusId: 'c1', scheduleId: 's1', dutyDate: '2026-09-02',
    teacherId: 'u1', locationName: '校门口', timeSlotName: '全天', situation: 'ok',
    photos: ['k1'], checkedInAt: 1000,
    ...over,
  });

  it('会签格：u1 打卡，u2 仍未打卡（不串台）', () => {
    const checker = buildScheduleDoneChecker([checkin({ teacherId: 'u1' })]);
    expect(checker.isPersonDone('s1', '2026-09-02', 'u1')).toBe(true);
    expect(checker.isPersonDone('s1', '2026-09-02', 'u2')).toBe(false); // 关键：u2 不被误标
  });

  it('不同日期不串台', () => {
    const checker = buildScheduleDoneChecker([checkin({ dutyDate: '2026-09-02' })]);
    expect(checker.isCheckedIn('s1', '2026-09-02', 'u1')).toBe(true);
    expect(checker.isCheckedIn('s1', '2026-09-09', 'u1')).toBe(false);
  });

  it('历史脏数据（无 teacherId）回退整格标记', () => {
    const checker = buildScheduleDoneChecker([checkin({ teacherId: '' })]);
    expect(checker.isCellDone('s1', '2026-09-02')).toBe(true);
    // 整格兜底：任意人查询都命中（避免老数据误显示缺勤）
    expect(checker.isCheckedIn('s1', '2026-09-02', 'u9')).toBe(true);
  });

  it('get 取回打卡行', () => {
    const checker = buildScheduleDoneChecker([checkin({ id: 'ck-x' })]);
    expect(checker.get('s1', '2026-09-02', 'u1')?.id).toBe('ck-x');
  });
});

describe('大表矩阵（三态 pill）', () => {
  const userNames = new Map([['u1', '张老师'], ['u2', '李老师']]);
  const locationNames = new Map([['l1', '校门口']]);

  it('未打卡 → pending 态', () => {
    const insts = expandWeek([sched({ dateStart: '2026-08-31', dateEnd: '2026-09-06' })], parseDate('2026-09-02'));
    const withEff = applySwapOverlay(insts, new Map());
    const checker = buildScheduleDoneChecker([]);
    const m = buildMatrix(withEff, checker, { columns: weekDates(parseDate('2026-09-02')), today: parseDate('2026-09-02'), userNames, locationNames });
    const cell = m.rows[0].cells.find((c) => c.date === '2026-09-02')!;
    expect(cell.pills[0].state).toBe('pending');
    expect(cell.pills[0].userName).toBe('张老师');
  });

  it('已打卡 → done 态', () => {
    const insts = expandWeek([sched({ dateStart: '2026-08-31', dateEnd: '2026-09-06' })], parseDate('2026-09-02'));
    const withEff = applySwapOverlay(insts, new Map());
    const checker = buildScheduleDoneChecker([{
      id: 'ck', campusId: 'c1', scheduleId: 's1', dutyDate: '2026-09-02', teacherId: 'u1',
      locationName: '校门口', timeSlotName: '全天', situation: null, photos: ['k'], checkedInAt: 1,
    }]);
    const m = buildMatrix(withEff, checker, { columns: weekDates(parseDate('2026-09-02')), today: parseDate('2026-09-02'), userNames, locationNames });
    const cell = m.rows[0].cells.find((c) => c.date === '2026-09-02')!;
    expect(cell.pills[0].state).toBe('done');
  });

  it('调班叠加 → swapped 态 + 显示接手人', () => {
    const insts = expandWeek([sched({ dateStart: '2026-08-31', dateEnd: '2026-09-06' })], parseDate('2026-09-02'));
    const overlay = buildSwapOverlay([{
      id: 'sw', campusId: 'c1', type: 'proxy', applicantId: 'u1', applicantScheduleId: 's1',
      applicantDate: '2026-09-02', targetId: 'u2', targetScheduleId: null, targetDate: null,
      reason: 'r', status: 'approved', reviewerId: 'a', reviewComment: null, createdAt: 1, reviewedAt: 1,
    }]);
    const withEff = applySwapOverlay(insts, overlay, userNames);
    const checker = buildScheduleDoneChecker([]);
    const m = buildMatrix(withEff, checker, { columns: weekDates(parseDate('2026-09-02')), today: parseDate('2026-09-02'), userNames, locationNames });
    const cell = m.rows[0].cells.find((c) => c.date === '2026-09-02')!;
    expect(cell.pills[0].state).toBe('swapped');
    expect(cell.pills[0].userName).toBe('李老师'); // 接手人 u2
    expect(cell.pills[0].swapHint).toBeTruthy();
  });

  it('今日列高亮 isToday', () => {
    const insts = expandWeek([sched({ dateStart: '2026-08-31', dateEnd: '2026-09-06' })], parseDate('2026-09-02'));
    const m = buildMatrix(applySwapOverlay(insts, new Map()), buildScheduleDoneChecker([]), {
      columns: weekDates(parseDate('2026-09-02')), today: parseDate('2026-09-02'), userNames, locationNames,
    });
    const todayCol = m.columns.find((c) => c.isToday);
    expect(todayCol?.date).toBe('2026-09-02');
  });

  it('matrixSummary 统计三态计数', () => {
    const insts = expandWeek([sched({ dateStart: '2026-08-31', dateEnd: '2026-09-06', countersign: 1, assigneeIds: ['u1', 'u2'] })], parseDate('2026-09-02'));
    const checker = buildScheduleDoneChecker([{
      id: 'ck', campusId: 'c1', scheduleId: 's1', dutyDate: '2026-09-02', teacherId: 'u1',
      locationName: '校门口', timeSlotName: '全天', situation: null, photos: ['k'], checkedInAt: 1,
    }]);
    const m = buildMatrix(applySwapOverlay(insts, new Map()), checker, {
      columns: weekDates(parseDate('2026-09-02')), today: parseDate('2026-09-02'), userNames, locationNames,
    });
    const sum = matrixSummary(m);
    expect(sum.total).toBe(2);  // 会签两人
    expect(sum.done).toBe(1);   // u1 打卡
    expect(sum.pending).toBe(1); // u2 未打卡
  });
});


describe('#4 单双周校区级锚点（REVIEW #4：消除排班各自 dateStart 导致的错位）', () => {
  // 两条 odd 排班，dateStart 不同（相差一周）→ 无统一锚点时对「哪周是奇数周」判断相反
  const sA: DutyScheduleRow = {
    id: 'A', campusId: 'c1', kind: 'teaching', areaId: 'a1', timeSlotId: null, locationId: 'l1',
    dateStart: '2026-09-01', dateEnd: '2026-09-30', weekday: 3, weekParity: 'odd',
    countersign: 0, assigneeIds: ['u1'], note: null,
  };
  const sB: DutyScheduleRow = {
    ...sA, id: 'B', dateStart: '2026-09-08', // 晚一周起
  };
  const range = { from: parseDate('2026-09-01'), to: parseDate('2026-09-13') };

  it('无统一锚点：A 命中 9/2、B 命中 9/9 —— 各自为政（错位 bug）', () => {
    const insts = expandSchedules([sA, sB], range);
    const aDates = insts.filter((i) => i.scheduleId === 'A').map((i) => i.date);
    const bDates = insts.filter((i) => i.scheduleId === 'B').map((i) => i.date);
    expect(aDates).toEqual(['2026-09-02']); // A 以 9/1 为 week1(奇)
    expect(bDates).toEqual(['2026-09-09']); // B 以 9/8 为 week1(奇) → 与 A 相反周
  });

  it('传校区级 parityAnchor：A、B 用同一把奇偶尺子对齐', () => {
    const anchor = parseDate('2026-09-01'); // 校区统一学期起点
    const insts = expandSchedules([sA, sB], { ...range, parityAnchor: anchor });
    const aDates = insts.filter((i) => i.scheduleId === 'A').map((i) => i.date);
    const bDates = insts.filter((i) => i.scheduleId === 'B').map((i) => i.date);
    // 统一锚点后：week1=含9/1那周(奇)、week2=含9/8那周(偶)
    expect(aDates).toEqual(['2026-09-02']); // A(odd) 命中 9/2(week1奇)
    expect(bDates).toEqual([]);             // B(odd) 的 9/9 是 week2(偶) 不命中，且 9/2 早于其 dateStart
  });

  it('parityAnchor 与 semesterWeekNo 一致', () => {
    expect(semesterWeekNo(parseDate('2026-09-02'), parseDate('2026-09-01'))).toBe(1);
    expect(semesterWeekNo(parseDate('2026-09-09'), parseDate('2026-09-01'))).toBe(2);
  });
});

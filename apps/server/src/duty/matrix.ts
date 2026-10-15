/**
 * 值班大表矩阵引擎（纯函数）—— docs/DUTY-FUSION.md §3.4。
 *
 * 把展开实例（含调班叠加）+ 打卡状态，组装成「行=地点、列=一周7天」的矩阵，
 * 每个履职者渲染成三态 pill（对齐外部 PRD，自主实现）：
 *  - swapped（青紫）：有生效调班叠加
 *  - done（绿）：本人已打卡
 *  - pending（黄）：尚未打卡
 *
 * 纯函数：输入实例 + 打卡查询器 + 地点/用户名映射 → 输出 DutyMatrix。前端直接消费。
 */
import type { DutyInstance, DutyMatrix, MatrixCell, MatrixPill } from './types.js';
import { WEEKDAY_NAMES } from './types.js';
import { startOfDay, parseDate, dateKey } from './date.js';
import type { ScheduleDoneChecker } from './checkin-index.js';

export interface MatrixOptions {
  /** 列：一周 7 天（周一起）。缺省从实例日期范围推导。 */
  columns?: Date[];
  /** 今日（高亮列）；缺省 new Date() */
  today?: Date;
  /** userId → 显示名 */
  userNames: Map<string, string>;
  /** locationId → 地点名（null locationId 归到「未指定地点」行） */
  locationNames: Map<string, string>;
}

const UNASSIGNED_LOC = '__unassigned__';

/**
 * 构建大表矩阵。
 * @param instances 展开 + 叠加后的实例（effectiveAssigneeIds 已算好）
 * @param doneChecker 打卡状态查询器
 */
export function buildMatrix(
  instances: DutyInstance[],
  doneChecker: ScheduleDoneChecker,
  opts: MatrixOptions,
): DutyMatrix {
  const today = opts.today ? startOfDay(opts.today) : startOfDay(new Date());
  const todayKey = dateKey(today);

  // 列：默认取实例里出现的最早周的周一..周日；调用方一般显式传 weekDates
  const columns = (opts.columns ?? deriveColumns(instances)).map(startOfDay);
  const colKeys = columns.map(dateKey);

  // 行：所有出现的地点（保持首次出现顺序），null 归到未指定
  const rowOrder: string[] = [];
  const rowName = new Map<string, string>();
  for (const inst of instances) {
    const locKey = inst.locationId ?? UNASSIGNED_LOC;
    if (!rowName.has(locKey)) {
      rowOrder.push(locKey);
      rowName.set(locKey, inst.locationId ? (opts.locationNames.get(inst.locationId) ?? '未知地点') : '未指定地点');
    }
  }

  // 按 (地点, 日期) 分桶实例
  const bucket = new Map<string, DutyInstance[]>();
  for (const inst of instances) {
    const locKey = inst.locationId ?? UNASSIGNED_LOC;
    const k = `${locKey}|${inst.date}`;
    const arr = bucket.get(k);
    if (arr) arr.push(inst);
    else bucket.set(k, [inst]);
  }

  const rows = rowOrder.map((locKey) => {
    const cells: MatrixCell[] = columns.map((col, ci) => {
      const colKey = colKeys[ci];
      const insts = bucket.get(`${locKey}|${colKey}`) ?? [];
      const pills: MatrixPill[] = [];
      for (const inst of insts) {
        const assignees = inst.effectiveAssigneeIds ?? inst.assigneeIds;
        for (const uid of assignees) {
          // ⚠ swapped 必须**按人**判定，不能按实例（否则同格会签同事的打卡状态被抹掉，
          //   大表显示未执勤、到岗率报表却算已执勤 → 两处口径矛盾，见 REVIEW #2）。
          //   只有叠加「换进来」的接手人（不在原名单 originalIds 中）才是 swapped 态；
          //   原班留守的会签同事照常按本人打卡判 done/pending。
          const swapped = inst.swapApplied != null && !inst.swapApplied.originalIds.includes(uid);
          const done = !swapped && doneChecker.isCheckedIn(inst.scheduleId, inst.date, uid);
          const state: MatrixPill['state'] = swapped ? 'swapped' : done ? 'done' : 'pending';
          pills.push({
            userId: uid,
            userName: opts.userNames.get(uid) ?? uid,
            state,
            swapHint: swapped ? inst.swapHint : undefined,
            scheduleId: inst.scheduleId,
            date: inst.date,
          });
        }
      }
      return {
        locationId: locKey === UNASSIGNED_LOC ? null : locKey,
        date: colKey,
        dateTs: col.getTime(),
        pills,
        isToday: colKey === todayKey,
      };
    });
    return {
      locationId: locKey === UNASSIGNED_LOC ? null : locKey,
      locationName: rowName.get(locKey) ?? '',
      cells,
    };
  });

  return {
    columns: columns.map((c) => ({
      date: dateKey(c),
      weekdayName: WEEKDAY_NAMES[c.getDay()] ?? '',
      isToday: dateKey(c) === todayKey,
    })),
    rows,
  };
}

/** 从实例日期范围推导列（最早日所在周的周一..周日） */
function deriveColumns(instances: DutyInstance[]): Date[] {
  if (instances.length === 0) {
    const mon = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  }
  const dates = instances.map((i) => parseDate(i.date));
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  // 回退到周一
  const dow = min.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  min.setDate(min.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(min); d.setDate(min.getDate() + i); return d; });
}

/** 矩阵摘要统计（状态摘要条：总数/已执勤/待执勤/已换班） */
export function matrixSummary(matrix: DutyMatrix): { total: number; done: number; pending: number; swapped: number } {
  let total = 0, done = 0, pending = 0, swapped = 0;
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      for (const p of cell.pills) {
        total++;
        if (p.state === 'done') done++;
        else if (p.state === 'swapped') swapped++;
        else pending++;
      }
    }
  }
  return { total, done, pending, swapped };
}

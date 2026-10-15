/**
 * 调班叠加层引擎（纯函数）—— docs/DUTY-FUSION.md §3.2。
 *
 * 吸收外部 PRD 的核心设计哲学（自主实现，非照搬）：
 *  - **不回改原排班模板**：调班审批通过后，原 DutySchedule 不动；叠加层在展开实例后按
 *    「具体日期」命中，实时计算「实际值班人 effectiveAssigneeIds」。
 *  - **叠加 key = scheduleId + 具体日期**（归一到本地日历日）：保证某天发起的调班只作用于那天，
 *    不污染整周期其他周的同班次（对齐外部 PRD 的 swapKey 语义）。
 *  - **后者覆盖前者**：同一 key 多条调班按 createdAt 升序，最后一条生效。
 *
 * 两种类型：
 *  - 代理 proxy：申请人排班那天，实际值班人 → 被申请人（申请人被替换）。
 *  - 交换 swap：申请人那天 → 被申请人；且被申请人那天 → 申请人（双向对调）。
 */
import type { DutyInstance, SwapRow } from './types.js';
import { startOfDay, parseDate } from './date.js';

/** 叠加 key：scheduleId + 本地日历日 epoch（归一，避免时区/时分秒差异） */
export function swapKey(scheduleId: string, date: string | number): string {
  const ts = typeof date === 'number' ? date : startOfDay(parseDate(date)).getTime();
  return `${scheduleId}|${ts}`;
}

/** 单条调班在某个 key 上产生的「实际值班人替换」 */
interface OverlayEntry {
  type: SwapRow['type'];
  /** userId → 替换成的 userId（该排班那天） */
  replace: Map<string, string>;
  createdAt: number;
}

/**
 * 从已批准的调班构建叠加层。
 * @param swaps 调班行（调用方应只传 status==='approved'；此处再过滤一次保险）
 * @returns Map<swapKey, OverlayEntry>
 */
export function buildSwapOverlay(swaps: SwapRow[]): Map<string, OverlayEntry> {
  const overlay = new Map<string, OverlayEntry>();
  // 按 createdAt 升序，后者覆盖前者
  const approved = swaps
    .filter((s) => s.status === 'approved')
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const s of approved) {
    // 代理/交换：申请人排班那天，申请人 → 被申请人
    const apKey = swapKey(s.applicantScheduleId, s.applicantDate);
    putReplace(overlay, apKey, s.applicantId, s.targetId, s.type, s.createdAt);

    // 交换：额外把被申请人排班那天，被申请人 → 申请人
    if (s.type === 'swap' && s.targetScheduleId && s.targetDate) {
      const tgKey = swapKey(s.targetScheduleId, s.targetDate);
      putReplace(overlay, tgKey, s.targetId, s.applicantId, s.type, s.createdAt);
    }
  }
  return overlay;
}

function putReplace(
  overlay: Map<string, OverlayEntry>,
  key: string,
  from: string,
  to: string,
  type: SwapRow['type'],
  createdAt: number,
) {
  const existing = overlay.get(key);
  if (existing) {
    // 后者覆盖前者：同一 from 的最新替换生效
    existing.replace.set(from, to);
    existing.type = type;
    existing.createdAt = createdAt;
  } else {
    overlay.set(key, { type, replace: new Map([[from, to]]), createdAt });
  }
}

/**
 * 把叠加层应用到展开后的排班实例（就地填充 effectiveAssigneeIds + swapApplied）。
 * 纯函数：不改原 overlay，返回新实例数组（或就地 mutate 由调用方决定；此处返回新数组保持纯净）。
 *
 * @param instances 展开引擎产出的实例
 * @param overlay buildSwapOverlay 的结果
 * @param userNames userId → 显示名（swapHint 用；缺省则 hint 只给 id）
 */
export function applySwapOverlay(
  instances: DutyInstance[],
  overlay: Map<string, OverlayEntry>,
  userNames?: Map<string, string>,
): DutyInstance[] {
  return instances.map((inst) => {
    const key = swapKey(inst.scheduleId, inst.dateTs);
    const entry = overlay.get(key);
    if (!entry || entry.replace.size === 0) {
      // 无叠加：实际值班人 = 原始
      return { ...inst, effectiveAssigneeIds: [...inst.assigneeIds] };
    }
    // 应用替换（保持原顺序，命中者换成接手人；去重防会签重复）
    const effective: string[] = [];
    let applied = false;
    for (const uid of inst.assigneeIds) {
      const to = entry.replace.get(uid);
      if (to) { effective.push(to); applied = true; }
      else effective.push(uid);
    }
    const dedup = Array.from(new Set(effective));
    if (!applied) return { ...inst, effectiveAssigneeIds: dedup };

    const originalNames = inst.assigneeIds.map((id) => userNames?.get(id) ?? id).join('、');
    const effectiveNames = dedup.map((id) => userNames?.get(id) ?? id).join('、');
    return {
      ...inst,
      effectiveAssigneeIds: dedup,
      swapApplied: { type: entry.type, originalIds: [...inst.assigneeIds] },
      swapHint: `原 ${originalNames} → ${effectiveNames}（${entry.type === 'swap' ? '交换' : '代理'}）`,
    };
  });
}

/** 取某实例的叠加命中信息（matrix 层判断 pill 是否 swapped 态） */
export function overlayHitFor(
  overlay: Map<string, OverlayEntry>,
  scheduleId: string,
  dateTs: number,
): OverlayEntry | undefined {
  return overlay.get(swapKey(scheduleId, dateTs));
}

export type { OverlayEntry };

/**
 * 业务枚举值 —— pg / sqlite 两份 schema 的 check 约束共享此单一真源，防止漂移。
 * 与 packages/shared 的联合类型对齐（UserRole / DutyKind 等）。
 *
 * 值班域拆分说明（原 guga-onduty-w 融合仓库 → 本仓库）：
 *  - 原融合方案中 DUTY_KINDS 含 'dutyWeek'（值周生值周排班），拆分后值周域已迁出，
 *    本仓库只承载教师执勤，kind 收敛为单一值 'teaching'（列保留，预留未来扩展
 *    其他巡查类型，如夜间值守/节假日执勤）。
 */

export const ROLES = ['admin', 'teacher', 'student'] as const;

// ── 值班域枚举（引擎/排班/调班/巡查）──────────────────────────────────
/** 排班类型：teaching=教师执勤（校园地点巡查）—— 当前唯一类型，列保留供扩展 */
export const DUTY_KINDS = ['teaching'] as const;
/** 单双周规则：everyweek=每周、odd=奇数周、even=偶数周 */
export const WEEK_PARITIES = ['everyweek', 'odd', 'even'] as const;
/** 调班类型：swap=交换、proxy=代理 */
export const SWAP_TYPES = ['swap', 'proxy'] as const;
/** 调班/巡查状态 */
export const SWAP_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const INSPECT_STATUSES = ['present', 'absent'] as const;

/** 枚举值 → SQL IN 列表字面量（`'a', 'b'`）。值为本地常量，无注入面。 */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

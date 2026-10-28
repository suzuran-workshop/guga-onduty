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

// ── 钉钉域枚举（自 guga-onduty-w 移植的基建；kind 为通用工作通知语义）──
/**
 * 通知种类。值周仓库（guga-onduty-w）的 record_deduction/weekly_report 绑定其值周业务，
 * 本仓库（值班域）无对应消费方，故收敛为单一通用 kind：
 *  - `notice`：通用钉钉工作通知（管理面手动发送/补发用）
 */
export const NOTIFICATION_KINDS = ['notice'] as const;
/**
 * 通知状态。
 *  - `pending`：已入库待发送（凭证缺失或异步队列中）
 *  - `sent`：钉钉受理且回执确认已投递（read 或 unread）
 *  - `failed`：钉钉返回错误，或回执显示 invalid/failed（⚠ asyncsend_v2 的 errcode:0
 *    只代表「已受理」，发给不存在的 userid 也返 0，必须查 getsendresult 才能判失败）
 *  - `skipped`：主动跳过
 */
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;

/** 枚举值 → SQL IN 列表字面量（`'a', 'b'`）。值为本地常量，无注入面。 */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

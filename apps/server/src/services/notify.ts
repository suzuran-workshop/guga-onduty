/**
 * 通知服务 —— 钉钉工作通知（自 guga-onduty-w 移植的通用基建）。
 *
 * 值周仓库的 notifyRecord / sendWeeklyReport / 周报定时器绑定其值周业务（扣分推送、
 * 班级周报聚合），本仓库（值班域）无对应消费方，故只移植通用发送链路：
 *
 *  A. **发送失败绝不影响业务主链路**：dispatch 内部消化全部异常，只落库 + 日志。
 *  B. **`errcode:0` ≠ 已送达**。asyncsend_v2 是异步任务：发给不存在的 userid 也返 0。
 *     必须轮询 `getSendResult` 拿 `invalidUserIds`/`failedUserIds`/`read|unreadUserIds`
 *     才能判成败——否则「人没收到」而系统显示「已发送」，是最难查的故障。
 *  C. **凭证缺失要降级，不能崩**。未配 AppKey/AppSecret/AgentId 时，通知仍**落库为
 *     pending**（而非丢弃），凭证到位后可 `flushPending` 补发。
 *
 * ⚠ 多实例部署会重复推送（发送是进程内动作）。需要防重复的通知用 dedupeKey。
 */
import { supports } from '@homurajs/3p';
import type { PlatformBundle } from '../platform/build.js';
import type { Repos } from '../repos/types.js';
import type { NotificationKind } from '@guga-onduty/shared';

export interface NotifyDeps {
  repos: Repos;
  platform: PlatformBundle;
  logger: {
    info: (m: string, f?: any) => void;
    warn: (m: string, f?: any) => void;
    error: (m: string, f?: any) => void;
  };
}

export interface NotifyResult {
  /** 是否已投递成功（回执确认 read/unread） */
  delivered: boolean;
  /** 未推送原因（降级/跳过时可展示给管理员） */
  skippedReason?: string;
  notificationId?: string;
}

export interface SendNoticeInput {
  campusId: string;
  /** 收件人钉钉 userid（asyncsend_v2 目标） */
  recipientPlatformId: string;
  /** 收件人本系统 users.id（可选，仅审计用） */
  recipientUserId?: string | null;
  kind?: NotificationKind;
  title: string;
  markdownText: string;
  /** 消息跳转链接（有则用 link 类型消息） */
  messageUrl?: string;
  /** 幂等键（需要防重复投递的通知填写；重复调用安全跳过） */
  dedupeKey?: string | null;
}

export interface NotifyService {
  /** 发送一条工作通知（落库 → 发送 → 回执 → 定状态）。降级不抛错 */
  send(input: SendNoticeInput): Promise<NotifyResult>;
  /** 补发 pending 的通知（凭证到位后调用） */
  flushPending(campusId?: string): Promise<{ sent: number; failed: number; reason?: string }>;
}

/** 轮询投递回执的参数（asyncsend_v2 是异步任务） */
const RECEIPT_POLL = { attempts: 6, intervalMs: 500 };

export function createNotifyService(deps: NotifyDeps): NotifyService {
  const { repos, platform, logger } = deps;

  // ── 投递回执轮询（坑 B）──────────────────────────────────────────
  /**
   * 轮询 getsendresult 判定真实投递结果。
   * 返回 'sent' / 'failed'（+ 原因）。⚠ 不能只看 sendWorkMessage 的 errcode:0。
   */
  async function pollReceipt(agentId: string, taskId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!platform.platform || !supports(platform.platform, 'message')) {
      return { ok: false, reason: '无 message 能力，无法查回执' };
    }
    let last = '';
    for (let i = 0; i < RECEIPT_POLL.attempts; i++) {
      try {
        const r = await platform.platform.getSendResult(agentId, taskId);
        if (r.readUserIds.length > 0 || r.unreadUserIds.length > 0) return { ok: true };
        if (r.invalidUserIds.length > 0) {
          return { ok: false, reason: `userid 无效（invalid: ${r.invalidUserIds.join(',')}）` };
        }
        if (r.failedUserIds.length > 0) {
          return { ok: false, reason: `投递失败（failed: ${r.failedUserIds.join(',')}）` };
        }
        if (r.forbiddenUserIds.length > 0) {
          return { ok: false, reason: `被企业策略禁止（forbidden: ${r.forbiddenUserIds.join(',')}）` };
        }
        last = '回执尚无结果';
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
      // 未出结果 → 等一下再查（异步任务需要时间）
      await new Promise((r) => setTimeout(r, RECEIPT_POLL.intervalMs));
    }
    // 轮询结束仍无定论：保守标记 failed（可补发），而不是假装成功
    return { ok: false, reason: `回执未确认送达（${last}）` };
  }

  // ── 底层发送 ─────────────────────────────────────────────────────
  /**
   * 实际发送一条工作通知并写日志状态。所有推送路径共用，
   * 确保「落库 → 发送 → 回执 → 定状态」一致。降级时只落库 pending，不抛错。
   */
  async function dispatch(input: SendNoticeInput): Promise<NotifyResult> {
    // 1) 先落库（pending）。带 dedupeKey 时已存在同 key → create 返回 null → 幂等跳过。
    const log = await repos.dingtalk.notifications.create({
      campusId: input.campusId,
      recipientUserId: input.recipientUserId ?? null,
      recipientPlatformId: input.recipientPlatformId,
      kind: input.kind ?? 'notice',
      recordId: null,
      week: null,
      title: input.title,
      dedupeKey: input.dedupeKey ?? null,
    });
    if (!log) {
      return { delivered: false, skippedReason: '重复推送已跳过（幂等）' };
    }

    // 2) 凭证未配 → 停在 pending，待 flushPending 补发（坑 C）
    if (!platform.canSend || !platform.platform || !platform.agentId) {
      const reason = platform.reason ?? '钉钉未启用';
      await repos.dingtalk.notifications.update(log.id, { status: 'pending', error: reason });
      logger.warn('notify: 钉钉未启用，通知留存待补发', { notificationId: log.id, kind: input.kind, reason });
      return { delivered: false, skippedReason: reason, notificationId: log.id };
    }
    if (!supports(platform.platform, 'message')) {
      await repos.dingtalk.notifications.update(log.id, { status: 'pending', error: '平台无 message 能力' });
      return { delivered: false, skippedReason: '平台无 message 能力', notificationId: log.id };
    }

    // 3) 发送（带跳转链接用 link 类型，其余 markdown）
    try {
      const { taskId } = await platform.platform.sendWorkMessage({
        agentId: platform.agentId,
        userIds: [input.recipientPlatformId],
        msg: input.messageUrl
          ? { type: 'link', content: { title: input.title, text: input.markdownText, messageUrl: input.messageUrl } }
          : { type: 'markdown', content: { title: input.title, text: input.markdownText } },
      });
      await repos.dingtalk.notifications.update(log.id, { providerTaskId: taskId });

      // 4) 轮询回执判真实投递（坑 B：errcode:0 只代表已受理）
      const receipt = await pollReceipt(platform.agentId, taskId);
      if (receipt.ok) {
        await repos.dingtalk.notifications.update(log.id, { status: 'sent', sentAt: Date.now(), error: null });
        return { delivered: true, notificationId: log.id };
      }
      await repos.dingtalk.notifications.update(log.id, { status: 'failed', error: receipt.reason });
      logger.warn('notify: 回执显示未送达', { notificationId: log.id, reason: receipt.reason });
      return { delivered: false, skippedReason: receipt.reason, notificationId: log.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await repos.dingtalk.notifications.update(log.id, { status: 'failed', error: msg });
      logger.error('notify: 发送异常', { notificationId: log.id, error: msg });
      return { delivered: false, skippedReason: msg, notificationId: log.id };
    }
  }

  // ── 补发 ────────────────────────────────────────────────────────
  async function flushPending(campusId?: string) {
    if (!platform.canSend) {
      return { sent: 0, failed: 0, reason: platform.reason ?? '钉钉未启用' };
    }
    const pending = await repos.dingtalk.notifications.listPending(campusId, 200);
    let sent = 0;
    let failed = 0;
    for (const n of pending) {
      // 只补发有收件人的
      if (!n.recipientPlatformId) continue;
      // pending 行只存了消息摘要（title），补发用它重建正文——通用基建无业务原文可依
      const r = await dispatch({
        campusId: n.campusId,
        recipientPlatformId: n.recipientPlatformId,
        recipientUserId: n.recipientUserId,
        kind: n.kind,
        title: n.title ?? '(通知)',
        markdownText: n.title ?? '(通知)',
        dedupeKey: null, // 补发不能再带原 dedupeKey，否则被幂等跳过永远发不出去
      });
      if (r.delivered) sent++;
      else failed++;
    }
    logger.info('notify: 补发完成', { campusId, sent, failed, candidates: pending.length });
    return { sent, failed };
  }

  return {
    send: dispatch,
    flushPending,
  };
}

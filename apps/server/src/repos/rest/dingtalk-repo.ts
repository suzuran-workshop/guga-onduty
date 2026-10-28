/**
 * 钉钉域 repo（rest 实现）—— PostgREST（qw-pages 轨）。
 *
 * rest 轨无事务/无原生 upsert，按 rest 轨补偿哲学（见 rest/_base.ts）：
 *  - upsertMany：先查已有 userId 集合 → 新增 insert / 已有 update，逐条 best-effort。
 *  - 通知幂等（dedupeKey）：先查后插，极端并发下可能重复入库（无唯一约束兜底），
 *    qw-pages 轨为低并发部署形态，可接受。
 *  - 令牌原子消费：update 带 `{ tokenHash, consumedAt: null }` 双条件过滤，
 *    PostgREST 单条 UPDATE 原子性由数据库保证，语义与 drizzle 轨一致。
 */
import type {
  DingtalkContact, DingtalkContactInput, NotificationLog, NotificationLogInput,
  NotificationLogPatch, NotificationKind, NotificationStatus,
} from '@guga-onduty/shared';
import type {
  DingtalkContactsRepo, NotificationsRepo, AppealTokensRepo,
} from '../dingtalk-types.js';
import type { Paged } from '../types.js';
import { tbl, paginateRows, num, ts, jsonArr, uuid } from './_base.js';
import type { RestCtx } from './_base.js';
import { sha256Hex } from '../../utils/token.js';
import { randomBytes } from 'node:crypto';

// ── 通讯录缓存 ──────────────────────────────────────────────────────
export function createRestDingtalkContactsRepo(ctx: RestCtx): DingtalkContactsRepo {
  const T = tbl<DingtalkContact & RestRowLike>(ctx.rest, 'dingtalkContacts');

  const toContact = (r: any): DingtalkContact => ({
    userId: r.userId,
    unionId: r.unionId ?? null,
    name: r.name,
    mobile: r.mobile ?? null,
    title: r.title ?? null,
    avatarUrl: r.avatarUrl ?? null,
    deptIds: jsonNumArr(r.deptIds),
    deptNames: jsonArr(r.deptNames),
    syncedAt: num(r.syncedAt),
  });

  return {
    async upsertMany(contacts): Promise<number> {
      if (contacts.length === 0) return 0;
      const ids = contacts.map((c) => c.userId);
      const existing = await T.select({ userId: ids } as any);
      const existingSet = new Set(existing.map((r) => String(r.userId)));
      let written = 0;
      for (const c of contacts) {
        const values = {
          userId: c.userId,
          unionId: c.unionId ?? null,
          name: c.name,
          mobile: c.mobile ?? null,
          title: c.title ?? null,
          avatarUrl: c.avatarUrl ?? null,
          deptIds: c.deptIds ?? null,
          deptNames: c.deptNames ?? null,
          syncedAt: c.syncedAt,
        };
        if (existingSet.has(c.userId)) {
          const { userId: _drop, ...patch } = values;
          await T.update(patch, { userId: c.userId } as any);
        } else {
          await T.insert(values as any);
        }
        written++;
      }
      return written;
    },

    async list(filter?): Promise<DingtalkContact[]> {
      const rows = await T.select(filter?.nameLike ? ({ name: `like.*${filter.nameLike}*` } as any) : ({} as any));
      return rows
        .map(toContact)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, filter?.limit ?? 500);
    },

    async findByUserId(userId): Promise<DingtalkContact | null> {
      const rows = await T.select({ userId } as any);
      return rows[0] ? toContact(rows[0]) : null;
    },

    async findByName(name): Promise<DingtalkContact[]> {
      const rows = await T.select({ name } as any);
      return rows.map(toContact);
    },
  };
}

// ── 通知日志 ────────────────────────────────────────────────────────
export function createRestNotificationsRepo(ctx: RestCtx): NotificationsRepo {
  const T = tbl<NotificationLog & RestRowLike>(ctx.rest, 'notificationLogs');

  const toLog = (r: any): NotificationLog => ({
    id: r.id,
    campusId: r.campusId,
    recipientUserId: r.recipientUserId ?? null,
    recipientPlatformId: r.recipientPlatformId,
    kind: r.kind as NotificationKind,
    status: r.status as NotificationStatus,
    recordId: r.recordId ?? null,
    week: r.week ?? null,
    title: r.title ?? null,
    dedupeKey: r.dedupeKey ?? null,
    providerTaskId: r.providerTaskId ?? null,
    error: r.error ?? null,
    createdAt: ts(r.createdAt),
    sentAt: r.sentAt === null || r.sentAt === undefined ? null : ts(r.sentAt),
  });

  return {
    async create(input): Promise<NotificationLog | null> {
      if (input.dedupeKey) {
        const dup = await T.select({ dedupeKey: input.dedupeKey } as any);
        if (dup[0]) return null;
      }
      const id = uuid();
      await T.insert({
        id,
        campusId: input.campusId,
        recipientUserId: input.recipientUserId ?? null,
        recipientPlatformId: input.recipientPlatformId,
        kind: input.kind,
        status: 'pending',
        recordId: input.recordId ?? null,
        week: input.week ?? null,
        title: input.title ?? null,
        dedupeKey: input.dedupeKey ?? null,
        providerTaskId: null,
        error: null,
        createdAt: Date.now(),
        sentAt: null,
      } as any);
      const rows = await T.select({ id } as any);
      return rows[0] ? toLog(rows[0]) : null;
    },

    async update(id, patch: NotificationLogPatch): Promise<void> {
      const p: Record<string, unknown> = {};
      if (patch.status !== undefined) p.status = patch.status;
      if (patch.providerTaskId !== undefined) p.providerTaskId = patch.providerTaskId;
      if (patch.error !== undefined) p.error = patch.error;
      if (patch.sentAt !== undefined) p.sentAt = patch.sentAt;
      if (Object.keys(p).length === 0) return;
      await T.update(p, { id } as any);
    },

    async findById(id): Promise<NotificationLog | null> {
      const rows = await T.select({ id } as any);
      return rows[0] ? toLog(rows[0]) : null;
    },

    async list(filter): Promise<Paged<NotificationLog>> {
      const all = await T.select({ campusId: filter.campusId } as any);
      const filtered = all
        .map(toLog)
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => (filter.kind ? r.kind === filter.kind : true))
        .filter((r) => (filter.recordId ? r.recordId === filter.recordId : true))
        .sort((a, b) => b.createdAt - a.createdAt);
      return paginateRows(filtered, filter.page, filter.pageSize);
    },

    async listPending(campusId?, limit = 100): Promise<NotificationLog[]> {
      const all = await T.select(campusId ? ({ campusId, status: 'pending' } as any) : ({ status: 'pending' } as any));
      return all
        .map(toLog)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit);
    },
  };
}

// ── 免登录令牌（基建预留）───────────────────────────────────────────
export function createRestAppealTokensRepo(ctx: RestCtx): AppealTokensRepo {
  const T = tbl<AppealTokenRow & RestRowLike>(ctx.rest, 'appealTokens');

  async function inspect(tokenHash: string): Promise<
    { ok: true; recordId: string | null; teacherDingtalkId: string } | { ok: false; reason: 'not_found' | 'expired' | 'consumed' }
  > {
    const rows = await T.select({ tokenHash } as any);
    const row: any = rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.consumedAt !== null && row.consumedAt !== undefined) return { ok: false, reason: 'consumed' };
    if (num(row.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, recordId: row.recordId ?? null, teacherDingtalkId: row.teacherDingtalkId };
  }

  return {
    async create(input): Promise<{ plainToken: string }> {
      const plainToken = randomBytes(32).toString('base64url');
      await T.insert({
        tokenHash: sha256Hex(plainToken),
        recordId: input.recordId ?? null,
        teacherDingtalkId: input.teacherDingtalkId,
        expiresAt: input.expiresAt,
        consumedAt: null,
        createdAt: Date.now(),
      } as any);
      return { plainToken };
    },

    async consume(tokenHash) {
      // 原子消费：PostgREST 单条 UPDATE（带 consumedAt IS NULL 过滤）数据库侧原子
      const rowsBefore = await T.select({ tokenHash } as any);
      const row: any = rowsBefore[0];
      if (!row) return { ok: false as const, reason: 'not_found' as const };
      if (row.consumedAt !== null && row.consumedAt !== undefined) {
        return { ok: false as const, reason: 'consumed' as const };
      }
      if (num(row.expiresAt) <= Date.now()) {
        return { ok: false as const, reason: 'expired' as const };
      }
      await T.update({ consumedAt: Date.now() }, { tokenHash, consumedAt: null } as any);
      // 无事务轨：update 未命中（并发抢先）→ 回读确认
      const after = await inspect(tokenHash);
      if (after.ok) return { ok: true as const, recordId: after.recordId, teacherDingtalkId: after.teacherDingtalkId };
      return { ok: false as const, reason: 'consumed' as const };
    },

    async peek(tokenHash) {
      return inspect(tokenHash);
    },

    async purgeExpired(now = Date.now()): Promise<number> {
      // rest 轨无 or 过滤：分别按过期/消费时间删，best-effort
      const expired = await T.select({ expiresAt: `lt.${now}` } as any);
      let deleted = 0;
      for (const r of expired) {
        await T.remove({ tokenHash: (r as any).tokenHash } as any);
        deleted++;
      }
      const consumed = await T.select({ consumedAt: `lt.${now - 7 * 24 * 60 * 60 * 1000}` } as any);
      for (const r of consumed) {
        await T.remove({ tokenHash: (r as any).tokenHash } as any);
        deleted++;
      }
      return deleted;
    },
  };
}

interface RestRowLike {
  [k: string]: unknown;
}
interface AppealTokenRow {
  tokenHash: string;
  recordId: string | null;
  teacherDingtalkId: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

/** JSON 数组列解析（number[] 专用；rest 轨 JSON 列可能返回字符串） */
function jsonNumArr(v: unknown): number[] | null {
  const arr = jsonArr(v as never);
  return arr ? (arr as unknown as number[]) : null;
}

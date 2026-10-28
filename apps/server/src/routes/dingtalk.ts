/**
 * dingtalk 路由 —— 钉钉集成管理面（自 guga-onduty-w 移植）。**全部 admin only**。
 *
 * 端点：
 *  - GET    /status                     平台启用状态 + 凭证齐备情况（含降级原因，便于排障）
 *  - POST   /sync                       引入整个组织通讯录（**不含家校通讯录**）
 *  - GET    /contacts                   通讯录联系人列表（绑定下拉的数据源）
 *  - GET    /apps                       列出企业应用（agentId 发现：asyncsend_v2 必需 agentId 且无法从 appKey 反推）
 *  - GET    /bindings                   用户 ↔ 钉钉 userid 绑定列表（扫码登录 + 身份解析的依据）
 *  - POST   /bindings                   建绑定 { userId, dingtalkUserId }（写 oauth2_identity_links）
 *  - DELETE /bindings/:userId           解绑（按本系统用户 id 删钉钉 link）
 *  - GET    /notifications              通知日志（分页，可按 status/kind 过滤）
 *  - POST   /notifications/flush        补发全部 pending（凭证到位后用）
 *  - POST   /send                       手动发一条工作通知 { dingtalkUserId | userId, title, markdownText }
 *
 * ⚠ 通讯录同步是**组织级**的（钉钉通讯录无校区维度），故 sync 不接受 campus_id；
 * 联系人可被任意校区使用（数据录入正确性由管理员负责）。
 */
import { Hono } from 'hono';
import { supports } from '@homurajs/3p';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, getProfile } from '../middleware/profile.js';
import { ok, created, ApiError, parsePagination } from '../http/respond.js';
import { DINGTALK_PROVIDER, resolveDingtalkUserId } from '../platform/resolve-identity.js';
import type { ContactsSyncResult, DingtalkContact } from '@guga-onduty/shared';

export function createDingtalkRoutes(deps: RouteDeps): Hono {
  const { repos, platform, notify, auth } = deps;
  const app = new Hono();

  // 整个模块 admin only（管理面：凭证/通讯录/通知日志都不该对其他角色可见）
  app.use('*', requireRole('admin'));

  // GET /status —— 启用状态（凭证是否齐备 + 降级原因）
  app.get('/status', async (c) => {
    const p = platform.platform;
    return ok(c, {
      enabled: platform.canSend,
      reason: platform.reason ?? null,
      agentId: platform.agentId,
      capabilities: p ? [...p.capabilities] : [],
      oauth: p ? supports(p, 'oauth') : false,
      contacts: p ? supports(p, 'contacts') : false,
      message: p ? supports(p, 'message') : false,
      apps: p ? supports(p, 'apps') : false,
      /** 钉钉扫码登录是否已启用（OAUTH_* 凭证齐备） */
      oauthLogin: auth.oauthEnabled,
    });
  });

  // POST /sync —— 引入整个组织通讯录（不含家校）
  app.post('/sync', async (c) => {
    const p = platform.platform;
    if (!p || !supports(p, 'contacts')) {
      throw ApiError.badRequest(
        '钉钉通讯录能力不可用（请配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET）',
        'DINGTALK_NOT_CONFIGURED',
      );
    }
    // ⚠ includeFamily 恒为 false：沿用 w 仓库产品决策「引入整个组织通讯录（**不含家校通讯录**）」。
    // 家校子树（dept_id=-7）也不能用普通部门 API 递归（3p 实测 40009），fetchAllContacts 已自动跳过。
    const snap = await p.fetchAllContacts({ includeFamily: false, concurrency: 4 });

    // 部门 id → 名称映射，给每个联系人算出部门名路径（展示用，避免前端重建部门树）
    const deptNameById = new Map<number, string>();
    for (const d of snap.depts) deptNameById.set(d.deptId, d.name);

    const now = Date.now();
    const contacts = snap.users.map((u) => ({
      userId: u.userid,
      unionId: u.unionid ?? null,
      name: u.name ?? '(未命名)',
      mobile: u.mobile ?? null,
      title: u.title ?? null,
      avatarUrl: u.avatarUrl ?? null,
      deptIds: u.deptIdList ?? null,
      deptNames: (u.deptIdList ?? []).map((id) => deptNameById.get(id)).filter((n): n is string => Boolean(n)),
      syncedAt: now,
    }));
    const synced = await repos.dingtalk.contacts.upsertMany(contacts);

    const result: ContactsSyncResult = {
      synced,
      depts: snap.depts.length,
      truncated: snap.truncated,
      errors: snap.errors,
      // 按产品要求不引入家校通讯录，如实回报（管理员据此知情）
      family: { included: false, reason: '按产品要求不引入家校通讯录（仅引入组织通讯录）' },
      syncedAt: now,
    };
    return created(c, result);
  });

  // GET /contacts —— 联系人列表（绑定下拉数据源；可按姓名模糊搜）
  app.get('/contacts', async (c) => {
    const contacts: DingtalkContact[] = await repos.dingtalk.contacts.list({
      nameLike: c.req.query('q') || undefined,
      limit: Math.min(500, Number(c.req.query('limit') ?? 200)),
    });
    return ok(c, contacts);
  });

  // GET /apps —— 企业应用列表（agentId 发现）
  app.get('/apps', async (c) => {
    const p = platform.platform;
    if (!p || !supports(p, 'apps')) {
      throw ApiError.badRequest('钉钉应用能力不可用（请配置凭证）', 'DINGTALK_NOT_CONFIGURED');
    }
    return ok(c, await p.listMicroApps());
  });

  // ── 用户 ↔ 钉钉绑定（oauth2_identity_links；扫码登录与身份解析的依据）──

  // GET /bindings —— 全部钉钉绑定 + 用户名（管理面展示）
  app.get('/bindings', async (c) => {
    const users = await repos.users.list();
    const result = [];
    for (const u of users) {
      const links = await auth.linkStore.findByUserId(u.id);
      const dt = links.find((l) => l.provider === DINGTALK_PROVIDER);
      if (dt) {
        result.push({ userId: u.id, username: u.username, displayName: u.displayName, dingtalkUserId: dt.providerSub });
      }
    }
    return ok(c, result);
  });

  // POST /bindings —— 建绑定 { userId, dingtalkUserId }
  app.post('/bindings', async (c) => {
    const body = await c.req.json<{ userId?: string; dingtalkUserId?: string }>().catch(() => null as any);
    if (!body?.userId || !body.dingtalkUserId) throw ApiError.badRequest('缺少 userId / dingtalkUserId');
    const me = await repos.users.findMe(body.userId);
    if (!me) throw ApiError.notFound('用户不存在');
    const contact = await repos.dingtalk.contacts.findByUserId(body.dingtalkUserId);
    if (!contact) throw ApiError.badRequest('dingtalkUserId 不在通讯录缓存中（请先同步通讯录）');
    // 同一钉钉 userid 只能绑一个用户（(provider,providerSub) 唯一）；同一用户重复绑定则先解旧绑
    const dup = await auth.linkStore.findByProvider(DINGTALK_PROVIDER, body.dingtalkUserId);
    if (dup) {
      if (dup.userId === body.userId) return ok(c, { bound: true, contactName: contact.name });
      throw ApiError.conflict('该钉钉联系人已绑定其他用户');
    }
    const old = (await auth.linkStore.findByUserId(body.userId)).find((l) => l.provider === DINGTALK_PROVIDER);
    if (old) await auth.linkStore.delete(old.id);
    await auth.linkStore.create({ userId: body.userId, provider: DINGTALK_PROVIDER, providerSub: body.dingtalkUserId });
    return created(c, { bound: true, contactName: contact.name });
  });

  // DELETE /bindings/:userId —— 解绑
  app.delete('/bindings/:userId', async (c) => {
    const userId = c.req.param('userId');
    const links = await auth.linkStore.findByUserId(userId);
    const dt = links.find((l) => l.provider === DINGTALK_PROVIDER);
    if (!dt) throw ApiError.notFound('该用户没有钉钉绑定');
    await auth.linkStore.delete(dt.id);
    return ok(c, { unbound: true });
  });

  // ── 通知 ────────────────────────────────────────────────────────────

  // GET /notifications —— 通知日志（分页）
  app.get('/notifications', async (c) => {
    const { page, pageSize } = parsePagination(c);
    const result = await repos.dingtalk.notifications.list({
      campusId: resolveCampusId(c),
      status: (c.req.query('status') as any) || undefined,
      kind: (c.req.query('kind') as any) || undefined,
      recordId: c.req.query('record_id') || undefined,
      page,
      pageSize,
    });
    return ok(c, result.data, result.pagination);
  });

  // POST /notifications/flush —— 补发全部 pending（凭证到位后用）
  app.post('/notifications/flush', async (c) => {
    const r = await notify.flushPending();
    return ok(c, r);
  });

  // POST /send —— 手动发一条工作通知（管理面测试/群发通知用）
  app.post('/send', async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; dingtalk_user_id?: string; user_id?: string; title?: string; markdown_text?: string }>()
      .catch(() => null as any);
    if (!body?.title || !body.markdown_text) throw ApiError.badRequest('缺少 title / markdown_text');
    let dingtalkUserId = body.dingtalk_user_id;
    if (!dingtalkUserId && body.user_id) {
      dingtalkUserId = await resolveDingtalkUserId(auth.linkStore, body.user_id);
      if (!dingtalkUserId) throw ApiError.badRequest('该用户未绑定钉钉（无法解析钉钉 userid）');
    }
    if (!dingtalkUserId) throw ApiError.badRequest('缺少 dingtalk_user_id 或 user_id');
    const r = await notify.send({
      campusId: body.campus_id ?? getProfile(c).campusId,
      recipientPlatformId: dingtalkUserId,
      recipientUserId: body.user_id ?? null,
      kind: 'notice',
      title: body.title,
      markdownText: body.markdown_text,
    });
    return ok(c, r);
  });

  return app;
}

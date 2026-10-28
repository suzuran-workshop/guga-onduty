/**
 * 钉钉域 E2E —— 通讯录/通知日志/免登录令牌/绑定/扫码登录装配。
 *
 * 锁死的坑（改代码勿回退）：
 *  1. 凭证缺失必须降级不抛错：/status enabled:false、/sync 400 DINGTALK_NOT_CONFIGURED、
 *     notify.send 落库 pending（坑 C）。
 *  2. dedupeKey 幂等：同 key 二次 create 返回 null（重复触发安全）。
 *  3. 令牌一次性原子消费：consume 二次返回 consumed；过期返回 expired。
 *  4. 管理面 RBAC：teacher 访问 /dingtalk/* 一律 403。
 *  5. OAuth2 路由按配置挂载：凭证未配 → /auth/oauth2/authorize 404；
 *     配齐 → 302 到 IdP authorize URL（dingtalkOAuth 预设）。
 *  6. 绑定前置校验：dingtalkUserId 必须在通讯录缓存中；同一联系人不能绑两个用户。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';
import { createNotifyService } from '../src/services/notify.js';
import { jitProvision } from '../src/auth/auto-link.js';
import { sha256Hex } from '../src/utils/token.js';

let h: Harness;
let h2: Harness; // oauth 启用形态（第二实例验证路由挂载差异）

beforeAll(async () => {
  h = await boot('dingtalk');
  await seedStandard(h);
  // 第二实例：配齐 OAUTH_* 凭证 → /auth/oauth2/* 应挂载
  process.env.OAUTH_DINGTALK_ORG_ID = 'org-test';
  process.env.OAUTH_CLIENT_ID = 'cid';
  process.env.OAUTH_CLIENT_SECRET = 'csec';
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:5173/auth/oauth2/callback';
  h2 = await boot('dingtalk-oauth');
  delete process.env.OAUTH_DINGTALK_ORG_ID;
  delete process.env.OAUTH_CLIENT_ID;
  delete process.env.OAUTH_CLIENT_SECRET;
  delete process.env.OAUTH_REDIRECT_URI;
});

afterAll(async () => {
  await h.shutdown();
  await h2.shutdown();
});

describe('钉钉管理面 RBAC 与降级', () => {
  it('未登录访问 /dingtalk/status → 401', async () => {
    const r = await h.client().req('GET', '/api/v1/dingtalk/status');
    expect(r.status).toBe(401);
  });

  it('teacher 访问 /dingtalk/* → 403（模块级 admin only）', async () => {
    const c = await h.loginAs('teacher1');
    for (const [m, p] of [
      ['GET', '/api/v1/dingtalk/status'],
      ['POST', '/api/v1/dingtalk/sync'],
      ['GET', '/api/v1/dingtalk/contacts'],
      ['GET', '/api/v1/dingtalk/bindings'],
      ['GET', '/api/v1/dingtalk/notifications'],
    ] as const) {
      const r = await c.req(m, p);
      expect(r.status).toBe(403);
    }
  });

  it('GET /status：凭证未配 → enabled:false + 降级原因', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/dingtalk/status');
    expect(r.status).toBe(200);
    expect(r.json.data.enabled).toBe(false);
    expect(r.json.data.reason).toContain('DINGTALK_APP_KEY');
    expect(r.json.data.oauthLogin).toBe(false);
  });

  it('POST /sync：凭证未配 → 400 DINGTALK_NOT_CONFIGURED（不抛 500）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', '/api/v1/dingtalk/sync');
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('DINGTALK_NOT_CONFIGURED');
  });
});

describe('公开探测端点（免登录）', () => {
  it('GET /api/public/dingtalk/status：未登录可访问，oauthLogin:false', async () => {
    const r = await h.client().req('GET', '/api/public/dingtalk/status');
    expect(r.status).toBe(200);
    expect(r.json.data.oauthLogin).toBe(false);
  });

  it('OAUTH_* 配齐的实例：oauthLogin:true 且 /auth/oauth2/authorize 302 到 IdP', async () => {
    const r = await h2.client().req('GET', '/api/public/dingtalk/status');
    expect(r.json.data.oauthLogin).toBe(true);

    const a = await h2.client().req('GET', '/auth/oauth2/authorize');
    expect(a.status).toBe(302);
    const loc = a.res.headers.get('location') ?? '';
    // dingtalkOAuth 预设：authorize URL = <base>/<orgId>/authorize（缺省 base dingtalk.auth.xrl.im）
    expect(loc).toContain('https://dingtalk.auth.xrl.im/org-test/authorize');
    expect(loc).toContain('client_id=cid');
    expect(loc).toContain('redirect_uri=');
  });

  it('凭证未配的实例：/auth/oauth2/authorize → 404（路由未挂载）', async () => {
    const r = await h.client().req('GET', '/auth/oauth2/authorize');
    expect([404, 401]).toContain(r.status); // 未挂载 → SPA fallback 404
  });
});

describe('通讯录 repo 与绑定路由', () => {
  it('upsertMany：同 userId 二次写入以最新为准；list/findByUserId/findByName 正确', async () => {
    const R = h.booted.repos;
    const now = Date.now();
    const n1 = await R.dingtalk.contacts.upsertMany([
      { userId: 'dt-001', name: '李老师', deptIds: [1], deptNames: ['教学组'], syncedAt: now },
    ]);
    expect(n1).toBe(1);
    const n2 = await R.dingtalk.contacts.upsertMany([
      { userId: 'dt-001', name: '李老师', deptIds: [1, 2], deptNames: ['教学组', '校办'], syncedAt: now + 1 },
    ]);
    expect(n2).toBe(1);
    const found = await R.dingtalk.contacts.findByUserId('dt-001');
    expect(found?.deptNames).toEqual(['教学组', '校办']);
    expect((await R.dingtalk.contacts.findByName('李老师')).length).toBe(1);
    expect(await R.dingtalk.contacts.findByUserId('nope')).toBeNull();
  });

  it('绑定：前置校验 + 幂等重绑 + 同联系人冲突 409 + 解绑', async () => {
    const admin = await h.loginAs('admin');
    const R = h.booted.repos;
    // 先补一个联系人（dt-002）
    await R.dingtalk.contacts.upsertMany([
      { userId: 'dt-002', name: '王老师', deptIds: [1], deptNames: ['教学组'], syncedAt: Date.now() },
    ]);

    // dingtalkUserId 不在通讯录缓存 → 400
    const bad = await admin.req('POST', '/api/v1/dingtalk/bindings', {
      body: { userId: R.users ? (await listFirstTeacherId()).id : '', dingtalkUserId: 'not-in-cache' },
    });
    expect(bad.status).toBe(400);

    // 正常绑定 teacher1 ↔ dt-001
    const teacher1 = (await listFirstTeacherId('teacher1')).id;
    const ok1 = await admin.req('POST', '/api/v1/dingtalk/bindings', {
      body: { userId: teacher1, dingtalkUserId: 'dt-001' },
    });
    expect(ok1.status).toBe(201);

    // 重复绑定同一对 → 幂等 ok
    const ok2 = await admin.req('POST', '/api/v1/dingtalk/bindings', {
      body: { userId: teacher1, dingtalkUserId: 'dt-001' },
    });
    expect(ok2.status).toBe(200);

    // 同一联系人绑给 teacher2 → 409
    const teacher2 = (await listFirstTeacherId('teacher2')).id;
    const conflict = await admin.req('POST', '/api/v1/dingtalk/bindings', {
      body: { userId: teacher2, dingtalkUserId: 'dt-001' },
    });
    expect(conflict.status).toBe(409);

    // 换绑：teacher1 改绑 dt-002（旧绑自动清除）
    const rebind = await admin.req('POST', '/api/v1/dingtalk/bindings', {
      body: { userId: teacher1, dingtalkUserId: 'dt-002' },
    });
    expect(rebind.status).toBe(201);
    const links = await h.booted.auth.linkStore.findByUserId(teacher1);
    expect(links.filter((l) => l.provider === 'dingtalk').length).toBe(1);
    expect(links.find((l) => l.provider === 'dingtalk')?.providerSub).toBe('dt-002');

    // 列表与解绑
    const list = await admin.req('GET', '/api/v1/dingtalk/bindings');
    expect(list.status).toBe(200);
    expect(list.json.data.some((x: any) => x.userId === teacher1 && x.dingtalkUserId === 'dt-002')).toBe(true);
    const del = await admin.req('DELETE', `/api/v1/dingtalk/bindings/${teacher1}`);
    expect(del.status).toBe(200);
    const del2 = await admin.req('DELETE', `/api/v1/dingtalk/bindings/${teacher1}`);
    expect(del2.status).toBe(404);
  });

  async function listFirstTeacherId(username?: string) {
    const users = await h.booted.repos.users.list();
    const u = username ? users.find((x) => x.username === username)! : users[0];
    return u;
  }
});

describe('通知日志 repo 幂等 + notify 服务降级（坑 C）', () => {
  it('dedupeKey 幂等：同 key 二次 create 返回 null；部分更新只动传入字段', async () => {
    const R = h.booted.repos;
    const input = {
      campusId: (await R.campuses.listAll()).find((x) => x.code === "campus_01")!.id,
      recipientPlatformId: 'dt-002',
      kind: 'notice' as const,
      title: '测试通知',
      dedupeKey: 'notice:test:dt-002:1',
    };
    const first = await R.dingtalk.notifications.create(input);
    expect(first).not.toBeNull();
    expect(first!.status).toBe('pending');
    const dup = await R.dingtalk.notifications.create(input);
    expect(dup).toBeNull();

    // 部分更新：只记 taskId 不动状态
    await R.dingtalk.notifications.update(first!.id, { providerTaskId: 'task-1' });
    const after = await R.dingtalk.notifications.findById(first!.id);
    expect(after?.providerTaskId).toBe('task-1');
    expect(after?.status).toBe('pending');
  });

  it('notify.send 凭证缺失：落库 pending 且 error 写明原因，不抛错', async () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const notify = createNotifyService({ repos: h.booted.repos, platform: h.booted.platform, logger });
    const campusId = (await h.booted.repos.campuses.listAll()).find((x) => x.code === "campus_01")!.id;
    const r = await notify.send({
      campusId,
      recipientPlatformId: 'dt-002',
      kind: 'notice',
      title: '降级测试',
      markdownText: '降级测试',
      dedupeKey: 'notice:degrade:1',
    });
    expect(r.delivered).toBe(false);
    expect(r.skippedReason).toBeTruthy();
    const log = await h.booted.repos.dingtalk.notifications.findById(r.notificationId!);
    expect(log?.status).toBe('pending');
    expect(log?.error).toBeTruthy();

    // flushPending：canSend=false → 返回 reason，不抛错
    const fr = await notify.flushPending(campusId);
    expect(fr.sent).toBe(0);
    expect(fr.reason).toBeTruthy();
  });

  it('通知列表分页 + campus 过滤', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/dingtalk/notifications', { query: { pageSize: 10 } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
    expect(r.json.pagination.total).toBeGreaterThanOrEqual(2);
  });
});

describe('免登录令牌：只存哈希 + 一次性原子消费', () => {
  it('create 返回明文一次；consume 二次 → consumed；过期 → expired；purgeExpired 清理', async () => {
    const R = h.booted.repos;
    const { plainToken } = await R.dingtalk.appealTokens.create({
      teacherDingtalkId: 'dt-002',
      expiresAt: Date.now() + 3600_000,
    });
    // 库里只有哈希
    const byHash = await R.dingtalk.appealTokens.peek(sha256Hex(plainToken));
    expect(byHash.ok).toBe(true);

    // 第一次消费成功，第二次 consumed（原子）
    const c1 = await R.dingtalk.appealTokens.consume(sha256Hex(plainToken));
    expect(c1.ok).toBe(true);
    const c2 = await R.dingtalk.appealTokens.consume(sha256Hex(plainToken));
    expect(c2).toEqual({ ok: false, reason: 'consumed' });

    // 过期令牌：peek 返回 expired
    const expiredTok = await R.dingtalk.appealTokens.create({
      teacherDingtalkId: 'dt-002',
      expiresAt: Date.now() - 1000,
    });
    const expired = await R.dingtalk.appealTokens.peek(sha256Hex(expiredTok.plainToken));
    expect(expired).toEqual({ ok: false, reason: 'expired' });
    // 未知令牌 → not_found
    const unknown = await R.dingtalk.appealTokens.peek(sha256Hex('nonexistent-token'));
    expect(unknown).toEqual({ ok: false, reason: 'not_found' });

    const purged = await R.dingtalk.appealTokens.purgeExpired(Date.now() + 8 * 24 * 3600_000);
    expect(purged).toBeGreaterThanOrEqual(2);
  });
});

describe('扫码登录 JIT 建户（通讯录即白名单：userid 命中即建号+绑定）', () => {
  const CAMPUS = 'campus-jit';
  let firstUserId: string;

  beforeAll(async () => {
    const { handle } = h2.booted;
    await handle.db.insert(handle.tables.campuses).values({ id: CAMPUS, name: '测试校区', code: 'jit' });
    await handle.db.insert(handle.tables.dingtalkContacts).values([
      { userId: 'dt-jit-001', name: '张三', syncedAt: Date.now() },
      { userId: 'dt-jit-002', name: '李四', unionId: 'union-lisi-xyz', syncedAt: Date.now() },
    ]);
  });

  it('userid 命中通讯录 → 建号（username=userid、displayName=通讯录姓名、teacher+默认校区）+ 绑定落库', async () => {
    const { handle, auth } = h2.booted;
    const r = await jitProvision(handle, { linkStore: auth.linkStore, userStore: auth.userStore }, 'dingtalk', 'dt-jit-001');
    expect(typeof r).toBe('object');
    const user = r as { id: string; username: string | null };
    firstUserId = user.id;
    expect(user.username).toBe('dt-jit-001');
    const profiles = await (handle.db as any).select().from(handle.tables.userProfiles);
    const mine = profiles.find((p: any) => p.userId === user.id);
    expect(mine).toMatchObject({ displayName: '张三', role: 'teacher', campusId: CAMPUS, canInspect: 0 });
    const link = await auth.linkStore.findByProvider('dingtalk', 'dt-jit-001');
    expect(link?.userId).toBe(user.id);
  });

  it('再次 provision 同一 sub → 幂等复用（不重复建号）', async () => {
    const { handle, auth } = h2.booted;
    const r = await jitProvision(handle, { linkStore: auth.linkStore, userStore: auth.userStore }, 'dingtalk', 'dt-jit-001');
    expect((r as { id: string }).id).toBe(firstUserId);
    const again = await auth.userStore.findByUsername('dt-jit-001');
    expect(again?.id).toBe(firstUserId);
  });

  it('绑定丢失但账号已存在（username 冲突）→ 复用旧账号重建绑定', async () => {
    const { handle, auth } = h2.booted;
    const oldLink = await auth.linkStore.findByProvider('dingtalk', 'dt-jit-001');
    if (oldLink) await auth.linkStore.delete(oldLink.id);
    const r = await jitProvision(handle, { linkStore: auth.linkStore, userStore: auth.userStore }, 'dingtalk', 'dt-jit-001');
    expect(typeof r).toBe('object');
    expect((r as { id: string }).id).toBe(firstUserId);
    const link = await auth.linkStore.findByProvider('dingtalk', 'dt-jit-001');
    expect(link?.userId).toBe(firstUserId);
  });

  it('sub 为 unionid 形态 → 按通讯录 unionId 兜底命中', async () => {
    const { handle, auth } = h2.booted;
    const r = await jitProvision(handle, { linkStore: auth.linkStore, userStore: auth.userStore }, 'dingtalk', 'union-lisi-xyz');
    expect(typeof r).toBe('object');
    const user = r as { id: string };
    const again = await auth.userStore.findById(user.id);
    expect(again?.username).toBe('union-lisi-xyz'); // username=sub（此处即 unionid）
  });

  it('不在通讯录 → no_contact（fail-closed，绝不建户）', async () => {
    const { handle, auth } = h2.booted;
    const r = await jitProvision(handle, { linkStore: auth.linkStore, userStore: auth.userStore }, 'dingtalk', 'dt-outsider');
    expect(r).toBe('no_contact');
    const ghost = await auth.userStore.findByUsername('dt-outsider');
    expect(ghost).toBeNull();
  });
});

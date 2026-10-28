/**
 * 认证装配 —— @homurajs/auth 的 SessionManager + PasswordProvider + SDK 路由 + OIDC 扫码登录。
 *
 * 身份模型（docs/MIGRATION-HOMURA.md §2.2）：
 *  - auth SDK 的 `users`/`passwords`/`refresh_tokens` 表管「你是谁」（uuid 身份锚点 + scrypt 密码）。
 *  - 业务 `userProfiles` 表管「你能做什么」（role / campusId / displayName）。
 *  - session.sub = users.id(uuid)；业务中间件 requireProfile 再查 userProfiles 补角色/校区。
 *
 * 登录双通道：
 *  - 账密：SDK `POST /auth/password/login`（scrypt 校验 + 下发 access/refresh cookie）。
 *  - 钉钉扫码：SDK `GET /auth/oidc/authorize` → oidc-dingtalk IdP（v2.0.0，标准 OIDC Provider）→
 *    回调建会话。配置 OAUTH_DINGTALK_ORG_ID + OAUTH_CLIENT_ID/SECRET + OAUTH_REDIRECT_URI 即启用。
 *    客户端强制 id_token 验签（HS256，密钥=clientSecret）+ userinfo.sub 交叉核对——信任锚是签名。
 *    IdentityResolver 为自定义实现：① 显式绑定（oidc_identity_links）优先放行；
 *    ② 无绑定时 **JIT 建户**（见 auth/auto-link.ts）：IdP sub（钉钉企业 userid）
 *    精确命中通讯录缓存 → 自动建系统账号（username=userid，displayName=通讯录姓名，
 *    默认校区 + teacher 角色）→ 写绑定 → 放行。「通讯录即账号白名单」——admin 零人工，
 *    只需同步通讯录；不在通讯录 → IdentityNotLinkedError（fail-closed），但对外渲染中文
 *    友好错误页而非裸 JSON（SDK 硬编码 JSON，由包装中间件改写——非技术人员看到 JSON
 *    会恐慌）。提权/换校区必须 admin 在管理面手工调整。
 *
 * 注册**不走** SDK 自助注册（allowRegister=false）——值班系统是 admin 建号带 role/campus，
 * 由业务路由 POST /api/v1/users 调 passwordProvider.register + 建 profile（见 routes/users.ts）。
 */
import { Hono, type MiddlewareHandler } from 'hono';
import {
  SessionManager,
  PasswordProvider,
  createDrizzleSessionStore,
  createDrizzleUserStore,
  createDrizzlePasswordStore,
  createDrizzleOidcLinkStore,
  OidcClient,
  IdentityNotLinkedError,
  type UserStore,
  type OidcLinkStore,
  type IdentityResolver,
  type LocalUser,
} from '@homurajs/auth';
import { createAuthRoutes, sessionMiddleware } from '@homurajs/auth/hono';
import { createMemoryTtlKv, type Logger } from '@homurajs/core';
import { dingtalkOidc } from '@homurajs/3p/dingtalk';

import type { DbHandle } from '../db/client.js';
import type { AppConfig } from '../config.js';
import { jitProvision, isJitBlock } from './auto-link.js';

/** 钉钉在 oidc_identity_links 里的 provider 标识（绑定路由与解析共用） */
export const DINGTALK_PROVIDER = 'dingtalk';

export interface AuthBundle {
  sessions: SessionManager;
  sessionMiddleware: MiddlewareHandler;
  /** SDK 路由：/auth/password/login、/auth/oidc/authorize、/auth/refresh、/auth/logout（挂到根，非 /api/v1） */
  authRoutes: Hono;
  /** 业务建号用（admin 创建用户）：register 建 user+password，profile 另建 */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
  /**
   * IdP 身份关联存储（oidc_identity_links 表）。
   * 用途：① 钉钉扫码登录的 IdentityResolver 查绑定；② 管理面「用户 ↔ 钉钉 userid」绑定；
   * ③ 钉钉域身份解析（resolveDingtalkUserId）。
   */
  linkStore: OidcLinkStore;
  /** 钉钉扫码登录是否已启用（凭证齐备才挂 /auth/oidc/*） */
  oauthEnabled: boolean;
}

export interface BuildAuthOptions {
  /** cookie Secure：https 部署传 true，本地 http dev 传 false（由 adapter.trustProxy 接线） */
  secure: boolean;
  /** 未登录页面请求 302 的目标（SDK 不渲染登录页，指向 SPA 登录路由） */
  loginPath: string;
  /** 可选日志（自动绑定成功 / 拒绝原因记录到服务端日志，不透出给用户） */
  logger?: Logger;
}

export function buildAuth(handle: DbHandle, cfg: AppConfig, opts: BuildAuthOptions): AuthBundle {
  const secret = cfg.get('sessionSecret');

  const sessionStore = createDrizzleSessionStore(handle.db as never);
  const userStore = createDrizzleUserStore(handle.db as never);
  const passwordStore = createDrizzlePasswordStore(handle.db as never);
  const linkStore = createDrizzleOidcLinkStore(handle.db as never);

  const sessions = new SessionManager({ secret }, sessionStore);
  const passwordProvider = new PasswordProvider({ userStore, passwordStore });

  const mw = sessionMiddleware(sessions, { bearer: true, secure: opts.secure });

  // ── 钉钉扫码登录（凭证齐备才挂载；缺任一配置即只有账密通道）────────
  const oauthOrgId = cfg.get('oauthDingtalkOrgId');
  const oauthClientId = cfg.get('oauthClientId');
  const oauthClientSecret = cfg.get('oauthClientSecret');
  const oauthRedirectUri = cfg.get('oauthRedirectUri');
  const oauthEnabled = Boolean(oauthOrgId && oauthClientId && oauthClientSecret && oauthRedirectUri);

  let oidc: Parameters<typeof createAuthRoutes>[0]['oidc'];
  if (oauthEnabled) {
    // 3p 的 dingtalkOidc 预设：issuer + endpoints + mapUser（oidc-dingtalk userinfo → AuthUser）
    const preset = dingtalkOidc({ orgId: oauthOrgId!, baseUrl: cfg.get('oauthDingtalkBaseUrl') || undefined });
    const client = new OidcClient({
      clientId: oauthClientId!,
      clientSecret: oauthClientSecret!, // 兼作 id_token HS256 验签密钥
      redirectUri: oauthRedirectUri!,
      scopes: ['openid'],
      stateKv: createMemoryTtlKv(),
      // state 一次性消费（5min TTL，防 CSRF）；内存 KV（多实例部署需换 db/redis 实现）
      ...preset,
    });
    // 自定义 IdentityResolver：显式绑定优先；无绑定时 JIT 建户（userid 命中
    // 通讯录即建号+绑定+登录）；不在通讯录抛 IdentityNotLinkedError（SDK 转 JSON，再由
    // 下方包装中间件改写成友好页），绝不放行白名单之外的人。
    const identityResolver: IdentityResolver = {
      async resolve(provider: string, providerSub: string, _profile): Promise<LocalUser> {
        const link = await linkStore.findByProvider(provider, providerSub);
        if (link) {
          const user = await userStore.findById(link.userId);
          if (user) return user;
        }
        if (provider === DINGTALK_PROVIDER) {
          const result = await jitProvision(
            handle,
            { linkStore, userStore },
            provider,
            providerSub,
            opts.logger,
          );
          if (!isJitBlock(result)) return result;
          opts.logger?.warn('oidc login blocked (jit provision failed)', {
            provider,
            reason: result,
            providerSub,
          });
        }
        throw new IdentityNotLinkedError(provider, providerSub);
      },
    };
    oidc = { client, identityResolver, provider: DINGTALK_PROVIDER };
  }

  const authRoutes = createAuthRoutes({
    sessions,
    password: passwordProvider,
    oidc, // 未配置凭证时为 undefined → 不挂 OIDC 路由
    allowRegister: false, // 值班系统：admin 建号，禁自助注册
    secure: opts.secure,
  });

  // 包装 SDK 路由：OIDC 回调的失败响应（SDK 硬编码 JSON 403/401）改写为中文友好 HTML——
  // 扫码登录的主要用户是非技术人员，裸 JSON（含 provider/sub 技术细节）只会引发恐慌。
  // 原始错误体仍打到服务端日志便于排查。账密等 JSON API 不受影响。
  const wrappedAuthRoutes = new Hono();
  wrappedAuthRoutes.use('/auth/oidc/callback', async (c, next) => {
    await next();
    const res = c.res;
    if (res.status !== 403 && res.status !== 401) return;
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return;
    const raw = await res.text();
    console.error('[oidc/callback] login rejected:', raw.slice(0, 500));
    let body: { error?: string } | null = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* 非 JSON 兜底按 oidc_failed 处理 */
    }
    const kind = body?.error === 'identity_not_linked' ? 'not_linked' : 'failed';
    // 「返回登录」目标：优先从 redirectUri 推导 SPA 部署前缀（子路径部署下 /login 会 404）
    const base = (cfg.get('oauthRedirectUri') || '').replace(/\/auth\/oidc\/callback$/, '');
    const backTo = (base || opts.loginPath) + (base ? '/login' : '');
    c.res = new Response(oauthErrorHtml(kind, backTo), {
      status: res.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  wrappedAuthRoutes.route('/', authRoutes);

  return { sessions, sessionMiddleware: mw, authRoutes: wrappedAuthRoutes, passwordProvider, userStore, linkStore, oauthEnabled };
}

/**
 * OIDC 登录失败友好页（中文、无技术细节、无 provider/sub）。
 * kind=not_linked：钉钉身份未关联到系统账号（不在学校通讯录）；
 * kind=failed：登录过程异常（重试即可，多次失败找管理员）。
 */
function oauthErrorHtml(kind: 'not_linked' | 'failed', backTo: string): string {
  const notLinked = kind === 'not_linked';
  const title = notLinked ? '暂时无法登录' : '登录失败';
  const hint = notLinked
    ? '您的钉钉账号不在学校通讯录中，暂时无法登录。<br>请联系管理员确认您已加入学校钉钉组织，并在系统中同步通讯录。'
    : '钉钉登录过程中出现异常，请返回后重试。<br>如多次尝试仍失败，请联系管理员。';
  const safeBack = backTo.replace(/"/g, '%22');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f4f5f7;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#333}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);
        max-width:420px;width:calc(100% - 48px);padding:36px 32px;text-align:center}
  .icon{font-size:44px;margin-bottom:12px}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:14px;line-height:1.8;color:#666;margin:0 0 24px}
  a.btn{display:inline-block;padding:10px 28px;border-radius:8px;background:#2563eb;color:#fff;
        text-decoration:none;font-size:14px}
  a.btn:hover{background:#1d4ed8}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${notLinked ? '🔒' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${hint}</p>
    <a class="btn" href="${safeBack}">返回登录</a>
  </div>
</body>
</html>`;
}

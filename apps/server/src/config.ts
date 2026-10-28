/**
 * 配置装载 —— 配置即文档（@homurajs/core defineConfig）。
 *
 * 修复现有缺陷：JWT_SECRET 硬编码 fallback（生产不设 env 即用公开弱密钥）→
 * SESSION_SECRET 设为 required，缺失即 fail fast（启动期抛错，不带病上线）。
 *
 * 加载顺序（core README 硬约束）：applyEnvFile(process.env) 必须在 load() 之前。
 */
import { defineConfig, parses, applyEnvFile, createLogger } from '@homurajs/core';

/** 部署期配置文件并入 env（真实 env 优先） */
applyEnvFile(process.env);

const config = defineConfig({
  // ── 监听 ──
  port: { env: 'PORT', default: 3000, parse: parses.int, description: '监听端口' },
  host: { env: 'HOST', parse: parses.string, description: '监听地址（缺省 0.0.0.0）' },
  trustProxy: {
    env: 'TRUST_PROXY',
    default: false,
    parse: parses.boolean,
    description: '是否在反向代理后（决定 cookie Secure 与 X-Forwarded-* 可信度）',
  },

  // ── 数据方言 ──
  dbDialect: {
    env: 'DB_DIALECT',
    default: 'sqlite',
    parse: parses.string,
    description: "数据方言：'sqlite' | 'pg'（缺省 sqlite）",
  },
  dbPath: {
    env: 'DB_PATH',
    default: './data/app.db',
    parse: parses.string,
    description: 'sqlite 数据库文件路径（dialect=sqlite 时用）',
  },
  databaseUrl: {
    env: 'DATABASE_URL',
    parse: parses.string,
    secret: true,
    description: 'PostgreSQL 连接串（dialect=pg 时必填）',
  },

  // ── 认证（@homurajs/auth SessionManager）──
  sessionSecret: {
    env: 'SESSION_SECRET',
    parse: parses.string,
    required: true,
    secret: true,
    description: 'session HS256 签名密钥（>=32 bytes，必填）',
  },

  // ── 对象存储（@homurajs/storage local 后端）──
  storageRoot: {
    env: 'STORAGE_ROOT',
    default: './data/files',
    parse: parses.string,
    description: 'local-fs 存储后端根目录',
  },

  // ── 静态资源 / CORS ──
  assetsDir: {
    env: 'HOMURA_ASSETS_DIR',
    parse: parses.string,
    description: '前端静态资源目录（缺省 RuntimeAdapter.assetsDir：HOMURA_ASSETS_DIR ?? dist/client）',
  },
  corsOrigins: {
    env: 'CORS_ORIGINS',
    default: 'http://localhost:5173,http://127.0.0.1:5173',
    parse: parses.string,
    description: 'CORS 允许的来源（逗号分隔）；修复现有硬编码 localhost 缺陷',
  },

  // ── 钉钉集成（自 guga-onduty-w 移植：通讯录同步 + 通知基建 + 扫码登录）──
  // 全部可选：**缺省不启用**，此时推送落库标记 pending + 打日志，凭证到位后可补发，
  // 不阻塞业务主链路（降级优先于「配了才能用」）。
  dingtalkAppKey: {
    env: 'DINGTALK_APP_KEY',
    parse: parses.string,
    description: '钉钉企业应用 AppKey（配置即启用推送与通讯录同步能力）',
  },
  dingtalkAppSecret: {
    env: 'DINGTALK_APP_SECRET',
    parse: parses.string,
    secret: true,
    description: '钉钉企业应用 AppSecret',
  },
  dingtalkAgentId: {
    env: 'DINGTALK_AGENT_ID',
    parse: parses.string,
    description: '钉钉工作通知 agentId（asyncsend_v2 必需；无法从 AppKey 反推，需后台查看或调 GET /dingtalk/apps）',
  },
  oauthDingtalkOrgId: {
    env: 'OAUTH_DINGTALK_ORG_ID',
    parse: parses.string,
    description: 'oidc-dingtalk 组织标识（配置即启用钉钉扫码登录，教师免账密）',
  },
  oauthDingtalkBaseUrl: {
    env: 'OAUTH_DINGTALK_BASE_URL',
    parse: parses.string,
    description: 'oidc-dingtalk 部署地址（缺省线上 dingtalk.auth.ahkdxx.cn）',
  },
  oauthClientId: {
    env: 'OAUTH_CLIENT_ID',
    parse: parses.string,
    description: 'OIDC 客户端 id（= 钉钉 AppKey；与 OAUTH_CLIENT_SECRET 配齐才挂登录路由）',
  },
  oauthClientSecret: {
    env: 'OAUTH_CLIENT_SECRET',
    parse: parses.string,
    secret: true,
    description: 'OIDC 客户端密钥（= 钉钉 AppSecret，兼作 id_token HS256 验签密钥）',
  },
  oauthRedirectUri: {
    env: 'OAUTH_REDIRECT_URI',
    parse: parses.string,
    description: 'OIDC 回调地址（…/auth/oidc/callback；本地开发须写 :5173 走 Vite proxy，否则 cookie 落错域）',
  },

  // ── 日志 ──
  logLevel: {
    env: 'LOG_LEVEL',
    default: 'info',
    parse: parses.string,
    description: "日志级别：'debug' | 'info' | 'warn' | 'error'",
  },
});

export type AppConfig = ReturnType<typeof config.load>;

/** 加载并校验配置（缺 required 项即抛错） */
export function loadConfig(): AppConfig {
  return config.load();
}

/** 生成 .env.example 片段（配置即文档） */
export function configHelp(): string {
  return config.help();
}

/** 全局 logger（JSON lines，敏感字段打码） */
export function createAppLogger(cfg: AppConfig) {
  return createLogger({ level: cfg.get('logLevel') as 'debug' | 'info' | 'warn' | 'error' });
}

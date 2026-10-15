/**
 * 配置装载 —— 配置即文档（@homurajs/core defineConfig）。
 *
 * 修复现有缺陷：JWT_SECRET 硬编码 fallback（生产不设 env 即用公开弱密钥）→
 * SESSION_SECRET 设为 required，缺失即 fail fast（启动期抛错，不带病上线）。
 *
 * 加载顺序（core README 硬约束）：applyEnvFile(process.env) 必须在 load() 之前，
 * 以便 qw-pages 形态从随产物携带的 homura.config.env 注入密钥。
 */
import { defineConfig, parses, applyEnvFile, createLogger } from '@homurajs/core';

/** 部署期配置文件并入 env（真实 env 优先；qw-pages 密钥随产物携带的唯一入口） */
applyEnvFile(process.env);

const config = defineConfig({
  // ── 运行形态与监听 ──
  runtime: {
    env: 'HOMURA_RUNTIME',
    parse: parses.string,
    description: "运行形态：'standalone' | 'qw-pages'；缺省自动探测",
  },
  port: { env: 'PORT', default: 3000, parse: parses.int, description: '监听端口' },
  host: { env: 'HOST', parse: parses.string, description: '监听地址（缺省 0.0.0.0）' },
  trustProxy: {
    env: 'TRUST_PROXY',
    default: false,
    parse: parses.boolean,
    description: '是否在反向代理后（决定 cookie Secure 与 X-Forwarded-* 可信度）',
  },

  // ── 数据方言（三轨）──
  dbDialect: {
    env: 'DB_DIALECT',
    default: 'sqlite',
    parse: parses.string,
    description: "数据方言：'sqlite' | 'pg' | 'rest'（缺省 sqlite）",
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
  supabaseUrl: {
    env: 'SUPABASE_URL',
    parse: parses.string,
    description: 'PostgREST/Supabase URL（dialect=rest 时必填；qw-pages 自动注入）',
  },
  supabaseAnonKey: {
    env: 'SUPABASE_ANON_KEY',
    parse: parses.string,
    secret: true,
    description: 'Supabase anon key（dialect=rest 时必填）',
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
    description: '前端静态资源目录（缺省由 RuntimeAdapter.assetsDir 按形态算）',
  },
  corsOrigins: {
    env: 'CORS_ORIGINS',
    default: 'http://localhost:5173,http://127.0.0.1:5173',
    parse: parses.string,
    description: 'CORS 允许的来源（逗号分隔）；修复现有硬编码 localhost 缺陷',
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

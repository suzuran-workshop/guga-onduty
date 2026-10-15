/**
 * E2E 测试台架 —— 启动真实 HTTP 服务（ephemeral 端口 + 临时 sqlite），灌种子数据，
 * 提供按角色的 cookie-jar fetch 客户端。每个测试文件独立 boot/shutdown，库文件隔离。
 *
 * 这是「高覆盖率 E2E」的地基（AGENTS.md 验收标准）：测的是真实中间件链
 * （sessionMiddleware → requireProfile → 路由 → repo → db），非 mock。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeAdapter } from '@homurajs/app-kit/serve';
import { bootstrap, type Bootstrapped } from '../../src/bootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 极简 cookie jar（按名存值，absorb Set-Cookie） */
export class Jar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const name = kv.slice(0, i).trim();
      const val = kv.slice(i + 1).trim();
      if (val === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, val);
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export interface TestClient {
  /** 发请求，返回 {status, json, res, text, bytes} */
  req(method: string, path: string, opts?: { body?: unknown; isForm?: boolean; query?: Record<string, string | number | undefined | null> }): Promise<TestResponse>;
  /** 登录（走 SDK cookie），返回是否成功 */
  login(username: string, password: string): Promise<boolean>;
  jar: Jar;
}

export interface TestResponse {
  status: number;
  json: any;
  res: Response;
  text: () => Promise<string>;
  bytes: () => Promise<Uint8Array>;
}

function buildQuery(path: string, query?: Record<string, string | number | undefined | null>): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `${path}?${s}` : path;
}

export interface Harness {
  base: string;
  port: number;
  booted: Bootstrapped;
  client(jar?: Jar): TestClient;
  /** 便捷：建一个已登录某账号的客户端 */
  loginAs(username: string, password?: string): Promise<TestClient>;
  shutdown(): Promise<void>;
}

/** 随机端口（避开 OS ephemeral 区间常见段，取 30000-45000） */
function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 15000);
}

/** 判断是否端口占用错误（EADDRINUSE） */
function isAddrInUse(e: unknown): boolean {
  const code = (e as any)?.code ?? (e as any)?.cause?.code;
  return code === 'EADDRINUSE';
}

/**
 * 启动测试服务（独立 sqlite 文件 + 端口）。
 *
 * ⚠ 端口冲突重试：boot() 在各测试文件的 beforeAll 里调用，若 adapter.start 撞上已被占用的
 * 随机端口（EADDRINUSE），beforeAll 抛错会导致**整个文件加载失败**（全部用例 skipped），
 * 表现为偶发的 flaky 套件。故此处对端口绑定做重试（最多 5 次，每次换端口）。
 */
export async function boot(tag: string, opts?: { port?: number }): Promise<Harness> {
  let port = opts?.port ?? randomPort();
  const DB = join(__dirname, `../../data/test-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
  const FILES = join(__dirname, `../../data/test-files-${tag}-${Date.now()}`);
  rmSync(DB, { force: true });
  mkdirSync(dirname(DB), { recursive: true });

  process.env.SESSION_SECRET = 'test-secret-key-minimum-32-bytes-long-xxxx';
  process.env.DB_DIALECT = 'sqlite';
  process.env.DB_PATH = DB;
  process.env.STORAGE_ROOT = FILES;
  process.env.PORT = String(port);
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.LOG_LEVEL = 'error'; // 静音请求日志，保持测试输出干净

  const adapter = createNodeAdapter();
  const booted = await bootstrap({ secure: false, staticDir: undefined, loginPath: '/login' });
  const ac = new AbortController();

  // 端口冲突重试（EADDRINUSE → 换端口重试；显式指定 opts.port 时不重试，直接暴露问题）
  let started = false;
  for (let attempt = 0; attempt < 5 && !started; attempt++) {
    try {
      await adapter.start(booted.homura.app, { port, signal: ac.signal });
      started = true;
    } catch (e) {
      if (isAddrInUse(e) && opts?.port === undefined) {
        port = randomPort();
        process.env.PORT = String(port);
        continue;
      }
      // 非端口冲突错误，或显式端口：清理后抛出
      booted.shutdown();
      rmSync(DB, { force: true });
      throw e;
    }
  }
  if (!started) {
    booted.shutdown();
    rmSync(DB, { force: true });
    throw new Error(`boot(${tag}): 5 次尝试后仍无法绑定端口`);
  }

  // 等端口就绪
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) break;
    } catch { /* 未就绪，重试 */ }
    await new Promise((r) => setTimeout(r, 50));
  }

  const base = `http://127.0.0.1:${port}`;

  function client(jar = new Jar()): TestClient {
    return {
      jar,
      async req(method, path, o = {}) {
        const headers: Record<string, string> = {};
        const ck = jar.header();
        if (ck) headers['Cookie'] = ck;
        let payload: BodyInit | undefined;
        if (o.body !== undefined) {
          if (o.isForm) payload = o.body as BodyInit;
          else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(o.body); }
        }
        const res = await fetch(base + buildQuery(path, o.query), { method, headers, body: payload, redirect: 'manual' });
        jar.absorb(res);
        const ct = res.headers.get('content-type') || '';
        const json = ct.includes('json') ? await res.json().catch(() => null) : null;
        return {
          status: res.status,
          json,
          res,
          text: () => res.text(),
          bytes: async () => new Uint8Array(await res.arrayBuffer()),
        };
      },
      async login(username, password = '123456') {
        const r = await this.req('POST', '/auth/password/login', { body: { username, password } });
        return r.status === 200;
      },
    };
  }

  async function loginAs(username: string, password = '123456'): Promise<TestClient> {
    const c = client();
    const okk = await c.login(username, password);
    if (!okk) throw new Error(`登录失败：${username}`);
    return c;
  }

  async function shutdown() {
    ac.abort();
    booted.shutdown();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(DB, { force: true });
    rmSync(DB + '-wal', { force: true });
    rmSync(DB + '-shm', { force: true });
    rmSync(FILES, { recursive: true, force: true });
  }

  return { base, port, booted, client, loginAs, shutdown };
}

/**
 * 灌一套标准种子（复用 repos，与生产 seed 同构）：
 * 2 校区 / c1 四用户 admin+teacher1(李老师)+teacher2(王老师)+teacher3(赵老师) / semester_start。
 * 低权限 RBAC 反例由 teacher2/teacher3（无 canInspect 的普通教师）承担。
 * 返回关键 id 供断言。
 */
export async function seedStandard(h: Harness) {
  const R = h.booted.repos;
  const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
  const c2 = await R.campuses.create({ name: '第二校区', code: 'campus_02' });
  const admin = await R.users.create({ campusId: c1.id, username: 'admin', password: '123456', displayName: '系统管理员', role: 'admin' });
  const teacher = await R.users.create({ campusId: c1.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });
  const teacher2 = await R.users.create({ campusId: c1.id, username: 'teacher2', password: '123456', displayName: '王老师', role: 'teacher' });
  const teacher3 = await R.users.create({ campusId: c1.id, username: 'teacher3', password: '123456', displayName: '赵老师', role: 'teacher' });
  await R.settings.upsertMany(c1.id, [{ key: 'semester_start', value: '2026-09-01' }]);
  return { c1, c2, admin, teacher, teacher2, teacher3 };
}

/** 构造一个 1x1 PNG（图片上传测试用） */
export function tinyPng(): File {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], 'a.png', { type: 'image/png' });
}

/**
 * API 客户端 —— cookie 优先（credentials:'include'）+ 统一响应解包。
 *
 * 迁移要点（docs §3.2）：
 *  - 旧代码手动管 localStorage token + Authorization 头；现在 auth SDK 下发 HttpOnly cookie，
 *    所有请求带 credentials:'include' 即可，access 过期由服务端透明 rotate。
 *  - 登录走 SDK 的 /auth/password/login（cookie 下发），其余业务走 /api/v1/*。
 *  - 统一解包 {success,data,pagination}；success:false 抛 ApiError。
 *  - 401 → 清状态 + 跳登录（由 useAuth 处理，这里只抛）。
 */
import type { ApiResponse, ApiError as ApiErrorBody, Pagination } from '@guga-onduty/shared';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * 子路径部署 base（nginx 子路径反代场景，如 /bengbu3shixiao/onduty）。
 * vite build --base=<path>/ 时由 BASE_URL 注入；根部署（BASE_URL='/'）归一为空串。
 * 所有同源绝对路径（/api、/auth、/files）必须经 withBase 拼接，否则子路径下 404。
 */
export const APP_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

const API_BASE = `${APP_BASE}/api/v1`;

/**
 * 401 全局处理器 —— 会话过期（access+refresh 都失效）时清登录态。
 * useAuth 挂载时注入（setMe(null)），App 的 ProtectedRoute 随即跳 /login。
 * 登录/刷新过程中的 401 由调用方 catch，不触发全局跳转（见 authApi.login 直接 fetch，不经此处）。
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** FormData（图片上传）—— 不设 Content-Type，交给浏览器带 boundary */
  isForm?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined | null>;
}

/** 拼 query string（跳过 undefined/null/空串） */
function withQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/** 底层请求：返回解包后的 {data, pagination} */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; pagination?: Pagination }> {
  const { method = 'GET', body, isForm, signal, query } = opts;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as BodyInit; // FormData，不手动设 Content-Type
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  const res = await fetch(withQuery(path, query), {
    method,
    headers,
    body: payload,
    credentials: 'include', // cookie（access+refresh）
    signal,
    redirect: 'manual', // 不自动跟随 302（未登录时服务端可能重定向）
  });

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const parsed = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    // 会话过期：触发全局清态（ProtectedRoute 随后跳登录）
    if (res.status === 401) unauthorizedHandler?.();
    const err = parsed as ApiErrorBody | null;
    throw new ApiClientError(
      err?.error?.code ?? `HTTP_${res.status}`,
      err?.error?.message ?? `请求失败（${res.status}）`,
      res.status,
      err?.error?.details,
    );
  }

  // 成功：解包 {success, data, pagination}
  const body0 = parsed as ApiResponse<T> | null;
  return { data: (body0?.data ?? (parsed as T)), pagination: body0?.pagination };
}

export const api = {
  get<T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) {
    return request<T>(`${API_BASE}${path}`, { method: 'GET', query, signal });
  },
  post<T>(path: string, body?: unknown, opts?: { isForm?: boolean }) {
    return request<T>(`${API_BASE}${path}`, { method: 'POST', body, isForm: opts?.isForm });
  },
  put<T>(path: string, body?: unknown) {
    return request<T>(`${API_BASE}${path}`, { method: 'PUT', body });
  },
  delete<T>(path: string) {
    return request<T>(`${API_BASE}${path}`, { method: 'DELETE' });
  },
  /** 文件上传（multipart，图片）—— records 用 */
  upload<T>(path: string, form: FormData) {
    return request<T>(`${API_BASE}${path}`, { method: 'POST', body: form, isForm: true });
  },
  /**
   * 下载二进制（CSV 导出）—— fetch 无法用 window.open 带 cookie，故走 fetch + blob。
   * 返回 Blob 供前端触发下载。
   */
  async download(path: string, filename: string): Promise<void> {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
    if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', `下载失败（${res.status}）`, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// ── 认证端点（SDK 路径，不在 /api/v1 下）────────────────────────────
export const authApi = {
  /** 登录：POST /auth/password/login → {ok:true} + Set-Cookie（HttpOnly） */
  async login(username: string, password: string): Promise<void> {
    const res = await fetch(`${APP_BASE}/auth/password/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new ApiClientError(
        err?.error ?? 'INVALID_CREDENTIALS',
        err?.error === 'invalid_body' ? '请求格式错误' : '用户名或密码错误',
        res.status,
      );
    }
  },
  /** 登出：POST /auth/logout（清 cookie） */
  async logout(): Promise<void> {
    await fetch(`${APP_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  },
};

/** storage 文件代理 URL（图片 src 用；同源自动带 cookie） */
export function fileUrl(objectKey: string): string {
  return `${APP_BASE}/files/${objectKey}`;
}

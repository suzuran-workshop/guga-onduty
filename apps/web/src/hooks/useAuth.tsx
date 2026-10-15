/**
 * 认证上下文 —— cookie 会话 + 业务档案（docs §3.2）。
 *
 * 迁移要点（对照旧 hooks/useAuth.tsx）：
 *  - 旧：localStorage token + /auth/login 返回 {token,user}，手动管 token。
 *  - 新：SDK cookie（HttpOnly，credentials:'include'），登录 POST /auth/password/login；
 *    身份 + 角色从 GET /api/v1/auth/me 取（{user, profile, campusName}）。
 *  - user/profile 都不持久化（cookie 是唯一真源）；刷新时靠 /me 重建（401 即未登录）。
 *  - RBAC 数据源：profile.role（前端路由守卫 + 菜单过滤都读它）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, UserProfile, UserRole } from '@guga-onduty/shared';
import { api, authApi, ApiClientError, setUnauthorizedHandler } from '../api/client';

interface MeResponse {
  user: User;
  profile: UserProfile;
  campusName: string;
}

interface AuthContextValue {
  /** auth 身份锚点（username/nickname/avatarUrl） */
  user: User | null;
  /** 业务档案（role/campusId/displayName）—— RBAC 与校区上下文的数据源 */
  profile: UserProfile | null;
  campusName: string;
  /** 首屏 /me 加载中（未知登录态） */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** RBAC 助手：当前角色是否在允许集 */
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 首屏：探测登录态（cookie 有效则 /me 成功）
  useEffect(() => {
    let alive = true;
    // 注册全局 401 处理：会话过期时清态 → ProtectedRoute 跳 /login
    setUnauthorizedHandler(() => { if (alive) setMe(null); });
    (async () => {
      try {
        const { data } = await api.get<MeResponse>('/auth/me');
        if (alive) setMe(data);
      } catch {
        if (alive) setMe(null); // 401 或网络错 → 未登录
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await authApi.login(username, password); // 下发 cookie
    const { data } = await api.get<MeResponse>('/auth/me'); // 拉身份+档案
    setMe(data);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout(); // 清 cookie
    setMe(null);
  }, []);

  const hasRole = useCallback(
    (...roles: UserRole[]) => (me?.profile ? roles.includes(me.profile.role) : false),
    [me],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me?.user ?? null,
      profile: me?.profile ?? null,
      campusName: me?.campusName ?? '',
      loading,
      login,
      logout,
      hasRole,
    }),
    [me, loading, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

export { ApiClientError };

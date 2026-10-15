/**
 * 路由 + 守卫 —— react-router 7。
 *
 * 路由表（值班域）：
 *   /login            登录（已登录则重定向 /）
 *   /                 → 值班大表（默认落地页）
 *   /duty/schedule    值班大表矩阵
 *   /duty/checkin     执勤打卡
 *   /duty/inspection  领导巡查（admin+teacher；页面内再校验 canInspect）
 *   /duty/swap        调班申请
 *   /duty/report      值班统计
 *   /duty/config      值班配置（仅 admin）
 *   /config           配置中心（校区/用户，仅 admin）
 *   /settings         系统设置（仅 admin）
 *
 * 守卫：ProtectedRoute（需登录）；RequireRole（路由级 RBAC，与后端矩阵对齐）。
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { UserRole } from '@guga-onduty/shared';
import { useAuth } from '@/hooks/useAuth';
import { Layout } from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DutySchedulePage from '@/pages/DutySchedulePage';
import DutyCheckinPage from '@/pages/DutyCheckinPage';
import DutyInspectionPage from '@/pages/DutyInspectionPage';
import DutySwapPage from '@/pages/DutySwapPage';
import DutyReportPage from '@/pages/DutyReportPage';
import DutyConfigPage from '@/pages/DutyConfigPage';
import ConfigPage from '@/pages/ConfigPage';
import SettingsPage from '@/pages/SettingsPage';

/** 全屏加载占位（首屏 /me 探测中） */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">加载中…</div>
    </div>
  );
}

/** 需登录守卫：未登录跳 /login（记住来源） */
function ProtectedRoute({ children }: { children: ReactElement }) {
  const { profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** 路由级 RBAC：角色不符 → 回首页（不渲染越权页面） */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactElement }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DutySchedulePage />} />
                <Route path="/duty/schedule" element={<DutySchedulePage />} />
                <Route path="/duty/checkin" element={<DutyCheckinPage />} />
                <Route
                  path="/duty/inspection"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <DutyInspectionPage />
                    </RequireRole>
                  }
                />
                <Route path="/duty/swap" element={<DutySwapPage />} />
                <Route path="/duty/report" element={<DutyReportPage />} />
                <Route
                  path="/duty/config"
                  element={
                    <RequireRole roles={['admin']}>
                      <DutyConfigPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/config"
                  element={
                    <RequireRole roles={['admin']}>
                      <ConfigPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RequireRole roles={['admin']}>
                      <SettingsPage />
                    </RequireRole>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

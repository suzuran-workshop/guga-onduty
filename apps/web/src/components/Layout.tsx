/**
 * 布局 —— 侧边栏 + 顶栏（shadcn/ui + lucide）。
 *
 * 导航（值班域）：值班大表 / 执勤打卡 / 领导巡查 / 调班申请 / 值班统计 / 值班配置 + 配置中心/系统设置。
 * 菜单按角色过滤（visibleNav），路由级 RBAC 已在 App.tsx 的 RequireRole 兜底。
 * 顶栏用户区：displayName + 角色 + 下拉（退出）。
 *
 * 移动端（<lg）：侧边栏折叠为抽屉（Sheet，左滑出），顶栏出汉堡按钮；桌面端恒显侧边栏。
 * 路由切换后自动收起抽屉。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck, BarChart3, Settings, SlidersHorizontal,
  Building2, LogOut, ChevronsUpDown, Menu,
  CalendarDays, Search, ArrowLeftRight, Settings2,
} from 'lucide-react';
import type { UserRole } from '@guga-onduty/shared';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  i18nKey: string;
  icon: ReactNode;
  roles?: UserRole[]; // 缺省 = 所有角色可见
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/duty/schedule', i18nKey: 'nav.dutySchedule', icon: <CalendarDays className="h-4 w-4" />, exact: true },
  { to: '/duty/checkin', i18nKey: 'nav.dutyCheckin', icon: <ClipboardCheck className="h-4 w-4" /> },
  { to: '/duty/inspection', i18nKey: 'nav.dutyInspection', icon: <Search className="h-4 w-4" />, roles: ['admin', 'teacher'] },
  { to: '/duty/swap', i18nKey: 'nav.dutySwap', icon: <ArrowLeftRight className="h-4 w-4" /> },
  { to: '/duty/report', i18nKey: 'nav.dutyReport', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/duty/config', i18nKey: 'nav.dutyConfig', icon: <Settings2 className="h-4 w-4" />, roles: ['admin'] },
  { to: '/config', i18nKey: 'nav.config', icon: <Settings className="h-4 w-4" />, roles: ['admin'] },
  { to: '/settings', i18nKey: 'nav.settings', icon: <SlidersHorizontal className="h-4 w-4" />, roles: ['admin'] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { profile, campusName, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 路由切换后收起移动端抽屉
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const role = profile?.role;
  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));

  // 当前页标题（反查 nav）
  const current =
    NAV_ITEMS.find((n) => (n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to) && n.to !== '/')) ??
    NAV_ITEMS[0];
  const pageTitle = t(current.i18nKey);
  const displayName = profile?.displayName ?? '';

  const renderNav = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-1 p-2">
      {visibleNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.exact}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )
          }
        >
          {item.icon}
          {t(item.i18nKey)}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <Building2 className="h-5 w-5 text-primary" />
      <span className="font-semibold">{t('app.title')}</span>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* 桌面侧边栏（≥lg 恒显） */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card lg:flex">
        {brand}
        {renderNav()}
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4 sm:px-6">
          <div className="flex items-center gap-1 sm:gap-2">
            {/* 移动端汉堡 → 抽屉导航 */}
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('nav.menu')}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
                <SheetHeader className="border-b p-0">
                  <SheetTitle className="sr-only">{t('app.title')}</SheetTitle>
                  {brand}
                </SheetHeader>
                {renderNav(() => setDrawerOpen(false))}
              </SheetContent>
            </Sheet>
            <h1 className="truncate text-base font-semibold">{pageTitle}</h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="hidden text-left sm:block">
                  <div className="text-sm font-medium leading-tight">{displayName}</div>
                  <div className="text-xs text-muted-foreground leading-tight">
                    {role ? t(`roles.${role}`) : ''}
                    {campusName ? ` · ${campusName}` : ''}
                  </div>
                </div>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {campusName || t('app.title')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <Separator className="hidden" />
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/**
 * 登录页 —— shadcn Card + cookie 登录。
 * 迁移：旧 Fluent Card/Input/Button → shadcn；登录走 useAuth.login（SDK cookie）。
 */
import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Lock, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { APP_BASE } from '@/api/client';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  /** 钉钉扫码登录是否可用（后端 OAUTH_* 凭证齐备才开启；免登录探测） */
  const [oauthLogin, setOauthLogin] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  useEffect(() => {
    fetch(`${APP_BASE}/api/public/dingtalk/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setOauthLogin(Boolean(j?.data?.oauthLogin)))
      .catch(() => setOauthLogin(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="size-6 text-primary" />
          </div>
          <CardTitle className="text-xl">{t('app.title')}</CardTitle>
          <CardDescription>{t('app.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.username')}</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  className="pl-9"
                  placeholder={t('auth.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  className="pl-9"
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.loginLoading') : t('auth.login')}
            </Button>
          </form>
          {oauthLogin && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t('auth.or')}</span>
                </div>
              </div>
              {/* 免账密扫码：SDK GET /auth/oidc/authorize → 302 oidc-dingtalk → 回调建会话。
                  通讯录命中即自动建号（JIT；oidc_identity_links 绑定，未在通讯定引导联系管理员）。 */}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.href = `${APP_BASE}/auth/oidc/authorize?returnTo=${encodeURIComponent(APP_BASE + from)}`;
                }}
              >
                {t('auth.dingtalkLogin')}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">{t('auth.dingtalkLoginHint')}</p>
            </>
          )}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t('auth.testAccounts')} admin / teacher1 / teacher2
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

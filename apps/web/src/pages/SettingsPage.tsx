/**
 * 系统设置 —— 值班域校区设置 + 钉钉集成管理面（admin only）。
 *
 *  - GET /settings 返回 key-value map（Record<string,string>）。
 *  - PUT /settings 从 profile 取校区，body {settings:[{key,value}]}。
 *  - semester_start（YYYY-MM-DD）：驱动全校单双周排班的奇偶对齐（resolveParityAnchor）。
 *  - 钉钉节（自 guga-onduty-w 移植）：状态/通讯录同步/联系人/通知日志/补发/测试发送。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Users, FileText, Inbox, RefreshCw, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { DingtalkContact, NotificationLog } from '@guga-onduty/shared';

type SettingsMap = Record<string, string>;

/** GET /dingtalk/status 的返回形状 */
interface DingtalkStatus {
  enabled: boolean;
  reason: string | null;
  agentId: string | null;
  capabilities: string[];
  oauth: boolean;
  contacts: boolean;
  message: boolean;
  apps: boolean;
  oauthLogin: boolean;
}

type DingtalkTab = 'contacts' | 'notifications';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [settings, setSettings] = useState<SettingsMap>({});
  const [semesterStart, setSemesterStart] = useState('');

  // ── 钉钉管理面状态 ──
  const [dt, setDt] = useState<DingtalkStatus | null>(null);
  const [dingtalkTab, setDingtalkTab] = useState<DingtalkTab>('contacts');
  const [contacts, setContacts] = useState<DingtalkContact[]>([]);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm, setSendForm] = useState({ dingtalkUserId: '', title: '', markdownText: '' });

  const isAdmin = profile?.role === 'admin';

  const loadDingtalk = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await api.get<DingtalkStatus>('/dingtalk/status');
      setDt(r.data);
    } catch { /* 忽略 */ }
    try {
      if (dingtalkTab === 'contacts') {
        const r = await api.get<DingtalkContact[]>('/dingtalk/contacts', { limit: 500 });
        setContacts(r.data);
      } else {
        const r = await api.get<NotificationLog[]>('/dingtalk/notifications', { pageSize: 50 });
        setNotifications(r.data);
      }
    } catch { /* 忽略 */ }
  }, [isAdmin, dingtalkTab]);

  useEffect(() => {
    api.get<SettingsMap>('/settings').then((r) => {
      setSettings(r.data);
      setSemesterStart(r.data.semester_start ?? '');
    }).catch(() => { /* 忽略 */ });
  }, []);

  useEffect(() => { loadDingtalk(); }, [loadDingtalk]);

  async function save() {
    try {
      await api.put('/settings', { settings: [{ key: 'semester_start', value: semesterStart }] });
      setSettings((prev) => ({ ...prev, semester_start: semesterStart }));
      toast.success(t('settings.savedOk'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function syncContacts() {
    setSyncing(true);
    try {
      const r = await api.post<{ synced: number; depts: number; truncated: boolean; errors: { deptId: number; message: string }[] }>('/dingtalk/sync');
      const d = r.data;
      toast.success(t('settings.dingtalk.syncOk', { synced: d.synced, depts: d.depts }));
      if (d.truncated) {
        toast.warning(t('settings.dingtalk.syncTruncated', { count: d.errors.length }));
      }
      loadDingtalk();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setSyncing(false);
    }
  }

  async function flushPending() {
    setFlushing(true);
    try {
      const r = await api.post<{ sent: number; failed: number }>('/dingtalk/notifications/flush');
      toast.success(t('settings.dingtalk.flushOk', { sent: r.data.sent, failed: r.data.failed }));
      loadDingtalk();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setFlushing(false);
    }
  }

  async function sendTest() {
    try {
      await api.post('/dingtalk/send', {
        dingtalk_user_id: sendForm.dingtalkUserId || undefined,
        title: sendForm.title,
        markdown_text: sendForm.markdownText,
      });
      toast.success(t('settings.dingtalk.sendOk'));
      setSendOpen(false);
      loadDingtalk();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  const lastSyncedAt = contacts.length > 0 ? Math.max(...contacts.map((c) => c.syncedAt)) : null;
  const formatTime = (n: number) => new Date(n).toISOString().replace('T', ' ').slice(0, 19);
  const dtEnabled = dt?.enabled ?? false;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('settings.title')}</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('settings.campusSettings')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label className="text-base">{t('settings.semesterStart')}</Label>
          <p className="text-sm text-muted-foreground">{t('settings.semesterStartDesc')}</p>
          <div className="flex items-center gap-4">
            <Input
              type="date"
              className="max-w-xs"
              value={semesterStart}
              onChange={(e) => setSemesterStart(e.target.value)}
            />
            <Button onClick={save}>{t('common.save')}</Button>
          </div>
          {settings.semester_start === undefined && (
            <p className="text-xs text-muted-foreground">{t('settings.semesterStart')}?</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <div className="font-semibold">{t('settings.dingtalk.section')}</div>
              {dt && (
                dtEnabled
                  ? <Badge variant="success">{t('settings.dingtalk.statusEnabled')}</Badge>
                  : <Badge variant="secondary">{t('settings.dingtalk.statusDisabled')}</Badge>
              )}
              {dt?.oauthLogin && <Badge variant="outline">{t('settings.dingtalk.oauthOn')}</Badge>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
                <Send className="size-4" />{t('settings.dingtalk.sendTest')}
              </Button>
              <Button size="sm" variant="outline" onClick={flushPending} disabled={flushing || !dtEnabled}>
                <Inbox className="size-4" />{flushing ? t('common.loading') : t('settings.dingtalk.flush')}
              </Button>
              <Button size="sm" onClick={syncContacts} disabled={syncing || !dt?.contacts}>
                <RefreshCw className="size-4" />{syncing ? t('settings.dingtalk.syncing') : t('settings.dingtalk.syncContacts')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!dtEnabled && dt?.reason && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{t('settings.dingtalk.disabledReason')}：</span>
                {dt.reason}
              </p>
            )}

            <Tabs value={dingtalkTab} onValueChange={(v) => setDingtalkTab(v as DingtalkTab)}>
              <TabsList>
                <TabsTrigger value="contacts"><Users className="mr-1 size-4" />{t('settings.dingtalk.contacts')}</TabsTrigger>
                <TabsTrigger value="notifications"><FileText className="mr-1 size-4" />{t('settings.dingtalk.notifications')}</TabsTrigger>
              </TabsList>
            </Tabs>

            {dingtalkTab === 'contacts' && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {lastSyncedAt
                    ? `${t('settings.dingtalk.lastSynced')}: ${formatTime(lastSyncedAt).slice(0, 16)}`
                    : t('settings.dingtalk.contactsHint')}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('settings.dingtalk.contactName')}</TableHead>
                      <TableHead>{t('settings.dingtalk.contactTitle')}</TableHead>
                      <TableHead>{t('settings.dingtalk.contactDepts')}</TableHead>
                      <TableHead>{t('settings.dingtalk.contactMobile')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((ct) => (
                      <TableRow key={ct.userId}>
                        <TableCell className="font-medium">{ct.name}</TableCell>
                        <TableCell>{ct.title ?? '--'}</TableCell>
                        <TableCell className="max-w-64 truncate text-muted-foreground">{ct.deptNames?.join(' / ') ?? '--'}</TableCell>
                        <TableCell>{ct.mobile ?? '--'}</TableCell>
                      </TableRow>
                    ))}
                    {contacts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          {t('settings.dingtalk.contactsEmpty')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {contacts.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('settings.dingtalk.contactsCount', { count: contacts.length })}</p>
                )}
              </div>
            )}

            {dingtalkTab === 'notifications' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('settings.dingtalk.notifTime')}</TableHead>
                    <TableHead>{t('settings.dingtalk.notifRecipient')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('settings.dingtalk.notifTitle')}</TableHead>
                    <TableHead>{t('settings.dingtalk.notifError')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notifications.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="whitespace-nowrap">{formatTime(n.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{n.recipientPlatformId}</TableCell>
                      <TableCell>
                        <Badge variant={n.status === 'sent' ? 'success' : n.status === 'pending' ? 'secondary' : 'destructive'}>
                          {t(`settings.dingtalk.status.${n.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-64 truncate">{n.title ?? '--'}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{n.error ?? ''}</TableCell>
                    </TableRow>
                  ))}
                  {notifications.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {t('common.noData')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('settings.dingtalk.sendTest')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t('settings.dingtalk.sendUserId')}</Label>
              <Input
                value={sendForm.dingtalkUserId}
                onChange={(e) => setSendForm((p) => ({ ...p, dingtalkUserId: e.target.value }))}
                placeholder="5314054424-444663015"
              />
              <p className="text-xs text-muted-foreground">{t('settings.dingtalk.sendUserIdHint')}</p>
            </div>
            <div className="space-y-1">
              <Label>{t('settings.dingtalk.notifTitle')}</Label>
              <Input value={sendForm.title} onChange={(e) => setSendForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Markdown</Label>
              <Input value={sendForm.markdownText} onChange={(e) => setSendForm((p) => ({ ...p, markdownText: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSendOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={sendTest} disabled={!sendForm.title || !sendForm.markdownText}>{t('common.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

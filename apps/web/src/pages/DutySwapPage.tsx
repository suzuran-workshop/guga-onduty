/**
 * 调班申请页 —— 教师发起交换/代理，admin 审批（外部 PRD「调班申请」自有实现）。
 *
 * 对照外部 PRD 功能语义：
 *  - 发起：选调班类型（交换/代理）+ 我的排班 + 对方教师(+对方排班，交换时) + 原因。
 *  - 「我的排班」从本人未来排班里选（后端 schedules 列表按 assignee 含本人过滤在前端做）。
 *  - 审批：admin 看全部 pending，批准/驳回（叠加层实时生效，见值班大表）。
 *  - 列表：我发起的 / 待我处理的（教师），全部（admin）。
 *
 * 叠加哲学（后端保证）：审批通过不回改原排班，作为叠加层在矩阵展开时实时命中。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, X, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { dateKey } from '@/lib/date';
import type { SwapRecord, DutySchedule, UserView, SwapStatus, SwapType } from '@guga-onduty/shared';

const STATUS_VARIANT: Record<SwapStatus, 'warning' | 'success' | 'destructive'> = {
  pending: 'warning', approved: 'success', rejected: 'destructive',
};

export default function DutySwapPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [tab, setTab] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [open, setOpen] = useState(false);

  // 列表
  const { data: swaps, loading, reload } = useAsync<SwapRecord[]>(async () => {
    const r = await api.get<SwapRecord[]>('/duty/swaps', { pageSize: 100 });
    return r.data;
  }, [profile?.userId, tab]);

  // 表单数据源：我的排班（未来）+ 全部教师
  const { data: mySchedules } = useAsync<DutySchedule[]>(async () => {
    const r = await api.get<DutySchedule[]>('/duty/schedules', { pageSize: 200 });
    const today = dateKey(new Date());
    // 前端筛：assignee 含本人 且 未过期
    return r.data.filter((s) => s.assigneeIds.includes(profile!.userId) && s.dateEnd >= today);
  }, [profile?.userId]);
  const { data: users } = useAsync<UserView[]>(async () => (await api.get<UserView[]>('/users')).data, [profile?.campusId]);

  // 表单态
  const [type, setType] = useState<SwapType>('proxy');
  const [apSched, setApSched] = useState('');
  const [apDate, setApDate] = useState('');
  const [targetId, setTargetId] = useState('');
  const [tgSched, setTgSched] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openNew() {
    setType('proxy'); setApSched(''); setApDate(dateKey(new Date())); setTargetId(''); setTgSched(''); setReason('');
    setOpen(true);
  }

  async function submit() {
    if (!apSched || !apDate || !targetId || !reason.trim()) { toast.error(t('common.failed')); return; }
    if (type === 'swap' && !tgSched) { toast.error(t('duty.swap.targetSchedule')); return; }
    setSubmitting(true);
    try {
      await api.post('/duty/swaps', {
        type, applicant_schedule_id: apSched, applicant_date: apDate,
        target_id: targetId, target_schedule_id: type === 'swap' ? tgSched : undefined,
        target_date: type === 'swap' ? apDate : undefined, reason: reason.trim(),
      });
      toast.success(t('duty.swap.ok'));
      setOpen(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function review(id: string, decision: 'approved' | 'rejected') {
    try {
      await api.post(`/duty/swaps/${id}/review`, { decision });
      toast.success(t('duty.swap.reviewed'));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  const userName = (id: string) => (users ?? []).find((u) => u.id === id)?.displayName ?? id;
  const schedLabel = (id: string) => {
    const s = (mySchedules ?? []).find((x) => x.id === id);
    return s ? `${s.locationName ?? s.areaName ?? ''} ${t('duty.weekdayName.' + s.weekday)}` : id.slice(0, 8);
  };

  const visible = (swaps ?? []).filter((s) =>
    tab === 'all' ? true : (s.applicantId === profile?.userId || s.targetId === profile?.userId));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ArrowLeftRight className="size-6 text-primary" />{t('duty.swap.title')}
        </h1>
        <Button size="sm" onClick={openNew}><Plus className="size-4" />{t('duty.swap.newSwap')}</Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="mine">{t('duty.swap.myApplied')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="all">{t('common.all')}</TabsTrigger>}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {visible.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('duty.swap.empty')}</div>
          )}
          {visible.map((s) => (
            <div key={s.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{userName(s.applicantId)}</span>
                  <span className="mx-2 text-muted-foreground">
                    {s.type === 'swap' ? t('duty.swap.typeSwap') : t('duty.swap.typeProxy')}
                  </span>
                  → <span className="font-medium">{userName(s.targetId)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{s.applicantDate}</span>
                </div>
                <Badge variant={STATUS_VARIANT[s.status]}>{t('duty.swap.' + s.status)}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t('duty.swap.reason')}: {s.reason}</div>
              {s.reviewComment && <div className="mt-1 text-xs text-muted-foreground">{t('duty.swap.reviewComment')}: {s.reviewComment}</div>}
              {/* admin 审批 pending */}
              {isAdmin && s.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => review(s.id, 'approved')}><Check className="size-4" />{t('duty.swap.approve')}</Button>
                  <Button size="sm" variant="destructive" onClick={() => review(s.id, 'rejected')}><X className="size-4" />{t('duty.swap.reject')}</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 发起调班弹窗 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('duty.swap.newSwap')}</DialogTitle>
            <DialogDescription>{t('duty.swap.title')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('duty.swap.type')}</Label>
              <div className="flex gap-2">
                <Button type="button" variant={type === 'proxy' ? 'default' : 'outline'} size="sm" onClick={() => setType('proxy')}>{t('duty.swap.typeProxy')}</Button>
                <Button type="button" variant={type === 'swap' ? 'default' : 'outline'} size="sm" onClick={() => setType('swap')}>{t('duty.swap.typeSwap')}</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('duty.swap.mySchedule')}</Label>
              <Select value={apSched} onValueChange={setApSched}>
                <SelectTrigger><SelectValue placeholder={t('duty.swap.mySchedule')} /></SelectTrigger>
                <SelectContent>{(mySchedules ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{schedLabel(s.id)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('duty.swap.pickDate')}</Label>
              <input type="date" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={apDate} onChange={(e) => setApDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('duty.swap.targetTeacher')}</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue placeholder={t('duty.swap.targetTeacher')} /></SelectTrigger>
                <SelectContent>
                  {(users ?? []).filter((u) => u.id !== profile?.userId).map((u) => <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {type === 'swap' && (
              <div className="space-y-2">
                <Label>{t('duty.swap.targetSchedule')}</Label>
                <Select value={tgSched} onValueChange={setTgSched}>
                  <SelectTrigger><SelectValue placeholder={t('duty.swap.targetSchedule')} /></SelectTrigger>
                  <SelectContent>{(mySchedules ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{schedLabel(s.id)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('duty.swap.reason')}</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('duty.swap.reasonPh')} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? t('common.loading') : t('duty.swap.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 执勤打卡页 —— 教师查看今日执勤任务并提交打卡（外部 PRD「执勤打卡」自有实现）。
 *
 * 对照外部 PRD 功能语义（docs/DUTY-FUSION.md §7）：
 *  - 今日任务工作台：待执勤 / 已完成分区（今日概览）。
 *  - 打卡表单：情况说明（选填）+ 现场照片（必填≥1，走 storage）。
 *  - 本人班次守卫：后端校验精确到实际值班人（含调班接手人），前端只对本人班次开放打卡。
 *  - 经调班接手的班次标注 viaSwap。
 *  - 提交成功刷新任务列表（已完成移入 done 区）。
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ClipboardCheck, Camera, X, CheckCircle2, Clock, ArrowLeftRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { api, fileUrl } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { dateKey } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { TodayTask } from '@guga-onduty/shared';

export default function DutyCheckinPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const today = dateKey(new Date());

  const { data: tasks, loading, reload } = useAsync<TodayTask[]>(async () => {
    const r = await api.get<TodayTask[]>('/duty/checkins/today', { date: today });
    return r.data;
  }, [today, profile?.userId]);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<TodayTask | null>(null);
  const [situation, setSituation] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const todo = (tasks ?? []).filter((x) => !x.checkedIn);
  const done = (tasks ?? []).filter((x) => x.checkedIn);

  const openCheckin = useCallback((task: TodayTask) => {
    setActive(task);
    setSituation('');
    setPhotos([]);
    setOpen(true);
  }, []);

  async function submit() {
    if (!active) return;
    if (photos.length === 0) {
      toast.error(t('duty.checkin.needPhoto'));
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set('schedule_id', active.scheduleId);
      fd.set('duty_date', active.date);
      if (situation.trim()) fd.set('situation', situation.trim());
      photos.forEach((p) => fd.append('photos', p));
      await api.upload('/duty/checkins', fd);
      toast.success(t('duty.checkin.ok'));
      setOpen(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <ClipboardCheck className="size-6 text-primary" />{t('duty.checkin.title')}
        </h1>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>{t('common.refresh')}</Button>
      </div>

      {/* 今日概览 */}
      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="flex items-center gap-3 pt-6">
          <Clock className="size-8 text-amber-500" />
          <div><div className="text-2xl font-bold">{todo.length}</div><div className="text-xs text-muted-foreground">{t('duty.checkin.todo')}</div></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-6">
          <CheckCircle2 className="size-8 text-green-500" />
          <div><div className="text-2xl font-bold">{done.length}</div><div className="text-xs text-muted-foreground">{t('duty.checkin.done')}</div></div>
        </CardContent></Card>
      </div>

      {/* 待执勤任务 */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('duty.checkin.todayTasks')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {todo.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('duty.checkin.noTask')}</div>
          )}
          {todo.map((task) => (
            <TaskCard key={task.scheduleId + task.date} task={task} onCheckin={() => openCheckin(task)} checkinLabel={t('duty.checkin.submit')} />
          ))}
        </CardContent>
      </Card>

      {/* 已完成 */}
      {done.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('duty.checkin.done')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {done.map((task) => (
              <TaskCard key={task.scheduleId + task.date} task={task} done />
            ))}
          </CardContent>
        </Card>
      )}

      {/* 打卡弹窗 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('duty.checkin.submit')}</DialogTitle>
            <DialogDescription>
              {active?.locationName} · {active?.timeSlotName ?? t('duty.checkin.todayTasks')} · {active?.date}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('duty.checkin.situation')}</Label>
              <Textarea value={situation} onChange={(e) => setSituation(e.target.value)} placeholder={t('duty.checkin.situationPh')} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>{t('duty.checkin.photosRequired')}</Label>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-sm text-muted-foreground hover:bg-accent sm:p-6">
                <Camera className="mb-2 size-7 sm:size-5" />
                <input type="file" accept="image/*" multiple hidden
                  onChange={(e) => setPhotos((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, 9))} />
                {t('duty.checkin.photos')}
              </label>
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative">
                      <img src={URL.createObjectURL(p)} alt="" className="h-[72px] w-[72px] rounded-md border object-cover" />
                      <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? t('common.loading') : t('duty.checkin.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskCard({ task, onCheckin, done, checkinLabel }: {
  task: TodayTask; onCheckin?: () => void; done?: boolean; checkinLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center justify-between rounded-md border-l-4 p-3', done ? 'border-l-green-500 bg-muted/30' : 'border-l-primary')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {task.locationName || t('duty.unassignedLoc')}
          {task.viaSwap && (
            <Badge variant="default" className="gap-1 text-xs">
              <ArrowLeftRight className="size-3" />{t('duty.checkin.viaSwap')}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {task.timeSlotName ?? ''} · {task.date}
          {task.viaSwap && task.swapHint ? ` · ${task.swapHint}` : ''}
        </div>
      </div>
      {done ? (
        <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />{t('duty.checkin.checkedIn')}</Badge>
      ) : (
        <Button size="sm" className="h-9 shrink-0 px-4 sm:h-8" onClick={onCheckin}>{checkinLabel}</Button>
      )}
    </div>
  );
}

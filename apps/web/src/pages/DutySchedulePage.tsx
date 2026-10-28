/**
 * 值班大表 —— 排班矩阵全景（外部 PRD 头号交付物，自有实现）。
 *
 * 对照外部 PRD 的「值班大表」功能语义（docs/DUTY-FUSION.md §7 映射），用 shadcn + Tailwind 重新实现：
 *  - 行=地点、列=周一~周日 的矩阵；格内教师 pill 三态（swapped 青紫 / done 绿 / pending 黄）。
 *  - 周导航（上一周/本周/下一周）+ 区域/kind 筛选。
 *  - 今日列高亮。
 *  - 我的执勤摘要侧栏（当前登录教师本周任务概览）。
 *  - 单元格点击 → 操作弹窗（打卡/巡查/调班）——本页只读展示 + 摘要，操作在各自页面。
 *  - 状态摘要条：本周 总数/已执勤/待执勤/已换班。
 *
 * 数据全部实时计算（后端 getWeekMatrix：展开→叠加→打卡→矩阵），前端不持久化视图态。
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, MapPin, Users, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { mondayOf, mondayOffset, dateKey, shortDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { MatrixView, DutyArea, MatrixPill } from '@guga-onduty/shared';

const PILL_STYLE: Record<MatrixPill['state'], string> = {
  swapped: 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white',
  done: 'bg-gradient-to-r from-green-500 to-emerald-500 text-white',
  pending: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950',
};

export default function DutySchedulePage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [areaId, setAreaId] = useState<string>('__all__');

  const monday = useMemo(() => mondayOffset(new Date(), weekOffset), [weekOffset]);
  const mondayKey = dateKey(monday);

  // 区域列表（筛选维度）
  const { data: areas } = useAsync<DutyArea[]>(async () => {
    const r = await api.get<DutyArea[]>('/duty/areas');
    return r.data;
  }, [profile?.campusId]);

  // 矩阵数据
  const { data: view, loading, reload } = useAsync<MatrixView>(async () => {
    const r = await api.get<MatrixView>('/duty/matrix', {
      week: mondayKey,
      area_id: areaId === '__all__' ? undefined : areaId,
    });
    return r.data;
  }, [mondayKey, areaId, profile?.campusId]);

  // 我的执勤摘要（本周我的 pill）
  const myTasks = useMemo(() => {
    if (!view || !profile) return [];
    const mine: { date: string; locationName: string; state: MatrixPill['state'] }[] = [];
    for (const row of view.matrix.rows) {
      for (const cell of row.cells) {
        for (const p of cell.pills) {
          if (p.userId === profile.userId) mine.push({ date: cell.date, locationName: row.locationName, state: p.state });
        }
      }
    }
    return mine.sort((a, b) => a.date.localeCompare(b.date));
  }, [view, profile]);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekLabel = `${shortDate(mondayKey)} ~ ${shortDate(dateKey(sunday))}`;

  return (
    <div className="space-y-4">
      {/* 标题 + 快捷操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <CalendarDays className="size-6 text-primary" />
          {t('duty.schedule.title')}
        </h1>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          {t('common.refresh')}
        </Button>
      </div>

      {/* 筛选 + 周导航 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder={t('duty.area')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('common.all')}</SelectItem>
              {(areas ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w - 1)}><ChevronLeft className="size-4" /></Button>
            <Button variant={weekOffset === 0 ? 'default' : 'outline'} size="sm" onClick={() => setWeekOffset(0)}>
              {t('duty.thisWeek')}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight className="size-4" /></Button>
            <span className="ml-2 text-sm text-muted-foreground">{weekLabel}</span>
          </div>
        </CardContent>
      </Card>

      {/* 状态摘要条 */}
      {view && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label={t('duty.summary.total')} value={view.summary.total} />
          <SummaryTile label={t('duty.summary.done')} value={view.summary.done} tone="text-green-600" />
          <SummaryTile label={t('duty.summary.pending')} value={view.summary.pending} tone="text-amber-600" />
          <SummaryTile label={t('duty.summary.swapped')} value={view.summary.swapped} tone="text-indigo-600" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* 矩阵主区 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('duty.schedule.matrix')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading && !view ? (
              <MatrixSkeleton />
            ) : !view || view.matrix.rows.length === 0 ? (
              <EmptyState onAction={() => setWeekOffset(0)} actionLabel={t('duty.thisWeek')} />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border bg-muted/50 px-3 py-2 text-left font-medium">
                      {t('duty.location')}
                    </th>
                    {view.matrix.columns.map((col) => (
                      <th
                        key={col.date}
                        className={cn('border px-2 py-2 text-center font-medium', col.isToday && 'bg-primary/10 text-primary')}
                      >
                        <div>{col.weekdayName}</div>
                        <div className="text-xs text-muted-foreground">{shortDate(col.date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.matrix.rows.map((row) => (
                    <tr key={row.locationId ?? '__unassigned__'}>
                      <td className="sticky left-0 z-10 border bg-card px-3 py-2 font-medium">
                        <MapPin className="mr-1 inline size-3.5 text-muted-foreground" />
                        {row.locationName}
                      </td>
                      {row.cells.map((cell) => (
                        <td key={cell.date} className={cn('border px-1 py-2 align-top', cell.isToday && 'bg-primary/5')}>
                          <div className="flex flex-wrap justify-center gap-1">
                            {cell.pills.length === 0 && <span className="text-xs text-muted-foreground/40">—</span>}
                            {cell.pills.map((p, i) => (
                              <span
                                key={`${p.userId}-${i}`}
                                title={p.swapHint ?? `${p.userName} · ${t(`duty.pill.${p.state}`)}`}
                                className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', PILL_STYLE[p.state])}
                              >
                                {p.userName}
                              </span>
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* 图例 */}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <Legend className={PILL_STYLE.done} label={t('duty.pill.done')} />
              <Legend className={PILL_STYLE.pending} label={t('duty.pill.pending')} />
              <Legend className={PILL_STYLE.swapped} label={t('duty.pill.swapped')} />
            </div>
          </CardContent>
        </Card>

        {/* 我的执勤摘要侧栏 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />{t('duty.schedule.mySummary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myTasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('duty.schedule.noMyTask')}</p>
            ) : (
              myTasks.map((task, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <div>
                    <div className="font-medium">{task.locationName || t('duty.unassignedLoc')}</div>
                    <div className="text-xs text-muted-foreground">{shortDate(task.date)}</div>
                  </div>
                  <Badge variant={task.state === 'done' ? 'success' : task.state === 'swapped' ? 'default' : 'warning'}>
                    {t(`duty.pill.${task.state}`)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-6 text-center">
        <div className={cn('text-2xl font-bold', tone ?? 'text-foreground')}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('inline-block size-3 rounded-full', className)} />
      {label}
    </span>
  );
}

function MatrixSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

function EmptyState({ onAction, actionLabel }: { onAction: () => void; actionLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <CalendarDays className="mb-3 size-10 text-muted-foreground/40" />
      <p className="mb-4 text-sm text-muted-foreground">{t('duty.schedule.empty')}</p>
      <Button variant="outline" size="sm" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}

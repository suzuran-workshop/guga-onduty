/**
 * 领导巡查页 —— 抽样检查教师是否在岗（外部 PRD「巡查记录」自有实现）。
 *
 * 对照外部 PRD 功能语义：
 *  - 领导选区域+日期 → 从今日该区域排班「逐记录展开」成巡查行（地点×真实教师，防笛卡尔积）。
 *  - 每行选在岗/不在岗 + 可选照片。
 *  - 提交（每行必须选状态）→ 近期巡查记录列表。
 *  - 权限：canInspect 或 admin（后端也校验，前端无权限则提示）。
 *
 * 「逐记录展开」：一条排班记录 → 该地点×该记录内实际值班教师（会签多人各一行），
 * 不做 地点×教师 笛卡尔积（外部 PRD 记录的 P0 错配 bug）。应用调班叠加取实际值班人。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Search, Camera, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { dateKey } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { DutyArea, MatrixView, InspectionRecord, InspectStatus, UserView } from '@guga-onduty/shared';

interface InspectRow {
  key: string;
  locationName: string;
  teacherName: string;
  teacherId: string;
  scheduleId: string;
  dutyDate: string;
  status: InspectStatus | '';
  photo?: File;
}

export default function DutyInspectionPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const canInspect = profile?.role === 'admin' || Boolean(profile?.canInspect);

  const today = dateKey(new Date());
  const [areaId, setAreaId] = useState('');
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<InspectRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: areas } = useAsync<DutyArea[]>(async () => (await api.get<DutyArea[]>('/duty/areas')).data, [profile?.campusId]);
  const { data: users } = useAsync<UserView[]>(async () => (await api.get<UserView[]>('/users')).data, [profile?.campusId]);
  const { data: recent, reload } = useAsync<InspectionRecord[]>(async () => {
    const r = await api.get<InspectionRecord[]>('/duty/inspections', { pageSize: 20 });
    return r.data;
  }, [profile?.campusId]);

  const userNames = new Map((users ?? []).map((u) => [u.id, u.displayName]));

  /** 从今日该区域排班「逐记录展开」生成巡查行（应用调班叠加，取实际值班人） */
  async function loadFromSchedule() {
    if (!areaId) { toast.error(t('duty.inspection.area')); return; }
    // 拉该区域该日的矩阵（后端已展开+叠加），把每个 pill 展开成一行
    const r = await api.get<MatrixView>('/duty/matrix', { week: date, area_id: areaId });
    const out: InspectRow[] = [];
    for (const row of r.data.matrix.rows) {
      for (const cell of row.cells) {
        if (cell.date !== date) continue;
        for (const p of cell.pills) {
          out.push({
            key: `${p.scheduleId}|${p.userId}|${cell.date}`,
            locationName: row.locationName,
            teacherName: p.userName,
            teacherId: p.userId,
            scheduleId: p.scheduleId,
            dutyDate: cell.date,
            status: '',
          });
        }
      }
    }
    if (out.length === 0) toast.error(t('duty.inspection.noRows'));
    setRows(out);
  }

  function setStatus(key: string, status: InspectStatus) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, status } : r)));
  }
  function setPhoto(key: string, file?: File) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, photo: file } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  async function submit() {
    if (rows.length === 0) { toast.error(t('duty.inspection.noRows')); return; }
    if (rows.some((r) => r.status !== 'present' && r.status !== 'absent')) {
      toast.error(t('duty.inspection.needStatus')); return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set('inspect_date', date);
      fd.set('area_id', areaId);
      // 逐行组装 items；照片按 append 顺序上传，photoIndex = 紧凑下标（后端 photoKeys[photoIndex] 对应）
      let photoIdx = 0;
      const items = rows.map((r) => {
        const it: any = {
          locationName: r.locationName, teacherName: r.teacherName, teacherId: r.teacherId,
          status: r.status, photoKeys: [], scheduleId: r.scheduleId, dutyDate: r.dutyDate,
        };
        if (r.photo) { it.photoIndex = photoIdx++; fd.append('photos', r.photo); }
        return it;
      });
      fd.set('items', JSON.stringify(items));
      await api.upload('/duty/inspections', fd);
      toast.success(t('duty.inspection.ok'));
      setRows([]);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canInspect) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t('duty.inspection.noPermission')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Search className="size-6 text-primary" />{t('duty.inspection.title')}
      </h1>

      {/* 新增巡查 */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('duty.inspection.newInspection')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('duty.inspection.area')}</Label>
              <Select value={areaId} onValueChange={setAreaId}>
                <SelectTrigger><SelectValue placeholder={t('duty.area')} /></SelectTrigger>
                <SelectContent>{(areas ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('duty.inspection.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={loadFromSchedule} className="w-full">
                <Plus className="size-4" />{t('duty.inspection.addRow')}
              </Button>
            </div>
          </div>

          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('duty.inspection.location')}</TableHead>
                  <TableHead>{t('duty.inspection.teacher')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('duty.checkin.photos')}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>{r.locationName}</TableCell>
                    <TableCell>{r.teacherName}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant={r.status === 'present' ? 'default' : 'outline'} onClick={() => setStatus(r.key, 'present')}>
                          {t('duty.inspection.present')}
                        </Button>
                        <Button size="sm" variant={r.status === 'absent' ? 'destructive' : 'outline'} onClick={() => setStatus(r.key, 'absent')}>
                          {t('duty.inspection.absent')}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                        <Camera className="size-4" />
                        <input type="file" accept="image/*" hidden onChange={(e) => setPhoto(r.key, e.target.files?.[0])} />
                        {r.photo ? r.photo.name.slice(0, 12) : t('duty.checkin.photos')}
                      </label>
                    </TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => removeRow(r.key)}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {rows.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting}>{submitting ? t('common.loading') : t('duty.inspection.submit')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 近期巡查记录 */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('duty.inspection.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(recent ?? []).length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">{t('duty.inspection.empty')}</div>}
          {(recent ?? []).map((ins) => (
            <div key={ins.id} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{ins.inspectDate}</span>
                <Badge variant="secondary">{ins.items.length} {t('duty.inspection.items')}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {ins.items.map((it, i) => (
                  <span key={i} className={cn('rounded-full px-2 py-0.5 text-xs',
                    it.status === 'present' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                    {it.locationName}·{it.teacherName}·{it.status === 'present' ? t('duty.inspection.present') : t('duty.inspection.absent')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

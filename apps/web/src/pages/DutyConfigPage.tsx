/**
 * 值班配置页 —— admin 管理区域/地点/时段/排班模板（外部 PRD「系统配置」+ 排班维护，自有实现）。
 *
 * 4 Tab：区域 / 地点 / 时段 / 排班模板。前三是配置实体 CRUD，排班模板是核心（周期模板，
 * 含 kind/周内日/单双周/会签/值班人员）。排班模板的 assigneeIds 从本校区用户多选。
 * 全部 admin only（路由级 RequireRole 已在 App.tsx 兜底）。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Settings2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { minuteToHHmm } from '@/lib/date';
import type { DutyArea, DutyLocation, DutyTimeSlot, DutySchedule, UserView } from '@guga-onduty/shared';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // 周一~周日

export default function DutyConfigPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const campusId = profile?.campusId ?? '';
  const [tab, setTab] = useState('areas');

  const areasQ = useAsync<DutyArea[]>(async () => (await api.get<DutyArea[]>('/duty/areas')).data, [campusId]);
  const locsQ = useAsync<DutyLocation[]>(async () => (await api.get<DutyLocation[]>('/duty/locations')).data, [campusId]);
  const slotsQ = useAsync<DutyTimeSlot[]>(async () => (await api.get<DutyTimeSlot[]>('/duty/time-slots')).data, [campusId]);
  const schedsQ = useAsync<DutySchedule[]>(async () => (await api.get<DutySchedule[]>('/duty/schedules', { pageSize: 200 })).data, [campusId]);
  const usersQ = useAsync<UserView[]>(async () => (await api.get<UserView[]>('/users')).data, [campusId]);

  const reloadAll = () => { areasQ.reload(); locsQ.reload(); slotsQ.reload(); schedsQ.reload(); };

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Settings2 className="size-6 text-primary" />{t('duty.config.title')}
      </h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="areas">{t('duty.config.areas')}</TabsTrigger>
          <TabsTrigger value="locations">{t('duty.config.locations')}</TabsTrigger>
          <TabsTrigger value="slots">{t('duty.config.timeSlots')}</TabsTrigger>
          <TabsTrigger value="schedules">{t('duty.config.schedules')}</TabsTrigger>
        </TabsList>

        {/* 区域 */}
        <TabsContent value="areas" className="mt-4">
          <EntityTable
            onNew={() => openAreaDialog(null)}
            newLabel={t('duty.config.newArea')}
            columns={[t('common.name'), t('duty.config.sortOrder'), '']}
            rows={(areasQ.data ?? []).map((a) => ({
              id: a.id,
              cells: [a.name, String(a.sortOrder)],
              onEdit: () => openAreaDialog(a),
              onDelete: () => del('/duty/areas', a.id, areasQ.reload),
            }))}
            empty={t('common.noData')}
          />
        </TabsContent>

        {/* 地点 */}
        <TabsContent value="locations" className="mt-4">
          <EntityTable
            onNew={() => openLocDialog(null)}
            newLabel={t('duty.config.newLocation')}
            columns={[t('common.name'), t('duty.area'), '']}
            rows={(locsQ.data ?? []).map((l) => ({
              id: l.id,
              cells: [l.name, l.areaName ?? ''],
              onEdit: () => openLocDialog(l),
              onDelete: () => del('/duty/locations', l.id, locsQ.reload),
            }))}
            empty={t('common.noData')}
          />
        </TabsContent>

        {/* 时段 */}
        <TabsContent value="slots" className="mt-4">
          <EntityTable
            onNew={() => openSlotDialog(null)}
            newLabel={t('duty.config.newSlot')}
            columns={[t('common.name'), t('duty.timeSlot'), t('duty.config.priority'), '']}
            rows={(slotsQ.data ?? []).map((s) => ({
              id: s.id,
              cells: [s.name, `${minuteToHHmm(s.startMinute)}-${minuteToHHmm(s.endMinute)}`, String(s.priority)],
              onEdit: () => openSlotDialog(s),
              onDelete: () => del('/duty/time-slots', s.id, slotsQ.reload),
            }))}
            empty={t('common.noData')}
          />
        </TabsContent>

        {/* 排班模板 */}
        <TabsContent value="schedules" className="mt-4">
          <EntityTable
            onNew={() => openSchedDialog(null)}
            newLabel={t('duty.config.newSchedule')}
            columns={[t('duty.location'), t('duty.config.weekday'), t('duty.config.weekParity'), t('duty.config.assignees'), '']}
            rows={(schedsQ.data ?? []).map((s) => ({
              id: s.id,
              cells: [
                s.locationName ?? t('duty.unassignedLoc'),
                t('duty.weekdayName.' + s.weekday),
                t(s.weekParity === 'odd' ? 'duty.config.parityOdd' : s.weekParity === 'even' ? 'duty.config.parityEven' : 'duty.config.parityEvery'),
                s.assigneeIds.map((id) => (usersQ.data ?? []).find((u) => u.id === id)?.displayName ?? id.slice(0, 4)).join('、'),
              ],
              badges: s.countersign ? [{ label: t('duty.config.countersign'), variant: 'secondary' as const }] : [],
              onEdit: () => openSchedDialog(s),
              onDelete: () => del('/duty/schedules', s.id, schedsQ.reload),
            }))}
            empty={t('common.noData')}
          />
        </TabsContent>
      </Tabs>

      <AreaDialog areas={areasQ} reload={reloadAll} />
      <LocDialog areas={areasQ.data ?? []} reload={reloadAll} />
      <SlotDialog areas={areasQ.data ?? []} reload={reloadAll} />
      <SchedDialog areas={areasQ.data ?? []} locs={locsQ.data ?? []} slots={slotsQ.data ?? []} users={usersQ.data ?? []} reload={reloadAll} />
    </div>
  );

  // ── 弹窗控制（提升到模块级 state 会复杂，这里用局部命令式）──
  function openAreaDialog(a: DutyArea | null) { areaDlg(a); }
  function openLocDialog(l: DutyLocation | null) { locDlg(l); }
  function openSlotDialog(s: DutyTimeSlot | null) { slotDlg(s); }
  function openSchedDialog(s: DutySchedule | null) { schedDlg(s); }

  async function del(path: string, id: string, reload: () => void) {
    if (!confirm(t('config.deleteConfirm'))) return;
    try { await api.delete(`${path}/${id}`); toast.success(t('duty.config.delOk')); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('common.failed')); }
  }
}

// 弹窗触发器用模块级事件总线（避免 prop drilling 大量 open 函数）
type AreaDlgFn = (a: DutyArea | null) => void;
let areaDlg: AreaDlgFn = () => {};
let locDlg: (l: DutyLocation | null) => void = () => {};
let slotDlg: (s: DutyTimeSlot | null) => void = () => {};
let schedDlg: (s: DutySchedule | null) => void = () => {};

// ── 通用实体表 ──────────────────────────────────────────────────────
function EntityTable({ onNew, newLabel, columns, rows, empty }: {
  onNew: () => void; newLabel: string; columns: string[];
  rows: { id: string; cells: string[]; badges?: { label: string; variant: 'secondary' }[]; onEdit: () => void; onDelete: () => void }[];
  empty: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={onNew}><Plus className="size-4" />{newLabel}</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>{columns.map((c, i) => <TableHead key={i}>{c}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {r.cells.map((cell, i) => (
                  <TableCell key={i}>
                    {cell}
                    {i === 0 && r.badges?.map((b, j) => <Badge key={j} variant={b.variant} className="ml-2">{b.label}</Badge>)}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={r.onEdit}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={r.onDelete}><Trash2 className="size-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">{empty}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── 区域弹窗 ────────────────────────────────────────────────────────
function AreaDialog({ reload }: { areas: ReturnType<typeof useAsync<DutyArea[]>>; reload: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DutyArea | null>(null);
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  areaDlg = (a) => { setEditing(a); setName(a?.name ?? ''); setSortOrder(a?.sortOrder ?? 0); setOpen(true); };

  async function save() {
    if (!name.trim()) return;
    try {
      if (editing) await api.put(`/duty/areas/${editing.id}`, { name, sort_order: sortOrder });
      else await api.post('/duty/areas', { name, sort_order: sortOrder });
      toast.success(t('duty.config.saveOk')); setOpen(false); reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.failed')); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? t('config.editItem') : t('duty.config.newArea')}</DialogTitle><DialogDescription className="sr-only">area</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label>{t('common.name')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label>{t('duty.config.sortOrder')}</Label><Input type="number" value={String(sortOrder)} onChange={(e) => setSortOrder(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button onClick={save}>{t('common.save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 地点弹窗 ────────────────────────────────────────────────────────
function LocDialog({ areas, reload }: { areas: DutyArea[]; reload: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DutyLocation | null>(null);
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  locDlg = (l) => { setEditing(l); setName(l?.name ?? ''); setAreaId(l?.areaId ?? areas[0]?.id ?? ''); setOpen(true); };

  async function save() {
    if (!name.trim() || !areaId) return;
    try {
      if (editing) await api.put(`/duty/locations/${editing.id}`, { name, area_id: areaId });
      else await api.post('/duty/locations', { name, area_id: areaId });
      toast.success(t('duty.config.saveOk')); setOpen(false); reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.failed')); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? t('config.editItem') : t('duty.config.newLocation')}</DialogTitle><DialogDescription className="sr-only">loc</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label>{t('duty.area')}</Label>
            <Select value={areaId} onValueChange={setAreaId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-2"><Label>{t('common.name')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button onClick={save}>{t('common.save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 时段弹窗 ────────────────────────────────────────────────────────
function SlotDialog({ areas, reload }: { areas: DutyArea[]; reload: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DutyTimeSlot | null>(null);
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [priority, setPriority] = useState(0);
  slotDlg = (s) => {
    setEditing(s); setName(s?.name ?? ''); setAreaId(s?.areaId ?? areas[0]?.id ?? '');
    setStart(s?.startMinute != null ? String(s.startMinute) : ''); setEnd(s?.endMinute != null ? String(s.endMinute) : '');
    setPriority(s?.priority ?? 0); setOpen(true);
  };

  async function save() {
    if (!name.trim() || !areaId) return;
    const body = {
      name, area_id: areaId, priority,
      start_minute: start === '' ? null : Number(start),
      end_minute: end === '' ? null : Number(end),
    };
    try {
      if (editing) await api.put(`/duty/time-slots/${editing.id}`, body);
      else await api.post('/duty/time-slots', body);
      toast.success(t('duty.config.saveOk')); setOpen(false); reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.failed')); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? t('config.editItem') : t('duty.config.newSlot')}</DialogTitle><DialogDescription className="sr-only">slot</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label>{t('duty.area')}</Label>
            <Select value={areaId} onValueChange={setAreaId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-2"><Label>{t('common.name')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('duty.timeSlot')} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2"><Label>{t('duty.config.startMinute')}</Label><Input type="number" value={start} onChange={(e) => setStart(e.target.value)} placeholder="480" /></div>
            <div className="space-y-2"><Label>{t('duty.config.endMinute')}</Label><Input type="number" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="510" /></div>
            <div className="space-y-2"><Label>{t('duty.config.priority')}</Label><Input type="number" value={String(priority)} onChange={(e) => setPriority(Number(e.target.value))} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button onClick={save}>{t('common.save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 排班模板弹窗 ────────────────────────────────────────────────────
function SchedDialog({ areas, locs, slots, users, reload }: {
  areas: DutyArea[]; locs: DutyLocation[]; slots: DutyTimeSlot[]; users: UserView[]; reload: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DutySchedule | null>(null);
  const [areaId, setAreaId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [timeSlotId, setTimeSlotId] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [weekParity, setWeekParity] = useState<'everyweek' | 'odd' | 'even'>('everyweek');
  const [countersign, setCountersign] = useState(false);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);

  schedDlg = (s) => {
    setEditing(s);
    setAreaId(s?.areaId ?? areas[0]?.id ?? '');
    setLocationId(s?.locationId ?? ''); setTimeSlotId(s?.timeSlotId ?? '');
    setWeekday(s?.weekday ?? 1); setWeekParity(s?.weekParity ?? 'everyweek');
    setCountersign(Boolean(s?.countersign)); setDateStart(s?.dateStart ?? ''); setDateEnd(s?.dateEnd ?? '');
    setAssignees(s?.assigneeIds ?? []);
    setOpen(true);
  };

  function toggleAssignee(id: string) {
    setAssignees((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function save() {
    if (!areaId || !dateStart || !dateEnd || assignees.length === 0) { toast.error(t('common.failed')); return; }
    const body = {
      kind: 'teaching', area_id: areaId, location_id: locationId || null, time_slot_id: timeSlotId || null,
      date_start: dateStart, date_end: dateEnd, weekday, week_parity: weekParity,
      countersign, assignee_ids: assignees,
    };
    try {
      if (editing) await api.put(`/duty/schedules/${editing.id}`, body);
      else await api.post('/duty/schedules', body);
      toast.success(t('duty.config.saveOk')); setOpen(false); reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.failed')); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? t('config.editItem') : t('duty.config.newSchedule')}</DialogTitle><DialogDescription className="sr-only">schedule</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>{t('duty.area')}</Label>
              <Select value={areaId} onValueChange={setAreaId}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>{t('duty.location')}</Label>
              <Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder={t('duty.unassignedLoc')} /></SelectTrigger>
                <SelectContent>{locs.filter((l) => l.areaId === areaId).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>{t('duty.timeSlot')}</Label>
              <Select value={timeSlotId} onValueChange={setTimeSlotId}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{slots.filter((s) => s.areaId === areaId).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>{t('duty.config.weekday')}</Label>
              <Select value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS.map((w) => <SelectItem key={w} value={String(w)}>{t('duty.weekdayName.' + w)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>{t('duty.config.weekParity')}</Label>
              <Select value={weekParity} onValueChange={(v) => setWeekParity(v as any)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="everyweek">{t('duty.config.parityEvery')}</SelectItem><SelectItem value="odd">{t('duty.config.parityOdd')}</SelectItem><SelectItem value="even">{t('duty.config.parityEven')}</SelectItem></SelectContent></Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>{t('duty.config.dateStart')}</Label><Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('duty.config.dateEnd')}</Label><Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-2">
            <input id="countersign" type="checkbox" checked={countersign} onChange={(e) => setCountersign(e.target.checked)} className="size-4" />
            <Label htmlFor="countersign">{t('duty.config.countersign')}</Label>
          </div>
          <div className="space-y-2">
            <Label>{t('duty.config.assignees')}（{assignees.length}）</Label>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => toggleAssignee(u.id)}
                  className={assignees.includes(u.id) ? 'rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground' : 'rounded-full border px-3 py-1 text-xs'}>
                  {u.displayName}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button onClick={save}>{t('common.save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

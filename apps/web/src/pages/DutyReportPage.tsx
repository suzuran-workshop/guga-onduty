/**
 * 值班统计报表页 —— 到岗率 + 打卡日志（外部 PRD「值班日志/统计报表」自有实现）。
 *
 * 两个 Tab：
 *  - 到岗率统计：应到/实到人次 + 到岗率 + 按教师明细（后端 getAttendance 实时算）。
 *  - 值班日志：打卡明细列表（本人或 admin 看全部）。
 * 日期范围查询，可选 kind（教师执勤/值周巡查）。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api, fileUrl } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { dateKey, formatTime, pct } from '@/lib/date';
import type { AttendanceStats, CheckinRecord } from '@guga-onduty/shared';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: dateKey(from), to: dateKey(to) };
}

export default function DutyReportPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [range, setRange] = useState(defaultRange());

  const q = { date_from: range.from, date_to: range.to };

  const { data: att, loading: attLoading, reload: reloadAtt } = useAsync<AttendanceStats>(
    async () => (await api.get<AttendanceStats>('/duty/attendance', q)).data,
    [range.from, range.to, profile?.campusId],
  );

  // 打卡日志：admin 看全校区（用 checkins/mine 仅本人；admin 用 attendance byTeacher 已够，这里给本人日志）
  const { data: logs, reload: reloadLogs } = useAsync<CheckinRecord[]>(
    async () => (await api.get<CheckinRecord[]>('/duty/checkins/mine', { date_from: range.from, date_to: range.to, pageSize: 100 })).data,
    [range.from, range.to, profile?.userId],
  );

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <BarChart3 className="size-6 text-primary" />{t('duty.report.title')}
      </h1>

      {/* 查询条件 */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-2">
            <Label>{t('duty.report.dateFrom')}</Label>
            <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>{t('duty.report.dateTo')}</Label>
            <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <Button variant="outline" onClick={() => { reloadAtt(); reloadLogs(); }}>{t('duty.report.query')}</Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="attendance">
        <TabsList>
          <TabsTrigger value="attendance">{t('duty.report.attendance')}</TabsTrigger>
          <TabsTrigger value="log">{t('duty.report.logReport')}</TabsTrigger>
        </TabsList>

        {/* 到岗率 */}
        <TabsContent value="attendance" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold">{att?.scheduled ?? 0}</div>
              <div className="text-xs text-muted-foreground">{t('duty.report.scheduled')}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-green-600">{att?.checkedIn ?? 0}</div>
              <div className="text-xs text-muted-foreground">{t('duty.report.checkedIn')}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-primary">{att ? pct(att.rate) : '—'}</div>
              <div className="text-xs text-muted-foreground">{t('duty.report.rate')}</div>
            </CardContent></Card>
          </div>
          {att && <Progress value={att.rate * 100} className="h-2" />}

          <Card>
            <CardHeader><CardTitle className="text-base">{t('duty.report.byTeacher')}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('duty.report.teacher')}</TableHead>
                    <TableHead className="text-right">{t('duty.report.scheduled')}</TableHead>
                    <TableHead className="text-right">{t('duty.report.checkedIn')}</TableHead>
                    <TableHead className="text-right">{t('duty.report.rate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(att?.byTeacher ?? []).map((b) => (
                    <TableRow key={b.teacherId}>
                      <TableCell>{b.teacherName}</TableCell>
                      <TableCell className="text-right">{b.scheduled}</TableCell>
                      <TableCell className="text-right">{b.checkedIn}</TableCell>
                      <TableCell className="text-right">{b.scheduled ? pct(b.checkedIn / b.scheduled) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {att && att.byTeacher.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 打卡日志 */}
        <TabsContent value="log" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="size-4" />{t('duty.report.checkinDetail')}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('duty.checkin.todayTasks')}</TableHead>
                    <TableHead>{t('duty.location')}</TableHead>
                    <TableHead>{t('duty.checkin.situation')}</TableHead>
                    <TableHead>{t('duty.checkin.photos')}</TableHead>
                    <TableHead>{t('duty.report.time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(logs ?? []).map((ck) => (
                    <TableRow key={ck.id}>
                      <TableCell>{ck.dutyDate}</TableCell>
                      <TableCell>{ck.locationName || '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{ck.situation || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {ck.photos.slice(0, 3).map((k, i) => (
                            <img key={i} src={fileUrl(k)} alt="" className="size-8 rounded border object-cover" />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{formatTime(ck.checkedInAt)}</TableCell>
                    </TableRow>
                  ))}
                  {logs && logs.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * 系统设置 —— 值班域校区设置。
 *
 *  - GET /settings 返回 key-value map（Record<string,string>）。
 *  - PUT /settings 从 profile 取校区，body {settings:[{key,value}]}。
 *  - semester_start（YYYY-MM-DD）：驱动全校单双周排班的奇偶对齐（resolveParityAnchor）。
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/api/client';

type SettingsMap = Record<string, string>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsMap>({});
  const [semesterStart, setSemesterStart] = useState('');

  useEffect(() => {
    api.get<SettingsMap>('/settings').then((r) => {
      setSettings(r.data);
      setSemesterStart(r.data.semester_start ?? '');
    }).catch(() => { /* 忽略 */ });
  }, []);

  async function save() {
    try {
      await api.put('/settings', { settings: [{ key: 'semester_start', value: semesterStart }] });
      setSettings((prev) => ({ ...prev, semester_start: semesterStart }));
      toast.success(t('settings.savedOk'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

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
    </div>
  );
}

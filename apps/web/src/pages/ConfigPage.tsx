/**
 * 配置中心 —— 基础实体配置驱动 CRUD 引擎（校区 / 用户）。
 *
 * 值班域基础配置：校区（campuses）+ 用户（users，含巡查权限 canInspect）。
 *  - 字段规格化：每实体声明 FieldSpec[]（label i18n key + type + 关联下拉数据源）。
 *  - 引用字段用下拉（用户选校区/角色），不手填 ID。
 *  - 新建默认当前 profile 校区，admin 可切。
 *  - 字段 snake_case 请求体（后端契约）+ camelCase 展示。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { Campus, UserView } from '@guga-onduty/shared';

type TabKey = 'campuses' | 'users';

const TAB_KEYS: TabKey[] = ['campuses', 'users'];
const ENDPOINTS: Record<TabKey, string> = {
  campuses: '/campuses', users: '/users',
};

/** 字段规格：驱动表单渲染与请求体构造 */
interface FieldSpec {
  key: string;              // 请求体字段名（snake_case，对齐后端契约）
  labelKey: string;         // i18n key
  type: 'text' | 'number' | 'textarea' | 'select' | 'bool';
  options?: { value: string; labelKey?: string; label?: string }[];
  refSource?: 'campuses'; // 关联下拉数据源
  required?: boolean;
  createOnly?: boolean;     // 仅新建时可编辑（如 username）
}

const FIELDS: Record<TabKey, FieldSpec[]> = {
  campuses: [
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
    { key: 'code', labelKey: 'config.code', type: 'text', required: true },
  ],
  users: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'username', labelKey: 'auth.username', type: 'text', required: true, createOnly: true },
    { key: 'password', labelKey: 'auth.password', type: 'text', createOnly: true },
    { key: 'display_name', labelKey: 'config.displayName', type: 'text', required: true },
    { key: 'role', labelKey: 'config.role', type: 'select', required: true, options: [
      { value: 'admin', labelKey: 'roles.admin' }, { value: 'teacher', labelKey: 'roles.teacher' },
    ] },
    { key: 'can_inspect', labelKey: 'config.canInspect', type: 'bool' },
  ],
};

/** 表格展示列（camelCase 领域字段 → 表头 i18n） */
const COLUMNS: Record<TabKey, { key: string; labelKey: string }[]> = {
  campuses: [{ key: 'name', labelKey: 'common.name' }, { key: 'code', labelKey: 'config.code' }],
  users: [{ key: 'username', labelKey: 'auth.username' }, { key: 'displayName', labelKey: 'config.displayName' }, { key: 'role', labelKey: 'config.role' }, { key: 'campusName', labelKey: 'common.campus' }, { key: 'canInspect', labelKey: 'config.canInspect' }],
};

export default function ConfigPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tab, setTab] = useState<TabKey>('users');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  // 关联下拉数据源（campuses 供 users 的 campus_id select 用）
  const [campuses, setCampuses] = useState<Campus[]>([]);

  const loadRefs = useCallback(async () => {
    try {
      const c = await api.get<Campus[]>('/campuses');
      setCampuses(c.data);
    } catch { /* 忽略 */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<any[]>(ENDPOINTS[tab]);
      setRows(r.data);
    } catch { /* 忽略 */ }
  }, [tab]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    // 默认当前用户校区
    setForm({ campus_id: profile?.campusId ?? '', role: 'teacher', can_inspect: false });
    setOpen(true);
  }
  function openEdit(it: any) {
    setEditing(it);
    // camelCase 领域对象 → snake_case 表单（请求体契约）
    setForm({
      name: it.name, code: it.code, campus_id: it.campusId,
      username: it.username, display_name: it.displayName, role: it.role,
      can_inspect: Number(it.canInspect) === 1,
    });
    setOpen(true);
  }
  const setField = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSave() {
    try {
      // 只提交当前实体声明的字段（去掉无关键）
      const payload: Record<string, any> = {};
      for (const f of FIELDS[tab]) {
        if (editing && f.createOnly) continue; // 编辑不改 username/password
        if (f.type === 'bool') { payload[f.key] = Boolean(form[f.key]); continue; }
        if (form[f.key] !== undefined && form[f.key] !== '') payload[f.key] = form[f.key];
      }
      if (editing) {
        await api.put(`${ENDPOINTS[tab]}/${editing.id}`, payload);
        toast.success(t('config.updatedOk'));
      } else {
        await api.post(ENDPOINTS[tab], payload);
        toast.success(t('config.createdOk'));
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('config.deleteConfirm'))) return;
    try {
      await api.delete(`${ENDPOINTS[tab]}/${id}`);
      toast.success(t('config.deletedOk'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  // 关联下拉选项渲染
  function refOptions(source: FieldSpec['refSource']) {
    if (source === 'campuses') return campuses.map((c) => ({ value: c.id, label: c.name }));
    return [];
  }

  function renderField(f: FieldSpec) {
    const disabled = !!editing && f.createOnly;
    const val = form[f.key] ?? '';
    if (f.type === 'bool') {
      return <Switch checked={Boolean(val)} disabled={disabled} onCheckedChange={(c) => setField(f.key, c)} />;
    }
    if (f.type === 'select') {
      const opts = f.refSource ? refOptions(f.refSource) : (f.options ?? []).map((o) => ({ value: o.value, label: o.labelKey ? t(o.labelKey) : o.label! }));
      return (
        <Select value={String(val)} onValueChange={(v) => setField(f.key, v)} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder={t(f.labelKey)} /></SelectTrigger>
          <SelectContent>
            {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (f.type === 'number') {
      return <Input type="number" value={String(val)} disabled={disabled} onChange={(e) => setField(f.key, Number(e.target.value))} />;
    }
    return <Input type={f.key === 'password' ? 'password' : 'text'} value={String(val)} disabled={disabled} onChange={(e) => setField(f.key, e.target.value)} />;
  }

  const columns = COLUMNS[tab];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('config.title')}</h1>

      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            {TAB_KEYS.map((k) => (
              <TabsTrigger key={k} value={k}>{t(`config.tabs.${k}`)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={openNew}><Plus className="size-4" />{t('config.newItem')}</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.key}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it) => (
                <TableRow key={it.id}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      {c.key === 'role' ? (
                        <Badge variant="secondary">{t(`roles.${it.role}`)}</Badge>
                      ) : c.key === 'canInspect' ? (
                        Number(it.canInspect) === 1
                          ? <Badge variant="success">{t('settings.enabled')}</Badge>
                          : <Badge variant="secondary">{t('settings.disabled')}</Badge>
                      ) : (
                        String(it[c.key] ?? '--')
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(it)}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(it.id)}><Trash2 className="size-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t('config.editItem') : t('config.newItem')} · {t(`config.tabs.${tab}`)}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('config.title')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {FIELDS[tab].map((f) => (
              <div key={f.key} className="space-y-2">
                <Label>{t(f.labelKey)}{f.required && <span className="text-destructive"> *</span>}</Label>
                {renderField(f)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

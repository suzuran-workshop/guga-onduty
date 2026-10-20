/**
 * 值班域 rest repos —— 7 个 repo 合一文件（内聚域，共享 rest 句柄）。
 * 语义严格对齐 drizzle/duty-repo.ts（排序键、分页、UNIQUE 冲突、review 仅 pending 等），
 * 差异仅在实现手段（PostgREST 能力边界，见 _base.ts 头注）：
 *
 *  - join → indexByIds 批查 + JS 拼接（schedules list 的 areaName/locationName/timeSlotName、
 *    locations 的 areaName；只对当页行批查，避免 N+1）。
 *  - 分页 → select 全部过滤+排序后 paginateRows JS 切页（total = 过滤后长度）。
 *  - 日期范围相交 → dateStart<=dateTo AND dateEnd>=dateTo 过滤（{op,value} 条件）。
 *  - 打卡 UNIQUE(schedule,date,teacher) → 先 select 查重，冲突时抛同构错误
 *    （message 含 'UNIQUE constraint failed'，路由 isUniqueViolation 转 409）。
 *  - review 仅 pending 可改（filters 带 status='pending'，已审行返回原值，对齐 drizzle）。
 *  - bulkCreate 无事务，循环 insert（rest 轨 best-effort）。
 *  - 所有写操作显式给 id: uuid()；createdAt 显式给（mock/无 default 场景兜底）。
 *  - JSON 列（assigneeIds/photos/items）读侧 jsonArr 兜底，写侧直接传数组（pg jsonb）。
 */
import type { RestDb, RestFilters } from '@homurajs/db';
import type {
  DutyAreaRepo, DutyLocationRepo, DutyTimeSlotRepo, DutyScheduleRepo,
  DutyCheckinRepo, DutyInspectionRepo, DutySwapRepo, DutyRepos,
  DutyArea, DutyLocation, DutyTimeSlot,
} from '../duty-types.js';
import type { Paged } from '../types.js';
import type {
  DutyScheduleRow, SwapRow, CheckinRow, InspectionRow, InspectionItem,
  DutyKind, SwapType, SwapStatus, WeekParity,
} from '../../duty/types.js';
import { tbl, paginateRows, indexByIds, num, ts, nowIso, jsonArr, uuid } from './_base.js';

// ── 行映射：DB 行 → 引擎领域类型（对齐 drizzle 版）────────────────────
function toScheduleRow(r: any): DutyScheduleRow {
  return {
    id: r.id, campusId: r.campusId, kind: r.kind as DutyKind, areaId: r.areaId,
    timeSlotId: r.timeSlotId ?? null, locationId: r.locationId ?? null,
    dateStart: r.dateStart, dateEnd: r.dateEnd,
    weekday: num(r.weekday) as DutyScheduleRow['weekday'],
    weekParity: r.weekParity as WeekParity,
    countersign: num(r.countersign),
    assigneeIds: jsonArrOf<string>(r.assigneeIds),
    note: r.note ?? null,
  };
}
function toCheckinRow(r: any): CheckinRow {
  return {
    id: r.id, campusId: r.campusId, scheduleId: r.scheduleId, dutyDate: r.dutyDate,
    teacherId: r.teacherId, locationName: r.locationName, timeSlotName: r.timeSlotName ?? null,
    situation: r.situation ?? null, photos: jsonArrOf<string>(r.photos), checkedInAt: num(r.checkedInAt),
  };
}
function toSwapRow(r: any): SwapRow {
  return {
    id: r.id, campusId: r.campusId, type: r.type as SwapType,
    applicantId: r.applicantId, applicantScheduleId: r.applicantScheduleId, applicantDate: r.applicantDate,
    targetId: r.targetId, targetScheduleId: r.targetScheduleId ?? null, targetDate: r.targetDate ?? null,
    reason: r.reason, status: r.status as SwapStatus,
    reviewerId: r.reviewerId ?? null, reviewComment: r.reviewComment ?? null,
    createdAt: ts(r.createdAt), reviewedAt: r.reviewedAt == null ? null : num(r.reviewedAt),
  };
}
function toInspectionRow(r: any): InspectionRow {
  return {
    id: r.id, campusId: r.campusId, inspectorId: r.inspectorId,
    inspectDate: r.inspectDate, areaId: r.areaId,
    items: jsonArrOf<InspectionItem>(r.items), createdAt: ts(r.createdAt),
  };
}

/** 可选 eq：值存在才加入过滤（对齐 drizzle eqIf；'' 视为空） */
function eqIf(f: RestFilters, col: string, val: unknown): void {
  if (val === undefined || val === null || val === '') return;
  (f as any)[col] = val;
}

/** JSON 列 → 数组（_base.jsonArr 兜底 null → []，对齐 drizzle 版三态兜底） */
function jsonArrOf<T>(v: unknown): T[] {
  return (jsonArr(v) as T[] | null) ?? [];
}

export function createDutyRepos(rest: RestDb): DutyRepos {
  const areasT = tbl<any>(rest, 'dutyAreas');
  const locationsT = tbl<any>(rest, 'dutyLocations');
  const timeSlotsT = tbl<any>(rest, 'dutyTimeSlots');
  const schedulesT = tbl<any>(rest, 'dutySchedules');
  const checkinsT = tbl<any>(rest, 'dutyCheckins');
  const inspectionsT = tbl<any>(rest, 'dutyInspections');
  const swapsT = tbl<any>(rest, 'dutySwaps');

  // ══════════ 区域 ══════════
  const areas: DutyAreaRepo = {
    async listByCampus(campusId): Promise<DutyArea[]> {
      const rows = await areasT.select({ campusId }, { order: 'sortOrder.asc,name.asc' });
      return rows.map((r) => ({ id: r.id, campusId: r.campusId, name: r.name, sortOrder: num(r.sortOrder) }));
    },
    async findById(id): Promise<DutyArea | null> {
      const rows = await areasT.select({ id }, { limit: 1 });
      const r = rows[0];
      return r ? { id: r.id, campusId: r.campusId, name: r.name, sortOrder: num(r.sortOrder) } : null;
    },
    async create(input): Promise<DutyArea> {
      const id = uuid();
      const row = { id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 };
      await areasT.insert(row);
      return { id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 };
    },
    async update(id, input): Promise<DutyArea | null> {
      await areasT.update({ name: input.name, sortOrder: input.sortOrder ?? 0 }, { id });
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await areasT.remove({ id });
    },
  };

  // ══════════ 地点 ══════════
  const locations: DutyLocationRepo = {
    async listByCampus(campusId, areaId): Promise<DutyLocation[]> {
      const f: RestFilters = { campusId };
      eqIf(f, 'areaId', areaId);
      const rows = await locationsT.select(f, { order: 'name.asc' });
      // join areaName：批查 dutyAreas
      const areaMap = await indexByIds(areasT, 'id', rows.map((r: any) => r.areaId));
      return rows.map((r: any) => ({
        id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name,
        areaName: areaMap.get(r.areaId)?.name ?? undefined,
      }));
    },
    async findById(id): Promise<DutyLocation | null> {
      const rows = await locationsT.select({ id }, { limit: 1 });
      const r = rows[0];
      return r ? { id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name } : null;
    },
    async create(input): Promise<DutyLocation> {
      const id = uuid();
      await locationsT.insert({ id, campusId: input.campusId, areaId: input.areaId, name: input.name });
      return { id, campusId: input.campusId, areaId: input.areaId, name: input.name };
    },
    async update(id, input): Promise<DutyLocation | null> {
      const patch: any = { name: input.name };
      if (input.areaId !== undefined) patch.areaId = input.areaId;
      await locationsT.update(patch, { id });
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await locationsT.remove({ id });
    },
  };

  // ══════════ 时段 ══════════
  const timeSlots: DutyTimeSlotRepo = {
    async listByCampus(campusId, areaId): Promise<DutyTimeSlot[]> {
      const f: RestFilters = { campusId };
      eqIf(f, 'areaId', areaId);
      const rows = await timeSlotsT.select(f, { order: 'priority.asc,name.asc' });
      return rows.map((r: any) => ({
        id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name,
        startMinute: r.startMinute == null ? null : num(r.startMinute),
        endMinute: r.endMinute == null ? null : num(r.endMinute),
        priority: num(r.priority),
      }));
    },
    async findById(id): Promise<DutyTimeSlot | null> {
      const rows = await timeSlotsT.select({ id }, { limit: 1 });
      const r = rows[0];
      return r ? {
        id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name,
        startMinute: r.startMinute == null ? null : num(r.startMinute),
        endMinute: r.endMinute == null ? null : num(r.endMinute),
        priority: num(r.priority),
      } : null;
    },
    async create(input): Promise<DutyTimeSlot> {
      const id = uuid();
      const row = {
        id, campusId: input.campusId, areaId: input.areaId, name: input.name,
        startMinute: input.startMinute ?? null, endMinute: input.endMinute ?? null, priority: input.priority ?? 0,
      };
      await timeSlotsT.insert(row);
      return row;
    },
    async update(id, input): Promise<DutyTimeSlot | null> {
      const patch: any = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.startMinute !== undefined) patch.startMinute = input.startMinute;
      if (input.endMinute !== undefined) patch.endMinute = input.endMinute;
      if (input.priority !== undefined) patch.priority = input.priority;
      await timeSlotsT.update(patch, { id });
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await timeSlotsT.remove({ id });
    },
  };

  // ══════════ 排班模板 ══════════
  const schedules: DutyScheduleRepo = {
    async listForExpand(filter): Promise<DutyScheduleRow[]> {
      // 与日期范围相交：dateStart <= dateTo AND dateEnd >= dateFrom（减少扫描）
      const f: RestFilters = { campusId: filter.campusId };
      eqIf(f, 'kind', filter.kind);
      eqIf(f, 'areaId', filter.areaId);
      if (filter.dateTo) (f as any).dateStart = { op: 'lte', value: filter.dateTo };
      if (filter.dateFrom) (f as any).dateEnd = { op: 'gte', value: filter.dateFrom };
      const rows = await schedulesT.select(f);
      return rows.map(toScheduleRow);
    },
    async list(filter): Promise<Paged<DutyScheduleRow & { areaName?: string; locationName?: string; timeSlotName?: string }>> {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 50;
      const f: RestFilters = { campusId: filter.campusId };
      eqIf(f, 'kind', filter.kind);
      eqIf(f, 'areaId', filter.areaId);
      const all = await schedulesT.select(f, { order: 'weekday.asc,dateStart.asc' });
      const { data, pagination } = paginateRows(all, page, pageSize);
      // join 名称：只对当页行批查（对齐 drizzle leftJoin 语义，缺关联则名字 undefined）
      const areaMap = await indexByIds(areasT, 'id', data.map((r) => r.areaId));
      const locMap = await indexByIds(locationsT, 'id', data.map((r) => r.locationId));
      const slotMap = await indexByIds(timeSlotsT, 'id', data.map((r) => r.timeSlotId));
      return {
        data: data.map((r) => ({
          ...toScheduleRow(r),
          areaName: areaMap.get(r.areaId)?.name ?? undefined,
          locationName: r.locationId ? (locMap.get(r.locationId)?.name ?? undefined) : undefined,
          timeSlotName: r.timeSlotId ? (slotMap.get(r.timeSlotId)?.name ?? undefined) : undefined,
        })),
        pagination,
      };
    },
    async findById(id): Promise<DutyScheduleRow | null> {
      const rows = await schedulesT.select({ id }, { limit: 1 });
      return rows[0] ? toScheduleRow(rows[0]) : null;
    },
    async create(input): Promise<DutyScheduleRow> {
      const id = input.id ?? uuid();
      const row = {
        id, campusId: input.campusId, kind: input.kind, areaId: input.areaId,
        timeSlotId: input.timeSlotId ?? null, locationId: input.locationId ?? null,
        dateStart: input.dateStart, dateEnd: input.dateEnd, weekday: input.weekday,
        weekParity: input.weekParity, countersign: input.countersign,
        assigneeIds: input.assigneeIds, note: input.note ?? null,
      };
      await schedulesT.insert(row);
      return toScheduleRow(row);
    },
    async update(id, input): Promise<DutyScheduleRow | null> {
      const patch: any = { ...input };
      delete patch.id;
      await schedulesT.update(patch, { id });
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await schedulesT.remove({ id });
    },
    async bulkCreate(rows): Promise<number> {
      // 无事务：循环 insert（rest 轨 best-effort，导入重跑前先清空同区间模板可幂等）
      for (const r of rows) {
        await schedulesT.insert({
          id: uuid(), campusId: r.campusId, kind: r.kind, areaId: r.areaId,
          timeSlotId: r.timeSlotId ?? null, locationId: r.locationId ?? null,
          dateStart: r.dateStart, dateEnd: r.dateEnd, weekday: r.weekday,
          weekParity: r.weekParity, countersign: r.countersign, assigneeIds: r.assigneeIds, note: r.note ?? null,
        });
      }
      return rows.length;
    },
  };

  // ══════════ 执勤打卡 ══════════
  const checkins: DutyCheckinRepo = {
    async create(input): Promise<CheckinRow> {
      const id = uuid();
      const row = {
        id, campusId: input.campusId, scheduleId: input.scheduleId, dutyDate: input.dutyDate,
        teacherId: input.teacherId, locationName: input.locationName, timeSlotName: input.timeSlotName ?? null,
        situation: input.situation ?? null, photos: input.photos, checkedInAt: input.checkedInAt ?? Date.now(),
      };
      // UNIQUE(schedule,date,teacher)：PostgREST 冲突错误可识别但为兜先行查重，
      // 抛同构错误（message 含 UNIQUE constraint failed）→ 路由 isUniqueViolation 转 409。
      const dup = await checkinsT.select(
        { scheduleId: input.scheduleId, dutyDate: input.dutyDate, teacherId: input.teacherId } as RestFilters,
        { limit: 1 },
      );
      if (dup.length > 0) {
        throw new Error('UNIQUE constraint failed: dutyCheckins.scheduleId, dutyCheckins.dutyDate, dutyCheckins.teacherId');
      }
      await checkinsT.insert(row);
      return toCheckinRow(row);
    },
    async listByTeacher(teacherId, opts): Promise<Paged<CheckinRow>> {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      // RestFilters 单列只支持一个条件：dateFrom（gte）下推 DB 过滤，dateTo（lte）JS 侧补滤
      const f: RestFilters = { teacherId };
      if (opts?.dateFrom) (f as any).dutyDate = { op: 'gte', value: opts.dateFrom };
      const rows = await checkinsT.select(f, { order: 'checkedInAt.desc' });
      const dateTo = opts?.dateTo;
      const filtered = dateTo ? rows.filter((r: any) => r.dutyDate <= dateTo) : rows;
      const { data, pagination } = paginateRows(filtered, page, pageSize);
      return { data: data.map(toCheckinRow), pagination };
    },
    async listByCampusDate(campusId, dateFrom, dateTo): Promise<CheckinRow[]> {
      // 同列双范围条件：PostgREST 单列多条件经 RestFilters 表达受限 → DB 过滤 from + JS 过滤 to
      const rows = await checkinsT.select(
        { campusId, dutyDate: { op: 'gte', value: dateFrom } } as RestFilters,
        { order: 'checkedInAt.asc' },
      );
      return rows.filter((r: any) => r.dutyDate <= dateTo).map(toCheckinRow);
    },
    async findById(id): Promise<CheckinRow | null> {
      const rows = await checkinsT.select({ id }, { limit: 1 });
      return rows[0] ? toCheckinRow(rows[0]) : null;
    },
  };

  // ══════════ 巡查记录 ══════════
  const inspections: DutyInspectionRepo = {
    async create(input): Promise<InspectionRow> {
      const id = uuid();
      const row = {
        id, campusId: input.campusId, inspectorId: input.inspectorId,
        inspectDate: input.inspectDate, areaId: input.areaId, items: input.items,
        createdAt: nowIso(),
      };
      await inspectionsT.insert(row);
      const rows = await inspectionsT.select({ id }, { limit: 1 });
      return toInspectionRow(rows[0]);
    },
    async listByCampus(campusId, opts): Promise<Paged<InspectionRow>> {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      const f: RestFilters = { campusId };
      eqIf(f, 'areaId', opts?.areaId);
      const rows = await inspectionsT.select(f, { order: 'createdAt.desc' });
      const { data, pagination } = paginateRows(rows, page, pageSize);
      return { data: data.map(toInspectionRow), pagination };
    },
    async findById(id): Promise<InspectionRow | null> {
      const rows = await inspectionsT.select({ id }, { limit: 1 });
      return rows[0] ? toInspectionRow(rows[0]) : null;
    },
  };

  // ══════════ 调班申请 ══════════
  const swaps: DutySwapRepo = {
    async create(input): Promise<SwapRow> {
      const id = uuid();
      const row = {
        id, campusId: input.campusId, type: input.type,
        applicantId: input.applicantId, applicantScheduleId: input.applicantScheduleId, applicantDate: input.applicantDate,
        targetId: input.targetId, targetScheduleId: input.targetScheduleId ?? null, targetDate: input.targetDate ?? null,
        reason: input.reason, status: 'pending' as const, reviewerId: null, reviewComment: null,
        createdAt: nowIso(), reviewedAt: null,
      };
      await swapsT.insert(row);
      const rows = await swapsT.select({ id }, { limit: 1 });
      return toSwapRow(rows[0]);
    },
    async list(filter): Promise<Paged<SwapRow>> {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 20;
      const f: RestFilters = {};
      eqIf(f, 'campusId', filter.campusId);
      eqIf(f, 'applicantId', filter.applicantId);
      eqIf(f, 'targetId', filter.targetId);
      eqIf(f, 'status', filter.status);
      const rows = await swapsT.select(Object.keys(f).length ? f : undefined, { order: 'createdAt.desc' });
      const { data, pagination } = paginateRows(rows, page, pageSize);
      return { data: data.map(toSwapRow), pagination };
    },
    async findById(id): Promise<SwapRow | null> {
      const rows = await swapsT.select({ id }, { limit: 1 });
      return rows[0] ? toSwapRow(rows[0]) : null;
    },
    async review(id, reviewerId, decision, reviewComment): Promise<SwapRow | null> {
      // 仅 pending 可审（filters 带 status='pending' 防重复审批）；已审行返回原值（对齐 drizzle 行为）
      await swapsT.update(
        { status: decision, reviewerId, reviewComment: reviewComment ?? null, reviewedAt: Date.now() },
        { id, status: 'pending' } as RestFilters,
      );
      return this.findById(id);
    },
    async listApproved(campusId): Promise<SwapRow[]> {
      const rows = await swapsT.select({ campusId, status: 'approved' } as RestFilters, { order: 'createdAt.asc' });
      return rows.map(toSwapRow);
    },
  };

  return { areas, locations, timeSlots, schedules, checkins, inspections, swaps };
}

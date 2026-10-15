/**
 * 值班域 drizzle repos —— 7 个 repo 合一文件（内聚域，共享 ctx）。
 *
 * 严格遵循现有 drizzle repo 模式（_base.ts 助手 + Tables 类型 + 两条硬约束）。
 * **repo 只取行/写行，不做展开/叠加/矩阵计算**（那是 src/duty/* 纯函数引擎，service 层组合）。
 *
 * 关键实现点：
 *  - JSON 列（assigneeIds/photos/items）drizzle 自动编解码，映射时兜底 parse。
 *  - 打卡 UNIQUE(schedule,date,teacher) 冲突 → 抛，路由转 409（用 isUniqueViolation，遍历 cause 链）。
 *  - 调班 review 仅 pending 可改（WHERE status='pending'），事务更新 + reviewedAt。
 *  - bulkCreate（Excel 导入）用事务批量插入。
 *  - campusId 强制隔离：所有查询都带 campusId（由路由从 profile 取，repo 不信任请求体）。
 */
import { eq, and, desc, asc, sql, gte, lte, inArray } from 'drizzle-orm';
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
import { DrizzleCtx, whereAll, eqIf, paginate, num } from './_base.js';

// ── JSON 列兜底解析（sqlite text / pg jsonb / rest string 三态）──────────
function jsonArr<T = string>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// ── 行映射：DB 行 → 引擎领域类型 ──────────────────────────────────────
function toScheduleRow(r: any): DutyScheduleRow {
  return {
    id: r.id, campusId: r.campusId, kind: r.kind as DutyKind, areaId: r.areaId,
    timeSlotId: r.timeSlotId ?? null, locationId: r.locationId ?? null,
    dateStart: r.dateStart, dateEnd: r.dateEnd,
    weekday: num(r.weekday) as DutyScheduleRow['weekday'],
    weekParity: r.weekParity as WeekParity,
    countersign: num(r.countersign),
    assigneeIds: jsonArr(r.assigneeIds),
    note: r.note ?? null,
  };
}
function toCheckinRow(r: any): CheckinRow {
  return {
    id: r.id, campusId: r.campusId, scheduleId: r.scheduleId, dutyDate: r.dutyDate,
    teacherId: r.teacherId, locationName: r.locationName, timeSlotName: r.timeSlotName ?? null,
    situation: r.situation ?? null, photos: jsonArr(r.photos), checkedInAt: num(r.checkedInAt),
  };
}
function toSwapRow(r: any): SwapRow {
  return {
    id: r.id, campusId: r.campusId, type: r.type as SwapType,
    applicantId: r.applicantId, applicantScheduleId: r.applicantScheduleId, applicantDate: r.applicantDate,
    targetId: r.targetId, targetScheduleId: r.targetScheduleId ?? null, targetDate: r.targetDate ?? null,
    reason: r.reason, status: r.status as SwapStatus,
    reviewerId: r.reviewerId ?? null, reviewComment: r.reviewComment ?? null,
    createdAt: num(r.createdAt), reviewedAt: r.reviewedAt == null ? null : num(r.reviewedAt),
  };
}
function toInspectionRow(r: any): InspectionRow {
  return {
    id: r.id, campusId: r.campusId, inspectorId: r.inspectorId,
    inspectDate: r.inspectDate, areaId: r.areaId,
    items: jsonArr<InspectionItem>(r.items), createdAt: num(r.createdAt),
  };
}

export function createDutyRepos(ctx: DrizzleCtx): DutyRepos {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const {
    dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules,
    dutyCheckins, dutyInspections, dutySwaps,
  } = T;

  // ══════════ 区域 ══════════
  const areas: DutyAreaRepo = {
    async listByCampus(campusId): Promise<DutyArea[]> {
      const rows = await db.select().from(dutyAreas).where(eq(dutyAreas.campusId, campusId)).orderBy(asc(dutyAreas.sortOrder), asc(dutyAreas.name));
      return rows.map((r: any) => ({ id: r.id, campusId: r.campusId, name: r.name, sortOrder: num(r.sortOrder) }));
    },
    async findById(id): Promise<DutyArea | null> {
      const rows = await db.select().from(dutyAreas).where(eq(dutyAreas.id, id)).limit(1);
      return rows[0] ? { id: rows[0].id, campusId: rows[0].campusId, name: rows[0].name, sortOrder: num(rows[0].sortOrder) } : null;
    },
    async create(input): Promise<DutyArea> {
      const id = crypto.randomUUID();
      await db.insert(dutyAreas).values({ id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 }).run();
      return { id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 };
    },
    async update(id, input): Promise<DutyArea | null> {
      await db.update(dutyAreas).set({ name: input.name, sortOrder: input.sortOrder ?? 0 }).where(eq(dutyAreas.id, id)).run();
      const rows = await db.select().from(dutyAreas).where(eq(dutyAreas.id, id)).limit(1);
      return rows[0] ? { id: rows[0].id, campusId: rows[0].campusId, name: rows[0].name, sortOrder: num(rows[0].sortOrder) } : null;
    },
    async remove(id): Promise<void> {
      await db.delete(dutyAreas).where(eq(dutyAreas.id, id)).run();
    },
  };

  // ══════════ 地点 ══════════
  const locations: DutyLocationRepo = {
    async listByCampus(campusId, areaId): Promise<DutyLocation[]> {
      const cond = whereAll([eq(dutyLocations.campusId, campusId), eqIf(dutyLocations.areaId, areaId)]);
      const rows = await db.select({
        id: dutyLocations.id, campusId: dutyLocations.campusId, areaId: dutyLocations.areaId,
        name: dutyLocations.name, areaName: dutyAreas.name,
      }).from(dutyLocations).leftJoin(dutyAreas, eq(dutyLocations.areaId, dutyAreas.id)).where(cond!).orderBy(asc(dutyLocations.name));
      return rows.map((r: any) => ({ id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name, areaName: r.areaName ?? undefined }));
    },
    async findById(id): Promise<DutyLocation | null> {
      const rows = await db.select().from(dutyLocations).where(eq(dutyLocations.id, id)).limit(1);
      return rows[0] ? { id: rows[0].id, campusId: rows[0].campusId, areaId: rows[0].areaId, name: rows[0].name } : null;
    },
    async create(input): Promise<DutyLocation> {
      const id = crypto.randomUUID();
      await db.insert(dutyLocations).values({ id, campusId: input.campusId, areaId: input.areaId, name: input.name }).run();
      return { id, campusId: input.campusId, areaId: input.areaId, name: input.name };
    },
    async update(id, input): Promise<DutyLocation | null> {
      const patch: any = { name: input.name };
      if (input.areaId !== undefined) patch.areaId = input.areaId;
      await db.update(dutyLocations).set(patch).where(eq(dutyLocations.id, id)).run();
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await db.delete(dutyLocations).where(eq(dutyLocations.id, id)).run();
    },
  };

  // ══════════ 时段 ══════════
  const timeSlots: DutyTimeSlotRepo = {
    async listByCampus(campusId, areaId): Promise<DutyTimeSlot[]> {
      const cond = whereAll([eq(dutyTimeSlots.campusId, campusId), eqIf(dutyTimeSlots.areaId, areaId)]);
      const rows = await db.select().from(dutyTimeSlots).where(cond!).orderBy(asc(dutyTimeSlots.priority), asc(dutyTimeSlots.name));
      return rows.map((r: any) => ({
        id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name,
        startMinute: r.startMinute == null ? null : num(r.startMinute),
        endMinute: r.endMinute == null ? null : num(r.endMinute),
        priority: num(r.priority),
      }));
    },
    async findById(id): Promise<DutyTimeSlot | null> {
      const rows = await db.select().from(dutyTimeSlots).where(eq(dutyTimeSlots.id, id)).limit(1);
      const r = rows[0];
      return r ? { id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name, startMinute: r.startMinute == null ? null : num(r.startMinute), endMinute: r.endMinute == null ? null : num(r.endMinute), priority: num(r.priority) } : null;
    },
    async create(input): Promise<DutyTimeSlot> {
      const id = crypto.randomUUID();
      const row = {
        id, campusId: input.campusId, areaId: input.areaId, name: input.name,
        startMinute: input.startMinute ?? null, endMinute: input.endMinute ?? null, priority: input.priority ?? 0,
      };
      await db.insert(dutyTimeSlots).values(row).run();
      return row;
    },
    async update(id, input): Promise<DutyTimeSlot | null> {
      const patch: any = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.startMinute !== undefined) patch.startMinute = input.startMinute;
      if (input.endMinute !== undefined) patch.endMinute = input.endMinute;
      if (input.priority !== undefined) patch.priority = input.priority;
      await db.update(dutyTimeSlots).set(patch).where(eq(dutyTimeSlots.id, id)).run();
      const rows = await db.select().from(dutyTimeSlots).where(eq(dutyTimeSlots.id, id)).limit(1);
      const r = rows[0];
      return r ? { id: r.id, campusId: r.campusId, areaId: r.areaId, name: r.name, startMinute: r.startMinute == null ? null : num(r.startMinute), endMinute: r.endMinute == null ? null : num(r.endMinute), priority: num(r.priority) } : null;
    },
    async remove(id): Promise<void> {
      await db.delete(dutyTimeSlots).where(eq(dutyTimeSlots.id, id)).run();
    },
  };

  // ══════════ 排班模板 ══════════
  const schedules: DutyScheduleRepo = {
    async listForExpand(filter): Promise<DutyScheduleRow[]> {
      // 与日期范围相交：dateStart <= dateTo AND dateEnd >= dateFrom（减少扫描）
      const cond = whereAll([
        eq(dutySchedules.campusId, filter.campusId),
        eqIf(dutySchedules.kind, filter.kind),
        eqIf(dutySchedules.areaId, filter.areaId),
        filter.dateTo ? lte(dutySchedules.dateStart, filter.dateTo) : undefined,
        filter.dateFrom ? gte(dutySchedules.dateEnd, filter.dateFrom) : undefined,
      ]);
      const rows = await db.select().from(dutySchedules).where(cond!);
      return rows.map(toScheduleRow);
    },
    async list(filter): Promise<Paged<DutyScheduleRow & { areaName?: string; locationName?: string; timeSlotName?: string }>> {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 50;
      const cond = whereAll([
        eq(dutySchedules.campusId, filter.campusId),
        eqIf(dutySchedules.kind, filter.kind),
        eqIf(dutySchedules.areaId, filter.areaId),
      ]);
      const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(dutySchedules).where(cond!);
      const rows = await db.select({
        s: dutySchedules,
        areaName: dutyAreas.name,
        locationName: dutyLocations.name,
        timeSlotName: dutyTimeSlots.name,
      }).from(dutySchedules)
        .leftJoin(dutyAreas, eq(dutySchedules.areaId, dutyAreas.id))
        .leftJoin(dutyLocations, eq(dutySchedules.locationId, dutyLocations.id))
        .leftJoin(dutyTimeSlots, eq(dutySchedules.timeSlotId, dutyTimeSlots.id))
        .where(cond!)
        .orderBy(asc(dutySchedules.weekday), asc(dutySchedules.dateStart))
        .limit(pageSize).offset((page - 1) * pageSize);
      const data = rows.map((r: any) => ({
        ...toScheduleRow(r.s),
        areaName: r.areaName ?? undefined,
        locationName: r.locationName ?? undefined,
        timeSlotName: r.timeSlotName ?? undefined,
      }));
      return { data, pagination: paginate(page, pageSize, num(total)) };
    },
    async findById(id): Promise<DutyScheduleRow | null> {
      const rows = await db.select().from(dutySchedules).where(eq(dutySchedules.id, id)).limit(1);
      return rows[0] ? toScheduleRow(rows[0]) : null;
    },
    async create(input): Promise<DutyScheduleRow> {
      const id = input.id ?? crypto.randomUUID();
      const row = {
        id, campusId: input.campusId, kind: input.kind, areaId: input.areaId,
        timeSlotId: input.timeSlotId ?? null, locationId: input.locationId ?? null,
        dateStart: input.dateStart, dateEnd: input.dateEnd, weekday: input.weekday,
        weekParity: input.weekParity, countersign: input.countersign,
        assigneeIds: input.assigneeIds, note: input.note ?? null,
      };
      await db.insert(dutySchedules).values(row).run();
      return toScheduleRow(row);
    },
    async update(id, input): Promise<DutyScheduleRow | null> {
      const patch: any = { ...input };
      delete patch.id;
      await db.update(dutySchedules).set(patch).where(eq(dutySchedules.id, id)).run();
      return this.findById(id);
    },
    async remove(id): Promise<void> {
      await db.delete(dutySchedules).where(eq(dutySchedules.id, id)).run();
    },
    async bulkCreate(rows): Promise<number> {
      if (rows.length === 0) return 0;
      await ctx.tx(async (tx: any) => {
        for (const r of rows) {
          await tx.insert(dutySchedules).values({
            id: crypto.randomUUID(), campusId: r.campusId, kind: r.kind, areaId: r.areaId,
            timeSlotId: r.timeSlotId ?? null, locationId: r.locationId ?? null,
            dateStart: r.dateStart, dateEnd: r.dateEnd, weekday: r.weekday,
            weekParity: r.weekParity, countersign: r.countersign, assigneeIds: r.assigneeIds, note: r.note ?? null,
          }).run();
        }
      });
      return rows.length;
    },
  };

  // ══════════ 执勤打卡 ══════════
  const checkins: DutyCheckinRepo = {
    async create(input): Promise<CheckinRow> {
      const id = crypto.randomUUID();
      const row = {
        id, campusId: input.campusId, scheduleId: input.scheduleId, dutyDate: input.dutyDate,
        teacherId: input.teacherId, locationName: input.locationName, timeSlotName: input.timeSlotName ?? null,
        situation: input.situation ?? null, photos: input.photos, checkedInAt: input.checkedInAt ?? Date.now(),
      };
      // UNIQUE(schedule,date,teacher) 冲突由 isUniqueViolation 在路由转 409
      await db.insert(dutyCheckins).values(row).run();
      return toCheckinRow(row);
    },
    async listByTeacher(teacherId, opts): Promise<Paged<CheckinRow>> {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      const cond = whereAll([
        eq(dutyCheckins.teacherId, teacherId),
        opts?.dateFrom ? gte(dutyCheckins.dutyDate, opts.dateFrom) : undefined,
        opts?.dateTo ? lte(dutyCheckins.dutyDate, opts.dateTo) : undefined,
      ]);
      const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(dutyCheckins).where(cond!);
      const rows = await db.select().from(dutyCheckins).where(cond!).orderBy(desc(dutyCheckins.checkedInAt)).limit(pageSize).offset((page - 1) * pageSize);
      return { data: rows.map(toCheckinRow), pagination: paginate(page, pageSize, num(total)) };
    },
    async listByCampusDate(campusId, dateFrom, dateTo): Promise<CheckinRow[]> {
      const rows = await db.select().from(dutyCheckins).where(
        and(eq(dutyCheckins.campusId, campusId), gte(dutyCheckins.dutyDate, dateFrom), lte(dutyCheckins.dutyDate, dateTo)),
      );
      return rows.map(toCheckinRow);
    },
    async findById(id): Promise<CheckinRow | null> {
      const rows = await db.select().from(dutyCheckins).where(eq(dutyCheckins.id, id)).limit(1);
      return rows[0] ? toCheckinRow(rows[0]) : null;
    },
  };

  // ══════════ 巡查记录 ══════════
  const inspections: DutyInspectionRepo = {
    async create(input): Promise<InspectionRow> {
      const id = crypto.randomUUID();
      const row = {
        id, campusId: input.campusId, inspectorId: input.inspectorId,
        inspectDate: input.inspectDate, areaId: input.areaId, items: input.items,
      };
      await db.insert(dutyInspections).values(row).run();
      const rows = await db.select().from(dutyInspections).where(eq(dutyInspections.id, id)).limit(1);
      return toInspectionRow(rows[0]);
    },
    async listByCampus(campusId, opts): Promise<Paged<InspectionRow>> {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      const cond = whereAll([eq(dutyInspections.campusId, campusId), eqIf(dutyInspections.areaId, opts?.areaId)]);
      const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(dutyInspections).where(cond!);
      const rows = await db.select().from(dutyInspections).where(cond!).orderBy(desc(dutyInspections.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
      return { data: rows.map(toInspectionRow), pagination: paginate(page, pageSize, num(total)) };
    },
    async findById(id): Promise<InspectionRow | null> {
      const rows = await db.select().from(dutyInspections).where(eq(dutyInspections.id, id)).limit(1);
      return rows[0] ? toInspectionRow(rows[0]) : null;
    },
  };

  // ══════════ 调班申请 ══════════
  const swaps: DutySwapRepo = {
    async create(input): Promise<SwapRow> {
      const id = crypto.randomUUID();
      const row = {
        id, campusId: input.campusId, type: input.type,
        applicantId: input.applicantId, applicantScheduleId: input.applicantScheduleId, applicantDate: input.applicantDate,
        targetId: input.targetId, targetScheduleId: input.targetScheduleId ?? null, targetDate: input.targetDate ?? null,
        reason: input.reason, status: 'pending' as const, reviewerId: null, reviewComment: null,
      };
      await db.insert(dutySwaps).values(row).run();
      const rows = await db.select().from(dutySwaps).where(eq(dutySwaps.id, id)).limit(1);
      return toSwapRow(rows[0]);
    },
    async list(filter): Promise<Paged<SwapRow>> {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 20;
      const cond = whereAll([
        eqIf(dutySwaps.campusId, filter.campusId),
        eqIf(dutySwaps.applicantId, filter.applicantId),
        eqIf(dutySwaps.targetId, filter.targetId),
        eqIf(dutySwaps.status, filter.status),
      ]);
      const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(dutySwaps).where(cond!);
      const rows = await db.select().from(dutySwaps).where(cond!).orderBy(desc(dutySwaps.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
      return { data: rows.map(toSwapRow), pagination: paginate(page, pageSize, num(total)) };
    },
    async findById(id): Promise<SwapRow | null> {
      const rows = await db.select().from(dutySwaps).where(eq(dutySwaps.id, id)).limit(1);
      return rows[0] ? toSwapRow(rows[0]) : null;
    },
    async review(id, reviewerId, decision, reviewComment): Promise<SwapRow | null> {
      // 仅 pending 可审（WHERE status='pending' 防重复审批）
      await db.update(dutySwaps)
        .set({ status: decision, reviewerId, reviewComment: reviewComment ?? null, reviewedAt: Date.now() })
        .where(and(eq(dutySwaps.id, id), eq(dutySwaps.status, 'pending')))
        .run();
      return this.findById(id);
    },
    async listApproved(campusId): Promise<SwapRow[]> {
      const rows = await db.select().from(dutySwaps)
        .where(and(eq(dutySwaps.campusId, campusId), eq(dutySwaps.status, 'approved')))
        .orderBy(asc(dutySwaps.createdAt));
      return rows.map(toSwapRow);
    },
  };

  return { areas, locations, timeSlots, schedules, checkins, inspections, swaps };
}

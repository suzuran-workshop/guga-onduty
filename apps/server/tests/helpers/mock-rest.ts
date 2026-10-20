/**
 * 内存�?RestDb（PostgREST mock）—�?�?rest 轨可在本地端到端验证�?
 *
 * 为什么需要：rest 轨真身跑�?qw-pages（PostgREST over HTTPS），本地无环境�?
 * 这个 mock 忠实实现 @homurajs/db �?RestDb/RestTable 契约（select/insert/update/remove +
 * 过滤算子 eq/neq/gt/gte/lt/lte/like/ilike/is/in + order + limit），使同一�?E2E 能跑 rest 轨，
 * 验证 rest repo �?JS-join / JS-聚合 / JS-分页逻辑正确（而非仅类型对齐）�?
 *
 * �?忠实还原 homura RestTable �?*能力边界**（这些正�?rest repo 要在应用侧补偿的）：
 *   - �?join、无聚合、无 offset、无 count、无事务�?
 * 行为对齐 @homurajs/db/src/postgrest.ts 的过滤语义（值比较用列的原始类型）�?
 */
import type { RestDb, RestTable, RestRow, RestFilters, RestFilterValue, RestSelectOptions, RestCondition, RestOp } from '@homurajs/db';

type Row = Record<string, any>;

/** 单表内存存储 */
class MemTable implements RestTable<RestRow> {
  constructor(private rows: Row[], private pk: string) {}

  private matches(row: Row, filters?: RestFilters): boolean {
    if (!filters) return true;
    for (const [col, fv] of Object.entries(filters)) {
      if (!matchOne(row[col], fv)) return false;
    }
    return true;
  }

  async select(filters?: RestFilters, opts?: RestSelectOptions): Promise<RestRow[]> {
    let out = this.rows.filter((r) => this.matches(r, filters)).map((r) => ({ ...r }));
    // order: 'col.desc' / 'col.asc' / 'a.desc,b.asc'
    if (opts?.order) {
      for (const part of opts.order.split(',').reverse()) {
        const [col, dir] = part.trim().split('.');
        const desc = dir === 'desc';
        out.sort((a, b) => cmp(a[col], b[col]) * (desc ? -1 : 1));
      }
    }
    if (opts?.columns && opts.columns !== '*') {
      const cols = opts.columns.split(',').map((s) => s.trim());
      out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    if (opts?.limit !== undefined) out = out.slice(0, opts.limit);
    return out;
  }

  async insert(rows: Partial<RestRow> | Partial<RestRow>[], opts?: { upsertOn?: string }): Promise<RestRow[]> {
    const arr = Array.isArray(rows) ? rows : [rows];
    const out: Row[] = [];
    for (const r of arr) {
      const conflictKey = opts?.upsertOn ?? this.pk;
      const existing = this.rows.find((x) => x[conflictKey] === (r as any)[conflictKey]);
      if (existing) {
        // upsert：合�?
        Object.assign(existing, r);
        out.push({ ...existing });
      } else {
        const row = { ...(r as Row) };
        this.rows.push(row);
        out.push({ ...row });
      }
    }
    return out;
  }

  async update(patch: Partial<RestRow>, filters: RestFilters): Promise<RestRow[]> {
    const out: Row[] = [];
    for (const row of this.rows) {
      if (this.matches(row, filters)) {
        Object.assign(row, patch);
        out.push({ ...row });
      }
    }
    return out;
  }

  async remove(filters: RestFilters): Promise<RestRow[]> {
    const removed: Row[] = [];
    this.rows = this.rows.filter((row) => {
      if (this.matches(row, filters)) { removed.push({ ...row }); return false; }
      return true;
    });
    return removed;
  }
}

function cmp(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

/** 单列匹配一�?RestFilterValue（对�?buildFilterEntries 语义�?*/
function matchOne(colVal: any, fv: RestFilterValue): boolean {
  // null �?is.null
  if (fv === null) return colVal === null || colVal === undefined;
  // 数组 �?in
  if (Array.isArray(fv)) return fv.includes(colVal);
  // 显式 {op, value}
  if (typeof fv === 'object' && fv !== null && 'op' in fv) {
    const { op, value } = fv as RestCondition;
    return applyOp(op, colVal, value);
  }
  // 标量 �?eq
  return colVal === fv;
}

function applyOp(op: RestOp, colVal: any, value: unknown): boolean {
  switch (op) {
    case 'eq': return colVal === value;
    case 'neq': return colVal !== value;
    case 'gt': return colVal > (value as any);
    case 'gte': return colVal >= (value as any);
    case 'lt': return colVal < (value as any);
    case 'lte': return colVal <= (value as any);
    case 'like': return likeMatch(colVal, value as string, false);
    case 'ilike': return likeMatch(colVal, value as string, true);
    case 'is': return value === null ? (colVal === null || colVal === undefined) : colVal === value;
    case 'in': return Array.isArray(value) ? value.includes(colVal) : false;
    default: return false;
  }
}

function likeMatch(colVal: any, pattern: string, insensitive: boolean): boolean {
  if (typeof colVal !== 'string') return false;
  const cv = insensitive ? colVal.toLowerCase() : colVal;
  const p = insensitive ? pattern.toLowerCase() : pattern;
  // PostgREST like�? = 任意，_ = 单字�?
  const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
  return re.test(cv);
}

/** 内存 RestDb：table(name) 惰性建�?*/
export function createMockRestDb(): RestDb & { _tables: Map<string, MemTable>; _seed(name: string, rows: Row[], pk?: string): void } {
  const tables = new Map<string, MemTable>();
  return {
    _tables: tables,
    _seed(name, rows, pk = 'id') {
      tables.set(name, new MemTable(rows.map((r) => ({ ...r })), pk));
    },
    table<TRow extends RestRow = RestRow>(name: string): RestTable<TRow> {
      if (!tables.has(name)) tables.set(name, new MemTable([], 'id'));
      return tables.get(name)! as unknown as RestTable<TRow>;
    },
    async ping(tableName: string): Promise<void> {
      if (!tables.has(tableName)) throw new Error(`ping: table ${tableName} 不存在`);
    },
  };
}

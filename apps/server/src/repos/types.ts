/**
 * Repository 契约 —— db 无关的领域接口。
 *
 * 路由层只依赖这些接口，不碰 drizzle/rest/SQL 细节。三轨装配（repos/index.ts）：
 *  - drizzle 实现覆盖 sqlite + pg（表对象按方言注入，同一份源码）
 *  - rest 实现覆盖 qw-pages（PostgREST API）
 *
 * 通用约定：
 *  - 所有 id 为 uuid string。
 *  - campusId 强制隔离：写操作的 campusId 由调用方（路由，取自 profile）传入，repo 不信任请求体。
 *  - 多语句操作用事务（drizzle: db.transaction；rest: 无事务，best-effort + 幂等设计补偿）。
 *  - 返回领域对象（camelCase，见 @guga-onduty/shared）；JSON 列已反序列化为数组。
 */
import type {
  Campus, UserView, UserProfile, User, UserRole, Pagination,
} from '@guga-onduty/shared';
import type { DutyRepos } from './duty-types.js';

/** 分页结果 */
export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

// ── 校区 ────────────────────────────────────────────────────────────
export interface CampusesRepo {
  listAll(): Promise<Campus[]>;
  listForCampus(campusId: string): Promise<Campus[]>;
  findById(id: string): Promise<Campus | null>;
  create(input: { name: string; code: string }): Promise<Campus>;
  update(id: string, input: { name: string; code: string }): Promise<Campus | null>;
  remove(id: string): Promise<void>;
}

// ── 用户（auth users 身份锚点 + userProfiles 业务档案）──────────────
export interface UsersRepo {
  list(campusId?: string, role?: UserRole): Promise<UserView[]>;
  findProfile(userId: string): Promise<UserProfile | null>;
  /** 建号：auth register（user+password）+ 建 profile，事务/顺序保证 */
  create(input: {
    campusId: string; username: string; password: string;
    displayName: string; role: UserRole; canInspect?: number;
  }): Promise<UserView>;
  update(userId: string, input: { displayName: string; role: UserRole; canInspect?: number }): Promise<UserView | null>;
  remove(userId: string): Promise<void>;
  /** /auth/me：身份 + 档案 + 校区名 */
  findMe(userId: string): Promise<{ user: User; profile: UserProfile; campusName: string } | null>;
}

// ── 系统设置 ────────────────────────────────────────────────────────
export interface SettingsRepo {
  getMap(campusId: string): Promise<Record<string, string>>;
  upsertMany(campusId: string, entries: { key: string; value: string }[]): Promise<void>; // 事务
}

/** 全部 repo 集合（createRepos 按形态装配） */
export interface Repos {
  campuses: CampusesRepo;
  users: UsersRepo;
  settings: SettingsRepo;
  /** 值班域 —— 排班/打卡/巡查/调班 */
  duty: DutyRepos;
}

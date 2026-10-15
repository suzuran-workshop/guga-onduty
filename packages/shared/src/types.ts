/**
 * 前后端共享类型契约 —— 值班（教师校园巡查）领域模型。
 *
 *  - 所有实体 id 为 uuid string（身份模型统一到 auth SDK 的 uuid 锚点）。
 *  - 字段一律 camelCase，与 drizzle schema / PostgREST 列名 / API wire 三者一致，消除映射层。
 *  - 用户拆分为 `User`（auth 身份锚点：id/username/nickname/avatarUrl）+
 *    `UserProfile`（业务档案：campusId/role/displayName/canInspect）。
 *  - 时间戳统一 epoch 毫秒（number）。
 *
 * 值班域 wire 契约（区域/地点/时段/排班/矩阵/打卡/巡查/调班）见 ./duty.ts，
 * 由此文件统一 re-export（单一 import 路径 '@guga-onduty/shared'）。
 */

// ── 枚举（与 server/src/schema/enums.ts 单一真源对齐）──────────────────
export type UserRole = 'admin' | 'teacher' | 'student';

// ── 实体 ────────────────────────────────────────────────────────────
export interface Campus {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

/** auth SDK 身份锚点（users 表） */
export interface User {
  id: string;
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 业务档案（userProfiles 表）——「你能做什么」 */
export interface UserProfile {
  userId: string;
  campusId: string;
  displayName: string;
  role: UserRole;
  /** 领导巡查权限（0/1）：teacher 且被授权者可巡查在岗 */
  canInspect: number;
}

/** 列表页返回的用户视图（身份 + 档案 + 关联名） */
export interface UserView {
  id: string;
  username: string | null;
  campusId: string;
  displayName: string;
  role: UserRole;
  campusName: string;
  /** 领导巡查权限（0/1） */
  canInspect: number;
  createdAt: number;
}

export interface Setting {
  id: string;
  campusId: string;
  key: string;
  value: string;
}

// ── API 契约 ────────────────────────────────────────────────────────
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ── 请求体 ──────────────────────────────────────────────────────────
export interface LoginRequest {
  username: string;
  password: string;
}

/** GET /api/v1/auth/me —— 身份 + 档案 + 校区名 */
export interface MeResponse {
  user: User;
  profile: UserProfile;
  campusName: string;
}

export interface CreateUserRequest {
  campusId: string;
  username: string;
  password?: string;
  displayName: string;
  role: UserRole;
  canInspect?: boolean;
}

export interface UpdateUserRequest {
  displayName: string;
  role: UserRole;
  canInspect?: boolean;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ── 值班域 wire 契约（区域/地点/时段/排班/矩阵/打卡/巡查/调班）──────────
// 单一 import 路径：前端从 '@guga-onduty/shared' 一并取基础 + 值班类型。
export * from './duty.js';

/**
 * pg 轨迁移入口 —— drizzle-kit generate 的 schema 源。
 *
 * drizzle-kit 扫描「单独导出的表对象」生成 DDL，故此处把业务表与 auth SDK 5 表
 * 全部以具名导出摊平（不能只导出一个 record 对象）。repo 层运行时用的是 ./pg.ts 与
 * @homurajs/auth/tables，本文件仅供迁移生成，不参与运行时查询。
 */
export * from './pg.js';
export * from './pg.duty.js';
import { pgAuthTables } from '@homurajs/auth/tables';

// auth SDK 5 表（具名导出供 drizzle-kit 识别）
export const users = pgAuthTables.users;
export const passwords = pgAuthTables.passwords;
export const refreshTokens = pgAuthTables.refreshTokens;
export const oauth2IdentityLinks = pgAuthTables.oauth2IdentityLinks;
export const webauthnCredentials = pgAuthTables.webauthnCredentials;

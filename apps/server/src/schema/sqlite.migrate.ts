/**
 * sqlite 轨迁移入口 —— drizzle-kit generate 的 schema 源。
 * 与 pg.migrate.ts 对称：摊平业务表 + auth SDK 5 表的具名导出。
 */
export * from './sqlite.js';
export * from './sqlite.duty.js';
import { sqliteAuthTables } from '@homurajs/auth/tables';

export const users = sqliteAuthTables.users;
export const passwords = sqliteAuthTables.passwords;
export const refreshTokens = sqliteAuthTables.refreshTokens;
export const oauth2IdentityLinks = sqliteAuthTables.oauth2IdentityLinks;
export const webauthnCredentials = sqliteAuthTables.webauthnCredentials;

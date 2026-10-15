import { defineDrizzleKitConfig } from '@homurajs/db';

// sqlite 轨迁移：schema 源 = src/schema/sqlite.migrate.ts，输出 drizzle/sqlite
export default defineDrizzleKitConfig({
  dialect: 'sqlite',
  schemaGlob: './src/schema/sqlite.migrate.ts',
  out: './drizzle/sqlite',
});

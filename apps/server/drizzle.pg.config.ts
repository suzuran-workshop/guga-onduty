import { defineDrizzleKitConfig } from '@homurajs/db';

// pg 轨迁移：schema 源 = src/schema/pg.migrate.ts，输出 drizzle/pg
// 注：defineDrizzleKitConfig 内部把 dialect 'pg' 映射为 drizzle-kit 的 'postgresql'
export default defineDrizzleKitConfig({
  dialect: 'pg',
  schemaGlob: './src/schema/pg.migrate.ts',
  out: './drizzle/pg',
});

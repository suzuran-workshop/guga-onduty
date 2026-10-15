# AGENTS.md

校园值班·值周管理平台（**值班域**）——@homurajs(app-kit) + Hono + Drizzle 三轨 + React19/shadcn 全栈应用

> 本仓库由「值班 / 值周二合一」仓库 `guga-onduty-w` 拆分而来，只承载**值班域**（教师巡查校园地点：
> 教学楼 / 校门口 / 操场等）。值周域（值周生巡查班级打分）在 `guga-onduty-w`。

## 概述
- 本项目面向中小学**教师执勤值班**：把教师校园巡查执勤变成可排班、可履职、可监督、可变更的一站式工具
- 值班域：区域 / 地点 / 时段配置、排班模板（周期 + 单双周 + 会签）、Excel 排班导入、执勤打卡（照片）、领导巡查、调班审批、值班大表矩阵、到岗率统计、数字大屏数据源、多校区隔离
- 核心设计：**状态不持久化、实时计算**（DB 只存周期模板 + 打卡 + 已批准调班；展开/矩阵/统计查询时实时算）

## 边界与范围
- **范围内**：教师执勤排班、打卡（照片）、领导巡查、调班审批、值班大表矩阵、到岗率统计、Excel 导入、多校区隔离
- **非目标**（明确排除）：对接真实短信 / 邮件推送通道、学生请假、课表系统；值周生班级打分（属 `guga-onduty-w`）

## Agent 操作指南
- **全局规则**：
  - 使用 pnpm 作为包管理器，不要使用 npm/yarn
  - 后端从零冷启动：`cp apps/server/.env.example apps/server/.env`（填 SESSION_SECRET）→ `pnpm db:seed && pnpm dev:server`
  - 前端端口 5173，Vite proxy 将 `/api`、`/auth`（SDK 登录链）、`/files`（图片代理）转发到 `localhost:3000`
  - git commit 遵循 Conventional Commits，subject 不超过 72 字符
- **数据库**：`@homurajs/db`（Drizzle）三轨——`DB_DIALECT=sqlite`（默认，node:sqlite，`apps/server/data/app.db`）/ `pg`（postgres-js）/ `rest`（PostgREST，qw-pages）。**迁移 SQL 必须 `pnpm db:generate`（drizzle-kit 从 schema 生成），绝不手写 DDL**
- **Schema 铁律**：pg.ts / sqlite.ts 双方言手写、列名一律 **camelCase**、主键 uuid、`assertSchemaParity` 门禁校验表名/列名/主键一致；不用 drizzle `references()`（rest 轨无 FK，完整性靠 repo+事务）
- **鉴权**：`@homurajs/auth` cookie 会话（HttpOnly access+refresh，非 localStorage token）；`sessionMiddleware` 设 `c.get('auth').sub`(=users.id uuid) → `requireProfile` 查 userProfiles 设 `c.get('profile')`(role/campusId/canInspect) → `requireRole` RBAC。登录走 SDK `POST /auth/password/login`
- **多校区隔离**：读用 `resolveCampusId(c)`（非 admin 强制本人校区）；写用 `resolveWriteCampusId(c, body)`；按 id 写端点用 `assertEntityOwnership(c, entity)` 校验归属（非本校区返 404，不泄露存在性）
- **drizzle repo 两条硬约束**：① select 里的 sql 片段不生成别名 → orderBy 必须重复完整表达式；② pg 严格 groupBy → 补全所有非聚合列（按最严的 pg 写）
- **i18n**：前端文案必须经过 `t()` 包裹，中英双语（`apps/web/src/i18n/index.ts`）
- **测试**：`pnpm test`（vitest，105 tests）。E2E 用 `tests/helpers/harness.ts` 起真实 HTTP 服务（ephemeral 端口+临时 sqlite+cookie jar）

## 目录速查
| 路径 | 职责 |
|------|------|
| `apps/server/src/index.ts` | standalone 入口（createNodeAdapter） |
| `apps/server/src/qw-pages.ts` | qw-pages 入口（createQwPagesAdapter） |
| `apps/server/src/bootstrap.ts` | 启动装配（config→db→auth→repos→storage→app） |
| `apps/server/src/app.ts` | app-kit createApp 装配（CORS/onError/healthz/static+SPA） |
| `apps/server/src/config.ts` | defineConfig 配置装载（SESSION_SECRET required） |
| `apps/server/src/schema/{pg,sqlite}.ts` | 双方言业务 schema（共享基础表：campuses/userProfiles/settings） |
| `apps/server/src/schema/{pg,sqlite}.duty.ts` | 双方言值班 schema（7 表） |
| `apps/server/src/schema/index.ts` | parity 门禁 + restSchema 派生 + auth 表合并 |
| `apps/server/drizzle/{pg,sqlite}/` | drizzle-kit 生成的迁移 |
| `apps/server/src/db/{client,seed}.ts` | db 工厂（三轨 openDatabase/migrate）+ 值班种子 |
| `apps/server/src/auth/build.ts` | SessionManager + PasswordProvider + SDK 路由装配 |
| `apps/server/src/middleware/profile.ts` | requireProfile/requireRole/resolveCampusId/assertEntityOwnership |
| `apps/server/src/repos/types.ts` | repo 契约（campuses/users/settings/duty） |
| `apps/server/src/repos/duty-types.ts` | 7 值班 repo 契约（DutyRepos） |
| `apps/server/src/repos/drizzle/` | drizzle repo 实现（sqlite/pg 共用） |
| `apps/server/src/repos/index.ts` | createRepos 按形态派发（drizzle 完成，rest 为 P4） |
| `apps/server/src/duty/` | 值班纯函数引擎（expand/swap-overlay/checkin-index/matrix/date/excel-import）+ service |
| `apps/server/src/routes/` | 路由模块（基础 auth/campuses/users/settings + duty.ts 值班） |
| `apps/server/src/storage/build.ts` | local-fs storage + /files 代理（域：duty-checkin/duty-inspect） |
| `apps/server/tests/` | E2E + 引擎单测 + 审查回归（helpers/harness.ts） |
| `apps/web/src/App.tsx` | 路由 + RBAC 守卫（ProtectedRoute/RequireRole） |
| `apps/web/src/components/Layout.tsx` | 侧边栏（值班导航）+ 顶栏 |
| `apps/web/src/components/ui/` | shadcn/ui 组件（源码内联） |
| `apps/web/src/pages/` | 业务页面（值班 6：DutySchedule/Checkin/Inspection/Swap/Report/Config + Config/Settings/Login） |
| `apps/web/src/api/client.ts` | cookie 认证 fetch 封装（api + authApi + fileUrl + upload/download） |
| `apps/web/src/hooks/useAuth.tsx` | cookie 会话上下文（profile 驱动 RBAC） |
| `apps/web/src/i18n/index.ts` | 国际化资源（含 duty 命名空间） |
| `packages/shared/src/types.ts` | 基础 wire 契约（re-export duty.ts） |
| `packages/shared/src/duty.ts` | 值班域 wire 契约（矩阵/打卡/调班/巡查/统计） |
| `docs/` | PRD / ARCHITECTURE / DUTY-FUSION / REVIEW-PHILOSOPHY / DECISIONS |

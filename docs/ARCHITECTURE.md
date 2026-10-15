# ARCHITECTURE — 校园值班管理

## 概述
校园值班管理（**值班域**）—— 面向中小学教师执勤值班的排班/打卡/巡查/调班一体化平台。
本仓库由「值班 / 值周二合一」仓库拆分而来（见 `DECISIONS.md` ADR-6），只承载值班域。

## 技术栈
| 层 | 选型 |
|----|------|
| 运行时 | Node.js >= 22.5 |
| 应用底座 | @homurajs（app-kit / core / db / auth / storage） |
| 后端 | Hono + Drizzle ORM（repository 模式，三轨装配） |
| 前端 | Vite + React 19 + shadcn/ui (Tailwind) + react-router + i18next |
| 数据库 | sqlite（默认，node:sqlite）/ PostgreSQL（postgres-js）/ PostgREST（qw-pages） |
| 迁移 | drizzle-kit 从 schema 生成（pg / sqlite 双方言） |
| 共享 | pnpm workspace（apps/server + apps/web + packages/shared） |

## 部署形态（双形态，经 RuntimeAdapter 收口）
- **standalone**：`apps/server/src/index.ts`（createNodeAdapter）—— sqlite/pg + local-fs storage，独立部署。
- **qw-pages**：`apps/server/src/qw-pages.ts`（createQwPagesAdapter）—— rest 数据轨 + 网关反代。
  差异仅在 adapter（trustProxy / assetsDir / port），业务代码不变。

## 数据模型（15 表 = 5 auth + 10 业务）
- **auth（SDK 提供）**：users / passwords / refreshTokens / oauth2IdentityLinks / webauthnCredentials
- **共享基础表（3）**：`campuses`（校区）/ `userProfiles`（业务档案：role/campusId/displayName/canInspect）/ `settings`（key-value，含 `semester_start`）
- **值班域（7）**：`dutyAreas`（区域）/ `dutyLocations`（地点）/ `dutyTimeSlots`（时段）/ `dutySchedules`（排班模板，核心）/ `dutyCheckins`（打卡）/ `dutyInspections`（巡查）/ `dutySwaps`（调班）

Schema 铁律：双方言手写、列名 camelCase、主键 uuid、`assertSchemaParity` 门禁、无 drizzle `references()`（完整性靠 repo + 事务）。

## 分层
```
routes/*            HTTP 端点（参数校验、RBAC、校区隔离）
  ↓ RouteDeps { repos, storage, auth }
duty/service.ts     组合层：repo 取行 + 引擎计算 → 业务能力（矩阵/今日任务/到岗率）
  ↓
duty/*.ts           纯函数引擎（无 I/O，可单测）
  ├─ expand.ts         排班模板 → 具体日期实例
  ├─ swap-overlay.ts   已批准调班 → 实际值班人叠加层
  ├─ checkin-index.ts  打卡状态索引（精确到人）
  ├─ matrix.ts         大表矩阵（地点 × 一周 7 天，pill 三态）
  ├─ excel-import.ts   Excel 排班导入解析
  └─ date.ts           值班日期工具（本地日历日）
  ↓
repos/drizzle/*     数据存取（duty-repo 7 合一 + campuses/users/settings）
  ↓
db/client.ts        三轨 openDatabase / migrate（按 DB_DIALECT 派发）
schema/*            双方言 schema + parity 门禁
```

### 值班域核心引擎（纯函数）
- **排班展开**：`DutySchedule`（周期模板）→ `[dateStart,dateEnd]` 内每个匹配日生成 `DutyInstance`
  （匹配：日期区间 ∧ 周内日 ∧ 单双周奇偶 ∧ 区域）
- **调班叠加**：`buildSwapOverlay(approvedSwaps)` 生成 `swapKey(scheduleId, date) → 实际值班人` 映射；
  `applySwapOverlay` 产出 `effectiveAssigneeIds`（不回改原模板）
- **打卡索引**：`buildScheduleDoneChecker` 按 (scheduleId, date, teacherId) 精确到人（会签不串台）
- **大表矩阵**：`buildMatrix` 聚合为 行=地点 × 列=周一~周日，格=教师 pill（已换班 / 已执勤 / 未执勤）
- **单双周锚点**：校区级 `settings.semester_start`，矩阵 / 打卡守卫 / 到岗率三处同源（消除各自 dateStart 错位）

## 身份与权限
- **会话**：`@homurajs/auth` cookie 会话（HttpOnly access + refresh rotate + 族吊销），非 localStorage token。
- **身份锚点**：auth SDK `users`（uuid），业务属性在 `userProfiles`（1:1）。
- **链路**：`sessionMiddleware`（设 `c.auth`）→ `requireProfile`（查 userProfiles 设 `c.profile`）→ `requireRole`（RBAC）。
- **角色**：`admin` / `teacher`。领导巡查 = `admin` ∪（`teacher` 且 `userProfiles.canInspect=1`）。
- **多校区隔离**：读 `resolveCampusId`（非 admin 强制本人校区）；写 `resolveWriteCampusId`；by-id 写端点 `assertEntityOwnership`（非本校区 404，不泄露存在性）。

## 数据流（值班）
```
GET  /api/v1/duty/matrix?week=&area_id=   → listForExpand → expandWeek → swapOverlay
                                          → checkins → buildMatrix → MatrixView
POST /api/v1/duty/checkins (multipart照片)  → resolveDutyGuard(本人班次,含叠加) → storage.upload → dutyCheckins
POST /api/v1/duty/inspections             → canInspect 校验 → items(JSON 子表) → dutyInspections
POST /api/v1/duty/swaps → review          → dutySwaps 状态机 → 影响后续展开的叠加层
GET  /api/v1/duty/attendance              → expandSchedules + doneChecker → 应到/实到/到岗率
```

## 测试策略
- `pnpm test`（vitest，105 tests，5 套件）：
  - `duty-engine`：纯函数引擎单测（展开 / 单双周 / 叠加 / 打卡索引 / 矩阵 / 锚点）
  - `duty-repo`：repo 端到端（CRUD / UNIQUE / JSON 子表 / 事务 / 隔离）
  - `duty-http`：HTTP E2E（真实服务 + cookie 登录，配置/矩阵/打卡/巡查/调班/到岗率）
  - `duty-import`：Excel 导入端到端（SheetJS 生成 xlsx）
  - `duty-review`：对抗性审查回归（同角色跨主体越权、引用守卫、日期校验等）
- E2E 台架 `tests/helpers/harness.ts`：起真实 HTTP 服务（ephemeral 端口 + 临时 sqlite + cookie jar），测真实中间件链。

## 边界
- rest 轨（qw-pages）repo 为 P4 规划项；当前 standalone（sqlite/pg）为完整验证主路径。
- storage rest 轨（qw-pages 只读根）待 `@homurajs/storage` 发包修复后接 db 后端。
- 通知仅数据记录，未接真实推送通道（非目标）。

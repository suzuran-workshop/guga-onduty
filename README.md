# 校园值班管理平台

面向中小学的**教师执勤值班**数字化平台——把教师的校园巡查执勤（教学楼、校门口、操场等地点）变成可排班、可履职、可监督、可变更的一站式工具，替代纸质值班表与口头调班。

> 本仓库由原「值班 / 值周二合一」仓库 `guga-onduty-w` 拆分而来，只承载**值班域**（教师巡查校园地点）。
> 值周域（值周生巡查班级打分）已迁至 `guga-onduty-w`。两者底层引擎同构（排班→履职→监督→变更四层），
> 但面向客户的场景不同，故拆分为独立产品。值班引擎的设计文档见 `docs/DUTY-FUSION.md`。

## 这是什么？
- **定位**：校内教师执勤值班的排班—打卡—巡查—调班—统计一体化工具
- **解决的核心问题**：
  - 教师值班排班靠 Excel「一张总表」难维护
  - 到岗无记录、执勤无凭证（照片）
  - 临时调班靠口头、无审批留痕、无叠加追溯
  - 领导巡查在岗无抽样工具
  - 到岗率手工统计费时易错

## 功能
| 功能 | 解决什么 |
|------|----------|
| 区域 / 地点 / 时段配置 | 校园执勤岗位可配置（比班级更粗粒度的巡查对象） |
| 排班模板（周期 + 单双周 + 会签） | 一条模板描述一学期的周期性执勤 |
| Excel 排班导入 | 从现有排班表一键导入（缺失区域/地点/时段自动创建） |
| 值班大表矩阵 | 地点 × 一周 7 天的实时矩阵（点开即看谁在哪执勤） |
| 执勤打卡（照片必填） | 到岗凭证，本人班次守卫防代打卡 |
| 领导巡查 | 有巡查权限者抽样核对在岗 |
| 调班申请与审批 | 交换 / 代理两种调班，审批后叠加层实时生效（不回改原排班） |
| 到岗率统计 | 应到 / 实到，精确到人 |
| 多校区隔离 | 各校区独立运行互不干扰 |
| 多校区大屏 | 「校园值班」数字大屏数据源 |

## 核心设计
- **状态不持久化、实时计算**：DB 只存**周期排班模板 + 打卡 + 已批准调班**；展开实例、矩阵、到岗率都在查询时由纯函数引擎实时算出。
- **调班叠加层**：调班不改原排班模板，而是叠加一层「实际值班人」映射，天然可追溯、可按日期回滚。
- **四层同构**：排班 → 履职（打卡）→ 监督（巡查）→ 变更（调班）。

## 安装与运行
- **前置要求**：Node.js >= 22.5、pnpm
- **安装步骤**：
  ```bash
  pnpm install
  cp apps/server/.env.example apps/server/.env   # 填入 SESSION_SECRET（>=32 bytes）
  pnpm db:seed          # 建表（drizzle 迁移）+ 灌种子数据
  ```
- **启动（开发模式）**：
  ```bash
  pnpm dev:server       # 后端 http://localhost:3000
  pnpm dev:web          # 前端 http://localhost:5173（Vite proxy 转发 /api、/auth、/files）
  ```
- **测试**：`pnpm test`（后端 105 tests：引擎单测 + repo + HTTP E2E + Excel 导入 + 审查回归）
- 测试账号：admin / teacher1（领导，有巡查权）/ teacher2，密码均为 `123456`

## 当前状态
- **阶段**：原型（自 值周/值班 融合仓库拆分独立）
- **数据方言**：默认 sqlite；schema 三轨全写（sqlite / pg / rest 派生），保留 standalone 与 qw-pages 双形态部署能力
- **已知限制**：
  - 通知未对接真实推送通道（非目标）
  - rest 轨（qw-pages）repo 为 P4 规划项，当前 standalone(sqlite/pg) 为完整验证主路径

## 核心技术
- **应用底座**：[@homurajs](https://www.npmjs.com/org/homurajs) 五模块（app-kit / core / db / auth / storage）
- **后端**：Hono + Drizzle ORM（repository 模式，三轨装配）
- **前端**：Vite + React 19 + shadcn/ui (Tailwind CSS) + react-router + i18next + sonner
- **类型共享**：pnpm workspace（apps/server + apps/web + packages/shared）
- **认证**：cookie 会话（HttpOnly access+refresh）+ Bearer 兼容；身份(auth users) 与业务档案(userProfiles) 分离
- **数据库**：sqlite（默认，零依赖）/ PostgreSQL / PostgREST，迁移由 drizzle-kit 从 schema 生成（双方言）

## 文档
- `docs/PRD.md` — 值班域产品需求
- `docs/ARCHITECTURE.md` — 系统架构
- `docs/DUTY-FUSION.md` — 值班引擎设计（原「值班/值周融合方案」，拆分后作为值班引擎的设计依据保留）
- `docs/DECISIONS.md` — 架构决策记录（含拆分决策 ADR-6）
- `docs/REVIEW-PHILOSOPHY.md` — 值班域审查与改良记录

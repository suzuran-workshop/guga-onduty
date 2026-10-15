# 值班引擎设计（原「值班 / 值周融合方案」）

> **拆分后说明（2026-10-15）**：本仓库原为「值班 / 值周二合一」的 `guga-onduty-w`。
> 经 `DECISIONS.md` ADR-6 拆分后，本仓库只承载**值班域**（教师巡查校园地点），值周域已迁出。
> 因此本文中关于「融合」与「值周生（kind=dutyWeek）」的表述属**历史背景**；
> 值班引擎本身的设计（§2 数据模型、§3 算法、§4/5 结构、§7 实现映射）仍是本仓库的**设计依据**。
> 关键差异：`DutyKind` 现收敛为 `teaching` 单一类型；`dutyWeek` 排班类型与「到岗率桥接值周 records」已随拆分移除。

---

# DUTY-FUSION — 值班/值周统一巡查职责融合方案

> 状态：进行中 · 分支 `feat/duty-fusion` · 底座 = 已完成的 @homurajs 迁移（main 分支 P0–P6，71 E2E 全绿）
> 缘起：主人指出外部「值班系统」PRD（教师执勤排班）与本系统「值周」（学生打分）功能满足度≈5%，
> 但**「值周只是一种更详细的值班，都是巡查业务」**——两个功能集团应无缝融合。
> 约束：只参考外部 PRD 的**功能语义**，绝不照搬其实现（钉钉宜搭 oyd.jsx/React16/img.scdn.io 图床/
> searchFormDatas/dingtalk 审批流）。一切用本项目自己的 homura 底座 + Vite/React19/shadcn 重新构思实现。

---

## 0. 哲学统一：巡查职责的四层同构

外部 PRD 的「教师执勤」与本系统的「值周打分」，本质是**同一件事的两种粒度**：

> **某人（履职者）在某时某地（排班）执行一项职责并留下记录（履职），被上级抽样核查（监督），
> 且排班可经审批临时变更（工作流）。**

| 层 | 教师执勤（粗粒度巡查） | 值周生（细粒度巡查） | 统一抽象 |
|----|----------------------|--------------------|---------|
| **排班** Schedule | 教师每周某天某时段某地点到岗 | 值周生每周某几天巡查某片区 | `DutySchedule`（周期模板，展开到学期每个匹配日） |
| **履职** Performance | 执勤打卡（到岗+照片+情况说明） | 值周记录（班级打分+标签+图片）← **现有 `records`** | 都是「到岗履职记录」，共享状态机/图片存储/SSE |
| **监督** Oversight | 领导巡查（抽样查在岗/不在岗） | 班主任申诉（对扣分异议） | 核查履职质量 |
| **变更** Workflow | 调班申请（交换/代理，审批，叠加层） | 撤回/申诉状态机 | 排班或记录的受控变更 |
| **展示** View | 值班大表矩阵（地点×周几，教师 pill 三态） | 班级排名 / 数字大屏 | 统一排班矩阵 + 履职统计 |

**关键发现**：本系统现有 `dutyGroups`（值周小组）只是「分组」，从未真正排到「哪天、哪片、谁」。
外部 PRD 的**排班表**恰好补上这一缺失层——补上后，值周生的巡查排班与教师的执勤排班落到同一张
`duty_schedules` 表，用 `kind` 区分粒度，**这就是「无缝融合」的技术落点**。

**融合原则（增量，非推倒）**：
- ✅ 现有值周履职域（`records`/`appeals`/`awards`/`statistics`，71 E2E 全绿）**保持不动**——它是「细粒度履职」的完整实现。
- ✅ 新增**排班层** `duty_schedules`，统一承载「教师执勤排班」与「值周生值周排班」（`kind` 区分）。
- ✅ 新增**执勤履职** `duty_checkins`（粗粒度打卡）、**监督** `duty_inspections`（领导巡查）、**变更** `duty_swaps`（调班审批）。
- ✅ 统一在**值班大表矩阵**与**履职统计报表**层融合展示（教师执勤 + 值周巡查同框）。
- ✅ 全部复用 homura 底座：storage（照片）、auth+profile（教师/领导/管理员角色）、drizzle repos、SSE（大表实时刷新）、双形态。

---

## 1. 角色模型扩展

现有 `UserProfile.role` = `admin | teacher | student`。融合后语义对齐外部 PRD 的三类用户：

| 角色 | 外部 PRD 语义 | 本系统映射 | 权限 |
|------|-------------|-----------|------|
| `admin` | 管理员 | 管理员 | 排班维护、Excel 导入、区域/地点/时段配置、审批调班 |
| `teacher` | 教师（执勤+调班）/ 领导（巡查） | 教师 | 查看自己排班、执勤打卡、发起调班；**领导子角色**可巡查 |
| `student` | —（值周生） | 值周生 | 查看自己值周排班、提交值周记录（细粒度履职） |

**领导巡查权限**：外部 PRD 的「领导」在本系统用 `teacher` + 一个 `canInspect` 标志位表达
（避免新增顶层角色破坏现有 RBAC 矩阵）。`userProfiles` 增列 `canInspect int`（0/1）。
或更简：巡查权限 = `admin` ∪（`teacher` 且被授权）。采用 `canInspect` 标志，admin 建号时设定。

---

## 2. 数据模型（新增 7 表，三轨 schema）

全部沿用 P1 约定：**camelCase 列名、uuid 主键、check 约束、无 drizzle references（三轨一致）、
parity 门禁、drizzle-kit 生成迁移**。

### 2.1 配置类（3 表）

**`dutyAreas`（区域）** — 年级组/学部维度（外部 PRD「区域」）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | 多校区隔离（复用现有 campusId 语义） |
| name | text | 如「一年级组」「小学部」「行政」 |
| sortOrder | int | 排序 |

**`dutyLocations`（值班地点）** — 执勤岗位（外部 PRD「值班地点」）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| areaId | uuid | 关联 dutyAreas |
| name | text | 如「校门口」「教学楼A一层」 |

**`dutyTimeSlots`（值班时段）** — 时间段（外部 PRD「值班时间」）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| areaId | uuid | |
| name | text | 如「早读」「全天值日」 |
| startMinute | int null | 开始（分钟数，480=8:00） |
| endMinute | int null | 结束 |
| priority | int | 排序 |

### 2.2 核心：排班模板（周期，展开到整学期）

**`dutySchedules`（值班排班表）** — 外部 PRD 核心「值班排班表」，**融合的关键表**
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| kind | text | **`teaching`(教师执勤) \| `dutyWeek`(值周生值周)** ← 融合点 |
| areaId | uuid | |
| timeSlotId | uuid null | 时段（值周可空=全天） |
| locationId | uuid null | 地点（值周巡查片区可空） |
| dateStart | text | 周期开始日（YYYY-MM-DD，学期起） |
| dateEnd | text | 周期结束日（学期止） |
| weekday | int | 周内日（0=周日..6=周六；或 1-5 周一~周五） |
| weekParity | text | **`everyweek`\|`odd`\|`even`**（单双周，默认 everyweek） |
| countersign | int | 会签模式（0/1）：同一时空是否允许多人 |
| assigneeIds | json text[] | 被排班者 userId(uuid) 数组（教师或值周生；会签多人） |
| note | text null | |

> **一条记录 = 周期模板**：「每周{weekday}、{timeSlot}、{location}、由{assignees}执勤，
> {weekParity} 规则，在 [dateStart,dateEnd] 学期内生效」。**展开**到学期每个匹配日期是纯函数
> （§3），不持久化实例（对齐外部 PRD「状态不持久化，实时计算」设计哲学）。

### 2.3 履职 / 监督 / 变更（3 表）

**`dutyCheckins`（执勤打卡）** — 外部 PRD「执勤打卡」，粗粒度履职
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| scheduleId | uuid | 关联排班模板 |
| dutyDate | text | 实际执勤日（YYYY-MM-DD） |
| teacherId | uuid | 打卡人（**= 当前用户本人**，精确到人，非整条排班全部教师） |
| locationName | text | 冗余存地点名（快照） |
| timeSlotName | text | 冗余存时段名（快照） |
| situation | text | 执勤情况说明 |
| photos | json text[] | 现场照片 objectKey 数组（**必填≥1**，走 storage） |
| checkedInAt | epochMs | 打卡时刻 |

> 打卡唯一性 key = `scheduleId + dutyDate + teacherId`（会签格多人各自独立打卡，UNIQUE 约束防重复）。

**`dutyInspections`（巡查记录）** — 外部 PRD「巡查记录」，领导抽样查在岗
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| inspectorId | uuid | 巡查领导（当前用户） |
| inspectDate | text | 巡查日期 |
| areaId | uuid | 巡查区域 |
| items | json | **子表**：`[{locationName, teacherName, teacherId, status:'present'|'absent', photoKeys[], scheduleId, dutyDate}]` |
| createdAt | epochMs | |

> **逐记录展开**（外部 PRD 的关键修复）：一条排班记录 → 该地点×该记录内真实教师（会签则多人各一行），
> **不做笛卡尔积**（避免「地点×教师」错配出实际不存在的组合）。items 用 JSON 子表存，避免额外表。

**`dutySwaps`（调班申请）** — 外部 PRD「调班申请」，工作流 + 叠加层
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| campusId | uuid | |
| type | text | `swap`(交换) \| `proxy`(代理) |
| applicantId | uuid | 申请人（=自己） |
| applicantScheduleId | uuid | 我的排班模板 |
| applicantDate | text | 我的排班具体日期（叠加生效日） |
| targetId | uuid | 对方教师 |
| targetScheduleId | uuid null | 对方排班（仅交换） |
| targetDate | text null | 对方排班日期（仅交换） |
| reason | text | 调班原因（必填） |
| status | text | `pending`\|`approved`\|`rejected`（check 约束） |
| reviewerId | uuid null | 审批人 |
| reviewComment | text null | |
| createdAt / reviewedAt | epochMs | |

> **叠加层哲学**（外部 PRD 核心设计）：调班审批通过后**不回改原排班模板**，而是作为「叠加层」
> 在展开实例时按 `swapKey(scheduleInstanceId, date)` 命中，实时计算「实际值班人」。纯函数（§3.2）。

### 2.4 现有值周域的融合接入

- `records`（值周记录）**不动**——它是 `kind=dutyWeek` 排班的「细粒度履职」。
- `dutyGroups`（值周小组）→ 概念升级为「值周排班的人员池」，其 members 可被排进 `dutySchedules(kind=dutyWeek)`。
- `appeals`（申诉）= 值周域的「监督/工作流」，与 `dutyInspections`/`dutySwaps` 在报表层并列展示。

---

## 3. 核心算法（纯函数，可单测，对齐外部 PRD 设计哲学）

### 3.1 排班展开引擎 `expandSchedule(schedule, dateRange) → DutyInstance[]`

把周期模板展开成具体日期的排班实例：
```
DutyInstance = { scheduleId, date, areaId, timeSlotId, locationId, assigneeIds, kind, countersign }
```
匹配规则（对齐外部 PRD `recordMatchesCell`）：
1. `date ∈ [dateStart, dateEnd]`
2. `weekdayOf(date) === schedule.weekday`
3. **单双周**：`semesterWeekNo(date, dateStart)` 算学期第几周；`odd` 只在 `week%2===1`、`even` 反之、`everyweek` 恒真。
4. 会签：`assigneeIds` 多人 → 一个 instance 多履职者。

> `semesterWeekNo` 复用现有 `utils/week.ts` 口径（与值周 week 一致，避免两套周算法）。
> **纯函数、无 I/O、可单测**（93 万比对幂等验证是外部 PRD 的做法，咱用 vitest 覆盖边界）。

### 3.2 调班叠加层 `buildSwapOverlay(approvedSwaps) → Map<swapKey, effectiveAssignee>`

- 取所有 `status==='approved'` 的调班，按 `createdAt` 排序（后者覆盖前者）。
- `swapKey = scheduleId + '|' + normalizedDate`（**具体日期**，保证某天调班只作用那天，不污染整周期其他周同班次）。
- **代理**：申请人排班那天，实际值班人 → 被申请人。
- **交换**：额外把被申请人排班那天，实际值班人 → 申请人。
- 纯函数，展开实例后叠加，得「实际值班人 effectiveAssigneeIds」。

### 3.3 打卡状态精确到人 `buildCheckinIndex(checkins) → Map<doneKey, true>`

- `doneKey = date + '|' + locationId + '|' + timeSlotId + '|' + teacherUserId`（对齐外部 PRD 的 done 图 key）。
- 会签格里 A 打卡不会把 B 也标绿（外部 PRD 的 P1 修复）。
- 历史无 userId 的脏数据回退整格标记（`doneCell`）。

### 3.4 值班大表矩阵视图 `buildMatrix(instances, overlay, checkinIndex) → MatrixCell[][]`

- 行=地点，列=周一~周日，格=教师 pill（三态：已换班/已执勤/未执勤）。
- 纯函数聚合，前端消费。今日列高亮。

---

## 4. 后端结构（复用现有 repo/route 模式）

```
src/
  schema/{pg,sqlite}.ts      # +7 表（dutyAreas/dutyLocations/dutyTimeSlots/dutySchedules/dutyCheckins/dutyInspections/dutySwaps）
  duty/
    expand.ts                # §3.1 排班展开引擎（纯函数）
    swap-overlay.ts          # §3.2 调班叠加（纯函数）
    checkin-index.ts         # §3.3 打卡状态（纯函数）
    matrix.ts                # §3.4 大表矩阵（纯函数）
    excel-import.ts          # Excel 排班导入（叠加合并）
  repos/drizzle/duty-*.ts    # 值班域 repo（7 个）
  repos/rest/duty-*.ts       # rest 轨（P4 rest 完成后补，或本轮同步）
  routes/duty-*.ts           # 排班/打卡/巡查/调班/矩阵/导入 路由
```

**Excel 导入**：外部 PRD 用 Python openpyxl。本项目用 Node 侧 `xlsx`（SheetJS）解析
「岗位×周几→教师」二维总表，处理合并单元格，教师姓名→userId 靠通讯录匹配（现有 users），
生成 `dutySchedules` 批量插入（叠加合并，事务）。**自主实现，不照搬 Python 脚本**。

---

## 5. 前端结构（shadcn，复用现有基座）

```
pages/
  DutySchedulePage.tsx    # 值班大表矩阵（地点×周几，教师 pill 三态，周导航，筛选，今日高亮）← 核心页
  DutyCheckinPage.tsx     # 执勤打卡（今日任务工作台，本人班次守卫，照片必填上传）
  DutyInspectionPage.tsx  # 领导巡查（抽样多地点，在岗/不在岗，逐记录展开防笛卡尔积）
  DutySwapPage.tsx        # 调班申请（交换/代理，一键选对方班次，审批）
  DutyConfigPage.tsx      # 区域/地点/时段配置（admin）
  DutyReportPage.tsx      # 值班日志/统计报表（到岗率，已提交/未提交交叉）
```

主题：外部 PRD 用青岚绿 #24665F。本系统已有 shadcn 令牌体系——**将 primary 调整为青绿系**
以贴合值班域视觉，同时值周域沿用（统一主题）。这是视觉融合，非照搬 DS 对象。

---

## 6. 分阶段计划

| 阶段 | 内容 | 交付 | 验证 |
|------|------|------|------|
| **D0** | 融合蓝图（本文） | docs/DUTY-FUSION.md | 主人 review |
| **D1** | 值班域 schema（7 表三轨）+ parity + 迁移生成 | schema/{pg,sqlite}.ts、drizzle/ | parity 门禁、迁移生成、canInspect 列 |
| **D2** | 核心纯函数引擎（展开/叠加/打卡索引/矩阵） | src/duty/*.ts | vitest 单测（边界+单双周+会签+叠加） |
| **D3** | 值班域 repos（drizzle 7 个） | repos/drizzle/duty-*.ts | repo 验收脚本 |
| **D4** | 值班域路由（排班CRUD/打卡/巡查/调班审批/矩阵/导入） | routes/duty-*.ts | 接入 createApp |
| **D5** | Excel 导入（xlsx 解析二维总表→排班） | duty/excel-import.ts | 导入冒烟 |
| **D6** | 融合：值周排班接入统一排班层；角色 canInspect | seed 增值周排班 | 值周生在大表可见 |
| **D7** | E2E（排班展开→打卡→巡查→调班→矩阵，含权限/隔离/会签/单双周） | tests/duty-*.test.ts | 全绿 |
| **D8** | 前端 6 页（大表矩阵为核心）+ 主题青绿化 | pages/Duty*.tsx | typecheck+build |
| **D9** | 全栈联调 + 通查改良（每个功能哲学价值复盘） | — | 手动+自动 |

---

## 7. 外部 PRD 的功能 → 本系统自有实现映射（证明「只参考功能」）

| 外部 PRD 功能（宜搭实现） | 本系统自有实现（homura + shadcn） |
|--------------------------|----------------------------------|
| oyd.jsx `renderJsx` + `_customState` 闭包状态 | React19 函数组件 + useState/useAsync hooks |
| `searchFormDatas`/`saveFormData` 宜搭 API | drizzle repos（三轨）+ Hono 路由 |
| `img.scdn.io` 公共图床上传照片 | `@homurajs/storage` local-fs + `/files` 代理 |
| `startProcessInstance` 钉钉审批流 | 自有 `dutySwaps` 表 + approve/reject 状态机（复用申诉模式） |
| `getInstances.json` 读流程实例 | repo 直接查 `dutySwaps`（status=approved） |
| Python openpyxl 导入脚本 | Node `xlsx`(SheetJS) 自主解析 |
| 内联 SVG lucide 图标 | `lucide-react` 组件 |
| 内联 style 对象 + DS 令牌 | Tailwind + shadcn CSS 变量（青绿主题） |
| `fetchAllFormDatas` 全量分页翻页 | repo 分页查询（drizzle/rest） |
| 宜搭 display page 发布 | Vite 构建 + app-kit staticDir 托管 |

**核心洞察的落地**：外部 PRD 的「排班模板+调班叠加层+状态不持久化+实时计算」是**优秀的领域设计**，
咱吸收其**功能语义与算法思想**（§3 纯函数），但用本项目的 homura 三轨 + drizzle + 纯函数引擎 +
shadcn 前端**完全重新实现**，并与现有值周域在「排班层」无缝融合——值周生排班与教师执勤排班同表同引擎。

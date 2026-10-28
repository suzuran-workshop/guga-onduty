# DECISIONS

## ADR-1：使用 node:sqlite (DatabaseSync) 而非 better-sqlite3
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：需要嵌入式数据库，零运维成本
- **考虑过的方案**：better-sqlite3（需编译原生模块）、lowdb（JSON文件）、PostgreSQL（太重）
- **决策**：Node.js 26 内置的 `node:sqlite` DatabaseSync
- **为什么选这个**：零依赖、无需编译、同步API简单直接、足够校内场景使用
- **为什么不选其他**：better-sqlite3 需要 node-gyp 编译；PostgreSQL 需要独立部署
- **后果**：同步API阻塞事件循环（但在校内并发量级下无害）
- **何时重新审视**：当并发超过50 QPS 或需跨进程共享数据库时

## ADR-2：前端使用 shadcn/ui (Tailwind) + React 19
- **日期**：2026-10-07（原 Fluent UI 决策）
- **状态**：已更新（@homurajs 迁移时切换为 shadcn/ui）
- **背景**：需要现代、洁净的 UI 框架，支持亮色/暗色主题
- **考虑过的方案**：Fluent UI v9 + 内联样式、Ant Design、纯手写 CSS
- **决策**：shadcn/ui（源码内联组件）+ Tailwind CSS 变量 + lucide-react
- **为什么选这个**：源码内联可完全掌控、CSS 变量天然支持亮暗主题、与 shadcn 生态一致
- **后果**：新增组件需复制 shadcn 源码；主题走 CSS 变量
- **何时重新审视**：当需要复杂主题定制时

## ADR-3：图片存储于对象存储抽象（local-fs）而非数据库
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：执勤打卡 / 巡查需拍照上传作为到岗凭证
- **考虑过的方案**：base64 存 DB、文件系统 + DB 路径、对象存储
- **决策**：`@homurajs/storage` local-fs 后端 + `/files/<key>` 代理路由；DB 存 objectKey
- **为什么选这个**：避免 SQLite 膨胀、备份时可排除图片、命名空间按校区隔离（`<domain>/<campusId>/files/...`）
- **后果**：多服务器部署需共享存储或切对象存储后端
- **何时重新审视**：当需要多服务器部署时

## ADR-4：使用 pnpm workspace monorepo
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：前后端共享类型定义
- **决策**：`apps/server` + `apps/web` + `packages/shared` 三级结构
- **为什么选这个**：pnpm 速度最快、workspace 协议引用零成本共享、目录清晰

## ADR-5：i18n 使用 i18next 中英双语
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：需同时支持中文（日常使用）和英文（演示/国际化）
- **决策**：i18next + react-i18next，资源文件内联于 `apps/web/src/i18n/index.ts`
- **后果**：新增文案需同步中英文 key

## ADR-6：从「值班 / 值周二合一」仓库拆分出独立值班仓库
- **日期**：2026-10-15
- **状态**：已采纳
- **背景**：本仓库原为 `guga-onduty-w`（值班 + 值周融合）。融合方案（见 `DUTY-FUSION.md`）把
  「教师执勤（粗粒度巡查）」与「值周生班级打分（细粒度巡查）」统一为同一套巡查业务，技术上同表同引擎。
  但对客户而言仍是**两个场景**（不同用户、不同试点节奏、不同交付物），合一仓库带来：
  ① 两个产品的发布/部署耦合；② 命名混淆（`dutyGroups` 其实是值周小组）；③ 跨域桥接（改良A）难以独立演进。
- **考虑过的方案**：
  - A. 保持合一，仅用目录/命名空间区隔（现状）—— 场景耦合未解
  - B. 拆为两个仓库，各自独立产品 —— **采纳**
  - C. 拆为两仓库但保留跨服务 API（值周到岗率调用值班矩阵等）—— 引入跨服务依赖，收益不足
- **决策**：**B**。本仓库承载**值班域**（教师巡查校园地点：区域/地点/时段、排班、打卡、巡查、调班、矩阵、到岗率），
  包名 `@guga-onduty/*`；值周域（值周生班级打分）迁至 `guga-onduty-w`，包名 `@guga-onduty-w/*`。
- **关键处理**：
  - **移除跨域桥接（改良A）**：原 `getAttendance` 读值周 `records` 判定 `dutyWeek` 排班到岗 → 拆分后不复存在。
    连带移除 `dutyWeek` 排班类型（`DutyKind` 收敛为 `teaching`）、`RecordsRepo.listRecorderActivity`。
  - **共享基础表各自持有**：`campuses` / `userProfiles` / `settings` 两仓库各建一份（校区、用户、`semester_start`）。
  - **`canInspect` 列归属值班**：领导巡查权限随值班域迁走（值周仓库移除该列）。
- **后果**：两仓库代码高度相似（同一底座骨架），但产品边界清晰、可独立演进与交付。
  融合的技术洞察（纯函数引擎、叠加层、状态不持久化）完整保留在值班域。
- **何时重新审视**：若未来需要两产品数据打通（如统一大屏汇总两域数据），可评估跨服务只读 API，而非重新合库。

## ADR-7：钉钉身份三件套的职责分层——IdP（协议）/ homura（机制）/ App（策略）
- **日期**：2026-10-28
- **状态**：已采纳（本仓库已按此实现；下沉项为对 homura/3p 的演进建议）
- **背景**：钉钉扫码登录 + 通讯录白名单 JIT 建户在本仓库（guga-onduty）与 `guga-onduty-w` 各实现一份，
  且另有独立多租户 IdP `oauth2-dingtalk`。需要明确：哪些下沉 homura、哪些留在 App、
  以及 **oauth2-dingtalk IdP 自身承担什么**——不是「homura vs App」二选一，而是三层。
- **决策**：
  - **oauth2-dingtalk IdP（协议网关）**：钉钉 OAuth 协议细节的唯一封印处——authCode 一次性语义、
    users/me→unionId→getbyunionid 换 userid、sub=企业 userid 的语义锚定、多租户 org 路由、
    clientId/secret 托管。对 App 只暴露标准 OIDC 表面（authorize/token/userinfo）。
    红线：**不碰任何本地用户库**——它不知道 users 表长什么样，其职责止于交付可信的 sub。
  - **homura（机制）**：OIDC 客户端与会话（已有）、oauth2_identity_links 绑定表（已有）、
    未来下沉项：dingtalkContacts 表 + 同步任务、notify 服务（发送/回执/补发）、
    IdentityResolver **骨架**（查绑定→miss 匹配→落库→钩子），以 `provision(sub, contact)` 回调收敛策略点。
  - **App（策略）**：provision 判定（通讯录即白名单、默认角色/校区、JIT 允许性）、RBAC/校区隔离、
    通知的业务触发点与模板、管理面 UI。**建户是 App 的信任边界，永不下沉。**
- **为什么不全部下沉 homura**：① 建户策略是业务安全边界，框架硬编码任何一种都错；
  ② 修坑走 homura 发版会阻塞 App 上线（getbyunionid 参数名即例）；
  ③ 登录链路存在更彻底的收敛——App 只依赖标准 OIDC，钉钉细节归 IdP，homura 无需新增钉钉知识。
- **为什么不留在 App**：两仓库已各自复制 contacts/notify/sync，坑修不了一次（errcode:0≠送达等语义
  迟早漂移）；auth/tables 已有「框架自带表按包分发三方言 schema」的先例，下沉不是开创先例。
- **后果**：新 App 接钉钉登录一律走 IdP 拓扑（只配 OIDC）；通讯录/通知机制待第三个消费方出现时
  按上述刀口下沉 3p（rule of three）。App 内只留 provision 回调 + 管理面。
- **何时重新审视**：第三个钉钉消费方出现时执行下沉；IdP 若需要感知本地账号（当前绝不）则说明分层已被破坏。
- **补充（同日，表归属精修）**：ADR 正文所说「dingtalkContacts 表下沉」的归属定为 **auth 而非 3p**。
  3p 保持无状态 API 客户端（拉快照/发通知），一旦拥有表就必须复刻 auth/tables 的三方言 schema 机器，
  且与 auth 形成两个 schema 拥有者（漂移风险）。contacts 实为「外部身份目录」——oauth2_identity_links
  的伴生表，下沉时应泛型化为 `provider`+`sub`+`name` 的通用 directory 表（auth 拥有），
  3p 只提供拉取；依赖方向：auth ⇏ 3p、3p ⇏ auth，接线由 App 完成。

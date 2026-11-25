# v4 数据字典（字段 / 命令 / 回执矩阵）

> 状态：**跨模块契约收敛稿（#53）**，待负责人裁决 §8 的 C/D 级项后转为冻结基线。
> 上位文档：[M0_CONTRACT_FREEZE.md](M0_CONTRACT_FREEZE.md)（规则与不变式权威）、[DECISION_LOG.md](DECISION_LOG.md)（玩法权威）、[DOMAIN_ARCHITECTURE.md](DOMAIN_ARCHITECTURE.md) §7（字段语义权威）。
> 本文只做**展开与对齐**：把 M0 的表格落到字段级、把 §14.x 修订落到实现状态、把 DA 的模型落到可核对的键名清单。冲突时按 §1.3 的裁决顺序处理，本文不新增规则。
> 证据基线：main `03e95f0`；所有"实测"结论来自本机真实 WASM 构建（`npm run build:v4` + `scripts/audit-v4-contract.mjs`，emcc 7.0.1）。

---

## 1. 读法

### 1.1 状态标记

| 标记 | 含义 | 变更门槛 |
| --- | --- | --- |
| `实现` | 契约已冻结，v4 代码已产出该字段/行为 | 改它 = C 级 |
| `待实现` | 契约已冻结，代码尚无该字段/行为 | 补它 = B 级（新增）；先核对 §8 待裁决 |
| `超契约` | 代码产出了契约未要求的字段 | 删它 = C 级（影响存档形状） |
| `待裁决` | 文档之间存在冲突或字段载荷未冻结 | 按 §8 走负责人裁决 |

### 1.2 "已冻结"的判据

一个字段/命令/回执只有在满足以下三条时才标 `实现`：

1. M0（含 §14 修订）或 DECISION_LOG 已给出确定语义；
2. v4 代码在真实 WASM 构建下可观察该形状；
3. `scripts/audit-v4-contract.mjs` 的期望表已登记它（§9）。

三者缺一即不得称"已冻结可用"。这是本字典与"文档写了就算有了"的根本区别。

### 1.3 裁决顺序

`DECISION_LOG.md`（玩法）> `M0_CONTRACT_FREEZE.md`（工程契约，含 §14）> `DOMAIN_ARCHITECTURE.md` §7（字段语义）> 本文（展开与状态） > 代码（现状证据，不是规范）。

代码与文档冲突时**默认改代码**，除非文档侧违反 §1.3 上位权威（此时列入 §7 待裁决，不擅自改已确认玩法）。

---

## 2. 根结构

```text
GameState { version, seed, company, staff[], works[], suppliers[], contracts[],
            partners[], committees[], market, events, finance, archive }
```

| 字段 | 类型 | 解析必填（`decode_state`） | 缺失时 | 状态 |
| --- | --- | --- | --- | --- |
| `version` | int | 否 | 默认 `0` → `validate()` 报 `INV-01 version 必须为 4` | `实现`（`runtime.cpp:274`、`:460`） |
| `seed` | uint32 | 否 | 默认 `0`，**无任何校验**，静默改变随机输入 | `待裁决` D-05 |
| `company` | Company | **是** | `INVALID_INPUT` | `实现`（`runtime.cpp:193`） |
| `staff` | Staff[] | **是** | `INVALID_INPUT` | `实现`（`:194`） |
| `works` | Project[] | **是** | `INVALID_INPUT` | `实现`（`:195`） |
| `finance` | Finance | **是** | `INVALID_INPUT` | `实现`（`:196`） |
| `events` | EventState | **是**（且 `events.pending` 必须是数组） | `INVALID_INPUT` | `实现`（`:197-200`） |
| `suppliers` `contracts` `partners` `committees` `market` `archive` | Json | 否 | 缺失取默认（数组 `[]`、对象 `{}`），**内容零校验** | `待实现`（见 §3.10 与 §3.11） |

**解析必填共 8 条检查**：`state` 本身、`company` / `staff` / `works` / `finance` / `events` / `events.pending` / `events.pending[].viewed`。其余聚合是 C++ 侧的 `Json` 透传（`model.hpp` `GameState`），M0 §3 对它们要求的字段在 v4 代码里**没有任何对应实现**，所以第 3.10 节按 DA §7.4/§7.5/§7.6 的契约形状登记为 `待实现`。

**不存在的字段**（v3 遗产，禁止复活）与派生值不入存档清单，见 M0 §2；本文不重复列举，但 §7 记录了 `finance.loans` / `finance.solvency` 两个仍被代码产出的违例。

---

## 3. 聚合字段表

### 3.1 `Company`

实测键：`end_reason, founded_week, id, name, reputation, reputation_log, status, week`。

| 字段 | 类型 | 可空 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| `id` `name` `founded_week` `week` `status` `reputation` `reputation_log` | — | 否 | M0 §3 必填 | `实现` |
| `end_reason` | string\|null | 是（仅 `running` 为 null） | M0 §3 | `实现` |
| `facilities` | Facility[] | 是（可空数组） | §14.7 阶段 2 的"设施维护费"、§14.9 扩容的数据前提 | `待实现`——代码无此字段，维护费无法归因 |
| `core_staff_capacity` | int | — | §14.9：由成长里程碑**单调推导**，不绑设施 | `待实现`，且属派生值（不入存档），只作为读模型 |
| `status` 取值 | `running/closing/ended` | — | `runtime.cpp:278-280` 校验 | `实现` |
| `week` ∈ [0,520] ∧ `running ⇒ week<520` | — | — | INV-21（`:275-277`） | `实现` |
| `reputation_log[]` | `{week, reason, delta, after}` | — | DA §7.2 | `实现` |

### 3.2 `Staff`

实测键：`abilities, assignment_work_id, departure_warning, employment, experience, fatigue, id, last_participation, morale, name, potential, project_fee, revealed_potential, role, talent_type, temporary_contract, weekly_salary`。

| 字段 | 类型 | 可空/默认 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| `id name role employment fatigue morale departure_warning assignment_work_id` | — | 必填 | `实现` | 与 M0 §3 一致 |
| `abilities` `experience` `potential` `revealed_potential` | **对象**（非数组） | 必填 | `实现` | 实测序列化为固定 6 键对象：`planning / direction / drawing / animation / management / postproduction`；前三者值为 int，`revealed_potential` 为 bool。C++ 侧是 `std::array`，**JSON 侧是对象**——前端按数组下标读会全错，必须按能力名取键 |
| `talent_type` `weekly_salary` | string / int | 必填 | `实现` | |
| `signing_fee` | int ≥0 | 必填 | **`待实现`** | M0 §3/§14.6、DEC-STAFF-004 要求；**代码完全没有该字段**，`hire_core`/`hire_temporary` 亦未实现 |
| `project_fee` | int | — | **`超契约`** | 旧语义（DECISION_LOG 无、GAME_RULES 标为历史提案）；v4 无任何消费者（已 grep 确认，现存 `project_fee` 引用全在 V3 侧）→ §8 D-02 |
| `assignment_work_id` | string\|null | 是 | `实现` | INV-09（`:300+`）；INV-10（同周单归属 + 临时=合同项目）**无代码检查** |
| `last_participation` | `{work_id,item_id,week}\|null` | 是 | `实现` | INV-11 校验 `week ∈ {week-1, null}` |
| `temporary_contract` | Json\|null | 是 | `实现`（透传，`model.hpp` 注释"M1 不参与规则"） | 形状未冻结 → §8 D-07 |
| `forced_rest`（休养期） | — | — | **`待实现`** | §14.10 / INV-28 / DEC-STAFF-009 的前置数据；代码无字段、无红灯状态机 |
| 监督岗位 | — | — | **`待裁决` D-03** | 见下 |

**监督（INV-27 / §14.8 / DEC-STAFF-008）现状**：代码把"监督"实现为**职业判断** `kernel::is_supervisor(role)` = `role ∈ {director, animation_director, production_manager}`（`kernel.cpp:331-333`），既不是项目级岗位也没有状态字段。而 DEC-STAFF-008 明确"**担任监督…不修改 Staff.role**"且"每个 producing 项目**必须恰有一名**监督"。→ 用职业冒充岗位与已确认玩法冲突，且 INV-27 无法断言。裁决项 D-03（建议：`Project.supervisor_staff_id` 字段 + 资格校验，属于 C 级新增）。

### 3.3 `Project`

实测键：`channels, common, deadline_week, delivery, episodes, extension, id, investment, mode, offer, opened_week, plan, status`。

| 字段 | 类型 | 可空 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| `id mode investment channels opened_week deadline_week extension status common episodes plan` | — | 必填 | `实现` | `status ∈ planning/producing/delivering/settled` |
| `delivery` | Json\|null | 是 | `实现`（透传） | 形状未冻结 |
| `offer` | Json | **首版恒为 `null`** | `实现` + `待裁决` D-06 | `model.hpp:145` 注释"M2 强类型化"。**实测**：产出态 `offer=null`，JSON 往返 1/3 次哈希不变；但 `offer` 键**缺失**或为 `{}` 时解析成 `{}`，与 `null` 产生**不同哈希**（`model.cpp:243` `j.value("offer", Json::object())`）→ 同一语义两种编码不等价 |
| `ip_id` | string\|null | 是 | **`待实现`** | M0 §3 列出；代码无字段 → 原创/系列关联无处记录 |
| `committee_id` | string\|null | 是 | **`待实现`** | M0 §3 列出；代码无字段 → **INV-14 无法断言**（`mode=committee ⇒ committee_id≠null`） |
| `tv_service` | bool\|object\|null | 是 | **`待实现`** | M0 §3 列出；命令 15 `buy_tv_service` 的数据前提 |
| `plan` | `{intensity, focus, outsourcing, overtime, target}` | `target: null` | `实现` | 实测取值 `intensity=standard / focus=quality / outsourcing=gap_fill / overtime=false / target=null`；`target` 为 `{kind,id}\|null` |
| 可交付性 | — | — | `实现`（派生） | `Project::deliverable()`，INV-08 因此**不需要**存档字段（但无断言，见 §6） |

### 3.4 `CommonProduction` / `EpisodeProduction` / Stage

实测：`common = {id, items[]}`；`episodes[] = {id, index, stages}`；**`stages` 是长度为 6 的数组**，元素为 `{key, items[]}`。

- M0 §3/INV-06 的措辞是"stages 恰 6 个，**键**固定有序"。实现取**数组 + `key` 字段**（顺序即 `kStages` 顺序）而非 JSON 对象映射。
- 结论：**语义满足**（数量固定、顺序固定、键名固定），但"键"字面易被误读为 object 键。已在 §7 C-10 登记为文档措辞项（A 级：在 M0 §3 加一句"实现为数组，元素带 `key`"），**不改代码**。
- `episodes` 与 `stages[].items` 在哈希前排序（`runtime.cpp:455-462` canonicalize），所以数组顺序不影响 `hash_state`。

### 3.5 `WorkItem`

实测键与 M0 §3 必填**逐一对应**：`id, key, ability, work_total, work_done, deliver_at, deps, is_gate, quality, contributors`。

**类型细节（前端易踩）**：

- `quality` 是**对象**（非数组），固定 6 键 `story / direction / drawing / animation / art / sound`，值为 int；与 §5.1 `report.works[].quality.dims` 同一套维度名。
- `contributors` 是员工 id 字符串数组；`deps` 是工作项 id 字符串数组。
- 能力向量同 Staff（§3.2）：`WorkItem.ability` 是能力**名字符串**，不是下标。

| 约束 | 实现 | 状态 |
| --- | --- | --- |
| `0 ≤ work_done ≤ work_total`、`deliver_at ∈ [1,1000]` | `runtime.cpp` INV-03 | `实现` |
| `deps` 无环/不自指/不跨项目 | INV-04 | `实现` |
| 无 `status` 字段（全派生） | INV-05 | `待实现`（无断言；当前靠 `from_json` 不读该字段被动满足） |
| `contributors` 只增不删、无重复、只含参与过者 | INV-12 | `实现` |
| 工作项 id 前缀 `<work_id>.<key>` | 保证 INV-02 全局唯一 | `实现`（`v4.test.mjs findItem` 依赖此前缀） |
| 主责/协力档位 | 由 `kernel` 按职业映射即时判定，**不入存档** | `待裁决` D-04（前端需展示"主责/协力"，DEC-STAFF-008 要求 UI 呈现档位标签，但回执无该字段） |

### 3.6 `Finance`

实测键：`opening_funds, balance, entries, loans, solvency`。

| 字段 | 状态 | 说明 |
| --- | --- | --- |
| `opening_funds` `balance` `entries[]` | `实现` | INV-16 恒等式已断言（`runtime.cpp:433`） |
| `loans` | **`超契约`** | M0 §3"不含 loans"、INV-18、DA §7.5.1 全部废止；`model.cpp:301/324` 仍在序列化/解析/参与哈希 |
| `solvency{state,since_week,deadline_week,gap}` | **`超契约`** | `model.cpp:302-306/325-331`；**且 `runtime.cpp:435` 用它给负现金开逃生口**：`balance<0 && solvency.state!="crisis" && running ⇒ 报错`，即 `solvency.state=="crisis"` 时**允许负余额通过校验**，直接违背 INV-25 与 §14.2/§14.7 |
| `entries[]` 形状 | `实现` | `{id, week, work_id\|null, category, amount, counterparty\|null, memo}`——与 DA §7.5 `Entry` 一致 |

> 这两个字段不是"无害的多余键"：`INV-18`（禁止存在）之所以 16 条未断言之一，正是因为它们在代码里；`INV-25` 的"余额始终非负"之所以形同虚设，正是因为 `:435` 读它们。**删除即同时关闭违例路径**——这是 §8 D-01 推荐立即裁决的原因（零 v4 消费者，成本最低窗口在 UI 接入 v4 之前）。

### 3.7 `LedgerEntry.id` 与 `category` 约定（跨模块命名）

| 来源 | id 模式 | category | work_id | memo |
| --- | --- | --- | --- | --- |
| 周薪 | `w{week}.salary.{staff_id}` | `salary` | null | 员工名 |
| 公司运营 | `w{week}.operations` | `operations` | null | `公司运营` |
| 项目制作 | `w{week}.production.{work_id}` | `production` | work_id | 强度值 |
| 事件选项 `cost` | `w{week}.event.{event_id}.{work_id}` | `events` | work_id | 事件 id |
| 事件 `funds` 效果 | `w{week}.event.{event_id}.{work_id}.e{effectIndex}` | `events` | work_id | 事件 id |

- **不变式**：同一命令内所有 id 全局唯一（INV-02，`claim_id`）；`.e{index}` 后缀是 #92 为修复"同选项 cost 与 funds 效果同周同 id"而引入。
- 命名不一致处：路径段用单数 `event`，`category` 用复数 `events`。登记为 D-08（改动会破 `v4.test.mjs:810` 的 1 处断言，属可控）。
- DA §7.5 冻结了 **14 个 category 取值**（3 收入 + 11 支出）；v4 代码目前只产出 4 个（`salary/operations/production/events`）。收入类待命令 10/20 实现；`temporary/outsourcing/extension/penalty/development/distribution/investment_paid/*_received` 全部 `待实现`。

### 3.8 `EventState`

实测键：`pending[], last_event_week, per_work`；`per_work[<work_id>] = {cooldowns: {<event_id>: until_week}, major_seen: [<event_id>]}`。**`per_work` 与 `cooldowns` 的键是业务 id，不是字段名**（审计脚本把它们归一化为 `*`，见 §9）。

`pending[]` 实测键：`event_id, name, work_id, triggered_week, expires_week, cooldown_weeks, once_per_project, viewed, options[]`；`options[]` = `{id, label, kind, risk_hint, cost, effects[]}`；`effects[]` = `{scope, target, stage, value}`。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `work_id/event_id/triggered_week/viewed` | `实现` | INV-23；`viewed` 在 `runtime.cpp:204-206` **必填且必须布尔**，缺失即 `INVALID_INPUT`（不静默当未查看） |
| 触发时冻结 `name/cooldown_weeks/once_per_project/options/effects` | `实现` | `resolve_event` 只读快照，不回查内容目录（M0 §14.12、#92 测试第 7 条） |
| `expires_week` | `实现`（恒 `null`） | 首版非 0 被校验器与运行时双重拒绝（`runtime.cpp:419` + 内容校验） |
| `episode_id` / `stage` / `item_id` | **`待裁决` D-09** | DA §7.6 的 pending 形状含这三项（事件锚定到单集/阶段/工作项），M0 §3/INV-23 只要求项目级，代码无 → 三方不一致 |
| `escalation` | **`待裁决` D-09** | DA §7.6 出现该字段名，但 §14.11/§14.12 明确"默认分支与升级载荷字段未冻结"。字段名已存在却载荷未定，内容作者易误解 |
| 展示字段 `description` / `foreshadow` / `category` / `polarity` / `tier` | **`待实现`（建议 B 级扩展）** | 快照只有 `name`；前端要渲染事件正文必须回查内容目录，与"改版后仍按触发时执行"的展示一致性冲突（结算不需回查，展示却需要） |
| 内容目录（`event_catalog_info`） | `实现` | 卡片 schema 见 [EVENT_CONTENT_PIPELINE.md](EVENT_CONTENT_PIPELINE.md) §2；`schema_version=1` |

### 3.9 `Archive`

实测：`{company_result: null, series: [], works: []}`——**空对象透传**，`WorkRecord` 的 20+ 字段（DA §7.6）在 v4 代码中不存在。命令 19/20/21 未实现，故 INV-22（只追加、`WorkRecord.id` 唯一、`previous_work_id` 指向更早）为 `待实现`。

### 3.10 `Supplier` / `OutsourceContract` / `Partner` / `Committee` / `MarketState` / `Offer`

`initialize_game` 实测输出：`suppliers=[]`、`contracts=[]`、`partners=[]`、`committees=[]`、`market={}`。

| 聚合 | 契约形状 | 代码 | 缺口影响 |
| --- | --- | --- | --- |
| `Supplier` | DA §7.4 + M0 §3（8 必填） | `Json` 透传 | 命令 9 无数据前提；INV-19 无法断言 |
| `OutsourceContract` | DA §7.4（15 必填） | `Json` 透传 | INV-20 无法断言 |
| `Partner` / `Committee` | DA §7.4 + M0 §3 | `Json` 透传 | INV-13 无法断言；委员会模式无成员数据 |
| `MarketState` | M0 §3（`heat,slots,refresh_week,competitors` 必填） | **`{}` 空对象** | 命令 1 的原子范围（"市场首轮"）未落地；INV-24 无法断言；命令 12/13/14 无数据前提 |

**M0 §5 命令 1 的原子范围写的是"建立公司/名册/供应商/合作方/市场首轮"，实测只建立公司 + 3 名核心员工**（`suppliers/partners/committees` 为空、`market` 为 `{}`）。这是当前最大的跨模块缺口：企划、外包、委员会、市场四条链在核心里没有数据形状。

### 3.11 未冻结的形状（本文不代为冻结）

`Facility`、`temporary_contract` 内部字段、`Project.investment{percent,paid}`、`Project.extension`、`Project.delivery`、`Offer` 全量字段、`WorkRecord` 全量字段——语义见 DA §7，**载荷字段名/可空性未在 M0 冻结**，且对应命令未实现。本字典把它们标 `待实现`，并在 §8 D-10 说明"是否现在冻结这些形状"需负责人定节奏（建议：随各命令实现批次冻结，避免凭猜测锁死字段名）。

---

## 4. 命令矩阵

M0 §5 冻结 22 条命令。核心实际导出 **12 个入口**（`v4_bindings.cpp:10-24`），其中 3 个是别名。**"文档 22 / 代码 12"不是编号漂移，而是实现覆盖度**，必须显式区分，否则 M2/M3 会按文档以为可用。

| # | 命令 | 入口 | 输入（实测必填） | 主要错误码（实测） | 回执（实测） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `initialize_game(seed)` | ✅ `:14` | `seed`（非负整数，缺失即 `INVALID_INPUT`，`runtime.cpp:900-903`） | `INVALID_INPUT` | `{state}` | `实现`（原子范围不足，见 §3.10） |
| 2 | `start_work(offer_id, mode, percent, committee_partner_ids)` | ❌ | — | — | — | `待实现` |
| 3 | `set_work_plan(work_id, plan)` | ✅ `:15` | `state, work_id, plan` | `INVALID_INPUT` / `NOT_FOUND` / `INVALID_PHASE` | `{state}` | `实现` |
| 4 | `assign_staff(staff_id, work_id\|null)` | ✅ `:17` | `state, staff_id, work_id` | `NOT_FOUND` / `INVALID_PHASE` | `{state}` | `实现`（INV-27 监督替换未实现） |
| 5–16 | `hire_core` `scout` `dismiss_staff` `hire_temporary` `sign_outsourcing` `deliver_work` `abort_work` `create_custom_offer` `adopt_proposal` `reject_proposal` `buy_tv_service` `request_extension` | ❌ 全部无入口 | — | — | — | `待实现`（12 条） |
| 17 | `advance_week()` | ✅ `:18` | `state` | `INVALID_PHASE`（含"存在 N 条未查看事件"）/ `INSUFFICIENT_FUNDS`（带 `gap`）/ `INTERNAL_ERROR`（结算后校验失败） | `{state, report}` | `实现`（八阶段为单循环实现，非阶段 1–8 分离，见 §7） |
| 18 | `resolve_event(work_id, event_id, option_id)` | ✅ `:19` | 三者全必填 | `NOT_FOUND` / `INVALID_INPUT` / `INSUFFICIENT_FUNDS` | `{state, message}` | `实现` |
| 19–21 | `end_company` `finalize_delivery` `finalize_company` | ❌ | — | — | — | `待实现` |
| 22 | `view_event(work_id, event_id)` | ✅ `:20` | `state, work_id, event_id` | `INVALID_INPUT` / `NOT_FOUND` / `COMPANY_ENDED` | `{state, viewed, already_viewed}` | `实现` |
| — | `hash_state(state)` | ✅ `:21` | `state` | `INVALID_INPUT` | `{hash}` | 非 §5 命令（工具命令，§4.4） |
| — | `validate_event_catalog` / `event_catalog_info` | ✅ `:23/:24` | 目录 JSON | — | — | 非 §5 命令（内容工具） |
| — | `initialize` / `instantiate_work` / `set_plan` | ✅ `:10-12` | `initialize` 的 `seed` **可缺失**（默认 0，`runtime.cpp:487`） | — | 同对应正式命令 | **别名**，不在 M0 §5 → §8 D-11 |

### 4.1 未实现命令的回执是否现在冻结

M0 §6 已备 `NOT_IMPLEMENTED` 码，但 v4 代码**从未产生**它（12 个入口之外无占位）。§8 D-12 提请裁决：是先冻结 12 条命令的入参/回执键名并挂 `NOT_IMPLEMENTED` 占位入口，还是随实现批次冻结。本文按"载荷未定的不冻结"处理（§1.2 判据），只登记语义前提。

### 4.2 通用信封

```text
成功: { ...命令专属键, "state": GameState }        // 命令 1 无 state 输入但返回 state
失败: { "error": { "code": "<§6 码>", "message": "<中文诊断>" } }
```

- 实测 `advance_week` 的 `INSUFFICIENT_FUNDS` 额外带 `gap` 键（`runtime.cpp:751`）→ 现冻结为契约字段（§4.3），前端缺口显示依赖它。
- 解码失败消息被统一吞掉：`decode_state` 抛的精确消息（"缺少必填字段 state.company"）在 `catch (const Json::exception&)` 处替换为固定文案"JSON 或字段类型无效"（`runtime.cpp`）→ 定位能力损失，登记 A 级修复（§7 F-13）。
- **`SAVE_CORRUPT` / `SAVE_VERSION_UNSUPPORTED` 不由 v4 核心产生**：M0 §8.2 把它们放进版本矩阵，但核心侧一律回 `INVALID_STATE`/`INVALID_INPUT`。裁决：这两个码属**存储层**（`apps/web` 存档模块，M2 存档任务），字典按此登记，避免实现者在核心里找它们。

### 4.3 `INSUFFICIENT_FUNDS.gap`

| 键 | 类型 | 语义 |
| --- | --- | --- |
| `error.code` | string | `INSUFFICIENT_FUNDS` |
| `error.message` | string | 中文诊断 |
| `error.gap` | int ≥0 | 本次刚性支出预检的现金缺口（仅 `advance_week` 预检路径产出） |

### 4.4 `hash_state`

`{hash: string}`——对 canonicalize 后的状态做确定性哈希（数组顺序无关，见 §3.4）。用途：同 seed 同操作的回归比对与存档一致性检查；不参与规则。

---

## 5. 回执契约

### 5.1 `advance_week.report`（实测键树）

```text
report {
  week: int
  works[]: {
    work_id: string
    total_points: int
    items[]: { item_id: string, points: int, quality_gain: int }   // 仅本周有变化的项
    quality: { dims: {story, direction, drawing, animation, art, sound}, mean: int }
  }
  staff[]: { staff_id: string, produced: int, fatigue: int, morale: int }
  events: { drawn: bool, count: int, events[]: { event_id, work_id } }
  funds:  { delta: int, balance: int, costs: { salary, operations, production } }
}
```

- `funds.costs` 只有 3 个键，**与 §3.7 的 14 类 category 不对应**（缺 `events`、缺全部收入类）→ 回执成本分解不完整（§8 D-13）。
- 无 `finance` 键、无 `receipt` 键（实测确认）。
- `report` **不是** DA §9.4 的 `WeekReceipt`：后者含 `mode, cash{net_delta,balance}, highlights[], works[].{title,mode,progress_permille,progress_delta,delivery_range,deadline_slack,risk_level,bottleneck,committee_signal,active_items[],items_delivered[],gates_met,episodes_delivered,work_delta,quality_delta,handover[],causes[],warnings[],can_deliver}, staff_delta[], deliveries[], blocking_items[], actionable_clues[], neutral_updates[]`。
- 裁决建议（§8 D-14）：**保留 `report` 作为核心结算回执**（工程契约，字段与 §5.1 一致），把 `WeekReceipt` 明确为**前端读模型**（由 `report` + 状态派生，M0 §2 已把 `week_receipt` 列为派生值）。二者不得混名：`report` 不提供 `causes/handover/blocking_items` 等玩家解释性字段，缺的部分需要在 #8/M2 读模型层补齐或由核心扩展——这是当前"回执"确认出来的主要缺口，而不是命名问题。

### 5.2 其余命令回执

| 命令 | 键 | 备注 |
| --- | --- | --- |
| `view_event` | `state, viewed, already_viewed` | 无 `message`（与 `resolve_event` 不一致，登记 A 级） |
| `resolve_event` | `state, message` | **不回显已应用效果与实际扣款**；前端要展示"扣了多少钱/质量变化"须自行 diff 前后状态 → §8 D-15 |
| `initialize_game` / `set_work_plan` / `assign_staff` | `state` | 无附加回执 |
| `instantiate_work`（别名） | `state, work_id` | 命令 2 实现后需保持 `work_id` 可取 |
| `hash_state` | `hash` | §4.4 |

### 5.3 原子性与失败后状态

M0 §5 的"工作副本 + 一次提交"在已实现命令上成立：任一守卫失败 ⇒ 返回 `error`，不返回 `state`，状态逐字段不变（`v4.test.mjs` 的失败用例断言哈希不变）。`advance_week` 预检失败按 §14.2/§14.7 回滚并直接进入破产终局——**当前代码在预检不足时只返回 `INSUFFICIENT_FUNDS` 并回滚，不写终局**（`company.status` 仍为 `running`），因为 `end_company`/`finalize_company` 未实现 → 登记 `待实现`（不是文档缺陷）。

### 5.4 M0 §14.7 八阶段与 v4 实现对照

文档多处按"阶段 N"引用结算顺序（§14.7、§14.10、§14.11、DA §22），而 v4 代码此前沿用它**已废止的十三阶段编号**。本次把 `runtime.cpp` 的三处阶段注释改为 §14.7 编号（纯注释，无行为变化），并登记现状：

| §14.7 阶段 | 内容 | v4 实现 |
| --- | --- | --- |
| 1 | 计划冻结与快照 | 🔶 隐式（无独立快照点，靠工作副本） |
| 2 | 刚性支出预检 | `实现`（`runtime.cpp:727`；范围只含周薪 + 运营 + 制作费，缺设施维护/外包/到期承诺） |
| 3 | 刚性支出扣款 | `实现`（`:754`，唯一账本） |
| 4 | 项目生产推进 / 阶段切换 | `实现`（`kernel::apply_production`，`:814`） |
| 5 | 人员经验 / 疲劳 / 红灯判定 | `实现`（经验、疲劳、士气；**红灯 `forced_rest` 未实现**，INV-28 因此无断言） |
| 6 | 商业窗口与交付收入 | `待实现`（交付命令 10/20 未实现，本周无收入类流水） |
| 7 | 延迟状态倒计时 / 到期 | `待实现`（事件期限、休养期、定金有效期均无倒计时；§14.11 边界） |
| 8 | 随机事件与周数递增 | `实现`（`:870` 抽取 + `:874` `week+1`） |

预检不足时按 §14.2/§14.7 应"整周回滚 + 直接破产终局"：代码做到回滚与 `gap`，**未实现破产终局**（依赖 `end_company`/`finalize_company`，见 §5.3）。

---


## 6. 不变式实现对照

M0 §4 共 **29 条**。代码 `validate()`（`runtime.cpp:259-437`）实际断言 **13 条**：`INV-01 02 03 04 06 07 09 11 12 16 21 23 25`。

| INV | 断言 | 位置/缺口 |
| --- | --- | --- |
| 01 根字段/版本/取值 | ✅ | `:274` 及分散校验 |
| 02 id 全局唯一 | ✅ | `claim_id`（含账本 id） |
| 03 work_done/deliver_at 边界 | ✅ | |
| 04 deps 无环/不跨项目 | ✅ | |
| 05 无 `status` 派生字段 | ❌ | 无断言（靠 `from_json` 不读） |
| 06 六阶段固定 | ✅ | `kStages` + 数量校验 |
| 07 每集 ≥1 `is_gate` 且在 `sound_delivery` | ✅ | |
| 08 可交付 ⇔ 门槛项全交付 | ❌ | 派生函数存在（`Project::deliverable()`），无断言 |
| 09 `assignment_work_id` 合法 | ✅ | |
| 10 同周单归属 / 临时=合同项目 | ❌ | 依赖命令 8 实现 |
| 11 `last_participation.week` | ✅ | |
| 12 `contributors` 只增不重 | ✅ | |
| 13 委员会成员/渠道唯一 | ❌ | §3.10 无数据 |
| 14 contract/committee 投资与 `committee_id` 一致 | ❌ | **`Project.committee_id` 字段不存在**（§3.3） |
| 15 `allowed_modes` | ❌ | 无 `Offer` 数据 |
| 16 `balance = opening + Σamount` | ✅ | `:433` |
| 17 单笔单 category / 收入只由交付结算写 | ❌ | 交付命令未实现 |
| 18 无 Loan/Solvency | ❌ | **代码仍产出这两个字段**（§3.6）→ 断言必然红，先裁决 D-01 |
| 19 供应商周承诺 ≤ 容量 | ❌ | 命令 9 未实现 |
| 20 合同项归属/累计交付 | ❌ | 同上 |
| 21 `week` 只由 `advance_week` 改 | ✅ | |
| 22 Archive 只追加 | ❌ | §3.9 无实现 |
| 23 事件仲裁（多项目/viewed/限流/不覆盖） | ✅ | `:404-421` |
| 24 `market.slots ≤ 4` 与槽互斥 | ❌ | §3.10 `market={}` |
| 25 `balance ≥ 0` + 预检失败回滚破产 | 🔶 部分 | `:435` 被 `solvency.state=="crisis"` 开后门；破产终局未实现 |
| 26 存档无派生值 | ❌ | 无字段黑名单检查 |
| 27 每 producing 项目恰一名合格监督 | ❌ | 监督=职业判定（§3.2） |
| 28 `forced_rest` 占位与回归 | ❌ | 无字段 |
| 29 限时事件倒计时/默认分支/升级 | ❌ | 首版 `expires_week` 恒 null，按设计边界登记（M0 §14.11/§14.12） |

**口径统一**：M0 §1.1 写"INV-01 – INV-29"（29 条）正确；§12 写"27 条"错误 → §7 C-01 修正。

---

## 7. 分歧登记（文档侧待修，A/B 级）

已在本次一并修正（纯口径/引用，不改玩法）：

| # | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| C-01 | M0:347 | "状态契约与不变式（27 条）" | 改 29 |
| C-02 | M0:349 | "错误码（16 个，1 个废弃）" | 改 2 个废弃（`CRISIS_COMMITMENT_BLOCKED`、`STAGE_LOCKED`） |
| C-03 | M0:19 | §1.1 "21 个现行命令" | 改 22 |
| C-04 | M0:134 | "（其中两行各含多个命令）" | §5 表 22 行每行一条命令 → 删括注 |
| C-05 | M0:89 | §3 `EventState` 行缺 `viewed` | 补入必填 |
| C-06 | M0:197 | §7 历史表把 `arrange_financing` 列为"✅ 允许" | 加"旧版命令，已不属于当前命令面（§14.6）"限定，不改结论 |
| C-07 | M0:406/415 | 两个 `## 14` | 前者改为不带编号的附记（全文无"§14 与 v3"引用） |
| C-08 | M0:337 | §11 与 §12 之间的孤立危机横幅 | 删除（语义已在 §7:193 与 §14.6:473 保留） |
| C-09 | M0:168 起 | §6 未说明 `SAVE_*` 的产生层 | 补一句"存储层产生，核心回 `INVALID_STATE`" |
| C-10 | M0:3 §3 | `stages`"键固定有序"易误读为 object 键 | 补"实现为 6 元素数组，元素带 `key`" |
| F-11 | DA:69 | "29 条不变式、21 个现行命令" | 命令数改 22 |
| F-12 | M1:162 | 断言回执键 `report` 无 M0 依据 | 改引本文 §5.1 |
| F-13 | `runtime.cpp` | 解码精确消息被吞 | A 级代码修复（待后续 PR，不夹带在本次） |
| F-14 | 前端 V3/V4 | `apps/web` 全量仍走 V3（`services/gameCore.ts:20`），`saveGame.ts:29` 写 `version:3` 无 `rules_version` | M2 存档/接入任务，非文档缺陷 |
| F-15 | `runtime.cpp:727/754/870` | 结算阶段注释沿用它**已废止的十三阶段编号**（阶段 5/6/11），与 M0 §14.7 的八阶段冲突 | 本次改为 §14.7 编号（纯注释，A 级）；阶段覆盖现状见 §5.4 |

## 8. 待负责人裁决项（C/D 级，未擅自动）

| # | 项 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| D-01 | 是否立即从 v4 移除 `finance.loans` / `finance.solvency` | **C** | §3.6；`model.cpp:301-331`、`runtime.cpp:435`；零 v4 消费者 | **建议移除**：INV-18/INV-25 才能成立；在 UI 接入 v4 之前成本最低。同时给出存档策略（v4 存档本无兼容需求，M0 §8.3 不做迁移） |
| D-02 | `Staff.project_fee` → `signing_fee` 的改名时点 | **C** | §3.2；M0 §3/§14.6 | 建议随命令 5/8（招聘）实现批次一次性改名并补断言；本次只登记 |
| D-03 | 监督岗位的数据形状（`Project.supervisor_staff_id`?） | **C** | §3.2；DEC-STAFF-008 | 需新增字段 + 资格校验，属玩法落地必需；请确认字段名后再实现 |
| D-04 | 主责/协力档位是否进回执/状态 | B/C | §3.5；DEC-STAFF-008 要求 UI 展示 | 建议作为读模型输出，不入存档 |
| D-05 | 根 `version` / `seed` 是否解析必填 | **C** | §2；`runtime.cpp:460-461` | 建议 `seed` 必填（与 `initialize_game:900` 对齐），否则旧档缺 seed 会以 0 静默改变随机序列 |
| D-06 | `Project.offer` 缺失/`{}`/`null` 规范化 | **C** | §3.3（实测哈希不等价） | 建议 `from_json` 保留 `null`（缺失→null），并把 `offer` 加进 `decode_state` 必填；影响哈希，需与 D-05 同批裁决 |
| D-07 | `temporary_contract` / `investment` / `extension` / `delivery` 载荷是否现在冻结 | B | §3.11 | 建议随对应命令冻结，避免猜字段 |
| D-08 | 账本 `event` 段与 `events` 类目单复数统一 | B | §3.7 | 建议统一为 `events`；破坏面 1 处测试断言 |
| D-09 | pending 是否引入 `episode_id/stage/item_id/escalation` | **C** | §3.8 | DA 已写、M0 未写、代码无。**建议先从 DA §7.6 撤下未冻结字段名**或标注"历史草案"，避免内容作者误用；升级载荷随 §14.11 内容字段一起冻结 |
| D-10 | 未实现命令/聚合的形状冻结节奏 | B | §3.10/§3.11/§4.1 | 建议"随实现批次冻结"，本字典只登记语义前提与缺口 |
| D-11 | 别名 `initialize`/`instantiate_work`/`set_plan` 是否保留导出 | B | §4；`v4.test.mjs` 约 38 处调用 | 建议保留到命令 2/3 实现后再移除（移除属 C 级 API 变更） |
| D-12 | 是否为 12 条未实现命令挂 `NOT_IMPLEMENTED` 占位 | B | §4.1 | 建议挂占位入口，使前端与测试可依赖稳定码 |
| D-13 | `report.funds.costs` 是否覆盖全部支出类目 | B | §5.1 | 建议扩展为按 category 汇总（兼容新增键，B 级） |
| D-14 | `report` 与 `WeekReceipt` 的边界 | B/C | §5.1 | 建议：核心 `report` 冻结为结算回执；`WeekReceipt` 定位为前端派生；DA §9.4 加一句来源说明 |
| D-15 | `resolve_event` 是否回执已应用效果 | B | §5.2 | 建议增补 `{applied_effects[], cash_delta, removed_event_id}`（纯新增，B 级） |

---

## 9. 机器校验（"冻结"的可执行部分）

```bash
npm run build:v4 && npm run audit:v4      # 期望表：docs/v4-contract-shape.json
```

`scripts/audit-v4-contract.mjs` 加载真实 WASM（不是解析文档），跑一遍固定 seed 的闭环——`initialize_game → instantiate_work → assign_staff → 若干周 → view_event → resolve_event(付费选项)`，再与期望表双向比对：

1. **导出集合**：登记的 12 个入口必须存在；`documented_not_exported` 里 16 条 M0 命令一旦出现入口即红（强制同步 §4）。
2. **键树**：逐路径断言字段集合**完全相等**——新增未登记字段、字段消失、整条路径新增都会红；业务 id 作键的映射（`events.per_work`、`cooldowns`）归一化为 `*`；仅在特定运行出现的形状（`reputation_log[]`、`last_participation`）走 `optional_paths`（存在即校验键集）。
3. **解析必填**：按 `decode_state` 的 require 清单逐个删字段，必须得到 `INVALID_INPUT`（含 `state.events.pending[].viewed`）。
4. **命令回执键**：8 条已实现命令的返回键集合逐一相等。
5. **初始化空聚合**：`suppliers/contracts/partners/committees/market/finance.entries/works` 必须仍为 §3.10 记录的空形状——有人开始填这些聚合却没定字段契约，立刻红。
6. **契约缺口双向锁定**：`contract_required_missing` 列出的字段（`signing_fee`、`facilities`、`committee_id`…）必须**尚未出现**；`code_extra_fields`（`loans`、`solvency`、`project_fee`）必须**仍然存在**。任一方向变化都说明文档与代码分叉，必须同批更新。
7. **账本约定**：本次运行必须实际产出 `salary/operations/production/events` 四类；出现 §3.7 冻结 14 类之外的类目即红；id 前缀模式与 INV-02 唯一性检查。
8. **源码侧口径**：从 v4 源码提取 `INV-xx` 标签与错误码字面量，比对"已断言 13 条 / M0 §6 已登记 16 码"，防止文档宣称不存在的断言或产生未登记的码。
9. **预检失败信封**：用 `tv_standard` 昂贵蓝图把现金烧穿，断言 `INSUFFICIENT_FUNDS` 带非负整数 `gap`（§4.3）、失败响应不含 `state`、失败前后状态哈希一致。

**证据**：main `03e95f0` 上本机 emcc 7.0.1 构建，审计通过——35 条形状、8 条回执、13/29 条不变式有断言、8 个错误码在用、账本类目 `events/operations/production/salary`。
**反向验证**：把 `model.cpp` 的 `Staff.fatigue` 改名 `fatigue_v2` 重新构建后，审计同时报出"未登记字段 `fatigue_v2`"与"字段消失 `fatigue`"（随后已还原，工作区干净）——证明这道门是真检测，不是空跑。

期望表与本文档必须同一次提交更新；两者不一致时以 CI 红为信号，由 PR 作者同步修订并按 M0 §13 定级。


# 统一数据结构（v2 契约）

状态 schema 与存档记录版本均为 2，替代旧三字段工程夹具。本文与当前 C++ 六接口对应；循环结构见 [GAME_DESIGN.md](GAME_DESIGN.md)，调用、错误和同步流程见 [API.md](API.md)，暂定参数与精确公式见 [GAME_RULES.md](GAME_RULES.md)。结构已落入核心，数值平衡与经济口径仍待团队复核，不表示端到端验收已通过。

## 0. 概念纪律（本文档的核心）

**一个概念只有一个名字、一种类型、一个单位、一处存储。** 员工系统、制作系统、事件系统、结算系统、C++、TypeScript、存档，全部引用同一张概念表，禁止同义词。

- 新增字段前先查概念表；表里没有的概念先评审入表，再写代码。
- 禁止同义词：`stamina` / 体力 / 精力（统一为 `morale` 士气）、`cash` / `gold` / `money`（金额只用第 1 节的字段）、`完成度` / `品质`（统一为 `progress` / `quality`）。
- 游戏协议字段一律 snake_case，C++ JSON、TS 接口、请求响应和存档内的 GameState 同名，不做命名转换层。唯一独立例外是存档外层元数据 `savedAt`，保持既有名称。
- 业务枚举值使用小写英文字符串；评级沿用 `S` / `A` / `B` / `C` / `D`。UI 映射枚举中文名；员工、企划和事件的显示文案随核心目录下发，不参与数值计算。
- 单一事实源：GameState 只存业务状态，不再存一份总进度或利润。结算推导值由 C++ 计算并随 result 下发，前端不自行实现规则。当前响应没有独立的剩余天数或总进度字段，不应宣称核心已下发这些字段。

## 1. 基础概念表

### 标识与时间

| 概念 | 唯一名字 | 类型与单位 | 范围 | 规则 |
| --- | --- | --- | --- | --- |
| 实体 ID | `id` | string | 目录定义的 snake_case ID | `staff_01`、`proj_tv_01`、`evt_001`、`opt_a`；不用数字 ID |
| 当前日 | `day` | integer，游戏日 | 1–9007199254740991 | 公司时间全局连续，跨企划不重置 |
| 开工日 | `start_day` | integer，绝对日 | 1–day | 接手企划时记录 |
| 截止日 | `deadline_day` | integer，绝对日 | ≥ start_day，安全整数 | 截止日当天日结后仍未完成即强制交付；事件延期增加此值 |
| 工期 | `duration_days` | integer，天 | > 0 | 仅报价字段；开工时换算 `deadline_day = day + duration_days - 1` |

### 金额

金额单位统一为日元。`funds`、`budget`、`spent`、`revenue`、`cost` 为 0–9007199254740991 整数；`profit` 及资金增量可为负，仍需为安全整数。

| 概念 | 唯一名字 | 含义 |
| --- | --- | --- |
| 公司资金 | `funds` | 唯一可支配资金池 |
| 企划拨款 | `budget` | 开工时一次性并入 funds；不是公司剩余资金 |
| 累计支出 | `spent` | 本企划工资、固定成本、加班、外包及付费事件的累计支出 |
| 商业收入 | `revenue` | C++ 结算计算，入账至 funds |
| 结算成本 | `cost` | result 中的 spent 快照，不在 GameState 重复存储 |
| 利润 | `profit` | result 推导值：revenue - spent，不含开工拨款；草案口径待团队复核 |

### 刻度与枚举

| 概念 | 唯一名字 | 类型 / 范围 | 存储与说明 |
| --- | --- | --- | --- |
| 进度 | `progress` | 0–100 整数 | 每工序一份；下游不得超过上游 |
| 质量 | `quality` | 0–100 整数 | 每工序一份；成品 `quality_score` 只在 result 中 |
| 士气 | `morale` | 0–100 整数 | 每员工一份，全系统唯一的人状态数值 |
| 技能 | `skill` | 0–100 整数 | 每员工一份，当前必须匹配固定目录，无成长 |
| 声望 | `reputation` | 非负安全整数 | 公司一份，电影接取门槛为 20 |
| 工序 | `stage` | `pre` / `mid` / `post` | 前期·分镜演出 / 中期·原画动画 / 后期·摄影合成 |
| 排班 | `assignment` | 工序取值或 `rest` | rest 为休息 |
| 方针 | `policy` | `rush` / `normal` / `polish` | 赶工 / 正常 / 精修 |
| 经营阶段 | `phase` | `idle` / `producing` / `event_pending` / `ended` | 空闲 / 制作 / 待事件选择 / 待结算 |
| 终局原因 | `end_reason` | `completed` / `deadline` / `bankrupt` | 完成 / 截止强制交付（违约） / 破产 |
| 随机种子 | `seed` | uint32，0–4294967295 | TS 持有，C++ 仅在实际完成日结时推进 |
| 规则系数 | — | integer 千分比（1000 = ×1） | 只存在于 C++ 参数头，不进状态，不与 0–100 刻度混用 |

## 2. 核心结构

以下 TS 用于说明协议形状，所有 number 字段实际受整数范围约束。C++ 当前使用 `nlohmann::json`（`Json`）状态模型和完整校验，并非已建立同名强类型状态 struct。

```ts
type Stage = 'pre' | 'mid' | 'post'
type EndReason = 'completed' | 'deadline' | 'bankrupt'

interface Staff {
  id: string
  name: string
  role: 'director' | 'key_animator' | 'animator' | 'photographer'
  skill: number
  morale: number
  assignment: Stage | 'rest'
  overtime: boolean          // 今天的计划；完成日结后清除
}

interface StageState {
  progress: number           // 0–100
  quality: number            // 0–100
  outsourced: boolean        // 今天的外包计划；完成日结后清除
}

interface Project {
  id: string
  name: string
  type: 'tv' | 'movie' | 'ova'
  budget: number
  spent: number
  start_day: number
  deadline_day: number
  target_quality: number
  policy: 'rush' | 'normal' | 'polish'
  stages: { pre: StageState; mid: StageState; post: StageState }
}

interface ProjectOffer {
  id: string
  name: string
  type: 'tv' | 'movie' | 'ova'
  budget: number
  duration_days: number
  target_quality: number
  min_reputation: number
}

interface EventEffect {
  funds?: number             // 有符号日元增量；支出须可支付并计入 spent
  deadline_days?: number     // 当前目录仅顺延截止日
  stage_quality?: { stage: Stage; delta: number }
  morale?: number            // 作用于全员；质量、士气应用后钳制到 0–100
}

interface GameEvent {
  id: string
  title: string
  description: string
  options: { id: string; label: string; effect: EventEffect }[]
}

interface DayReport {        // 只读反馈，不回流 GameState
  day: number               // 刚结算的日期，不是响应状态的下一日
  funds_delta: number
  stage_deltas: { stage: Stage; progress: number; quality: number }[]
  morale_delta: number      // 全员实际变化的平均值，整数除法向零截断
  rework: boolean
  message: string
}

interface ProjectResult {    // 只读反馈，不存入 GameState
  end_reason: EndReason
  quality_score: number
  revenue: number
  cost: number              // = project.spent
  profit: number            // = revenue - cost，可负，不含拨款
  reputation_delta: number  // 钳制声望后实际变化
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
}

interface GameState {
  version: 2
  seed: number
  day: number
  funds: number
  reputation: number
  phase: 'idle' | 'producing' | 'event_pending' | 'ended'
  staff: Staff[]            // 固定且唯一的 4 人目录
  offers: ProjectOffer[]    // idle 时为相同 3 报价，其他阶段为空
  project: Project | null
  pending_event: GameEvent | null
  end_reason: EndReason | null
}
```

### 关联约束

- 每个带 state 的动作先严格验证完整模型，再检查阶段和决策；缺少必需字段、错误类型、越界或状态关联不一致均拒绝。
- staff 必须是固定 4 人且 ID 唯一，姓名、role、skill 匹配目录；`rest` 员工不得 `overtime: true`。
- `idle` 的 project、pending_event、end_reason 均为 null，offers 必须完整匹配固定 3 报价目录。锁定电影仍在列表内。
- 非 idle 必须有合法 project 且 offers 为空；企划 ID、名称、type、budget、target_quality 匹配报价目录；`post.progress ≤ mid.progress ≤ pre.progress`。
- `producing` / `event_pending` 必须未完成且 `day ≤ deadline_day`、end_reason 为 null。只有 event_pending 可携带事件，且其完整内容必须匹配固定 3 事件目录中的一项；不存在可自定义 effect 的接口。
- `ended` 的 pending_event 为 null，end_reason 非 null；completed 要求全部进度 100，deadline 要求未完成且已越过截止日。bankrupt 是费用不足的终局，不等于资金必须为 0。
- 当前事件模型不支持旧草案的进度效果字段。扩展目录或效果须先同步核心、类型、测试与协议。

## 3. 六接口契约

统一信封：除初始化外请求 `{ state, ...动作字段 }`，响应 `{ state, ...结果字段 }`。C++ 无全局会话，状态整体往返。错误格式为 `{ error: { code, message } }`，无可采用的新状态；完整错误分类见 API。

| 接口 | 请求 | 成功响应 | 要点 |
| --- | --- | --- | --- |
| `initialize_game` | `{ seed }` | `{ state }` | 唯一不带 state 的请求；公司、4 人、3 报价，idle / day 1 |
| `start_project` | `{ state, project_id }` | `{ state, message }` | 仅 idle；校验声望，拨款入账、清空 offers，转 producing |
| `apply_decision` | `{ state, decision }` | `{ state, message }` | 仅 producing；当天可多次调整，不扣款、不推进日期/seed |
| `advance_day` | `{ state }` | `{ state, report }` | 仅 producing；完整日结，可能转 event_pending 或 ended |
| `resolve_event` | `{ state, option_id }` | `{ state, message }` | 仅 event_pending；应用目录选项并清空事件，检查终局 |
| `calculate_result` | `{ state }` | `{ state, result }` | 仅 ended；收入/声望结算，清空企划，重供相同 3 报价，回 idle |

```ts
type Decision =
  | { type: 'assign'; staff_id: string; assignment: Stage | 'rest' }
  | { type: 'policy'; policy: 'rush' | 'normal' | 'polish' }
  | { type: 'outsource'; stage: Stage; enabled: boolean }
  | { type: 'overtime'; staff_id: string; enabled: boolean }
```

外包和加班都是可撤销的当天标记，不是立即扣款的操作。启用时若当日总费用不可承担则返回 `INSUFFICIENT_BUDGET`；日结才扣款、计入 spent、生效并清除标记。排班到 rest 会取消加班。`INVALID_PHASE` 已实现；六接口不是未实现占位。

## 4. 每日结算顺序与随机协议

精确公式与参数以 GAME_RULES 和源码为准，固定顺序为：

1. 计算固定成本、全员工资、加班与外包总费用；不足则直接返回 ended / bankrupt，不扣款、不推进日/seed、不执行后续步骤。
2. 扣款并增加 spent；按 pre → mid → post 计算工作量、流水线钳制后的进度和质量。
3. 新增进度且低质量的工序返工，再次钳制流水线并清除 outsourced。
4. 结算士气并清除 overtime；day 加 1。
5. 只推进一次 uint32 LCG：`s' = (s × 1664525 + 1013904223) mod 2^32`。
6. 若 `s' % 1000 < 150 + 50 × 当日加班人数`，事件候选取 `floor(s' / 1000) % 3`；不额外抽样。
7. 终局优先：全工序 100 为 completed，否则 day > deadline_day 为 deadline；终局丢弃当日事件候选。截止日当天日结后未完成即强制交付/违约结算。

非推进接口不消耗 seed；已完成日结的终局日仍推进一次。正常报告含三工序净变化；破产短路报告的 stage_deltas 为空、数值变化为 0。所有系数分步整数截断，不允许用前端浮点估算代替。

## 5. 存档 v2 与会话反馈

```ts
interface SaveRecord {
  version: 2
  savedAt: string
  state: GameState
}
```

数据库 `anime-production-committee` 的 DB schema 仍为 1，仓库 `saves`、键 `current` 不变。只有一个手动本地槽；record version 与 state.version 均为 2，不要把升级记录格式写成升级数据库 schema。

迁移策略：v1 是工程夹具——明确拒绝并提示新开游戏，无迁移、无静默转换、读取失败不覆盖当前会话。没有存档时返回 null。

只保存 GameState，不保存 DayReport / ProjectResult。报告和结算面板是会话反馈，重载后不恢复历史结果；calculate_result 已清空企划，不能从结算后的 idle 存档还原上一部作品。可以保存待处理事件或未结算终局，恢复后继续对应动作。

GameStore 的 `game` 初始为 null，新开必须等待真实 WASM 的 initialize_game；前端不构造初始游戏数据。`?seed=12345` 用于固定初始化 seed；读取存档采用其保存的 seed。

## 6. 数值来源与未完项

唯一数值入口为 [game_rules.hpp](../packages/game-core/include/game_rules.hpp)，现有初值、4 人名册、方针、费用、外包、返工、3 事件、3 报价、结算权重和评级线均已提供暂定值；完整表与公式集中在 GAME_RULES，不再列为全部待定。

尚需完成最终平衡、实测策略与时长、拨款/利润口径复核；招聘解雇、成长、复杂事件、市场和多企划并行不做。单槽本地存档没有旧版迁移，也没有历史结果持久化。

## 7. 跨层同步纪律

- C++：Json 解析与完整状态校验、纯规则和数值参数保持单一事实源；无需为了文档宣称而另造强类型状态结构体。
- TypeScript：同名字段与 v2 边界校验；store 整体采用 state，report/result 单独展示，不重算经营规则。
- 测试：C++ 覆盖钳制、整数与阶段边界；真实 WASM 覆盖六接口和同种子重放；前端覆盖空初态、错误保留、互斥和存档版本。原生测试、模拟服务测试与浏览器验证不能互相冒充。
- 协议变更按 CONTRIBUTING 流程同步 API、本文、实现、调用方与测试，明确旧存档策略；未运行验收不填写通过数量。

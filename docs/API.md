# 前端与 C++ 接口协议

本文记录最小纵向切片的 v2 实际核心契约，是前后端语言边界的联调依据。完整状态与响应类型见 [DATA_MODEL.md](DATA_MODEL.md)，暂定规则与公式见 [GAME_RULES.md](GAME_RULES.md)。模块职责见 [ARCHITECTURE.md](ARCHITECTURE.md)，产品范围见 [PRODUCT.md](PRODUCT.md)，协议变更流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。v2 指状态 schema，不代表最终平衡版本或端到端验收已通过。

## 传输方式

Emscripten Embind 导出 ES Module 默认工厂 `createGameCore`。工厂异步加载独立 WASM 文件，返回接口对象；加载完成后，六个导出函数本身都是同步调用。TypeScript 服务使用 Promise 封装加载与错误处理；规则调用在浏览器本地执行，不是 HTTP API，不涉及指针生命周期操作或 JavaScript 规则兜底。浏览器仍通过 HTTP(S) 加载模块与 WASM 资源。

C++ 声明位于 [game_core.hpp](../packages/game-core/include/game_core.hpp)，导出映射位于 [embind.cpp](../packages/game-core/bindings/embind.cpp)：

```cpp
namespace apc {
std::string initialize_game(std::string input);
std::string start_project(std::string input);
std::string apply_decision(std::string input);
std::string advance_day(std::string input);
std::string resolve_event(std::string input);
std::string calculate_result(std::string input);
}
```

所有输入与输出均为 JSON 字符串；调用方必须解析结果，不依赖字段输出顺序。核心不持有全局游戏会话，调用者持有状态并显式传入。

## 六接口与状态转换

除初始化外，所有动作都传入完整 `state`，成功后整体采用响应的 `state`（包括 `seed`），不能把局部字段拼回旧状态。协议字段统一 snake_case。

| 接口 | 请求 | 成功响应 | 允许阶段与行为 |
| --- | --- | --- | --- |
| `initialize_game` | `{ seed }` | `{ state }` | 不带旧状态；生成 `version: 2`、`day: 1`、`phase: 'idle'` 的公司、固定 4 人与 3 个报价 |
| `start_project` | `{ state, project_id }` | `{ state, message }` | 仅 `idle`；校验报价和声望，`funds += budget`，新建企划、清空报价，转 `producing` |
| `apply_decision` | `{ state, decision }` | `{ state, message }` | 仅 `producing`；更新可撤销的当日安排，不扣款、不推进日期或种子 |
| `advance_day` | `{ state }` | `{ state, report }` | 仅 `producing`；结算一天，保持制作、转 `event_pending` 或转 `ended` |
| `resolve_event` | `{ state, option_id }` | `{ state, message }` | 仅 `event_pending`；应用当前事件选项、清空事件并检查终局，通常回到 `producing` |
| `calculate_result` | `{ state }` | `{ state, result }` | 仅 `ended`；收入入账、声望结算，清空企划和终局原因，重新提供相同 3 个报价，回到 `idle` |

上述六接口均有 C++ 规则实现，不再是预留夹具。`movie` 报价始终在目录中，但声望达到 20 才能接取；未知报价或未达门槛返回 `INVALID_INPUT`。企划开工日为当前 `day`，`deadline_day = day + duration_days - 1`；初始三工序进度/质量均为 0，方针为 `normal`。

### 决策

以下类型是协议说明，完整模型见 DATA_MODEL；前端实现以 [types/game.ts](../apps/web/src/types/game.ts) 为边界，不在 TypeScript 中重写规则。

```ts
type Decision =
  | { type: 'assign'; staff_id: string; assignment: 'pre' | 'mid' | 'post' | 'rest' }
  | { type: 'policy'; policy: 'rush' | 'normal' | 'polish' }
  | { type: 'outsource'; stage: 'pre' | 'mid' | 'post'; enabled: boolean }
  | { type: 'overtime'; staff_id: string; enabled: boolean }
```

- 排班和方针持续保留，直到再次修改；外包写入 `StageState.outsourced`，加班写入员工 `overtime`，仅安排今天。决策成功消息包含 C++ 计算的预计当日总支出，前端直接展示而不重算费用。
- `enabled: false` 可撤销；启用时检查安排后的全部当日费用是否可承担，但此时不扣款、不增加 `spent`、不增加进度。
- 员工改为 `rest` 会取消其加班；不能给休息中的员工启用加班。
- 正常完成一天结算后清除所有外包与加班标记；未付款即破产的短路分支不执行这些日结步骤。

### 推进、事件与结算边界

`report` 为 `DayReport`，包含结算日 `day`、`funds_delta`、三工序净变化 `stage_deltas`、全员平均 `morale_delta`、`rework` 和 `message`。报告不回流为下一次请求。费用不足时仍成功返回 `{ state, report }`，其中 `phase: 'ended'`、`end_reason: 'bankrupt'`；不扣款、不改变 `spent`、日期、种子或制作数值，报告变化为 0，`stage_deltas` 为空。

只有实际付费并完成日结的 `advance_day` 推进一次种子；其他接口不推进。已付款的终局日也推进一次种子。三工序均达到 100 优先判为 `completed`；否则截止日当天日结后（`day > deadline_day`）判为 `deadline`，强制按现有进度交付/违约结算，不允许无限延期制作。同日若产生事件候选，终局优先并丢弃事件。具体顺序和 LCG 见 GAME_RULES。

事件只能提交当前 `pending_event` 中的 `option_id`。负资金效果立即扣款并计入本企划 `spent`，不足则报错且事件仍待处理；质量和士气钳制到 0–100。事件不推进日期或种子。

`result` 为 `ProjectResult`，包含 `end_reason`、`quality_score`、`revenue`、`cost`、`profit`、`reputation_delta`、`grade`。当前草案定义 `profit = revenue - spent`，不含开工拨款，需团队复核。结算后公司日历、种子、员工士气和排班保留，资金与声望采用结算值；不能用返回的 `idle` 状态再次结算。核心无会话去重，调用方不得重复提交旧的 `ended` 快照来重复消费回执。

## 输入验证

每个带状态的动作先严格验证完整 `GameState`，再检查允许阶段与动作参数，而不只验证本动作读取的字段：

- 顶层请求和 `state` 必须是对象；状态 `version` 必须是整数 2，`seed` 为 uint32（0–4294967295）。
- 金额、日期等为安全整数（最大 9007199254740991）；日期至少 1，进度、质量、士气为 0–100，布尔标记不可用数字代替。
- 原始 JSON 的 `5000.0`、`5e3` 会作为浮点数被拒绝；也拒绝缺失字段、字符串数字和错误的 null。正常调用用 `JSON.stringify` 序列化范围内的整数。
- 固定 4 名员工的 ID 必须唯一，姓名、角色、技能匹配目录；休息员工不能处于加班状态。
- `idle` 必须没有企划、事件和终局原因，且报价数组与固定目录一致；非 `idle` 必须有合法企划、空报价数组，满足工序流水线和阶段关联约束。
- 企划 ID、名称、类型、拨款、目标质量匹配目录；下游进度不得超过上游。待处理事件必须完整匹配固定 3 事件目录中的一项，不能自造选项效果。
- `producing` / `event_pending` 不能已经完成或越过截止日；`ended` 必须带合法终局原因，`completed` / `deadline` 还须满足对应进度和日期条件。

校验不是存档防篡改或服务器鉴权；额外字段也不构成受支持的扩展协议。错误响应不包含可采用的新状态。

## 错误处理

C++ 错误格式：

```json
{ "error": { "code": "INVALID_INPUT", "message": "输入错误的具体说明" } }
```

| code | 来源与含义 |
| --- | --- |
| INVALID_INPUT | C++：JSON、完整状态、目录数据、动作字段、范围或声望门槛不合法 |
| INVALID_PHASE | C++：合法状态的当前阶段不允许此动作，包括未处理事件或未结算企划 |
| INSUFFICIENT_BUDGET | C++：启用加班/外包后的当日总费用不可承担，或事件选项支付不足；推进费用不足是破产成功响应 |
| INTERNAL_ERROR | C++：非输入解析导致的内部异常 |
| LOAD_FAILED | TypeScript：ES Module/WASM 资源加载或实例化失败 |
| CALL_FAILED | TypeScript：请求序列化或导出函数调用抛出异常 |
| INVALID_RESPONSE | TypeScript：无效返回 JSON、错误结构或计算结果 |

TypeScript 服务将这些错误转换为 GameCoreError（code、message 和可选 cause）。Zustand 捕获错误并保留旧游戏状态，界面显示错误。模块加载失败会清除 Promise 缓存；下一次尝试给模块 URL 增加重试编号，绕过浏览器对失败模块导入的缓存。修复资源后可点击重试，不必刷新整个会话。

## 前端调用

[gameCore.ts](../apps/web/src/services/gameCore.ts) 分三层负责：共享模块加载、JSON 传输与通用错误转换、各动作的业务响应校验。React 组件通过 [gameStore.ts](../apps/web/src/stores/gameStore.ts) 操作，不直接调用导出函数或修改规则数据。

前端状态同步流程：

1. `game` 初始为 `null`，没有前端构造的初始 `GameState`。新开游戏等待真实 WASM，再以 `{ seed }` 调用 `initialize_game`；`?seed=12345` 可固定新局种子用于复现。
2. store 检查 `busy` 并捕获当前完整状态，服务发送 `{ state, ...动作字段 }`。种子来源是该状态，不在点击时另取随机数。
3. 服务解析并校验成功响应的完整状态及 `message` / `report` / `result`；store 整体替换 `game`，包括 C++ 返回的种子和阶段。
4. `report`、`result` 只更新会话内展示；失败保留旧业务状态、解除 `busy` 并显示错误。模块加载重试不伪造初始化或规则回执。
5. 存档恢复采用完整状态而不是重新初始化；新开游戏与返回首页不是同一操作。未处理事件必须先选择选项，终局必须先结算。

底层调试示例（浏览器控制台，同源静态服务器已启动；直接调用真实核心，不复制规则）：

```js
const { default: createGameCore } = await import('/wasm/game-core.mjs')
const core = await createGameCore({ locateFile: (file) => `/wasm/${file}` })
function invoke(method, input) {
  const output = JSON.parse(core[method](JSON.stringify(input)))
  if (output.error) throw new Error(`${output.error.code}: ${output.error.message}`)
  return output
}
let { state } = invoke('initialize_game', { seed: 12345 })
;({ state } = invoke('start_project', { state, project_id: 'proj_ova_01' }))
;({ state } = invoke('apply_decision', {
  state, decision: { type: 'outsource', stage: 'pre', enabled: true }
}))
const output = invoke('advance_day', { state })
state = output.state
console.log(state, output.report)
// 后续按 state.phase 选择 resolve_event / advance_day / calculate_result。
```

不要使用 file:// 打开页面；浏览器需要通过 HTTP(S) 获取模块与 WASM。加载器无 JavaScript 规则兜底，不可在构建失败时伪造成功结果。

## IndexedDB 存档

不是跨语言协议；由 TypeScript 服务独立负责：

```ts
interface SaveRecord {
  version: 2
  savedAt: string
  state: GameState // state.version 同样为 2
}
```

数据库 anime-production-committee / DB schema 版本仍为 1 / 仓库 saves / 键 current。记录 `version: 2` 与数据库版本不是一回事。外层 `savedAt` 保留 camelCase 元数据名称，不进入 C++ 协议或随机规则。

只有一个手动存档槽，不自动保存或自动继续。只保存 `GameState`，不保存 `report` / `result`；结算结果仅会话内展示，重载后不恢复历史结算面板。已结算状态的企划已被清空，不能从该存档重建上一部作品的结果。

[saveGame.ts](../apps/web/src/services/saveGame.ts) 的 `saveGame(state): Promise<void>` 在事务完成后才成功，`loadGame(): Promise<GameState | null>` 返回校验后的业务状态而非整个存档记录。没有存档时返回 null；损坏数据或不受支持的版本报错，不覆盖当前会话。v1 明确拒绝并提示新开游戏，无旧版迁移或静默转换。存档错误是 TypeScript `Error`，不属于 C++ 错误码。

## 版本与变更约束

当前为工程原型，不承诺长期协议兼容。未来增加字段或改变规则应同步更新 C++、TypeScript、测试与文档；涉及存档结构时需明确迁移策略，而不是默默读取为其他含义。

v2 替代三字段工程夹具，不兼容 v1。固定目录、公式和 LCG 以 [game_core.cpp](../packages/game-core/src/game_core.cpp) 与 [game_rules.hpp](../packages/game-core/include/game_rules.hpp) 为准。当前参数不是最终平衡方案；扩充目录、改变结算经济口径或增加结果持久化时，需要团队评审并同步契约，不能只在前端补规则。

协议变更按以下顺序完成：

1. 在 Issue 中确认输入输出、字段单位与范围、允许的状态转换、错误码和种子行为。
2. 同步修改当前协议文档、TypeScript 类型与边界校验、C++ 声明/实现/导出及调用方。
3. 增加原生规则、真实 WASM 契约与前端状态测试；涉及用户流程时补充浏览器验证。
4. 明确旧存档迁移或拒绝读取策略；核对通过后才将目标契约标为已实现。

验证入口为 `npm run test:native`、`npm run test:wasm`、`npm run typecheck` 与 `npm run test:unit`；浏览器流程使用 `npm run test:browser`。源码、文档示例与真实 WASM 返回结果必须一致。

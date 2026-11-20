# TypeScript / C++ 接口约定

## 传输方式

Emscripten Embind 导出 ES Module 默认工厂 createGameCore。工厂异步加载独立 WASM 文件，返回接口对象。各接口接受一个 JSON 字符串，返回一个 JSON 字符串；没有指针生命周期操作，没有网络 API。

| 名称 | 当前行为 |
| --- | --- |
| initialize_game(inputJson) | 返回 NOT_IMPLEMENTED |
| start_project(inputJson) | 返回 NOT_IMPLEMENTED |
| apply_decision(inputJson) | 返回 NOT_IMPLEMENTED |
| advance_day(inputJson) | 执行确定性示例计算 |
| resolve_event(inputJson) | 返回 NOT_IMPLEMENTED |
| calculate_result(inputJson) | 返回 NOT_IMPLEMENTED |

预留接口统一接收字符串，尚无业务输入结构承诺。首页的「开始经营」只切换到验证页，不声称调用尚未实现的 initialize_game 或 start_project。

## advance_day

请求示例：

```json
{ "budget": 100000, "progress": 20, "seed": 12345 }
```

- budget：非负整数，上限 9007199254740991（JavaScript 最大安全整数）。
- progress：0–100 整数。
- seed：0–4294967295 整数，由 TypeScript 传入；当前不参与随机计算。
- 不能使用字符串数字、布尔值、null 或缺失字段替代以上值。

成功示例：

```json
{ "budget": 95000, "progress": 25, "message": "制作进度已更新" }
```

返回结果不带 seed；状态层保留原请求中的种子。进度到达上限后再次调用不扣款。资金不足或参数不合法不会产生成功结果。额外输入字段目前不作为规则输入使用。

## 错误处理

C++ 错误格式：

```json
{ "error": { "code": "INVALID_INPUT", "message": "输入错误的具体说明" } }
```

| code | 来源与含义 |
| --- | --- |
| INVALID_INPUT | C++：JSON、字段类型或范围不合法 |
| INSUFFICIENT_BUDGET | C++：未完成时资金不足以推进 |
| NOT_IMPLEMENTED | C++：预留接口未实现 |
| INTERNAL_ERROR | C++：非输入解析导致的内部异常 |
| LOAD_FAILED | TypeScript：ES Module/WASM 资源加载或实例化失败 |
| CALL_FAILED | TypeScript：导出函数调用抛出异常 |
| INVALID_RESPONSE | TypeScript：无效返回 JSON、错误结构或计算结果 |

TypeScript 服务将这些错误转换为 GameCoreError（code、message 和可选 cause）。Zustand 捕获错误并保留旧游戏状态，界面显示错误。模块加载失败会清除 Promise 缓存；下一次尝试给模块 URL 增加重试编号，绕过浏览器对失败模块导入的缓存。修复资源后可点击重试，不必刷新整个会话。

## 前端调用

```ts
import { advanceDay } from './services/gameCore'

const input = { budget: 100000, progress: 20, seed: 12345 }
const result = await advanceDay(input)
console.log(result.budget, result.progress, result.message)
```

React 组件不直接调用上述接口或修改规则数据，应调用 store：

```ts
import { useGameStore } from './stores/gameStore'

await useGameStore.getState().advance()
```

底层调试示例（浏览器控制台，同源静态服务器已启动）：

```js
const { default: createGameCore } = await import('/wasm/game-core.mjs')
const core = await createGameCore({ locateFile: (file) => `/wasm/${file}` })
const output = JSON.parse(core.advance_day(JSON.stringify({
  budget: 100000, progress: 20, seed: 12345
})))
console.log(output)
```

不要使用 file:// 打开页面；浏览器需要通过 HTTP(S) 获取模块与 WASM。加载器无 JavaScript 规则兜底，不可在构建失败时伪造成功结果。

## IndexedDB 存档

不是跨语言协议；由 TypeScript 服务独立负责：

```ts
interface SaveRecord {
  version: 1
  savedAt: string
  state: { budget: number; progress: number; seed: number }
}
```

数据库 anime-production-committee / 版本 1 / 仓库 saves / 键 current。只有一个手动存档槽，不自动保存或自动继续。读取损坏或不受支持的版本时抛错，不覆盖当前会话；没有存档时返回 null。

## 版本约束

当前为工程原型，不承诺长期协议兼容。未来增加字段或改变规则应同步更新 C++、TypeScript、测试与文档；涉及存档结构时需明确迁移策略，而不是默默读取为其他含义。

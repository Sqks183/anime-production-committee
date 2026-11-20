# 动画制作委员会

ANIME PRODUCTION COMMITTEE · 浏览器经营模拟游戏工程基础 · v0.1.0

本仓库只建立可运行工程，不是完整游戏。React 通过 Emscripten 的真实 WebAssembly 调用 C++ 规则；没有用 TypeScript 伪造核心计算，也没有独立后端。

## 技术栈与版本

| 用途 | 依赖 / 版本 |
| --- | --- |
| UI | React / React DOM 19.2.0 |
| 类型 | TypeScript 5.9.3 |
| 构建 | Vite 7.3.8、@vitejs/plugin-react 5.1.0 |
| 状态 | Zustand 5.0.8 |
| 样式 | Tailwind CSS / @tailwindcss/vite 4.1.17 |
| 图标 | lucide-react 0.468.0 |
| 本地存档 | 浏览器原生 IndexedDB，无第三方运行时依赖 |
| 前端测试 | Vitest 4.1.12、Testing Library React 16.3.0、user-event 14.6.1、jest-dom 6.9.1 |
| 测试环境 | jsdom 27.2.0、fake-indexeddb 6.2.4 |
| 真实浏览器测试 | playwright-core 1.65.1，驱动本机 Edge，不下载浏览器 |
| C++ | C++17、CMake、Emscripten |
| JSON | nlohmann/json 3.12.0 |
| 原生测试 | GoogleTest 1.17.0 |

npm 精确版本由 package-lock.json 锁定。TypeScript 类型包版本见 apps/web/package.json。Node 要求 >=22.12，npm >=10；本机实际编译工具版本与验收结果见下文的验证记录。

## 目录

```text
apps/web/src/
  components/ pages/ stores/ services/ hooks/ types/ styles/ test/
apps/web/public/wasm/         # 生成的 game-core.mjs 与 game-core.wasm
packages/game-core/
  include/ src/ bindings/ tests/ CMakeLists.txt
scripts/                     # 原生/WASM 构建、集成测试、产物检查
docs/
  PRODUCT.md ARCHITECTURE.md GAME_RULES.md API.md
package.json                 # npm workspaces: apps/*、packages/*
```

build/、.tools/、node_modules/ 和 dist/ 都是本地产物，已忽略版本控制。

## 准备工具链

需要 Node/npm、Python 3、CMake、原生 C++17 编译器和 Emscripten。原生测试可用 Windows Visual Studio C++ 工作负载，或 Linux/macOS 的 GCC/Clang。

本项目将 Emscripten 安装于 `.tools/emsdk`，不修改全局 PATH。其他机器可以使用已安装的 SDK 并设置 `EMSDK`。SDK 不属于 npm 依赖，不会通过 npm install 自动安装。

从项目根目录安装固定 SDK 的示例（Git Bash / POSIX shell）：

```bash
git clone https://github.com/emscripten-core/emsdk.git .tools/emsdk
cd .tools/emsdk
./emsdk install 4.0.23
./emsdk activate --embedded 4.0.23
cd ../..
```

首次 CMake 配置需要网络下载固定版本的 nlohmann/json 和 GoogleTest；后续构建使用 CMake 缓存。不要混用原生和 WASM 构建目录。

## 开发

在项目根目录执行：

```bash
npm install
npm run build:wasm
npm run dev
```

Vite 绑定 127.0.0.1，默认端口 5173；如果被占用，以控制台输出为准。打开首页，待 C++ / WASM 就绪后，点击「开始经营」和「推进一次制作进度」。第一次应得到 95000 / 25，以及 C++ 返回的中文消息。

修改前端会热更新。修改 C++ 后重新运行 `npm run build:wasm` 并刷新浏览器，避免仍使用已经实例化的旧模块。未编译 WASM 时页面会明确提示加载失败，不会启用替代计算。

「保存进度」写入单一 IndexedDB 存档槽；「读取存档」恢复完整状态和 seed。存档只属于当前浏览器和源，不会在 localhost、不同端口或已部署域名之间自动共享。

## C++ / WASM 编译

```bash
npm run build:native
npm run build:wasm
```

统一入口为 scripts/build-core.mjs：原生使用 build/native，WASM 使用 build/wasm。输出独立 ES Module 与 WASM 二进制至 apps/web/public/wasm。根 npm scripts 及 @anime/game-core workspace 都提供核心构建入口。

## 测试

```bash
npm run test:unit       # Vitest：组件、状态、存档与数据校验
npm run test:native     # CMake 构建并运行 GoogleTest
npm run test:wasm       # 重新编译 WASM，再实际导入模块并执行 C++
npm test               # 顺序运行以上三类测试
npm run typecheck
npm run test:browser    # 完整构建后，用本机 Edge 进行实际点击与截图
```

浏览器测试默认使用已安装的 Microsoft Edge。也可设置 `BROWSER_CHANNEL=chrome`，或用 `BROWSER_EXECUTABLE` 指向兼容浏览器的绝对路径。截图输出至 build/browser-tests。测试自动启动仅监听回环地址的临时静态服务器，使用隔离的浏览器上下文，结束时自动关闭；不会修改用户的浏览器配置。它验证真实 WASM、模块与二进制加载失败后的重试、存档刷新恢复、资金不足、完成边界和 375/768/1440px 页面。

store 单元测试通过模拟服务隔离状态逻辑，不能作为 WASM 证据。scripts/wasm.test.mjs 会检查 WASM 魔数、WebAssembly.validate、真实模块加载、示例结果、确定性、错误和边界；不存在二进制时直接失败。

## 生产构建

```bash
npm run build          # 先编译 WASM，再 TypeScript 检查和 Vite 构建
npm run verify:dist    # 检查部署包中的独立 WASM 产物
npm run preview
```

部署目录为 apps/web/dist，绝不能上传整个仓库或只上传 index.html。浏览器需通过 HTTP(S) 访问，不能直接打开 file://。

## Qoder Sites 配置

- projectRoot：本仓库绝对路径。
- webDirectory：`apps/web/dist`。
- 构建命令：本地执行 `npm run build`；Sites 打包工具不代为运行 CMake。
- Vite base：`/`。首页和经营页采用内存状态切换，`spa: false` 即可，不需要路由回退。
- 必须完整上传 `wasm/game-core.mjs` 和 `wasm/game-core.wasm`。
- ES Module 需以 JavaScript 类型返回；WASM 推荐 `application/wasm`，不能误返回 SPA 的 HTML。
- 单线程构建，无 SharedArrayBuffer / pthreads，不需要 COOP / COEP 特殊头。
- 不配置 Functions、云数据库、Storage 或 Secrets。
- 设计工作台入口由 Sites 工具创建和维护，禁止手工修改发布身份。

Sites 官方插件本地打包约束：单文件不超过 50 MiB，整体发布 ZIP 不超过平台 50 MiB 限制。本项目使用小型独立 WASM，不改变架构来绕过限制。实际托管 MIME、访问策略与 WASM 加载必须在发布后验证，不能仅凭本地成功下结论。

当前会话根目录为 E:/，Sites 的 get_context 返回 `sites_document_scan_limit`。这阻止了本次云端上下文确认，不代表 WASM 文件不被支持。解决方式：以本仓库为工作区根目录重新打开会话，复用已有设计入口，执行正常 prepare / publish / status 验证；无需移动源文件或更换技术架构。

## 文档

- [产品定位](docs/PRODUCT.md)
- [技术架构](docs/ARCHITECTURE.md)
- [规则原则](docs/GAME_RULES.md)
- [接口协议](docs/API.md)

## 当前范围

只有 advance_day 实现验证用规则。initialize_game、start_project、apply_decision、resolve_event、calculate_result 是明确返回 NOT_IMPLEMENTED 的预留接口。资金 100000、进度 20、每次 5000 / 5 都是工程夹具，不是正式平衡数值。

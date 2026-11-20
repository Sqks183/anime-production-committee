# 技术架构

## 分层与调用方向

```text
React 页面 / 组件
  → Zustand 状态操作
    → gameCore.ts 服务 → Emscripten ES Module → WASM → C++ 纯规则
    → saveGame.ts 服务 → IndexedDB
```

加载状态由 useGameCore Hook 展示，模块加载 Promise 在服务层共享。状态更新只能通过明确的 store 操作触发，React 不计算核心结果。核心返回错误时保留旧状态；busy 状态阻止重复推进、存档竞争和操作中的页面切换。

## 目录

```text
anime-production-committee/
├── apps/web/
│   ├── src/
│   │   ├── components/       # 状态提示组件与测试
│   │   ├── pages/            # 首页、临时经营页
│   │   ├── stores/           # Zustand 状态与操作
│   │   ├── services/         # WASM 边界、IndexedDB
│   │   ├── hooks/            # 模块加载状态
│   │   ├── types/            # 协议类型与外部数据验证
│   │   ├── styles/           # Tailwind 与主题变量
│   │   ├── test/             # Vitest 测试环境
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/wasm/          # Emscripten 生成产物，忽略版本控制
│   └── dist/                 # Vite 静态部署输出
├── packages/game-core/
│   ├── include/             # 核心公开 C++ 接口
│   ├── src/                 # JSON 验证和规则计算
│   ├── bindings/            # Embind 导出
│   ├── tests/               # GoogleTest
│   └── CMakeLists.txt
├── docs/                    # 产品、架构、规则、API
├── scripts/                 # CMake 调用、真实 WASM 测试、部署产物验证
├── build/native/            # 原生 CMake 构建缓存
├── build/wasm/              # Emscripten CMake 构建缓存
├── .tools/                  # 可选的项目内工具链，忽略版本控制
├── package.json             # npm workspaces 和统一入口
├── package-lock.json        # npm 精确依赖锁定
└── README.md
```

## 模块职责

- **React + TypeScript**：语义化 UI、加载/错误/空态、输入与输出展示。
- **Zustand**：管理当前页面、budget/progress/seed、异步互斥、错误提示、最后一次回执。种子在 TypeScript 保存，目前固定且不推进。
- **WASM 服务**：同源加载 game-core.mjs，由其加载独立 game-core.wasm；序列化 JSON、转换核心错误并验证返回值。没有 TypeScript 规则后备实现。
- **IndexedDB 服务**：数据库 anime-production-committee、版本 1、对象仓库 saves、键 current。事务完成后才报告保存成功，关闭连接；读取校验存档版本和状态范围。
- **C++17**：处理纯规则和协议校验。nlohmann/json 解析与序列化；不读写 UI、文件、网络或时间，不内部持有随机种子。
- **Embind**：把六个明确命名的 JSON 字符串接口导出给 JavaScript。只有 advance_day 有示例业务逻辑。
- **CMake**：原生 GoogleTest 与 WASM 使用不同构建目录。GoogleTest 不进入浏览器产物。

## 依赖关系

前端运行时仅依赖 React、React DOM、Zustand、Lucide。Tailwind、Vite、TypeScript 是构建依赖；Vitest、Testing Library、jsdom、fake-indexeddb 是测试依赖；根目录的 playwright-core 仅用于驱动本机浏览器完成真实点击与截图，不打包进前端。fake-indexeddb 只用于单元测试，真实浏览器使用原生 IndexedDB。

C++ 使用固定版本 nlohmann/json 与 GoogleTest；具体版本、工具链和命令见 README。npm workspace @anime/game-core 提供构建入口，不把 C++ 当作可直接 import 的 npm 运行时包。前端只消费编译产物。

## 构建与部署

先编译 WASM 到 apps/web/public/wasm，再由 Vite 原样复制到 apps/web/dist/wasm。站点在域名根路径运行，base 为 /，两个页面采用内存状态切换，不引入路由库或独立 URL。

Qoder Sites 只部署 apps/web/dist 的静态文件，不在云端执行 CMake，也不提供 Node 服务器。本工程不使用 Functions、云数据库、Storage 或 Secrets。不启用 WASM 线程，不需要 SharedArrayBuffer、COOP 或 COEP。

项目根目录的 .动画制作委员会.qoder.site 由 Sites 工具维护，不能手写发布身份。CSS 消费 --site-* 主题、字号、间距、圆角和动画变量，供设计工作台使用。

## 验证边界

Vitest 中隔离服务的 store 测试只证明前端状态逻辑；fake-indexeddb 测试不代表浏览器验证。原生 GoogleTest 证明 C++ 规则；scripts/wasm.test.mjs 检查二进制魔数并实例化实际 Emscripten 模块，证明编译与跨语言契约。浏览器操作与发布结果必须另行验证，不能用前两类测试替代。

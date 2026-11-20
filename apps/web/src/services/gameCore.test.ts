import { beforeEach, expect, it, vi } from 'vitest'
import { dayReport, deferred, eventState, idleState, producingState, projectResult } from '../test/fixtures'
import type { CoreMethod, CoreModule } from '../types/game'

const moduleUrl = new URL('/wasm/game-core.mjs', window.location.href).href
const methods: CoreMethod[] = ['initialize_game', 'start_project', 'apply_decision', 'advance_day', 'resolve_event', 'calculate_result']
type Api = typeof import('./gameCore')

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock(moduleUrl)
  vi.doUnmock(`${moduleUrl}?retry=1`)
})

function moduleFixture(response = '{}'): CoreModule {
  return {
    initialize_game: vi.fn(() => response),
    start_project: vi.fn(() => response),
    apply_decision: vi.fn(() => response),
    advance_day: vi.fn(() => response),
    resolve_event: vi.fn(() => response),
    calculate_result: vi.fn(() => response),
  }
}

async function mockCore(module: Partial<CoreModule>) {
  vi.doMock(moduleUrl, () => ({ default: vi.fn().mockResolvedValue(module) }))
  return import('./gameCore')
}

const state = producingState()
const cases: { method: CoreMethod; input: unknown; response: unknown; invoke: (api: Api) => Promise<unknown> }[] = [
  { method: 'initialize_game', input: { seed: 12345 }, response: { state: idleState() }, invoke: (api) => api.initializeGame(12345) },
  { method: 'start_project', input: { state, project_id: 'proj_ova_01' }, response: { state, message: '接手回执' }, invoke: (api) => api.startProject(state, 'proj_ova_01') },
  { method: 'apply_decision', input: { state, decision: { type: 'outsource', stage: 'pre', enabled: false } }, response: { state, message: '决策回执' }, invoke: (api) => api.applyDecision(state, { type: 'outsource', stage: 'pre', enabled: false }) },
  { method: 'advance_day', input: { state }, response: { state: eventState(), report: dayReport() }, invoke: (api) => api.advanceDay(state) },
  { method: 'resolve_event', input: { state, option_id: 'opt_b' }, response: { state, message: '事件回执' }, invoke: (api) => api.resolveEvent(state, 'opt_b') },
  { method: 'calculate_result', input: { state }, response: { state: idleState(), result: projectResult() }, invoke: (api) => api.calculateResult(state) },
]

it.each(cases)('$method 使用 snake_case 完整信封，不重算返回值（工厂隔离测试）', async ({ method, input, response, invoke }) => {
  const module = moduleFixture(JSON.stringify(response))
  const api = await mockCore(module)
  expect(await invoke(api)).toEqual(response)
  expect(module[method]).toHaveBeenCalledWith(JSON.stringify(input))
})

it.each(['INVALID_INPUT', 'INSUFFICIENT_BUDGET', 'INVALID_PHASE', 'INTERNAL_ERROR'])('保留 C++ 结构化错误 %s', async (code) => {
  const api = await mockCore(moduleFixture(JSON.stringify({ error: { code, message: '核心拒绝此操作' } })))
  await expect(api.advanceDay(state)).rejects.toMatchObject({ code, message: '核心拒绝此操作', name: 'GameCoreError' })
})

it.each(['null', '[]', '{', '{}', '{"error":null}', '{"error":{"code":"NOT_IMPLEMENTED","message":"旧版"}}', '{"error":{"code":"INVALID_INPUT","message":42}}', '{"state":{"version":2},"report":{}}'])('拒绝非法返回 %s', async (response) => {
  const api = await mockCore(moduleFixture(response))
  await expect(api.advanceDay(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it.each(cases)('$method 拒绝缺失 payload 或损坏状态', async ({ invoke, method, response }) => {
  const module = moduleFixture(JSON.stringify({ state }))
  if (method === 'initialize_game') module.initialize_game = vi.fn(() => JSON.stringify({ state: { ...state, funds: -1 } }))
  const api = await mockCore(module)
  await expect(invoke(api)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  vi.mocked(module[method]).mockReturnValue(JSON.stringify({ ...response as object, state: { ...state, seed: 0x100000000 } }))
  await expect(invoke(api)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('拒绝损坏的日报与结算数值', async () => {
  const module = moduleFixture()
  module.advance_day = vi.fn(() => JSON.stringify({ state, report: { ...dayReport(), morale_delta: 101 } }))
  module.calculate_result = vi.fn(() => JSON.stringify({ state: idleState(), result: { ...projectResult(), profit: 0.25 } }))
  const api = await mockCore(module)
  await expect(api.advanceDay(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.calculateResult(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('捕获导出函数抛出的异常并保留 cause', async () => {
  const trap = new Error('wasm trap')
  const module = moduleFixture()
  module.advance_day = vi.fn(() => { throw trap })
  const api = await mockCore(module)
  await expect(api.advanceDay(state)).rejects.toMatchObject({ code: 'CALL_FAILED', cause: trap })
})

it.each(methods)('加载时验证 %s 导出，而非只检测 advance_day', async (method) => {
  const module: Partial<CoreModule> = moduleFixture()
  delete module[method]
  const api = await mockCore(module)
  await expect(api.loadGameCore()).rejects.toMatchObject({ code: 'LOAD_FAILED' })
})

it('加载失败清理缓存，用新模块 URL 重试，同一请求共用 promise 与工厂', async () => {
  const pending = deferred<CoreModule>()
  const module = moduleFixture()
  const create = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(module)
  vi.doMock(moduleUrl, () => ({ default: create }))
  vi.doMock(`${moduleUrl}?retry=1`, () => ({ default: create }))
  const { loadGameCore } = await import('./gameCore')
  const failed = loadGameCore()
  expect(loadGameCore()).toBe(failed)
  const rejection = expect(failed).rejects.toMatchObject({ code: 'LOAD_FAILED' })
  pending.reject(new Error('missing wasm'))
  await rejection
  const first = loadGameCore()
  expect(loadGameCore()).toBe(first)
  expect(await first).toBe(module)
  expect(loadGameCore()).toBe(first)
  expect(create).toHaveBeenCalledTimes(2)
  const { locateFile } = create.mock.calls[1][0] as { locateFile: (file: string) => string }
  expect(locateFile('game-core.wasm')).toBe(new URL('/wasm/game-core.wasm', window.location.href).href)
})

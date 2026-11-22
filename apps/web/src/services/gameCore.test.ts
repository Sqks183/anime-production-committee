import { beforeEach, expect, it, vi } from 'vitest'
import { deferred, v3EndedState, v3EventState, v3IdleState, v3ProducingState, v3SettledState, v3WeekReport } from '../test/fixtures'
import type { CoreMethod, StageConfiguration } from '../types/gameV3'
import type { CoreModule } from './gameCore'

const moduleUrl = new URL('/wasm/game-core.mjs', window.location.href).href
const methods: CoreMethod[] = ['initialize_game', 'start_project', 'apply_decision', 'advance_week', 'resolve_event', 'calculate_result']
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
    advance_week: vi.fn(() => response),
    resolve_event: vi.fn(() => response),
    calculate_result: vi.fn(() => response),
  }
}

async function mockCore(module: Partial<CoreModule>) {
  vi.doMock(moduleUrl, () => ({ default: vi.fn().mockResolvedValue(module) }))
  return import('./gameCore')
}

const state = v3ProducingState()
function startedState() {
  const next = v3ProducingState()
  next.project!.stages.script = { ...next.project!.stages.script, status: 'ready', configuration: null }
  next.preview = null
  return next
}
const settled = v3SettledState()
const ended = v3EndedState()
const configuration: StageConfiguration = { assignments: [{ staff_id: 'v3_director', role: 'director', focus: 'direction' }], policy: 'balanced', overtime: false }

const cases: { method: CoreMethod; input: unknown; response: unknown; invoke: (api: Api) => Promise<unknown> }[] = [
  { method: 'initialize_game', input: { seed: 12345 }, response: { state: v3IdleState(), message: '公司成立' }, invoke: (api) => api.initializeGame(12345) },
  { method: 'start_project', input: { state, offer_id: 'v3_ova', mode: 'contract', investment_percent: 0 }, response: { state: startedState(), message: '接手回执' }, invoke: (api) => api.startProject(state, 'v3_ova') },
  { method: 'apply_decision', input: { state, decision: { type: 'configure_stage', stage: 'script', configuration } }, response: { state, message: '决策回执' }, invoke: (api) => api.applyDecision(state, { type: 'configure_stage', stage: 'script', configuration }) },
  { method: 'advance_week', input: { state }, response: { state: v3EventState(), report: v3WeekReport() }, invoke: (api) => api.advanceWeek(state) },
  { method: 'resolve_event', input: { state, option_id: 'v3_keep' }, response: { state, message: '事件回执' }, invoke: (api) => api.resolveEvent(state, 'v3_keep') },
  { method: 'calculate_result', input: { state, scope: 'project' }, response: { state: settled, scope: 'project', result: settled.history[0] }, invoke: (api) => api.calculateProjectResult(state) },
  { method: 'calculate_result', input: { state, scope: 'company' }, response: { state: ended, scope: 'company', result: ended.company_result }, invoke: (api) => api.calculateCompanyResult(state) },
]

it.each(cases)('$method 使用 snake_case 完整信封，不重算返回值（工厂隔离测试）', async ({ method, input, response, invoke }) => {
  const module = moduleFixture(JSON.stringify(response))
  const api = await mockCore(module)
  expect(await invoke(api)).toEqual(response)
  expect(module[method]).toHaveBeenCalledWith(JSON.stringify(input))
})

it('resolve_event 可选携带阶段配置，未提供时不写入 configuration 键', async () => {
  const module = moduleFixture(JSON.stringify({ state, message: '事件回执' }))
  const api = await mockCore(module)
  await api.resolveEvent(state, 'v3_discuss', configuration)
  expect(module.resolve_event).toHaveBeenCalledWith(JSON.stringify({ state, option_id: 'v3_discuss', configuration }))
})

it.each(['INVALID_INPUT', 'INVALID_PHASE', 'INSUFFICIENT_BUDGET', 'STAGE_LOCKED', 'MODE_NOT_ALLOWED', 'CAPACITY_EXCEEDED', 'COMPANY_ENDED', 'INTERNAL_ERROR'])('保留 C++ 结构化错误 %s', async (code) => {
  const api = await mockCore(moduleFixture(JSON.stringify({ error: { code, message: '核心拒绝此操作' } })))
  await expect(api.advanceWeek(state)).rejects.toMatchObject({ code, message: '核心拒绝此操作', name: 'GameCoreError' })
})

it.each(['null', '[]', '{', '{}', '{"error":null}', '{"error":{"code":"NOT_IMPLEMENTED","message":"旧版"}}', '{"error":{"code":"INVALID_INPUT","message":42}}', '{"state":{"version":2}}'])('拒绝非法返回 %s', async (response) => {
  const api = await mockCore(moduleFixture(response))
  await expect(api.advanceWeek(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it.each(cases)('$method 拒绝缺失 payload 或损坏状态', async ({ invoke, method, response }) => {
  const module = moduleFixture(JSON.stringify({ state }))
  const api = await mockCore(module)
  await expect(invoke(api)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  const broken = JSON.parse(JSON.stringify(response)) as { state: { seed: number } }
  broken.state.seed = 0x100000000
  vi.mocked(module[method]).mockReturnValue(JSON.stringify(broken))
  await expect(invoke(api)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('initialize_game 拒绝负资金，start_project 拒绝未配置的首阶段', async () => {
  const module = moduleFixture()
  const poor = v3IdleState()
  poor.company.funds = -1
  module.initialize_game = vi.fn(() => JSON.stringify({ state: poor, message: '成立' }))
  module.start_project = vi.fn(() => JSON.stringify({ state, message: '接手' }))
  const api = await mockCore(module)
  await expect(api.initializeGame(12345)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.startProject(state, 'v3_ova')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('拒绝损坏的周报与结算数值', async () => {
  const module = moduleFixture()
  const lateReport = { ...v3WeekReport(), week: 2 }
  const badMorale = { ...v3WeekReport(), staff_deltas: [{ ...v3WeekReport().staff_deltas[0], morale_delta: 101 }] }
  module.advance_week = vi.fn(() => JSON.stringify({ state: v3EventState(), report: lateReport }))
  const api = await mockCore(module)
  await expect(api.advanceWeek(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  vi.mocked(module.advance_week).mockReturnValue(JSON.stringify({ state: v3EventState(), report: badMorale }))
  await expect(api.advanceWeek(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  vi.mocked(module.calculate_result).mockReturnValue(JSON.stringify({ state: settled, scope: 'project', result: { ...settled.history[0], profit: 0.25 } }))
  await expect(api.calculateProjectResult(state)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('捕获导出函数抛出的异常并保留 cause', async () => {
  const trap = new Error('wasm trap')
  const module = moduleFixture()
  module.advance_week = vi.fn(() => { throw trap })
  const api = await mockCore(module)
  await expect(api.advanceWeek(state)).rejects.toMatchObject({ code: 'CALL_FAILED', cause: trap })
})

it.each(methods)('加载时验证 %s 导出，而非只检测 advance_week', async (method) => {
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

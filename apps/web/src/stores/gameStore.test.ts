import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '../services/gameCore'
import { loadGame, saveGame } from '../services/saveGame'
import { dayReport, deferred, endedState, eventState, idleState, producingState, projectResult } from '../test/fixtures'
import { useGameStore } from './gameStore'

vi.mock('../services/gameCore', () => ({ initializeGame: vi.fn(), startProject: vi.fn(), applyDecision: vi.fn(), advanceDay: vi.fn(), resolveEvent: vi.fn(), calculateResult: vi.fn() }))
vi.mock('../services/saveGame', () => ({ loadGame: vi.fn(), saveGame: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/')
  useGameStore.setState(useGameStore.getInitialState())
})
afterEach(() => vi.restoreAllMocks())

const store = () => useGameStore.getState()
const actions = [
  { name: 'start', service: core.initializeGame, invoke: () => store().start(12345) },
  { name: 'startProject', service: core.startProject, invoke: () => store().startProject('proj_ova_01') },
  { name: 'decide', service: core.applyDecision, invoke: () => store().decide({ type: 'policy', policy: 'polish' }) },
  { name: 'advance', service: core.advanceDay, invoke: () => store().advance() },
  { name: 'resolveEvent', service: core.resolveEvent, invoke: () => store().resolveEvent('opt_b') },
  { name: 'settle', service: core.calculateResult, invoke: () => store().settle() },
  { name: 'save', service: saveGame, invoke: () => store().save() },
  { name: 'load', service: loadGame, invoke: () => store().load() },
]

describe('状态操作（服务隔离单元测试，不是 WASM 验证）', () => {
  it('初始无游戏；start 调用核心初始化，成功后才进入 studio 并清理旧回执', async () => {
    expect(store().game).toBeNull()
    expect(store().report).toBeNull()
    expect(store().result).toBeNull()
    const pending = deferred<{ state: ReturnType<typeof idleState> }>()
    vi.mocked(core.initializeGame).mockReturnValue(pending.promise)
    useGameStore.setState({ game: endedState(), report: dayReport(), result: projectResult() })
    const request = store().start(12345)
    expect(store().screen).toBe('home')
    expect(store().busy).toBe(true)
    const state = idleState()
    pending.resolve({ state })
    await request
    expect(core.initializeGame).toHaveBeenCalledWith(12345)
    expect(store()).toMatchObject({ screen: 'studio', game: state, report: null, result: null, busy: false })
  })

  it('未指定种子时使用 crypto.getRandomValues', async () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockReturnValue(new Uint32Array([987654321]))
    vi.mocked(core.initializeGame).mockResolvedValue({ state: idleState() })
    await store().start()
    expect(random).toHaveBeenCalledWith(expect.any(Uint32Array))
    expect(core.initializeGame).toHaveBeenCalledWith(987654321)
  })

  it.each(['0', '12345', '4294967295'])('URL seed=%s 用于复现，不调用随机生成器', async (seed) => {
    window.history.replaceState(null, '', `/?seed=${seed}`)
    const random = vi.spyOn(crypto, 'getRandomValues')
    vi.mocked(core.initializeGame).mockResolvedValue({ state: idleState() })
    await store().start()
    expect(core.initializeGame).toHaveBeenCalledWith(Number(seed))
    expect(random).not.toHaveBeenCalled()
  })

  it.each(['', '-1', '1.5', '4294967296', 'NaN', 'Infinity', '1e3', '0x10', '%20', '1&seed=2'])('拒绝非法 URL seed=%s 且保留现有游戏', async (seed) => {
    window.history.replaceState(null, '', `/?seed=${seed}`)
    const game = producingState()
    useGameStore.setState({ game })
    await store().start()
    expect(core.initializeGame).not.toHaveBeenCalled()
    expect(store().game).toBe(game)
    expect(store().error).toMatch(/seed 无效/)
    expect(store().busy).toBe(false)
  })

  it.each([-1, 0.5, NaN, Infinity, 0x100000000])('拒绝显式非法 seed=%s', async (seed) => {
    await store().start(seed)
    expect(core.initializeGame).not.toHaveBeenCalled()
    expect(store().error).toMatch(/种子必须/)
  })

  it('显式 seed 优先于 URL，并接受零', async () => {
    window.history.replaceState(null, '', '/?seed=invalid')
    vi.mocked(core.initializeGame).mockResolvedValue({ state: idleState() })
    await store().start(0)
    expect(core.initializeGame).toHaveBeenCalledWith(0)
  })

  it('接手企划直接采用完整服务状态并清理上轮回执', async () => {
    const before = idleState()
    const next = producingState()
    useGameStore.setState({ game: before, report: dayReport(), result: projectResult() })
    vi.mocked(core.startProject).mockResolvedValue({ state: next, message: '核心拨款回执' })
    await store().startProject('proj_ova_01')
    expect(core.startProject).toHaveBeenCalledWith(before, 'proj_ova_01')
    expect(store()).toMatchObject({ game: next, notice: '核心拨款回执', report: null, result: null })
  })

  it('决策与事件传递 snake_case 参数，不在前端应用效果', async () => {
    const before = producingState()
    const next = { ...producingState(), funds: 8123456, seed: 321 }
    const decision = { type: 'outsource', stage: 'mid', enabled: true } as const
    useGameStore.setState({ game: before })
    vi.mocked(core.applyDecision).mockResolvedValue({ state: next, message: '排班已更新' })
    await store().decide(decision)
    expect(core.applyDecision).toHaveBeenCalledWith(before, decision)
    expect(store().game).toBe(next)
    vi.mocked(core.resolveEvent).mockResolvedValue({ state: before, message: '事件已处理' })
    await store().resolveEvent('opt_b')
    expect(core.resolveEvent).toHaveBeenCalledWith(next, 'opt_b')
    expect(store().game).toBe(before)
    expect(store().notice).toBe('事件已处理')
  })

  it('推进直接采用返回 seed、phase 与完整 report，不重算状态', async () => {
    const before = producingState()
    const next = eventState()
    const report = dayReport()
    useGameStore.setState({ game: before })
    vi.mocked(core.advanceDay).mockResolvedValue({ state: next, report })
    await store().advance()
    expect(core.advanceDay).toHaveBeenCalledWith(before)
    expect(store().game).toBe(next)
    expect(store().report).toBe(report)
    expect(before.seed).toBe(12345)
  })

  it('结算采用核心的 idle 状态与 result，返回首页和继续经营不重初始化', async () => {
    const before = endedState()
    const next = idleState()
    const result = projectResult()
    useGameStore.setState({ screen: 'studio', game: before, report: dayReport() })
    vi.mocked(core.calculateResult).mockResolvedValue({ state: next, result })
    await store().settle()
    expect(core.calculateResult).toHaveBeenCalledWith(before)
    expect(store().game).toBe(next)
    expect(store().result).toBe(result)
    store().goHome()
    expect(store().screen).toBe('home')
    expect(store().game).toBe(next)
    store().resume()
    expect(store().screen).toBe('studio')
    expect(store().result).toBe(result)
    expect(core.initializeGame).not.toHaveBeenCalled()
  })

  it('保存与读取通过存档服务执行，成功载入才清理回执', async () => {
    const state = producingState()
    useGameStore.setState({ game: state, report: dayReport(), result: projectResult() })
    vi.mocked(saveGame).mockResolvedValue()
    await store().save()
    expect(saveGame).toHaveBeenCalledWith(state)
    expect(store().report).toEqual(dayReport())
    const next = eventState()
    vi.mocked(loadGame).mockResolvedValue(next)
    await store().load()
    expect(store()).toMatchObject({ game: next, screen: 'studio', report: null, result: null, notice: '已读取本地存档。' })
  })

  it('没有存档时不覆盖现有状态或回执', async () => {
    const game = producingState()
    useGameStore.setState({ game, report: dayReport(), result: projectResult() })
    vi.mocked(loadGame).mockResolvedValue(null)
    await store().load()
    expect(store()).toMatchObject({ game, report: dayReport(), result: projectResult(), screen: 'home', notice: '此浏览器还没有存档。' })
  })

  it('没有游戏时不调用依赖 state 的动作，也不能继续', async () => {
    store().resume()
    for (const action of actions.filter(({ name }) => !['start', 'load'].includes(name))) await action.invoke()
    for (const { service } of actions) expect(service).not.toHaveBeenCalled()
    expect(store().screen).toBe('home')
    expect(store().game).toBeNull()
  })

  it.each(actions)('$name 失败保留游戏、页面、report、result 并释放 busy', async ({ service, invoke }) => {
    const game = producingState()
    const report = dayReport()
    const result = projectResult()
    useGameStore.setState({ game, report, result, screen: 'studio' })
    vi.mocked(service).mockRejectedValue(new Error('隔离测试失败'))
    await invoke()
    expect(store().game).toBe(game)
    expect(store().report).toBe(report)
    expect(store().result).toBe(result)
    expect(store()).toMatchObject({ screen: 'studio', busy: false, error: '隔离测试失败' })
  })

  it.each(actions)('$name 持锁时阻止全部异步动作和页面切换', async ({ service, invoke }) => {
    const pending = deferred<never>()
    useGameStore.setState({ game: producingState(), screen: 'studio' })
    vi.mocked(service).mockReturnValue(pending.promise)
    const request = invoke()
    expect(store().busy).toBe(true)
    for (const action of actions) await action.invoke()
    store().goHome()
    store().resume()
    expect(store().screen).toBe('studio')
    for (const action of actions) expect(action.service).toHaveBeenCalledTimes(action.service === service ? 1 : 0)
    pending.reject(new Error('释放测试请求'))
    await request
    expect(store().busy).toBe(false)
    vi.mocked(saveGame).mockResolvedValue()
    await store().save()
    expect(store().notice).toBe('已保存到此浏览器。')
  })
})

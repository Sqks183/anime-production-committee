import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceDay } from '../services/gameCore'
import { loadGame, saveGame } from '../services/saveGame'
import { initialGame, useGameStore } from './gameStore'

vi.mock('../services/gameCore', () => ({ advanceDay: vi.fn() }))
vi.mock('../services/saveGame', () => ({ loadGame: vi.fn(), saveGame: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  useGameStore.setState(useGameStore.getInitialState())
})

describe('状态操作（服务隔离单元测试，不是 WASM 验证）', () => {
  it('把完整输入交给服务，并采用服务返回值', async () => {
    const result = { budget: 81000, progress: 31, message: '测试回执' }
    vi.mocked(advanceDay).mockResolvedValue(result)
    await useGameStore.getState().advance()
    expect(advanceDay).toHaveBeenCalledWith(initialGame)
    expect(useGameStore.getState().game).toEqual({ budget: 81000, progress: 31, seed: 12345 })
    expect(useGameStore.getState().result).toEqual(result)
    expect(initialGame.budget).toBe(100000)
  })

  it('调用失败保留状态并恢复操作', async () => {
    vi.mocked(advanceDay).mockRejectedValue(new Error('核心调用失败'))
    await useGameStore.getState().advance()
    expect(useGameStore.getState().game).toEqual(initialGame)
    expect(useGameStore.getState().error).toBe('核心调用失败')
    expect(useGameStore.getState().busy).toBe(false)
  })

  it('并发点击不会重复调用或切换页面', async () => {
    let resolve!: (result: { budget: number; progress: number; message: string }) => void
    vi.mocked(advanceDay).mockReturnValue(new Promise((done) => { resolve = done }))
    useGameStore.getState().start()
    const first = useGameStore.getState().advance()
    await useGameStore.getState().advance()
    useGameStore.getState().goHome()
    expect(advanceDay).toHaveBeenCalledTimes(1)
    expect(useGameStore.getState().screen).toBe('studio')
    resolve({ budget: 95000, progress: 25, message: '完成' })
    await first
    expect(useGameStore.getState().busy).toBe(false)
  })

  it('保存与读取通过存档服务执行', async () => {
    vi.mocked(saveGame).mockResolvedValue()
    await useGameStore.getState().save()
    expect(saveGame).toHaveBeenCalledWith(initialGame)
    const state = { budget: 75000, progress: 45, seed: 1 }
    vi.mocked(loadGame).mockResolvedValue(state)
    await useGameStore.getState().load()
    expect(useGameStore.getState().game).toEqual(state)
    expect(useGameStore.getState().screen).toBe('studio')
    expect(useGameStore.getState().result).toBeNull()
  })

  it('没有存档时不覆盖现有状态', async () => {
    vi.mocked(loadGame).mockResolvedValue(null)
    await useGameStore.getState().load()
    expect(useGameStore.getState().notice).toBe('此浏览器还没有存档。')
    expect(useGameStore.getState().game).toEqual(initialGame)
  })

  it('存档失败不会修改当前游戏数据', async () => {
    vi.mocked(loadGame).mockRejectedValue(new Error('存档损坏'))
    await useGameStore.getState().load()
    expect(useGameStore.getState().error).toBe('存档损坏')
    expect(useGameStore.getState().game).toEqual(initialGame)
  })
})

import { create } from 'zustand'
import { advanceDay, applyDecision, calculateResult, initializeGame, resolveEvent, startProject } from '../services/gameCore'
import { loadGame, saveGame } from '../services/saveGame'
import { isSeed } from '../types/game'
import type { DayReport, Decision, GameState, ProjectResult } from '../types/game'

interface GameStore {
  screen: 'home' | 'studio'
  game: GameState | null
  busy: boolean
  error: string | null
  notice: string | null
  report: DayReport | null
  result: ProjectResult | null
  start: (seed?: number) => Promise<void>
  resume: () => void
  goHome: () => void
  startProject: (projectId: string) => Promise<void>
  decide: (decision: Decision) => Promise<void>
  advance: () => Promise<void>
  resolveEvent: (optionId: string) => Promise<void>
  settle: () => Promise<void>
  save: () => Promise<void>
  load: () => Promise<void>
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

function startingSeed(explicit?: number): number {
  if (explicit !== undefined) {
    if (!isSeed(explicit)) throw new Error('种子必须是 0–4294967295 的整数。')
    return explicit
  }
  const values = new URLSearchParams(window.location.search).getAll('seed')
  if (values.length > 0) {
    const value = values[0]
    if (values.length !== 1 || !/^\d+$/.test(value) || !isSeed(Number(value))) {
      throw new Error('URL seed 无效，请使用 0–4294967295 的整数。')
    }
    return Number(value)
  }
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

export const useGameStore = create<GameStore>((set, get) => {
  // 所有异步入口共用一把锁；仅在成功后整体采用核心返回的状态。
  const run = async (action: () => Promise<Partial<GameStore>>) => {
    if (get().busy) return
    set({ busy: true, error: null, notice: null })
    try {
      set(await action())
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  }
  const withGame = (action: (state: GameState) => Promise<Partial<GameStore>>) => run(async () => {
    const game = get().game
    return game ? action(game) : {}
  })
  return {
    screen: 'home',
    game: null,
    busy: false,
    error: null,
    notice: null,
    report: null,
    result: null,
    start: (seed) => run(async () => {
      const { state } = await initializeGame(startingSeed(seed))
      return { game: state, screen: 'studio', report: null, result: null }
    }),
    resume: () => {
      if (!get().busy && get().game) set({ screen: 'studio', error: null, notice: null })
    },
    goHome: () => {
      if (!get().busy) set({ screen: 'home', error: null, notice: null })
    },
    startProject: (projectId) => withGame(async (game) => {
      const { state, message } = await startProject(game, projectId)
      return { game: state, notice: message, report: null, result: null }
    }),
    decide: (decision) => withGame(async (game) => {
      const { state, message } = await applyDecision(game, decision)
      return { game: state, notice: message }
    }),
    advance: () => withGame(async (game) => {
      const { state, report } = await advanceDay(game)
      return { game: state, report }
    }),
    resolveEvent: (optionId) => withGame(async (game) => {
      const { state, message } = await resolveEvent(game, optionId)
      return { game: state, notice: message }
    }),
    settle: () => withGame(async (game) => {
      const { state, result } = await calculateResult(game)
      return { game: state, result }
    }),
    save: () => withGame(async (game) => {
      await saveGame(game)
      return { notice: '已保存到此浏览器。' }
    }),
    load: () => run(async () => {
      const game = await loadGame()
      return game
        ? { game, report: null, result: null, screen: 'studio', notice: '已读取本地存档。' }
        : { notice: '此浏览器还没有存档。' }
    }),
  }
})

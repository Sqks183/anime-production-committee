import { create } from 'zustand'
import { advanceDay } from '../services/gameCore'
import { loadGame, saveGame } from '../services/saveGame'
import type { AdvanceDayResult, GameState } from '../types/game'

export const initialGame: Readonly<GameState> = Object.freeze({ budget: 100000, progress: 20, seed: 12345 })

interface GameStore {
  screen: 'home' | 'studio'
  game: GameState
  busy: boolean
  error: string | null
  notice: string | null
  result: AdvanceDayResult | null
  start: () => void
  goHome: () => void
  advance: () => Promise<void>
  save: () => Promise<void>
  load: () => Promise<void>
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'home',
  game: { ...initialGame },
  busy: false,
  error: null,
  notice: null,
  result: null,
  start: () => {
    if (!get().busy) set({ screen: 'studio', error: null, notice: null })
  },
  goHome: () => {
    if (!get().busy) set({ screen: 'home', error: null, notice: null })
  },
  advance: async () => {
    if (get().busy) return
    const state = { ...get().game }
    set({ busy: true, error: null, notice: null })
    try {
      const result = await advanceDay(state)
      set({ game: { budget: result.budget, progress: result.progress, seed: state.seed }, result })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },
  save: async () => {
    if (get().busy) return
    const state = { ...get().game }
    set({ busy: true, error: null, notice: null })
    try {
      await saveGame(state)
      set({ notice: '已保存到此浏览器。' })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },
  load: async () => {
    if (get().busy) return
    set({ busy: true, error: null, notice: null })
    try {
      const game = await loadGame()
      if (game) set({ game, result: null, screen: 'studio', notice: '已读取本地存档。' })
      else set({ notice: '此浏览器还没有存档。' })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },
}))

export interface GameState {
  budget: number
  progress: number
  seed: number
}

export interface AdvanceDayResult {
  budget: number
  progress: number
  message: string
}

export type CoreMethod =
  | 'initialize_game'
  | 'start_project'
  | 'apply_decision'
  | 'advance_day'
  | 'resolve_event'
  | 'calculate_result'

export type CoreModule = Record<CoreMethod, (input: string) => string>

export type CoreErrorCode =
  | 'LOAD_FAILED'
  | 'CALL_FAILED'
  | 'INVALID_RESPONSE'
  | 'INVALID_INPUT'
  | 'INSUFFICIENT_BUDGET'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'

export function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return typeof state.budget === 'number' && Number.isSafeInteger(state.budget) && state.budget >= 0
    && typeof state.progress === 'number' && Number.isInteger(state.progress) && state.progress >= 0 && state.progress <= 100
    && typeof state.seed === 'number' && Number.isInteger(state.seed) && state.seed >= 0 && state.seed <= 0xffffffff
}

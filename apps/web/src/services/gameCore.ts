import { isAdvanceDayResult, isCalculateResultResponse, isGameMessageResponse, isGameStateResponse } from '../types/game'
import type { AdvanceDayResult, CalculateResultResponse, CoreErrorCode, CoreMethod, CoreModule, Decision, GameMessageResponse, GameState, GameStateResponse } from '../types/game'

export class GameCoreError extends Error {
  constructor(public readonly code: CoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GameCoreError'
  }
}

let modulePromise: Promise<CoreModule> | undefined
let loadAttempt = 0

export function loadGameCore(): Promise<CoreModule> {
  if (!modulePromise) {
    const base = `${import.meta.env.BASE_URL}wasm/`
    const url = new URL(`${base}game-core.mjs`, window.location.href)
    if (loadAttempt > 0) url.searchParams.set('retry', String(loadAttempt))
    const moduleUrl = url.href
    modulePromise = (async () => {
      try {
        const { default: createGameCore } = await import(/* @vite-ignore */ moduleUrl)
        const module: CoreModule = await createGameCore({
          locateFile: (file: string) => new URL(file, moduleUrl).href,
        })
        const methods: CoreMethod[] = ['initialize_game', 'start_project', 'apply_decision', 'advance_day', 'resolve_event', 'calculate_result']
        for (const method of methods) {
          if (typeof module?.[method] !== 'function') throw new Error(`WASM 缺少 ${method} 导出`)
        }
        return module
      } catch (cause) {
        throw new GameCoreError('LOAD_FAILED', '游戏核心加载失败，请确认 WASM 已编译并可访问，然后重试。', { cause })
      }
    })().catch((error: unknown) => {
      loadAttempt += 1
      modulePromise = undefined
      throw error
    })
  }
  return modulePromise
}

const errorCodes: CoreErrorCode[] = ['INVALID_INPUT', 'INSUFFICIENT_BUDGET', 'INVALID_PHASE', 'INTERNAL_ERROR']

export async function callCore(method: CoreMethod, input: unknown): Promise<unknown> {
  const module = await loadGameCore()
  let raw: string
  try {
    raw = module[method](JSON.stringify(input))
  } catch (cause) {
    throw new GameCoreError('CALL_FAILED', 'C++ 核心调用异常，当前经营数据未改变。', { cause })
  }
  let result: unknown
  try {
    if (typeof raw !== 'string') throw new Error('核心响应不是 JSON 字符串')
    result = JSON.parse(raw)
  } catch (cause) {
    throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回了无效 JSON。', { cause })
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的数据结构无效。')
  }
  if ('error' in result) {
    const error = result.error as { code?: unknown; message?: unknown } | null
    if (!error || typeof error.code !== 'string' || !errorCodes.includes(error.code as CoreErrorCode) || typeof error.message !== 'string') {
      throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的错误结构无效。')
    }
    throw new GameCoreError(error.code as CoreErrorCode, error.message)
  }
  return result
}

async function checkedCall<T>(method: CoreMethod, input: unknown, validate: (value: unknown) => value is T): Promise<T> {
  const response = await callCore(method, input)
  if (!validate(response)) throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的经营数据无效。')
  return response
}

export function initializeGame(seed: number): Promise<GameStateResponse> {
  return checkedCall('initialize_game', { seed }, isGameStateResponse)
}

export function startProject(state: GameState, projectId: string): Promise<GameMessageResponse> {
  return checkedCall('start_project', { state, project_id: projectId }, isGameMessageResponse)
}

export function applyDecision(state: GameState, decision: Decision): Promise<GameMessageResponse> {
  return checkedCall('apply_decision', { state, decision }, isGameMessageResponse)
}

export function advanceDay(state: GameState): Promise<AdvanceDayResult> {
  return checkedCall('advance_day', { state }, isAdvanceDayResult)
}

export function resolveEvent(state: GameState, optionId: string): Promise<GameMessageResponse> {
  return checkedCall('resolve_event', { state, option_id: optionId }, isGameMessageResponse)
}

export function calculateResult(state: GameState): Promise<CalculateResultResponse> {
  return checkedCall('calculate_result', { state }, isCalculateResultResponse)
}

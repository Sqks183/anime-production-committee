import { isGameState } from '../types/game'
import type { AdvanceDayResult, CoreErrorCode, CoreMethod, CoreModule, GameState } from '../types/game'

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
        if (typeof module.advance_day !== 'function') throw new Error('WASM 缺少 advance_day 导出')
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

const errorCodes: CoreErrorCode[] = ['INVALID_INPUT', 'INSUFFICIENT_BUDGET', 'NOT_IMPLEMENTED', 'INTERNAL_ERROR']

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
    result = JSON.parse(raw)
  } catch (cause) {
    throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回了无效 JSON。', { cause })
  }
  if (typeof result !== 'object' || result === null) {
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

export async function advanceDay(state: GameState): Promise<AdvanceDayResult> {
  const result = await callCore('advance_day', state) as Partial<AdvanceDayResult>
  if (!isGameState({ ...result, seed: state.seed }) || typeof result.message !== 'string') {
    throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的经营数据无效。')
  }
  return result as AdvanceDayResult
}

import { CORE_METHODS, isCoreResponse } from '../types/gameV3'
import type { CompanyResult, CoreErrorCode, CoreMethod, CoreResponses, CooperationMode, Decision, GameState, StageConfiguration, StateResponse, WeekReport, WorkRecord } from '../types/gameV3'

export type CoreModule = Record<CoreMethod, (input: string) => string>
export type ServiceErrorCode = CoreErrorCode | 'LOAD_FAILED' | 'CALL_FAILED' | 'INVALID_RESPONSE'

export class GameCoreError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string, options?: ErrorOptions) {
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
        for (const method of CORE_METHODS) {
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

const errorCodes: CoreErrorCode[] = ['INVALID_INPUT', 'INVALID_PHASE', 'INSUFFICIENT_BUDGET', 'STAGE_LOCKED', 'MODE_NOT_ALLOWED', 'CAPACITY_EXCEEDED', 'COMPANY_ENDED', 'INTERNAL_ERROR']

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

async function checkedCall<M extends CoreMethod>(method: M, input: unknown): Promise<CoreResponses[M]> {
  const response = await callCore(method, input)
  if (!isCoreResponse(method, response)) throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的经营数据无效。')
  return response
}

export function initializeGame(seed: number): Promise<StateResponse> {
  return checkedCall('initialize_game', { seed })
}

export function startProject(state: GameState, offerId: string, mode: CooperationMode = 'contract', investmentPercent = 0): Promise<StateResponse> {
  return checkedCall('start_project', { state, offer_id: offerId, mode, investment_percent: investmentPercent })
}

export function applyDecision(state: GameState, decision: Decision): Promise<StateResponse> {
  return checkedCall('apply_decision', { state, decision })
}

export function advanceWeek(state: GameState): Promise<{ state: GameState; report: WeekReport }> {
  return checkedCall('advance_week', { state })
}

export function resolveEvent(state: GameState, optionId: string, configuration?: StageConfiguration): Promise<StateResponse> {
  const input = configuration === undefined ? { state, option_id: optionId } : { state, option_id: optionId, configuration }
  return checkedCall('resolve_event', input)
}

export async function calculateProjectResult(state: GameState): Promise<{ state: GameState; scope: 'project'; result: WorkRecord }> {
  const response = await checkedCall('calculate_result', { state, scope: 'project' })
  if (response.scope !== 'project') throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的经营数据无效。')
  return response
}

export async function calculateCompanyResult(state: GameState): Promise<{ state: GameState; scope: 'company'; result: CompanyResult }> {
  const response = await checkedCall('calculate_result', { state, scope: 'company' })
  if (response.scope !== 'company') throw new GameCoreError('INVALID_RESPONSE', 'C++ 返回的经营数据无效。')
  return response
}

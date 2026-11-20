export type Stage = 'pre' | 'mid' | 'post'
export type Assignment = Stage | 'rest'
export type Policy = 'rush' | 'normal' | 'polish'
export type Phase = 'idle' | 'producing' | 'event_pending' | 'ended'
export type EndReason = 'completed' | 'deadline' | 'bankrupt'
export type StaffRole = 'director' | 'key_animator' | 'animator' | 'photographer'
export type ProjectType = 'tv' | 'movie' | 'ova'
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface Staff {
  id: string
  name: string
  role: StaffRole
  skill: number
  morale: number
  assignment: Assignment
  overtime: boolean
}

export interface StageState {
  progress: number
  quality: number
  outsourced: boolean
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  budget: number
  spent: number
  start_day: number
  deadline_day: number
  target_quality: number
  policy: Policy
  stages: Record<Stage, StageState>
}

export interface ProjectOffer {
  id: string
  name: string
  type: ProjectType
  budget: number
  duration_days: number
  target_quality: number
  min_reputation: number
}

export interface StageEffect {
  stage: Stage
  delta: number
}

export interface EventEffect {
  funds?: number
  deadline_days?: number
  stage_quality?: StageEffect
  morale?: number
}

export interface EventOption {
  id: string
  label: string
  effect: EventEffect
}

export interface GameEvent {
  id: string
  title: string
  description: string
  options: EventOption[]
}

export interface StageDelta {
  stage: Stage
  progress: number
  quality: number
}

export interface DayReport {
  day: number
  funds_delta: number
  stage_deltas: StageDelta[]
  morale_delta: number
  rework: boolean
  message: string
}

export interface ProjectResult {
  end_reason: EndReason
  quality_score: number
  revenue: number
  cost: number
  profit: number
  reputation_delta: number
  grade: Grade
}

export interface GameState {
  version: 2
  seed: number
  day: number
  funds: number
  reputation: number
  phase: Phase
  staff: Staff[]
  offers: ProjectOffer[]
  project: Project | null
  pending_event: GameEvent | null
  end_reason: EndReason | null
}

export type Decision =
  | { type: 'assign'; staff_id: string; assignment: Assignment }
  | { type: 'policy'; policy: Policy }
  | { type: 'outsource'; stage: Stage; enabled: boolean }
  | { type: 'overtime'; staff_id: string; enabled: boolean }

export interface GameStateResponse { state: GameState }
export interface GameMessageResponse extends GameStateResponse { message: string }
export interface AdvanceDayResult extends GameStateResponse { report: DayReport }
export interface CalculateResultResponse extends GameStateResponse { result: ProjectResult }

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
  | 'INVALID_PHASE'
  | 'INTERNAL_ERROR'

const maxInteger = Number.MAX_SAFE_INTEGER
const stages: readonly Stage[] = ['pre', 'mid', 'post']
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const integer = (value: unknown, min = 0, max = maxInteger): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const choice = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T)
const uniqueIds = (values: { id: string }[]) => new Set(values.map((value) => value.id)).size === values.length
const scale = (value: unknown): value is number => integer(value, 0, 100)
const delta = (value: unknown): value is number => integer(value, -100, 100)

export const isSeed = (value: unknown): value is number => integer(value, 0, 0xffffffff)
export const isStage = (value: unknown): value is Stage => choice(value, stages)
export const isAssignment = (value: unknown): value is Assignment => choice(value, ['pre', 'mid', 'post', 'rest'])
export const isPolicy = (value: unknown): value is Policy => choice(value, ['rush', 'normal', 'polish'])
export const isPhase = (value: unknown): value is Phase => choice(value, ['idle', 'producing', 'event_pending', 'ended'])
export const isEndReason = (value: unknown): value is EndReason => choice(value, ['completed', 'deadline', 'bankrupt'])

// 仅验证协议结构、范围与关联字段；名册、报价、事件目录和经营规则由 C++ 校验。
export function isStaff(value: unknown): value is Staff {
  return isRecord(value) && isText(value.id) && isText(value.name)
    && choice(value.role, ['director', 'key_animator', 'animator', 'photographer'])
    && scale(value.skill) && scale(value.morale) && isAssignment(value.assignment)
    && typeof value.overtime === 'boolean' && (value.assignment !== 'rest' || !value.overtime)
}

export function isStageState(value: unknown): value is StageState {
  return isRecord(value) && scale(value.progress) && scale(value.quality) && typeof value.outsourced === 'boolean'
}

export function isProject(value: unknown): value is Project {
  if (!isRecord(value) || !isText(value.id) || !isText(value.name)
    || !choice(value.type, ['tv', 'movie', 'ova']) || !integer(value.budget) || !integer(value.spent)
    || !integer(value.start_day, 1) || !integer(value.deadline_day, value.start_day)
    || !scale(value.target_quality) || !isPolicy(value.policy) || !isRecord(value.stages)) return false
  const { pre, mid, post } = value.stages
  return isStageState(pre) && isStageState(mid) && isStageState(post)
    && pre.progress >= mid.progress && mid.progress >= post.progress
}

export function isProjectOffer(value: unknown): value is ProjectOffer {
  return isRecord(value) && isText(value.id) && isText(value.name) && choice(value.type, ['tv', 'movie', 'ova'])
    && integer(value.budget) && integer(value.duration_days, 1) && scale(value.target_quality) && integer(value.min_reputation)
}

export function isStageEffect(value: unknown): value is StageEffect {
  return isRecord(value) && isStage(value.stage) && delta(value.delta)
}

export function isEventEffect(value: unknown): value is EventEffect {
  return isRecord(value)
    && (!('funds' in value) || integer(value.funds, -maxInteger))
    && (!('deadline_days' in value) || integer(value.deadline_days))
    && Object.keys(value).every((key) => ['funds', 'deadline_days', 'stage_quality', 'morale'].includes(key))
    && (!('stage_quality' in value) || isStageEffect(value.stage_quality))
    && (!('morale' in value) || delta(value.morale))
}

export function isEventOption(value: unknown): value is EventOption {
  return isRecord(value) && isText(value.id) && isText(value.label) && isEventEffect(value.effect)
}

export function isGameEvent(value: unknown): value is GameEvent {
  return isRecord(value) && isText(value.id) && isText(value.title) && isText(value.description)
    && Array.isArray(value.options) && value.options.length > 0 && value.options.every(isEventOption) && uniqueIds(value.options)
}

export function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || value.version !== 2 || !isSeed(value.seed) || !integer(value.day, 1)
    || !integer(value.funds) || !integer(value.reputation) || !isPhase(value.phase)
    || !Array.isArray(value.staff) || !value.staff.length || !value.staff.every(isStaff) || !uniqueIds(value.staff)
    || !Array.isArray(value.offers) || !value.offers.every(isProjectOffer) || !uniqueIds(value.offers)) return false
  if (value.phase === 'idle') {
    return value.offers.length > 0 && value.project === null && value.pending_event === null && value.end_reason === null
  }
  if (value.offers.length !== 0 || !isProject(value.project) || value.project.start_day > value.day) return false
  if (value.phase === 'ended') return value.pending_event === null && isEndReason(value.end_reason)
  return value.end_reason === null && (value.phase === 'event_pending' ? isGameEvent(value.pending_event) : value.pending_event === null)
}

export function isStageDelta(value: unknown): value is StageDelta {
  return isRecord(value) && isStage(value.stage) && delta(value.progress) && delta(value.quality)
}

export function isDayReport(value: unknown): value is DayReport {
  return isRecord(value) && integer(value.day, 1) && integer(value.funds_delta, -maxInteger)
    && Array.isArray(value.stage_deltas)
    // 无法支付当天费用时，核心返回空工序回执。
    && (value.stage_deltas.length === 0 || (value.stage_deltas.length === stages.length
      && value.stage_deltas.every((item, index) => isStageDelta(item) && item.stage === stages[index])))
    && delta(value.morale_delta) && typeof value.rework === 'boolean' && isText(value.message)
}

export function isProjectResult(value: unknown): value is ProjectResult {
  return isRecord(value) && isEndReason(value.end_reason) && scale(value.quality_score)
    && integer(value.revenue) && integer(value.cost) && integer(value.profit, -maxInteger)
    && integer(value.reputation_delta, -maxInteger) && choice(value.grade, ['S', 'A', 'B', 'C', 'D'])
}

export function isDecision(value: unknown): value is Decision {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'assign': return isText(value.staff_id) && isAssignment(value.assignment)
    case 'policy': return isPolicy(value.policy)
    case 'outsource': return isStage(value.stage) && typeof value.enabled === 'boolean'
    case 'overtime': return isText(value.staff_id) && typeof value.enabled === 'boolean'
    default: return false
  }
}

export function isGameStateResponse(value: unknown): value is GameStateResponse {
  return isRecord(value) && isGameState(value.state)
}
export function isGameMessageResponse(value: unknown): value is GameMessageResponse {
  return isGameStateResponse(value) && 'message' in value && isText(value.message)
}
export function isAdvanceDayResult(value: unknown): value is AdvanceDayResult {
  return isGameStateResponse(value) && 'report' in value && isDayReport(value.report)
}
export function isCalculateResultResponse(value: unknown): value is CalculateResultResponse {
  return isGameStateResponse(value) && 'result' in value && isProjectResult(value.result)
}

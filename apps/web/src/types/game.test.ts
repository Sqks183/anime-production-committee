import { describe, expect, it } from 'vitest'
import { dayReport, endedState, eventState, idleState, producingState, projectResult } from '../test/fixtures'
import { isAdvanceDayResult, isCalculateResultResponse, isDayReport, isDecision, isEventEffect, isGameMessageResponse, isGameState, isGameStateResponse, isProjectResult } from './game'

// 在未知输入上修改字段，覆盖真实 JSON 边界；不使用类型断言绕过被测验证器。
function changed(source: unknown, path: string, value: unknown, remove = false): unknown {
  const copy = structuredClone(source) as Record<string, unknown>
  const keys = path.split('.')
  let target = copy
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  const key = keys[keys.length - 1]
  if (remove) delete target[key]
  else target[key] = value
  return copy
}

it.each([null, undefined, [], {}, { budget: 100000, progress: 20, seed: 1 }])('拒绝旧版或非法外部状态 %j', (state) => {
  expect(isGameState(state)).toBe(false)
})

it('接受四种 phase 与 safe integer 边界', () => {
  for (const state of [idleState(), producingState(), eventState(), endedState()]) expect(isGameState(state)).toBe(true)
  expect(isGameState({ ...idleState(), seed: 0, funds: 0, reputation: 0 })).toBe(true)
  expect(isGameState({ ...idleState(), seed: 0xffffffff, day: Number.MAX_SAFE_INTEGER, funds: Number.MAX_SAFE_INTEGER, reputation: Number.MAX_SAFE_INTEGER })).toBe(true)
})

it.each(['seed', 'day', 'funds', 'reputation', 'staff.0.skill', 'staff.0.morale', 'project.budget', 'project.spent', 'project.start_day', 'project.deadline_day', 'project.target_quality', 'project.stages.pre.progress', 'project.stages.mid.quality'])('严格拒绝 %s 的非整数/不安全数', (path) => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    expect(isGameState(changed(producingState(), path, value))).toBe(false)
  }
})

it.each(['version', 'seed', 'day', 'funds', 'reputation', 'phase', 'staff', 'offers', 'project', 'pending_event', 'end_reason', 'staff.0.id', 'staff.0.name', 'staff.0.role', 'staff.0.skill', 'staff.0.morale', 'staff.0.assignment', 'staff.0.overtime', 'project.id', 'project.name', 'project.type', 'project.budget', 'project.spent', 'project.start_day', 'project.deadline_day', 'project.target_quality', 'project.policy', 'project.stages.pre', 'project.stages.mid.progress', 'project.stages.post.quality', 'project.stages.pre.outsourced'])('必需字段 %s 不允许省略', (path) => {
  expect(isGameState(changed(producingState(), path, undefined, true))).toBe(false)
})

it.each([
  ['version', 1], ['seed', 0x100000000], ['day', 0], ['staff.0.skill', 101], ['staff.0.morale', 101],
  ['staff.0.assignment', 'unknown'], ['staff.0.role', 'producer'], ['staff.0.overtime', 1],
  ['project.start_day', 2], ['project.deadline_day', 0], ['project.target_quality', 101],
  ['project.stages.pre.progress', 101], ['project.stages.post.quality', 101], ['project.stages.mid.outsourced', null],
  ['project.stages.mid.progress', 31], ['project.stages.post.progress', 21], ['project.policy', 'fast'], ['project.type', 'film'],
])('校验范围、枚举与工序顺序 %s', (path, value) => {
  expect(isGameState(changed(producingState(), path as string, value))).toBe(false)
})

it('校验 phase 的 project、pending_event、end_reason 和 offers 空值一致性', () => {
  expect(isGameState({ ...idleState(), project: producingState().project })).toBe(false)
  expect(isGameState({ ...idleState(), pending_event: eventState().pending_event })).toBe(false)
  expect(isGameState({ ...idleState(), end_reason: 'completed' })).toBe(false)
  expect(isGameState({ ...idleState(), offers: [] })).toBe(false)
  expect(isGameState({ ...producingState(), project: null })).toBe(false)
  expect(isGameState({ ...producingState(), offers: idleState().offers })).toBe(false)
  expect(isGameState({ ...producingState(), pending_event: eventState().pending_event })).toBe(false)
  expect(isGameState({ ...producingState(), end_reason: 'bankrupt' })).toBe(false)
  expect(isGameState({ ...eventState(), pending_event: null })).toBe(false)
  expect(isGameState({ ...endedState(), pending_event: eventState().pending_event })).toBe(false)
  expect(isGameState({ ...endedState(), end_reason: null })).toBe(false)
})

it('拒绝休息时加班以及未实现的事件进度效果', () => {
  const state = producingState()
  state.staff[0].assignment = 'rest'
  state.staff[0].overtime = true
  expect(isGameState(state)).toBe(false)
  expect(isEventEffect({ stage_progress: { stage: 'pre', delta: 5 } })).toBe(false)
})

it('校验报价与事件嵌套必需字段及范围', () => {
  for (const path of ['id', 'name', 'type', 'budget', 'duration_days', 'target_quality', 'min_reputation']) {
    expect(isGameState(changed(idleState(), `offers.0.${path}`, undefined, true))).toBe(false)
  }
  for (const path of ['budget', 'duration_days', 'min_reputation']) {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(isGameState(changed(idleState(), `offers.0.${path}`, value))).toBe(false)
  }
  expect(isGameState(changed(idleState(), 'offers.0.duration_days', 0))).toBe(false)
  expect(isGameState(changed(idleState(), 'offers.0.target_quality', 101))).toBe(false)
  for (const path of ['id', 'title', 'description', 'options', 'options.0.id', 'options.0.label', 'options.0.effect']) {
    expect(isGameState(changed(eventState(), `pending_event.${path}`, undefined, true))).toBe(false)
  }
  expect(isGameState(changed(eventState(), 'pending_event.options', []))).toBe(false)
})

it('只校验结构与 ID 唯一性，不复制名册或事件/报价目录', () => {
  const state = eventState()
  state.staff[0].id = 'staff_custom'
  state.staff[0].name = '结构样本'
  state.staff[0].skill = 10
  expect(isGameState(state)).toBe(true)
  expect(isGameState(changed(idleState(), 'offers.0.name', '非目录报价'))).toBe(true)
  expect(isGameState(changed(state, 'staff.1.id', 'staff_custom'))).toBe(false)
  expect(isGameState(changed(state, 'pending_event.options.1.id', 'opt_a'))).toBe(false)
  expect(isGameState(changed(idleState(), 'offers.1.id', 'proj_ova_01'))).toBe(false)
})

it('事件增量支持 signed safe integer，显式无效字段不被当作省略', () => {
  expect(isEventEffect({ funds: -Number.MAX_SAFE_INTEGER, deadline_days: 1, morale: -100, stage_quality: { stage: 'pre', delta: -100 } })).toBe(true)
  for (const effect of [{ funds: NaN }, { funds: Number.MIN_SAFE_INTEGER - 1 }, { morale: -101 }, { morale: undefined }, { deadline_days: -1 }, { stage_quality: { stage: 'mid', delta: 0.1 } }, { stage_progress: { stage: 'bad', delta: 1 } }]) {
    expect(isEventEffect(effect)).toBe(false)
  }
})

it('校验所有决策字段，外包必须显式 enabled', () => {
  for (const decision of [{ type: 'assign', staff_id: 'staff_01', assignment: 'rest' }, { type: 'policy', policy: 'polish' }, { type: 'outsource', stage: 'mid', enabled: false }, { type: 'overtime', staff_id: 'staff_01', enabled: true }]) expect(isDecision(decision)).toBe(true)
  for (const decision of [{ type: 'assign', staffId: 'staff_01', assignment: 'rest' }, { type: 'outsource', stage: 'mid' }, { type: 'overtime', staff_id: 'staff_01', enabled: 1 }, { type: 'policy', policy: 'unknown' }]) expect(isDecision(decision)).toBe(false)
})

describe('核心回执结构', () => {
  it('接受 signed 增量及破产当天的空工序回执', () => {
    expect(isDayReport(dayReport())).toBe(true)
    expect(isDayReport({ ...dayReport(), funds_delta: -Number.MAX_SAFE_INTEGER, stage_deltas: [] })).toBe(true)
    expect(isProjectResult({ ...projectResult(), profit: Number.MIN_SAFE_INTEGER, revenue: Number.MAX_SAFE_INTEGER })).toBe(true)
  })
  it.each(['day', 'funds_delta', 'stage_deltas', 'morale_delta', 'rework', 'message', 'stage_deltas.0.stage', 'stage_deltas.0.progress', 'stage_deltas.0.quality'])('回执必需字段 %s', (path) => {
    expect(isDayReport(changed(dayReport(), path, undefined, true))).toBe(false)
  })
  it('拒绝乱序、缺项、越界或非整数回执', () => {
    const report = dayReport()
    for (const stage_deltas of [[report.stage_deltas[0]], [...report.stage_deltas].reverse(), [report.stage_deltas[0], report.stage_deltas[0], report.stage_deltas[2]]]) expect(isDayReport({ ...report, stage_deltas })).toBe(false)
    for (const [path, value] of [['day', 0], ['funds_delta', Number.MAX_SAFE_INTEGER + 1], ['morale_delta', -101], ['stage_deltas.0.progress', -101], ['stage_deltas.0.quality', 0.1], ['rework', 'true']]) expect(isDayReport(changed(report, path as string, value))).toBe(false)
  })
  it.each(['end_reason', 'quality_score', 'revenue', 'cost', 'profit', 'reputation_delta', 'grade'])('结算必需字段 %s', (path) => {
    expect(isProjectResult(changed(projectResult(), path, undefined, true))).toBe(false)
  })
  it('拒绝无效结算，不在 TS 重算利润或评级', () => {
    for (const [path, value] of [['end_reason', 'unknown'], ['quality_score', 101], ['revenue', -1], ['cost', 0.5], ['profit', Number.MIN_SAFE_INTEGER - 1], ['reputation_delta', NaN], ['grade', 'F']]) expect(isProjectResult(changed(projectResult(), path as string, value))).toBe(false)
    expect(isProjectResult({ ...projectResult(), profit: 42, grade: 'S' })).toBe(true)
  })
  it('逐个验证响应信封，拒绝丢失的 state/message/report/result', () => {
    expect(isGameStateResponse({ state: idleState() })).toBe(true)
    expect(isGameMessageResponse({ state: producingState(), message: '回执' })).toBe(true)
    expect(isAdvanceDayResult({ state: eventState(), report: dayReport() })).toBe(true)
    expect(isCalculateResultResponse({ state: idleState(), result: projectResult() })).toBe(true)
    expect(isGameStateResponse({})).toBe(false)
    expect(isGameMessageResponse({ state: producingState() })).toBe(false)
    expect(isAdvanceDayResult({ state: producingState() })).toBe(false)
    expect(isCalculateResultResponse({ state: idleState() })).toBe(false)
  })
})

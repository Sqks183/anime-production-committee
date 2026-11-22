import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import createGameCore from '../../../apps/web/public/wasm/game-core.mjs'

const wasmUrl = new URL('../../../apps/web/public/wasm/game-core.wasm', import.meta.url)
const core = await createGameCore()
const methods = ['initialize_game', 'start_project', 'apply_decision', 'advance_week', 'resolve_event', 'calculate_result']
const call = (method, input, module = core) => JSON.parse(module[method](JSON.stringify(input)))
function ok(method, input, module = core) {
  const result = call(method, input, module)
  assert.equal(result.error, undefined, JSON.stringify(result))
  return result
}
const initial = (seed = 12345, module = core) => ok('initialize_game', { seed }, module).state
const start = (seed = 12345, module = core) => ok('start_project', { state: initial(seed, module), offer_id: 'proj_ova_01', mode: 'contract', investment_percent: 0 }, module).state
function configure(state, policy = 'balanced', module = core) {
  const stage = state.project.current_stage
  const recommended = state.project.stages[stage].recommended_configuration
  return ok('apply_decision', { state, decision: { type: 'configure_stage', stage, configuration: { assignments: recommended.assignments, policy, overtime: false } } }, module).state
}
const advance = (state, module = core) => ok('advance_week', { state }, module)
function expectError(result, code) {
  assert.deepEqual(Object.keys(result), ['error'])
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message'])
  assert.equal(result.error.code, code)
  assert.equal(typeof result.error.message, 'string')
  assert.ok(result.error.message.length > 0)
}
const stageOrder = ['script', 'storyboard', 'key_animation', 'animation_check', 'postproduction']
function checkInvariants(state) {
  if (state.project === null) return
  const current = state.project.current_stage === null ? 5 : stageOrder.indexOf(state.project.current_stage)
  let seenActive = false
  for (const [index, stage] of stageOrder.entries()) {
    const item = state.project.stages[stage]
    if (item.status === 'completed') assert.ok(!seenActive && index < current, stage)
    if (item.status === 'active') { seenActive = true; assert.equal(index, current) }
    if (item.status === 'ready') { assert.equal(index, current); assert.equal(item.work_done, 0) }
  }
  assert.ok(state.company.funds >= 0 || state.company.status !== 'running')
}
function run(seed, module = core, policy = 'balanced') {
  let state = configure(start(seed, module), policy, module)
  const trace = [state]
  for (let step = 0; step < 60 && state.phase === 'producing'; step++) {
    const stage = state.project.current_stage
    if (state.project.stages[stage].status === 'ready') state = configure(state, policy, module)
    const result = advance(state, module)
    state = result.state
    checkInvariants(state)
    trace.push(result)
  }
  assert.equal(state.phase, 'project_ready')
  trace.push(ok('calculate_result', { state, scope: 'project' }, module))
  return trace
}

test('工厂加载真实 WASM 二进制并导出 v3 六接口', async () => {
  assert.equal(createGameCore.name, 'createGameCore')
  const bytes = await readFile(wasmUrl)
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0])
  assert.ok(WebAssembly.validate(bytes))
  for (const method of methods) assert.equal(typeof core[method], 'function')
})

test('v3 初始化、接手合同与首周黄金数据通过 Embind', () => {
  const idle = initial()
  assert.equal(idle.version, 3)
  assert.equal(idle.phase, 'idle')
  assert.equal(idle.company.funds, 2_000_000)
  assert.equal(idle.offers.length, 4)
  assert.equal(idle.offers[0].id, 'proj_ova_01')
  assert.equal(idle.preview.total_cost, 180_000)
  const state = start()
  assert.equal(state.project.offer.name, '放学后的第七帧')
  assert.equal(state.company.funds, 6_000_000)
  assert.equal(state.project.deadline_week, 14)
  assert.deepEqual(state.seed, idle.seed)
  const request = structuredClone(state)
  const first = advance(configure(state))
  assert.deepEqual(state, request)
  assert.equal(first.state.company.funds, 5_790_000)
  assert.equal(first.state.company.week, 1)
  assert.equal(first.state.project.stages.script.work_done, 10)
  assert.equal(first.state.project.stages.script.quality, 42)
  assert.equal(first.state.company.staff[0].morale, 78)
  assert.equal(first.state.company.staff[0].fatigue, 4)
  assert.equal(first.state.seed, 12345)
  assert.equal(first.report.funds_delta, -210_000)
})

test('相同种子的整局轨迹跨独立 WASM 实例与插局干扰完全相同', async () => {
  const second = await createGameCore()
  for (const seed of [0, 1, 13, 12345, 0xffffffff]) {
    const first = run(seed)
    run(4242, second, 'quality')
    assert.deepEqual(run(seed, second), first, `seed ${seed}`)
  }
})

test('完整对局结算、返回市场与企划轮换', () => {
  let state = configure(start())
  for (let step = 0; step < 60 && state.phase === 'producing'; step++) {
    const stage = state.project.current_stage
    if (state.project.stages[stage].status === 'ready') state = configure(state)
    state = advance(state).state
  }
  assert.equal(state.phase, 'project_ready')
  assert.equal(state.project.delivery_reason, 'deadline')
  expectError(call('advance_week', { state }), 'INVALID_PHASE')
  const settled = ok('calculate_result', { state, scope: 'project' })
  assert.equal(settled.state.phase, 'project_settled')
  assert.equal(settled.state.last_project_id, 'proj_ova_01')
  assert.equal(settled.state.history[0].id, 'proj_ova_01')
  assert.equal(settled.state.company.funds, state.company.funds - settled.result.finance.costs.penalty)
  assert.equal(settled.result.finance.costs.penalty, 800_000)
  assert.equal(settled.result.end_reason, 'deadline')
  assert.equal(settled.result.commercial_revenue % 15_000, 0)
  assert.ok(settled.result.quality_score >= 0 && settled.result.quality_score <= 100)
  expectError(call('calculate_result', { state: settled.state, scope: 'project' }), 'INVALID_PHASE')
  const returned = ok('apply_decision', { state: settled.state, decision: { type: 'return_to_market' } })
  assert.equal(returned.state.phase, 'idle')
  assert.equal(returned.state.seed, 87628868)
  assert.deepEqual(returned.state.offers.map((offer) => offer.id), ['proj_short_03', 'proj_tv_03', 'proj_ova_04', 'proj_movie_02'])
  const next = ok('start_project', { state: returned.state, offer_id: 'proj_short_03', mode: 'contract', investment_percent: 0 })
  assert.equal(next.state.project.start_week, 14)
})

test('M1 未开放动作返回契约错误且不修改状态', () => {
  const idle = initial()
  expectError(call('start_project', { state: idle, offer_id: 'proj_ova_01', mode: 'committee', investment_percent: 0 }), 'MODE_NOT_ALLOWED')
  expectError(call('apply_decision', { state: idle, decision: { type: 'hire_core', staff_id: 'staff_01' } }), 'INVALID_INPUT')
  expectError(call('apply_decision', { state: start(), decision: { type: 'hire_temporary', staff_id: 'tmp_01' } }), 'INVALID_INPUT')
  expectError(call('apply_decision', { state: start(), decision: { type: 'request_extension' } }), 'MODE_NOT_ALLOWED')
  expectError(call('resolve_event', { state: idle }), 'INVALID_PHASE')
  const producing = start()
  expectError(call('resolve_event', { state: producing }), 'INVALID_PHASE')
  const tampered = structuredClone(producing)
  tampered.pending_event = { id: 'evt_001' }
  expectError(call('advance_week', { state: tampered }), 'INVALID_INPUT')
})

test('空闲周推进扣款与企划轮换、破产周零修改', () => {
  const idle = initial()
  const week = advance(idle)
  assert.equal(week.state.company.week, 1)
  assert.equal(week.state.company.funds, 1_820_000)
  assert.equal(week.state.seed, 87628868)
  assert.deepEqual(week.state.offers.map((offer) => offer.id), ['proj_short_03', 'proj_tv_03', 'proj_ova_04', 'proj_movie_02'])
  const poor = { ...initial(), company: { ...idle.company, funds: 179_999 } }
  const bankrupt = advance(poor)
  assert.equal(bankrupt.state.company.funds, 179_999)
  assert.equal(bankrupt.state.company.week, 0)
  assert.equal(bankrupt.state.company.status, 'closing')
  assert.equal(bankrupt.state.company.end_reason, 'bankrupt')
  assert.deepEqual(bankrupt.state.offers, [])
  expectError(call('advance_week', { state: bankrupt.state }), 'COMPANY_ENDED')
  expectError(call('apply_decision', { state: bankrupt.state, decision: { type: 'end_company' } }), 'COMPANY_ENDED')
})

test('JSON 异常在 WASM 内捕获，后续调用正常', () => {
  for (const raw of ['', '{', 'undefined', 'null', 'true', '42', '"text"', '[]', '{}',
    '{"seed":1e1000}', '{"seed":1} trailing', '{"seed":1,}', '{"seed":18446744073709551615}',
    '{"seed":18446744073709551616}', '{"seed":1.0}', '{"seed":1e0}']) {
    for (const method of methods) expectError(JSON.parse(core[method](raw)), 'INVALID_INPUT')
    assert.equal(initial().phase, 'idle')
  }
})

test('嵌套数值与安全整数边界', () => {
  const invalid = {
    funds: [-1, Number.MAX_SAFE_INTEGER + 1, 0.5, '1', true, null, [], {}],
    seed: [-1, 0x100000000, 1.5, '1', true, null, [], {}],
  }
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      const state = start()
      if (field === 'funds') state.company.funds = value
      else state[field] = value
      expectError(call('advance_week', { state }), 'INVALID_INPUT')
    }
    const state = start()
    if (field === 'funds') delete state.company.funds
    else delete state[field]
    expectError(call('advance_week', { state }), 'INVALID_INPUT')
  }
  const rich = configure(start())
  rich.company.funds = Number.MAX_SAFE_INTEGER
  assert.equal(advance(rich).state.company.funds, Number.MAX_SAFE_INTEGER - 210_000)
  expectError(call('start_project', { state: { ...initial(), company: { ...initial().company, funds: Number.MAX_SAFE_INTEGER } }, offer_id: 'proj_ova_01', mode: 'contract', investment_percent: 0 }), 'INVALID_INPUT')
})

test('六接口的状态顺序校验', () => {
  const idle = initial()
  expectError(call('apply_decision', { state: idle, decision: { type: 'configure_stage', stage: 'script', configuration: {} } }), 'INVALID_PHASE')
  expectError(call('calculate_result', { state: idle, scope: 'project' }), 'INVALID_PHASE')
  const producing = start()
  expectError(call('calculate_result', { state: producing, scope: 'project' }), 'INVALID_PHASE')
  expectError(call('start_project', { state: producing, offer_id: 'proj_ova_01', mode: 'contract', investment_percent: 0 }), 'INVALID_PHASE')
  expectError(call('apply_decision', { state: producing, decision: { type: 'return_to_market' } }), 'INVALID_PHASE')
})

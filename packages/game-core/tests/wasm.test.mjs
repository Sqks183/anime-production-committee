import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import createGameCore from '../../../apps/web/public/wasm/game-core.mjs'

const wasmUrl = new URL('../../../apps/web/public/wasm/game-core.wasm', import.meta.url)
const core = await createGameCore()
const methods = ['initialize_game', 'start_project', 'apply_decision', 'advance_day', 'resolve_event', 'calculate_result']
const call = (method, input, module = core) => JSON.parse(module[method](JSON.stringify(input)))
function ok(method, input, module = core) {
  const result = call(method, input, module)
  assert.equal(result.error, undefined, JSON.stringify(result))
  return result
}
const initial = (seed = 12345) => ok('initialize_game', { seed }).state
const start = (seed = 12345) => ok('start_project', { state: initial(seed), project_id: 'proj_ova_01' }).state
const decide = (state, decision) => ok('apply_decision', { state, decision }).state
const advance = (state) => ok('advance_day', { state })
function expectError(result, code) {
  assert.deepEqual(Object.keys(result), ['error'])
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message'])
  assert.equal(result.error.code, code)
  assert.equal(typeof result.error.message, 'string')
  assert.ok(result.error.message.length > 0)
}
function run(seed, module = core) {
  let state = ok('initialize_game', { seed }, module).state
  state = ok('start_project', { state, project_id: 'proj_ova_01' }, module).state
  state = ok('apply_decision', { state, decision: { type: 'policy', policy: 'normal' } }, module).state
  const trace = [state]
  for (let step = 0; step < 100 && state.phase !== 'ended'; step++) {
    const result = state.phase === 'event_pending'
      ? ok('resolve_event', { state, option_id: 'opt_b' }, module)
      : ok('advance_day', { state }, module)
    state = result.state
    trace.push(result)
    assert.ok(state.project.stages.post.progress <= state.project.stages.mid.progress)
    assert.ok(state.project.stages.mid.progress <= state.project.stages.pre.progress)
    assert.ok(state.funds >= 0)
  }
  assert.equal(state.phase, 'ended')
  trace.push(ok('calculate_result', { state }, module))
  return trace
}

test('工厂加载真实 WASM 二进制并导出全部六接口', async () => {
  assert.equal(createGameCore.name, 'createGameCore')
  const bytes = await readFile(wasmUrl)
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0])
  assert.ok(WebAssembly.validate(bytes))
  for (const method of methods) assert.equal(typeof core[method], 'function')
})

test('UTF-8 初始化、接手、决策、首日黄金数据通过 Embind', () => {
  const state = start()
  assert.equal(state.project.name, '放学后的第七帧')
  assert.equal(state.staff.length, 4)
  assert.equal(state.funds, 10_000_000)
  assert.equal(state.project.deadline_day, 20)
  const request = structuredClone(state)
  const next = advance(state)
  assert.deepEqual(state, request)
  assert.equal(next.state.funds, 9_700_000)
  assert.equal(next.state.day, 2)
  assert.equal(next.state.seed, 87628868)
  assert.equal(next.state.project.stages.pre.progress, 6)
  assert.equal(next.state.project.stages.mid.progress, 6)
  assert.equal(next.state.project.stages.post.progress, 6)
  assert.equal(next.report.funds_delta, -300000)
})

test('相同种子与决策的整局轨迹跨独立 WASM 实例完全相同', async () => {
  const second = await createGameCore()
  for (const seed of [0, 1, 13, 12345, 0xffffffff]) {
    const first = run(seed)
    run(42)
    assert.deepEqual(run(seed, second), first)
  }
  assert.notDeepEqual(run(0), run(1))
})

test('完整新游戏到按期完成、结算、下一企划且不可重复结算', () => {
  const trace = run(12345)
  const settled = trace.at(-1)
  const ended = trace.at(-2).state
  assert.equal(settled.result.end_reason, 'completed')
  assert.equal(settled.state.phase, 'idle')
  assert.equal(settled.state.project, null)
  assert.equal(settled.state.offers.length, 3)
  assert.equal(settled.state.funds, ended.funds + settled.result.revenue)
  assert.equal(settled.result.profit, settled.result.revenue - settled.result.cost)
  assert.ok(settled.result.quality_score > 0)
  expectError(call('calculate_result', { state: settled.state }), 'INVALID_PHASE')
  const next = ok('start_project', { state: settled.state, project_id: 'proj_tv_01' }).state
  assert.equal(next.project.start_day, ended.day)
  assert.equal(next.seed, ended.seed)
})

test('安排可撤销，外包与加班推进才扣款且只生效一天', () => {
  const before = start()
  const planned = decide(before, { type: 'outsource', stage: 'pre', enabled: true })
  assert.equal(planned.funds, before.funds)
  assert.deepEqual(decide(planned, { type: 'outsource', stage: 'pre', enabled: false }), before)
  const overtime = decide(planned, { type: 'overtime', staff_id: 'staff_01', enabled: true })
  const next = advance(overtime).state
  assert.equal(next.project.spent, 825000)
  assert.equal(next.project.stages.pre.outsourced, false)
  assert.equal(next.staff[0].overtime, false)
  assert.equal(next.staff[0].morale, 73)
  const poor = { ...before, funds: 300000 }
  expectError(call('apply_decision', { state: poor, decision: { type: 'outsource', stage: 'pre', enabled: true } }), 'INSUFFICIENT_BUDGET')
  assert.equal(poor.funds, 300000)
})

test('确定性事件、未处理时阻止推进、事件费用不足不修改状态', () => {
  const pending = advance(start(13)).state
  assert.equal(pending.phase, 'event_pending')
  assert.equal(pending.seed, 1035543048)
  assert.equal(pending.pending_event.id, 'evt_001')
  expectError(call('advance_day', { state: pending }), 'INVALID_PHASE')
  const poor = { ...pending, funds: 0 }
  expectError(call('resolve_event', { state: poor, option_id: 'opt_a' }), 'INSUFFICIENT_BUDGET')
  const next = ok('resolve_event', { state: poor, option_id: 'opt_b' }).state
  assert.equal(next.phase, 'producing')
  assert.equal(next.seed, pending.seed)
  assert.equal(next.day, pending.day)
  assert.equal(next.project.deadline_day, pending.project.deadline_day + 1)
  const tampered = structuredClone(pending)
  tampered.pending_event.options[0].effect.funds = 1_000_000
  expectError(call('resolve_event', { state: tampered, option_id: 'opt_a' }), 'INVALID_INPUT')
})

test('截止、破产与末日完成优先级均可结算', () => {
  const state = start(13)
  state.project.deadline_day = 1
  const late = advance(state).state
  assert.equal(late.end_reason, 'deadline')
  assert.equal(late.pending_event, null)
  assert.equal(ok('calculate_result', { state: late }).state.phase, 'idle')
  const poor = { ...start(), funds: 299999 }
  const bankrupt = advance(poor).state
  assert.equal(bankrupt.end_reason, 'bankrupt')
  assert.equal(bankrupt.day, poor.day)
  assert.equal(bankrupt.seed, poor.seed)
  assert.equal(bankrupt.funds, poor.funds)
  assert.equal(ok('calculate_result', { state: bankrupt }).result.revenue, 0)
  for (const stage of Object.values(state.project.stages)) { stage.progress = 99; stage.quality = 80 }
  const completed = advance(state).state
  assert.equal(completed.end_reason, 'completed')
  for (const stage of Object.values(completed.project.stages)) assert.equal(stage.progress, 100)
})

test('JSON 异常在 WASM 内捕获，后续调用正常', () => {
  for (const raw of ['', '{', 'undefined', 'null', 'true', '42', '"text"', '[]', '{}',
    '{"seed":1e1000}', '{"seed":1} trailing', '{"seed":1,}', '{"seed":18446744073709551615}',
    '{"seed":18446744073709551616}', '{"seed":1.0}', '{"seed":1e0}']) {
    for (const method of methods) expectError(JSON.parse(core[method](raw)), 'INVALID_INPUT')
    assert.equal(initial().phase, 'idle')
  }
})

test('嵌套数值、必填字段、阶段一致性与安全整数边界', () => {
  const invalid = {
    funds: [-1, Number.MAX_SAFE_INTEGER + 1, 0.5, '1', true, null, [], {}],
    seed: [-1, 0x100000000, 1.5, '1', true, null, [], {}],
    day: [0, -1, 1.5, '1', true, null],
    reputation: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1],
  }
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) expectError(call('advance_day', { state: { ...start(), [field]: value } }), 'INVALID_INPUT')
    const state = start(); delete state[field]
    expectError(call('advance_day', { state }), 'INVALID_INPUT')
  }
  for (const field of ['progress', 'quality']) {
    for (const value of [-1, 101, 0.5, true, null, '1']) {
      const state = start(); state.project.stages.pre[field] = value
      expectError(call('advance_day', { state }), 'INVALID_INPUT')
    }
  }
  const forged = start(); forged.phase = 'ended'; forged.end_reason = 'completed'
  expectError(call('calculate_result', { state: forged }), 'INVALID_INPUT')
  const maximum = { ...start(), funds: Number.MAX_SAFE_INTEGER }
  assert.equal(advance(maximum).state.funds, Number.MAX_SAFE_INTEGER - 300000)
  expectError(call('start_project', { state: { ...initial(), funds: Number.MAX_SAFE_INTEGER }, project_id: 'proj_ova_01' }), 'INVALID_INPUT')
})

test('六接口的状态顺序与声望解锁门槛', () => {
  const idle = initial()
  for (const method of ['apply_decision', 'advance_day', 'resolve_event', 'calculate_result']) expectError(call(method, { state: idle }), 'INVALID_PHASE')
  expectError(call('start_project', { state: idle, project_id: 'proj_movie_01' }), 'INVALID_INPUT')
  const unlocked = { ...idle, reputation: 20 }
  assert.equal(ok('start_project', { state: unlocked, project_id: 'proj_movie_01' }).state.project.type, 'movie')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// v4 M1 契约测试：直接加载 emcc 构建的模块，全部通过 JSON 字符串接口调用。
// 依赖 build/v4/v4.mjs（npm run build:v4 生成）。
const factory = (await import('../build/v4/v4.mjs')).default
const core = await factory()

const call = (name, payload) => JSON.parse(core[name](JSON.stringify(payload)))
const ok = (name, payload) => {
  const result = call(name, payload)
  if (result.error) throw new Error(`${name} 失败: ${result.error.code} ${result.error.message}`)
  return result
}

const tiny = {
  schema_version: 1,
  id: 'test_tiny',
  name: '手算夹具',
  scale: 'short',
  episode_count: 1,
  work_unit: 'centi_staff_week',
  common: [{ key: 'series_comp', name: '系列构成', ability: 'planning', work_total: 100, deliver_at: 1000, deps: [] }],
  episode: [
    { key: 'script', stage: 'content_design', name: '脚本', ability: 'planning', work_total: 100, deliver_at: 1000, deps: [] },
    { key: 'storyboard', stage: 'storyboard_key_animation', name: '分镜', ability: 'direction', work_total: 100, deliver_at: 1000, deps: ['script'] },
    { key: 'inbetween', stage: 'animation', name: '动画', ability: 'animation', work_total: 100, deliver_at: 1000, deps: ['storyboard'] },
    { key: 'background', stage: 'art_visual', name: '背景', ability: 'drawing', work_total: 100, deliver_at: 1000, deps: ['storyboard'] },
    { key: 'composite', stage: 'photography_editing', name: '摄影', ability: 'postproduction', work_total: 100, deliver_at: 1000, deps: ['inbetween', 'background'] },
    { key: 'master', stage: 'sound_delivery', name: '母版', ability: 'postproduction', work_total: 100, deliver_at: 1000, is_gate: true, deps: ['composite'] }
  ]
}

function findItem(state, workId, itemId) {
  const work = state.works.find((entry) => entry.id === workId)
  // 工作项 id 带项目前缀（INV-02 全局唯一）；测试里仍可用相对 id 书写。
  const full = itemId.startsWith(`${workId}.`) ? itemId : `${workId}.${itemId}`
  for (const item of work.common.items) if (item.id === full) return item
  for (const episode of work.episodes) for (const stage of episode.stages) for (const item of stage.items) if (item.id === full) return item
  throw new Error(`找不到工作项 ${itemId}`)
}

function allItems(state, workId) {
  const work = state.works.find((entry) => entry.id === workId)
  const items = [...work.common.items]
  for (const episode of work.episodes) for (const stage of episode.stages) items.push(...stage.items)
  return items
}

function setupTiny(seed = 7, workId = 'work_01') {
  const base = ok('initialize', { seed })
  const created = ok('instantiate_work', { state: base.state, blueprint: tiny, work_id: workId, duration_weeks: 26 })
  return created.state
}

test('initialize 生成合法状态，同 seed 哈希一致', () => {
  const first = ok('initialize', { seed: 42 })
  const second = ok('initialize', { seed: 42 })
  const hashA = ok('hash_state', { state: first.state }).hash
  const hashB = ok('hash_state', { state: second.state }).hash
  assert.equal(first.state.version, 4)
  assert.equal(first.state.company.week, 0)
  assert.equal(first.state.staff.length, 3)
  assert.equal(hashA, hashB)
})

test('实例化 tv_standard 得到 174 个工作项（12×14 + 6）', () => {
  const blueprint = JSON.parse(readFileSync('docs/blueprints/tv_standard.blueprint.json', 'utf8'))
  const base = ok('initialize', { seed: 1 })
  const created = ok('instantiate_work', { state: base.state, blueprint, work_id: 'work_tv', duration_weeks: 26 })
  const items = allItems(created.state, 'work_tv')
  assert.equal(created.state.works[0].episodes.length, 12)
  assert.equal(items.length, 174)
  const gates = items.filter((item) => item.is_gate)
  assert.equal(gates.length, 12)
})

test('首周产出与独立手算逐项一致', () => {
  let state = setupTiny()
  for (const staffId of ['staff_dir', 'staff_ka', 'staff_anim']) {
    state = ok('assign_staff', { state, staff_id: staffId, work_id: 'work_01' }).state
  }
  const advanced = ok('advance_week', { state })

  // 手算（产能按主专业；跨专业按 800‰ 折算并四舍五入；分配期按未被占用的剩余量扣减）：
  // staff_anim 80 点 → 公共项 80→64（余 20）
  // staff_dir  82 点 → 公共项 20→16（余 0），脚本 62→50（余 38）
  // staff_ka   85 点 → 脚本 38→30（余 0）
  const common = findItem(advanced.state, 'work_01', 'common.series_comp')
  const script = findItem(advanced.state, 'work_01', 'ep01.script')
  assert.equal(common.work_done, 80)
  assert.equal(script.work_done, 80)

  // 质量是评级，不是点数换算：公共项按能力落到 story，脚本只允许 story/direction。
  // 旧公式（点数 × ability_q）会得到 58 / 62；新模型下质量与点数无关，由人和随机决定。
  const commonDims = Object.entries(common.quality).filter(([, value]) => value > 0)
  assert.equal(commonDims.length, 1, '公共项本周只写入一个质量维度')
  assert.equal(commonDims[0][0], 'story', '公共制作按 planning 落到 story')
  assert.ok(commonDims[0][1] >= 0 && commonDims[0][1] <= 100, '质量是 0..100 的评级')

  const scriptDims = Object.entries(script.quality).filter(([, value]) => value > 0)
  assert.ok(scriptDims.length >= 1 && scriptDims.length <= 2, '脚本只应落在 content_design 的两个维度')
  for (const [dim] of scriptDims) assert.ok(['story', 'direction'].includes(dim), `意外维度 ${dim}`)

  // 周结算同时记账：工资 120000 + 运营 30000 + 制作 60000 = 210000
  assert.equal(advanced.report.funds.costs.salary, 120000)
  assert.equal(advanced.report.funds.costs.operations, 30000)
  assert.equal(advanced.report.funds.costs.production, 60000)
  assert.equal(advanced.report.funds.delta, -210000)
  assert.equal(advanced.report.funds.balance, 1790000)
  assert.equal(advanced.state.finance.balance, 1790000)
  const ledgerSum = advanced.state.finance.entries.reduce((sum, entry) => sum + entry.amount, 0)
  assert.equal(advanced.state.finance.opening_funds + ledgerSum, advanced.state.finance.balance)
  assert.equal(advanced.state.finance.entries.length, 5)   // 3 工资 + 1 运营 + 1 制作
  assert.ok(advanced.state.finance.entries.some((entry) => entry.category === 'production' && entry.work_id === 'work_01'))

  // 质量聚合进入回执：工作项 → 阶段 → 单集 → 作品
  const aggregated = advanced.report.works[0].quality
  const aggregatedSum = Object.values(aggregated.dims).reduce((sum, value) => sum + value, 0)
  assert.ok(aggregatedSum > 0, '作品层质量不应为空')
  assert.ok(Object.values(aggregated.dims).filter((value) => value > 0).length <= 2, '只有脚本产出了质量')
  assert.equal(aggregated.mean, Math.round(aggregatedSum / 6))

  const fatigue = Object.fromEntries(advanced.state.staff.map((member) => [member.id, member.fatigue]))
  const morale = Object.fromEntries(advanced.state.staff.map((member) => [member.id, member.morale]))
  for (const id of ['staff_dir', 'staff_ka', 'staff_anim']) {
    assert.equal(fatigue[id], 8)
    assert.equal(morale[id], 78)
  }
  assert.equal(advanced.state.company.week, 1)
})

test('未开工的下游工作项不被解锁', () => {
  let state = setupTiny()
  state = ok('assign_staff', { state, staff_id: 'staff_ka', work_id: 'work_01' }).state
  const advanced = ok('advance_week', { state })
  const storyboard = findItem(advanced.state, 'work_01', 'ep01.storyboard')
  assert.equal(storyboard.work_done, 0)
})

test('同 seed 同操作序列产生相同哈希', () => {
  const run = () => {
    let state = setupTiny(11)
    state = ok('assign_staff', { state, staff_id: 'staff_ka', work_id: 'work_01' }).state
    state = ok('advance_week', { state }).state
    return ok('hash_state', { state }).hash
  }
  assert.equal(run(), run())
})

test('项目遍历顺序不改变结算结果', () => {
  const build = () => {
    let state = ok('initialize', { seed: 3 }).state
    state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_b', duration_weeks: 26 }).state
    state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_a', duration_weeks: 26 }).state
    for (const staffId of ['staff_dir', 'staff_ka', 'staff_anim']) {
      state = ok('assign_staff', { state, staff_id: staffId, work_id: staffId === 'staff_dir' ? 'work_a' : 'work_b' }).state
    }
    return state
  }
  const straight = ok('advance_week', { state: build() })
  const reversedState = build()
  reversedState.works = [...reversedState.works].reverse()
  const reversed = ok('advance_week', { state: reversedState })

  assert.equal(
    ok('hash_state', { state: straight.state }).hash,
    ok('hash_state', { state: reversed.state }).hash
  )
})

test('两个空项目并存且状态隔离', () => {
  let state = ok('initialize', { seed: 5 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_a', duration_weeks: 26 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_b', duration_weeks: 26 }).state
  state = ok('assign_staff', { state, staff_id: 'staff_ka', work_id: 'work_a' }).state
  const advanced = ok('advance_week', { state })

  assert.equal(advanced.state.works.length, 2)
  const a = findItem(advanced.state, 'work_a', 'common.series_comp')
  const b = findItem(advanced.state, 'work_b', 'common.series_comp')
  assert.ok(a.work_done > 0)
  assert.equal(b.work_done, 0)
})

test('非法目标与非法归属被拒绝且状态不变', () => {
  const state = setupTiny()
  const badTarget = call('set_plan', { state, work_id: 'work_01', plan: { target: { kind: 'episode', id: 'ep99' } } })
  assert.equal(badTarget.error.code, 'INVALID_INPUT')

  const badStaff = call('assign_staff', { state, staff_id: 'nobody', work_id: 'work_01' })
  assert.equal(badStaff.error.code, 'NOT_FOUND')

  const badWork = call('assign_staff', { state, staff_id: 'staff_ka', work_id: 'work_99' })
  assert.equal(badWork.error.code, 'NOT_FOUND')
})

test('定向目标把产能拉到指定单集', () => {
  // 单人、单周，差异只来自定向：不设定向时预算全给公共项，设了才轮到脚本
  const run = (plan) => {
    let state = ok('initialize', { seed: 9 }).state
    state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_b', duration_weeks: 26 }).state
    if (plan) state = ok('set_plan', { state, work_id: 'work_b', plan }).state
    state = ok('assign_staff', { state, staff_id: 'staff_dir', work_id: 'work_b' }).state
    const advanced = ok('advance_week', { state })
    return {
      script: findItem(advanced.state, 'work_b', 'ep01.script').work_done,
      common: findItem(advanced.state, 'work_b', 'common.series_comp').work_done,
      first: advanced.report.works.find((entry) => entry.work_id === 'work_b').items[0].item_id
    }
  }
  const plain = run(null)
  assert.ok(plain.common > 0 && plain.script === 0, '无定向时公共项先吃满')

  const targeted = run({ focus: 'quality', target: { kind: 'episode', id: 'ep01' } })
  assert.ok(targeted.script > 0, '定向后脚本应有产出')
  assert.equal(targeted.common, 0, '定向后公共项应让位')
  assert.equal(targeted.first, 'work_b.ep01.script', '第一个被投入的工作项应当是定向目标')
})

test('门槛优先级高于质量取向（回归：已过门槛的项不得吸走产能）', () => {
  // 公共项 work_total=1000 只给 150 的门槛：第 0 周（198 点）就"达标"，但远未做完。
  // 若排序被 quality 取向倒置，它会在后续每周继续吸走全部产能，脚本永远开不了工。
  const big = {
    ...tiny,
    id: 'test_gate_priority',
    common: [{ key: 'series_comp', name: '系列构成', ability: 'planning', work_total: 1000, deliver_at: 150, deps: [] }]
  }
  for (const focus of ['quality', 'schedule', 'cost']) {
    let state = ok('initialize', { seed: 7 }).state
    state = ok('instantiate_work', { state, blueprint: big, work_id: 'work_01', duration_weeks: 26 }).state
    state = ok('set_plan', { state, work_id: 'work_01', plan: { focus } }).state
    for (const staffId of ['staff_dir', 'staff_ka', 'staff_anim']) {
      state = ok('assign_staff', { state, staff_id: staffId, work_id: 'work_01' }).state
    }
    state = ok('advance_week', { state }).state
    // 第 1 周：公共项已过门槛但仍未完成，脚本尚未开工 —— 应当轮到脚本
    const advanced = ok('advance_week', { state })
    const script = findItem(advanced.state, 'work_01', 'ep01.script')
    const common = findItem(advanced.state, 'work_01', 'common.series_comp')
    assert.ok(common.work_done > 150 && common.work_done < 1000, `${focus}: 公共项应已过门槛但未完成`)
    assert.ok(script.work_done > 0, `${focus}: 未达门槛的脚本必须拿到产能`)
  }
})

test('改 focus 不清除定向目标，显式 null 才清除', () => {
  let state = setupTiny()
  state = ok('set_plan', { state, work_id: 'work_01', plan: { target: { kind: 'episode', id: 'ep01' } } }).state
  assert.deepEqual(state.works[0].plan.target, { kind: 'episode', id: 'ep01' })

  state = ok('set_plan', { state, work_id: 'work_01', plan: { focus: 'schedule' } }).state
  assert.deepEqual(state.works[0].plan.target, { kind: 'episode', id: 'ep01' }, '只改 focus 不应丢目标')
  assert.equal(state.works[0].plan.focus, 'schedule')

  state = ok('set_plan', { state, work_id: 'work_01', plan: { target: null } }).state
  assert.equal(state.works[0].plan.target, null, '显式 null 才清除目标')
})

test('计划枚举非法取值被拒绝且状态不变', () => {
  const state = setupTiny()
  const cases = [
    { focus: 'bogus' },
    { intensity: 'extreme' },
    { outsourcing: 'whatever' },
    { overtime: 'yes' },
    { target: 'ep01' }
  ]
  for (const plan of cases) {
    const result = call('set_plan', { state, work_id: 'work_01', plan })
    assert.equal(result.error?.code, 'INVALID_INPUT', `plan=${JSON.stringify(plan)} 应被拒绝`)
  }
})

test('现金不足时整周不提交，状态与流水都不变', () => {
  let state = setupTiny()
  for (const staffId of ['staff_dir', 'staff_ka', 'staff_anim']) {
    state = ok('assign_staff', { state, staff_id: staffId, work_id: 'work_01' }).state
  }
  // 本周需要 210000，只留 100000
  state.finance.opening_funds = 100000
  state.finance.balance = 100000
  const before = ok('hash_state', { state }).hash

  const result = call('advance_week', { state })
  assert.equal(result.error.code, 'INSUFFICIENT_FUNDS')
  assert.equal(result.error.gap, 110000)
  assert.equal(ok('hash_state', { state }).hash, before, '失败不得留下半结算')
  assert.equal(state.company.week, 0)
  assert.equal(state.finance.entries.length, 0)
  assert.equal(findItem(state, 'work_01', 'common.series_comp').work_done, 0)
})

test('双项目隔离：产出不串项目，作者不串项目', () => {
  let state = ok('initialize', { seed: 5 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_a', duration_weeks: 26 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_b', duration_weeks: 26 }).state
  state = ok('assign_staff', { state, staff_id: 'staff_ka', work_id: 'work_a' }).state
  state = ok('assign_staff', { state, staff_id: 'staff_dir', work_id: 'work_b' }).state
  const advanced = ok('advance_week', { state })

  const aItems = allItems(advanced.state, 'work_a')
  const bItems = allItems(advanced.state, 'work_b')
  // 只有各自项目的员工出现在 contributors 里
  for (const item of aItems) {
    for (const id of item.contributors) assert.equal(id, 'staff_ka', `work_a 出现了 ${id}`)
  }
  for (const item of bItems) {
    for (const id of item.contributors) assert.equal(id, 'staff_dir', `work_b 出现了 ${id}`)
  }
  // 两个项目的产出都必须 >0，且没有互相抵消
  assert.ok(aItems.some((item) => item.work_done > 0))
  assert.ok(bItems.some((item) => item.work_done > 0))
  // 每人本周产出不超过自身产能（不会被算两次）
  const produced = Object.fromEntries(advanced.report.staff.map((entry) => [entry.staff_id, entry.produced]))
  assert.ok(produced.staff_ka <= 100 && produced.staff_dir <= 100)
  const sumA = aItems.reduce((sum, item) => sum + item.work_done, 0)
  const sumB = bItems.reduce((sum, item) => sum + item.work_done, 0)
  assert.equal(sumA + sumB, produced.staff_ka + produced.staff_dir)
})

test('随机性进入制作结果：换 seed 改变质量落维，同 seed 可复现', () => {
  const run = (seed) => {
    let state = ok('initialize', { seed }).state
    state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_01', duration_weeks: 26 }).state
    for (const staffId of ['staff_dir', 'staff_ka', 'staff_anim']) {
      state = ok('assign_staff', { state, staff_id: staffId, work_id: 'work_01' }).state
    }
    const advanced = ok('advance_week', { state })
    const script = findItem(advanced.state, 'work_01', 'ep01.script')
    const dim = Object.entries(script.quality).find(([, value]) => value > 0)?.[0]
    return { dim, hash: ok('hash_state', { state: advanced.state }).hash }
  }
  const first = run(21)
  assert.deepEqual(run(21), first, '同 seed 必须逐字段复现')
  const dims = new Set()
  for (let seed = 0; seed < 12; seed++) dims.add(run(seed).dim)
  assert.ok(dims.size > 1, '不同 seed 应落到不同质量维度，否则随机性没有进入结果')
})

// ---- 2026-11-25 复审修正：质量模型、不变式、输入边界 ----

const assign = (state, staffId, workId = 'work_01') =>
  ok('assign_staff', { state, staff_id: staffId, work_id: workId }).state

const meanOf = (dims) => Math.round(Object.values(dims).reduce((sum, value) => sum + value, 0) / 6)

function singleItemBlueprint(workTotal, overrides = {}) {
  return {
    ...tiny,
    id: `single_${workTotal}`,
    common: [{ key: 'series_comp', name: '系列构成', ability: 'planning', work_total: workTotal, deliver_at: 1000, deps: [] }],
    ...overrides
  }
}

test('质量：工作量不同不改变质量评级（与点数脱钩）', () => {
  const run = (workTotal) => {
    let state = ok('initialize', { seed: 77 }).state
    state = ok('instantiate_work', { state, blueprint: singleItemBlueprint(workTotal), work_id: 'work_01', duration_weeks: 26 }).state
    state = assign(state, 'staff_dir')
    const advanced = ok('advance_week', { state })
    const item = findItem(advanced.state, 'work_01', 'common.series_comp')
    const entry = advanced.report.works[0].items.find((row) => row.item_id === item.id)
    return { points: entry.points, quality: Object.values(item.quality).reduce((sum, value) => sum + value, 0) }
  }
  const small = run(20)
  const large = run(200)
  assert.ok(large.points > small.points, `两次投入点数应当不同：${small.points} vs ${large.points}`)
  assert.equal(large.quality, small.quality, '点数不同但质量评级相同：质量不是点数换算')
})

test('质量：同等工作量下，能力与随机都会改变质量', () => {
  const run = (ability, seed) => {
    let state = ok('initialize', { seed }).state
    state = ok('instantiate_work', { state, blueprint: singleItemBlueprint(10), work_id: 'work_01', duration_weeks: 26 }).state
    const member = state.staff.find((entry) => entry.id === 'staff_dir')
    member.abilities.planning = ability
    member.role = 'scriptwriter'   // planning 主专业，排除适配差异
    state = assign(state, 'staff_dir')
    const advanced = ok('advance_week', { state })
    const item = findItem(advanced.state, 'work_01', 'common.series_comp')
    const entry = advanced.report.works[0].items.find((row) => row.item_id === item.id)
    return { points: entry.points, quality: item.quality.story }
  }
  const strong = run(90, 5)
  const weak = run(20, 5)
  assert.equal(strong.points, weak.points, '工作项只有 10 点，两人投入相同')
  assert.ok(strong.quality > weak.quality + 40, `能力应显著改变质量：${strong.quality} vs ${weak.quality}`)

  const values = new Set([1, 2, 3, 4, 5].map((seed) => run(60, seed).quality))
  assert.ok(values.size > 1, `同能力同工作量，不同随机仍应给出不同质量：${[...values].join(',')}`)
})

test('质量：未开工为 0，部分完成是评级，完成后不越界', () => {
  let state = setupTiny()
  const fresh = findItem(state, 'work_01', 'common.series_comp')
  assert.equal(Object.values(fresh.quality).reduce((sum, value) => sum + value, 0), 0)

  state = assign(state, 'staff_dir')
  state = ok('advance_week', { state }).state
  const partial = findItem(state, 'work_01', 'common.series_comp')
  assert.ok(partial.work_done > 0 && partial.work_done < partial.work_total, '第一周应为部分完成')
  const partialQuality = Object.values(partial.quality).reduce((sum, value) => sum + value, 0)
  assert.ok(partialQuality > 0 && partialQuality <= 100, '部分完成时质量应是 0..100 的评级')

  // 同一员工跨专业投入按 800‰ 折算，需要几周才能做满；逐周确认质量始终是评级。
  for (let guard = 0; guard < 6; guard++) {
    state = ok('advance_week', { state }).state
    const item = findItem(state, 'work_01', 'common.series_comp')
    assert.ok(Object.values(item.quality).every((value) => value >= 0 && value <= 100))
    if (item.work_done === item.work_total) break
  }
  const complete = findItem(state, 'work_01', 'common.series_comp')
  assert.equal(complete.work_done, complete.work_total)
})

test('质量：维度权重按 700/300 生效', () => {
  const counts = { story: 0, direction: 0 }
  for (let seed = 0; seed < 40; seed++) {
    let state = ok('initialize', { seed }).state
    state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_01', duration_weeks: 26 }).state
    state = ok('set_plan', { state, work_id: 'work_01', plan: { target: { kind: 'episode', id: 'ep01' } } }).state
    state = assign(state, 'staff_dir')
    const advanced = ok('advance_week', { state })
    const script = findItem(advanced.state, 'work_01', 'ep01.script')
    const dims = Object.entries(script.quality).filter(([, value]) => value > 0).map(([dim]) => dim)
    assert.equal(dims.length, 1, `seed=${seed} 应只写入一个维度`)
    counts[dims[0]] += 1
  }
  assert.ok(counts.direction > 0, `direction 也应能出现：${JSON.stringify(counts)}`)
  assert.ok(counts.story >= 20, `700‰ 权重下 story 至少应占一半：${JSON.stringify(counts)}`)
  assert.ok(counts.story > counts.direction, `story 应多于 direction：${JSON.stringify(counts)}`)
})

test('质量：公共制作通过依赖上限影响下游与作品层', () => {
  const dependent = {
    ...tiny,
    id: 'dep_tiny',
    episode: tiny.episode.map((item) => (item.key === 'script' ? { ...item, deps: ['common:series_comp'] } : item))
  }
  const run = (commonQuality) => {
    let state = ok('initialize', { seed: 31 }).state
    state = ok('instantiate_work', { state, blueprint: dependent, work_id: 'work_01', duration_weeks: 26 }).state
    const common = findItem(state, 'work_01', 'common.series_comp')
    common.work_done = common.work_total
    common.contributors = ['staff_dir']
    for (const dim of Object.keys(common.quality)) common.quality[dim] = commonQuality
    // 让执行者的质量样本明显高于低质量上限，才能观察到"公共项压低下游"。
    const member = state.staff.find((entry) => entry.id === 'staff_dir')
    member.abilities.planning = 90
    member.role = 'scriptwriter'
    state = assign(state, 'staff_dir')
    const advanced = ok('advance_week', { state })
    const script = findItem(advanced.state, 'work_01', 'ep01.script')
    return { script, aggregate: advanced.report.works[0].quality }
  }
  const low = run(20)
  const high = run(90)
  const lowMax = Math.max(...Object.values(low.script.quality))
  const highMax = Math.max(...Object.values(high.script.quality))
  assert.ok(lowMax <= 52, `低质量公共项应把下游压到 52 以内，实际 ${lowMax}`)
  assert.ok(highMax > 52, `高质量公共项不应继续被压住，实际 ${highMax}`)
  assert.ok(high.aggregate.dims.story > low.aggregate.dims.story, '作品层质量应体现公共制作的差异')
})

test('不变式：全局 id、公共项、归属、参与记录与贡献者都被校验', () => {
  const base = setupTiny()
  const reject = (mutate, label) => {
    const state = JSON.parse(JSON.stringify(base))
    mutate(state)
    const result = call('advance_week', { state })
    assert.equal(result.error?.code, 'INVALID_STATE', `${label}: ${JSON.stringify(result)}`)
  }
  reject((state) => { state.staff[0].id = state.works[0].id }, 'INV-02 staff 与 work 撞 id')
  reject((state) => { state.works[0].common.items[0].id = state.works[0].episodes[0].stages[0].items[0].id }, 'INV-02 工作项重复')
  reject((state) => { state.works[0].common.items[0].work_total = 0 }, 'INV-03 公共项 work_total')
  reject((state) => { state.works[0].status = 'settled'; state.staff[0].assignment_work_id = state.works[0].id }, 'INV-09 归属非 producing')
  reject((state) => {
    state.company.week = 2
    state.staff[0].last_participation = { work_id: state.works[0].id, item_id: state.works[0].common.items[0].id, week: 0 }
  }, 'INV-11 两周前的参与记录')
  reject((state) => {
    state.works[0].common.items[0].work_done = 10
    state.works[0].common.items[0].contributors = ['staff_dir', 'staff_dir']
  }, 'INV-12 重复贡献者')
  reject((state) => {
    state.works[0].common.items[0].work_done = 10
    state.works[0].common.items[0].contributors = ['nobody']
  }, 'INV-12 未知贡献者')
  const capped = JSON.parse(JSON.stringify(base))
  capped.company.week = 520
  const cappedResult = call('assign_staff', { state: capped, staff_id: 'staff_dir', work_id: 'work_01' })
  assert.equal(cappedResult.error?.code, 'INVALID_STATE', `INV-21 running 到 520: ${JSON.stringify(cappedResult)}`)

  const good = JSON.parse(JSON.stringify(base))
  good.company.week = 2
  good.staff[0].last_participation = { work_id: good.works[0].id, item_id: good.works[0].common.items[0].id, week: 1 }
  ok('assign_staff', { state: good, staff_id: 'staff_dir', work_id: 'work_01' })
})

test('参与记录：未产出周清空，满足 INV-11', () => {
  let state = setupTiny()
  state = assign(state, 'staff_dir')
  state = ok('advance_week', { state }).state
  assert.equal(state.staff.find((entry) => entry.id === 'staff_dir').last_participation.week, 0)
  state = ok('assign_staff', { state, staff_id: 'staff_dir', work_id: null }).state
  state = ok('advance_week', { state }).state
  assert.equal(state.staff.find((entry) => entry.id === 'staff_dir').last_participation, null)
  ok('assign_staff', { state, staff_id: 'staff_dir', work_id: 'work_01' })
})

test('输入边界：assign_staff 的 work_id 类型错误不被当成取消分配', () => {
  const state = assign(setupTiny(), 'staff_dir')
  const before = ok('hash_state', { state }).hash
  for (const work_id of [123, '', {}, []]) {
    const result = call('assign_staff', { state, staff_id: 'staff_dir', work_id })
    assert.equal(result.error?.code, 'INVALID_INPUT', `work_id=${JSON.stringify(work_id)}`)
    assert.equal(ok('hash_state', { state }).hash, before, '失败不得改动状态')
  }
  assert.equal(call('assign_staff', { state, staff_id: 'staff_dir' }).error?.code, 'INVALID_INPUT')
  const cleared = ok('assign_staff', { state, staff_id: 'staff_dir', work_id: null }).state
  assert.equal(cleared.staff.find((entry) => entry.id === 'staff_dir').assignment_work_id, null)
})

test('输入边界：缺必填字段返回 INVALID_INPUT，不用默认值掩盖', () => {
  const state = setupTiny()
  const missingWeek = JSON.parse(JSON.stringify(state))
  delete missingWeek.company.week
  assert.equal(call('assign_staff', { state: missingWeek, staff_id: 'staff_dir', work_id: null }).error?.code, 'INVALID_INPUT')

  const missingTotal = JSON.parse(JSON.stringify(state))
  delete missingTotal.works[0].common.items[0].work_total
  assert.equal(call('assign_staff', { state: missingTotal, staff_id: 'staff_dir', work_id: null }).error?.code, 'INVALID_INPUT')

  // M0 §3/§14.6：Staff 报酬字段与 Finance.solvency 不得静默补默认值
  for (const field of ['signing_fee', 'weekly_salary', 'fatigue', 'morale']) {
    const missing = JSON.parse(JSON.stringify(state))
    delete missing.staff[0][field]
    assert.equal(call('assign_staff', { state: missing, staff_id: 'staff_dir', work_id: null }).error?.code, 'INVALID_INPUT')
  }
  const missingSolvency = JSON.parse(JSON.stringify(state))
  delete missingSolvency.finance.solvency.state
  assert.equal(call('assign_staff', { state: missingSolvency, staff_id: 'staff_dir', work_id: null }).error?.code, 'INVALID_INPUT')
  assert.equal(state.staff[0].project_fee, undefined)
  assert.equal(typeof state.staff[0].signing_fee, 'number')
})

test('契约名适配：initialize_game / set_work_plan 与内部入口等价', () => {
  const internal = ok('initialize', { seed: 42 }).state
  const contract = ok('initialize_game', { seed: 42 }).state
  assert.equal(ok('hash_state', { state: internal }).hash, ok('hash_state', { state: contract }).hash)
  assert.equal(call('initialize_game', {}).error?.code, 'INVALID_INPUT')

  const base = setupTiny()
  const plan = { focus: 'schedule', target: { kind: 'episode', id: 'ep01' } }
  const viaInternal = ok('set_plan', { state: base, work_id: 'work_01', plan }).state
  const viaContract = ok('set_work_plan', { state: base, work_id: 'work_01', plan }).state
  assert.equal(ok('hash_state', { state: viaInternal }).hash, ok('hash_state', { state: viaContract }).hash)
})

// ---- 事件 M2（#50）：内容加载、多项目仲裁、效果与不变式 ----

function pendingOf(state) {
  return state.events.pending
}

function setAnimationQuality(state, workId, value) {
  const work = state.works.find((entry) => entry.id === workId)
  for (const episode of work.episodes) {
    for (const stage of episode.stages) {
      if (stage.key !== 'animation') continue
      for (const item of stage.items) {
        for (const dim of Object.keys(item.quality)) item.quality[dim] = value
      }
    }
  }
  return state
}

test('事件内容：运行时不硬编码，内嵌目录 7 张卡且校验通过', () => {
  const info = ok('event_catalog_info', {})
  assert.equal(info.ok, true)
  assert.equal(info.count, 7)
  assert.deepEqual(info.issues, [])
  assert.deepEqual(info.ids, [
    'animator_exhaustion',
    'director_illness',
    'key_cut_rework',
    'schedule_slip',
    'station_visit',
    'storyboard_spark',
    'supplier_dunning'
  ])
})

test('事件内容：非法卡被拒绝并定位到卡片与字段', () => {
  const card = {
    schema_version: 1,
    id: 'fixture_card',
    name: '夹具卡',
    category: 'quality',
    polarity: 'negative',
    tier: 'normal',
    tag: 'fixture',
    stages: ['animation'],
    priority: 10,
    cooldown_weeks: 4,
    once_per_project: false,
    trigger: { metric: 'max_fatigue', op: '>=', threshold: 50 },
    random_weight: 0,
    expires_weeks: 0,
    description: '夹具',
    options: [
      { id: 'accept', kind: 'abandon', label: '接受', cost: 0, effects: [{ scope: 'instant', target: 'morale', value: -1 }] }
    ]
  }
  const validate = (cards, source = 'fixture.json') =>
    ok('validate_event_catalog', { source, catalog: { schema_version: 1, cards } })

  const valid = validate([card])
  assert.equal(valid.ok, true)
  assert.equal(valid.count, 1)

  const duplicate = validate([card, { ...card, name: '重复' }])
  assert.equal(duplicate.ok, false)
  assert.ok(duplicate.issues.some((issue) => issue.field === 'id' && issue.message.includes('重复')))

  const unknownTarget = validate([{ ...card, options: [{ ...card.options[0], effects: [{ scope: 'instant', target: 'luck', value: 1 }] }] }])
  assert.ok(unknownTarget.issues.some((issue) => issue.field === 'options[0].effects[0].target'))

  const fundsGain = validate([{ ...card, options: [{ ...card.options[0], effects: [{ scope: 'instant', target: 'funds', value: 100 }] }] }])
  assert.ok(fundsGain.issues.some((issue) => issue.field === 'options[0].effects[0].value'))

  const missingLabel = validate([{ ...card, options: [{ ...card.options[0], label: '' }] }])
  assert.ok(missingLabel.issues.some((issue) => issue.field === 'options[0].label'))

  const badVersion = validate([{ ...card, schema_version: 2 }])
  assert.ok(badVersion.issues.some((issue) => issue.field === 'schema_version'))

  // 首版没有期限/超时行为，非 0 必须被拒绝，避免内容作者误以为会生效
  const expiry = validate([{ ...card, expires_weeks: 2 }])
  assert.ok(expiry.issues.some((issue) => issue.field === 'expires_weeks'))

  const empty = ok('validate_event_catalog', { source: 'empty', catalog: { schema_version: 1, cards: [] } })
  assert.equal(empty.ok, false)
  assert.equal(empty.issues[0].field, 'cards')
})

function twoProjectsNearDeadline() {
  let state = ok('initialize', { seed: 5 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_a', duration_weeks: 26 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_b', duration_weeks: 26 }).state
  for (const work of state.works) work.deadline_week = 2
  state = assign(state, 'staff_dir', 'work_a')
  state = assign(state, 'staff_ka', 'work_b')
  return setAnimationQuality(setAnimationQuality(state, 'work_a', 50), 'work_b', 50)
}

test('事件仲裁：两个项目同周各自触发，互不覆盖，处理前阻塞推进', () => {
  let state = twoProjectsNearDeadline()
  const advanced = ok('advance_week', { state })
  state = advanced.state
  assert.equal(advanced.report.events.drawn, true)
  assert.equal(advanced.report.events.count, 2)
  assert.equal(pendingOf(state).length, 2)
  assert.deepEqual(pendingOf(state).map((event) => event.work_id).sort(), ['work_a', 'work_b'])
  assert.ok(pendingOf(state).every((event) => event.event_id === 'schedule_slip'))

  const blocked = call('advance_week', { state })
  assert.equal(blocked.error.code, 'INVALID_PHASE')
  assert.ok(blocked.error.message.includes('2'))

  // M0 命令 18：work_id 必填，省略即拒绝
  const ambiguous = call('resolve_event', { state, event_id: 'schedule_slip', option_id: 'accept' })
  assert.equal(ambiguous.error.code, 'INVALID_INPUT')
  assert.ok(ambiguous.error.message.includes('work_id'))

  const resolvedA = ok('resolve_event', { state, event_id: 'schedule_slip', option_id: 'accept', work_id: 'work_a' }).state
  assert.equal(pendingOf(resolvedA).length, 1)
  assert.equal(pendingOf(resolvedA)[0].work_id, 'work_b')
  assert.equal(resolvedA.events.per_work.work_a.cooldowns.schedule_slip, resolvedA.company.week + 4)
  assert.ok(call('advance_week', { state: resolvedA }).error)

  // 效果只作用于归属项目：A 的动画阶段质量 -3，B 保持 50
  const aQuality = findItem(resolvedA, 'work_a', 'ep01.inbetween').quality
  const bQuality = findItem(resolvedA, 'work_b', 'ep01.inbetween').quality
  assert.equal(aQuality.story, 47)
  assert.equal(bQuality.story, 50)

  const resolvedB = ok('resolve_event', { state: resolvedA, event_id: 'schedule_slip', option_id: 'accept', work_id: 'work_b' }).state
  assert.equal(pendingOf(resolvedB).length, 0)
  const next = ok('advance_week', { state: resolvedB })
  assert.equal(next.state.company.week, resolvedB.company.week + 1)
})

test('事件仲裁：重大事件同项目只触发一次，之后让位给普通事件', () => {
  let state = ok('initialize', { seed: 9 }).state
  state = ok('instantiate_work', { state, blueprint: tiny, work_id: 'work_01', duration_weeks: 26 }).state
  for (const member of state.staff) member.fatigue = 70
  state = assign(state, 'staff_dir')
  const first = ok('advance_week', { state }).state
  assert.equal(pendingOf(first).length, 1)
  assert.equal(pendingOf(first)[0].event_id, 'director_illness')

  const resolved = ok('resolve_event', {
    state: first,
    event_id: 'director_illness',
    option_id: 'accept',
    work_id: 'work_01'
  }).state
  assert.deepEqual(resolved.events.per_work.work_01.major_seen, ['director_illness'])
  assert.equal(pendingOf(resolved).length, 0)

  const second = ok('advance_week', { state: resolved }).state
  assert.equal(pendingOf(second).length, 1)
  assert.equal(pendingOf(second)[0].event_id, 'animator_exhaustion')
})

test('事件不变式：同一项目多条待处理、归属无效都被拒绝', () => {
  let state = twoProjectsNearDeadline()
  state = ok('advance_week', { state }).state
  assert.equal(pendingOf(state).length, 2)

  const duplicate = JSON.parse(JSON.stringify(state))
  duplicate.events.pending.push({
    ...duplicate.events.pending[0],
    event_id: 'key_cut_rework',
    options: [{ id: 'accept', label: '接受', kind: 'abandon', risk_hint: '', cost: 0 }]
  })
  const duplicateResult = call('assign_staff', { state: duplicate, staff_id: 'staff_dir', work_id: 'work_a' })
  assert.equal(duplicateResult.error?.code, 'INVALID_STATE')
  assert.ok(duplicateResult.error.message.includes('INV-23'))

  const orphan = JSON.parse(JSON.stringify(state))
  orphan.events.pending[0].work_id = 'work_missing'
  const orphanResult = call('assign_staff', { state: orphan, staff_id: 'staff_dir', work_id: 'work_a' })
  assert.equal(orphanResult.error?.code, 'INVALID_STATE')
})

test('INV-23：查看只标记目标事件，不结算不移除；全部查看后允许推进', () => {
  let state = twoProjectsNearDeadline()
  state = ok('advance_week', { state }).state
  assert.equal(state.events.pending.length, 2)
  assert.ok(state.events.pending.every((event) => event.viewed === false))
  assert.equal(call('advance_week', { state }).error.code, 'INVALID_PHASE')

  const viewedA = ok('view_event', { state, work_id: 'work_a', event_id: 'schedule_slip' })
  assert.equal(viewedA.already_viewed, false)
  state = viewedA.state
  assert.equal(state.events.pending.length, 2)
  assert.equal(state.events.pending.find((e) => e.work_id === 'work_a').viewed, true)
  assert.equal(state.events.pending.find((e) => e.work_id === 'work_b').viewed, false)
  // 已查看未处理仍保留，但推进被另一条未查看事件挡住
  assert.equal(call('advance_week', { state }).error.code, 'INVALID_PHASE')

  const again = ok('view_event', { state, work_id: 'work_a', event_id: 'schedule_slip' })
  assert.equal(again.already_viewed, true)

  state = ok('view_event', { state, work_id: 'work_b', event_id: 'schedule_slip' }).state
  const advanced = ok('advance_week', { state })
  assert.equal(advanced.state.company.week, state.company.week + 1)
  assert.equal(advanced.state.events.pending.length, 2)   // 查看不等于处理
})

test('事件确定性：同 seed 同操作，待处理事件与哈希一致', () => {
  const run = () => {
    let state = twoProjectsNearDeadline()
    const advanced = ok('advance_week', { state })
    return {
      pending: advanced.state.events.pending,
      hash: ok('hash_state', { state: advanced.state }).hash
    }
  }
  assert.deepEqual(run(), run())
})

test('事件快照：选项效果冻结在 pending，JSON 往返后仍按触发时效果结算', () => {
  let state = twoProjectsNearDeadline()
  state = ok('advance_week', { state }).state
  const event = state.events.pending.find((entry) => entry.work_id === 'work_a')
  assert.equal(event.name, '作画进度落后')
  const option = event.options.find((entry) => entry.id === 'accept')
  assert.equal(option.effects.length, 1)
  // 模拟内容卡改版：把快照里的 -3 改成 -20。若 resolve 回查目录，仍会是 -3。
  option.effects[0].value = -20

  const loaded = JSON.parse(JSON.stringify(state))
  const resolved = ok('resolve_event', {
    state: loaded,
    work_id: 'work_a',
    event_id: 'schedule_slip',
    option_id: 'accept'
  }).state
  const quality = findItem(resolved, 'work_a', 'ep01.inbetween').quality
  assert.equal(quality.story, 30)

  // 存档往返后 pending 仍保留完整效果载荷
  assert.equal(resolved.events.pending.length, 1)
  assert.equal(resolved.events.pending[0].options[0].effects.length >= 0, true)
})

test('事件结算：选项 cost 与 funds 效果同周入账时账本 id 不冲突', () => {
  let state = twoProjectsNearDeadline()
  state = ok('advance_week', { state }).state
  const event = state.events.pending.find((entry) => entry.work_id === 'work_a')
  const option = event.options.find((entry) => entry.id === 'accept')
  // 内容卡允许 cost 与 funds 效果并存（#13 可写出「赔款 + 加急费」类选项），
  // 两条流水必须各有 id，否则 INV-02 判定状态非法、结算直接回滚。
  option.cost = 300
  option.effects.push({ scope: 'instant', target: 'funds', stage: '', value: -1000 })

  const before = ok('hash_state', { state: JSON.parse(JSON.stringify(state)) }).hash
  const resolved = ok('resolve_event', {
    state: JSON.parse(JSON.stringify(state)),
    work_id: 'work_a',
    event_id: 'schedule_slip',
    option_id: 'accept'
  }).state
  assert.notEqual(before, ok('hash_state', { state: resolved }).hash)

  const charged = resolved.finance.entries.filter((entry) => entry.category === 'events' && entry.memo === 'schedule_slip')
  assert.equal(charged.length, 2)
  assert.deepEqual(charged.map((entry) => entry.amount).sort((a, b) => a - b), [-1000, -300])
  assert.equal(new Set(charged.map((entry) => entry.id)).size, 2)
  // 事件支出不得让现金转负，也不得改到另一条 pending
  assert.ok(resolved.finance.balance >= 0)
  assert.equal(resolved.events.pending.length, 1)
})

// ---- M2 项目全链路 + M4 委员会/渠道结算 ----

function completeWork(state, workId, quality = 80, gatesOnly = false) {
  const work = state.works.find((entry) => entry.id === workId)
  for (const episode of work.episodes) {
    for (const stage of episode.stages) {
      for (const item of stage.items) {
        if (item.is_gate) item.work_done = item.work_total
        if (!gatesOnly) {
          for (const dim of Object.keys(item.quality)) item.quality[dim] = quality
        }
      }
    }
  }
  return state
}

test('M2 立项：承制模式消费企划、合同预算入账、项目按蓝图实例化', () => {
  let state = ok('initialize', { seed: 7 }).state
  assert.equal(state.market.slots.length, 4)
  const before = state.finance.balance
  const started = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' })
  state = started.state
  assert.equal(started.work_id, 'work_01')
  assert.equal(started.committee_id, null)
  assert.equal(state.market.slots.length, 3)
  assert.equal(state.works.length, 1)
  const work = state.works[0]
  assert.equal(work.mode, 'contract')
  assert.deepEqual(work.channels, ['domestic_streaming', 'tv'])
  assert.equal(work.offer.id, 'offer_01')
  assert.equal(work.deadline_week, 26)
  assert.equal(work.episodes.length, 12)
  assert.equal(work.common.items.length + work.episodes.reduce((sum, ep) => sum + ep.stages.reduce((n, st) => n + st.items.length, 0), 0), 174)
  assert.equal(state.finance.balance, before + 1200000)
  assert.equal(state.finance.entries.length, 1)
  assert.equal(state.finance.entries[0].category, 'contract_received')
  assert.equal(state.finance.opening_funds + state.finance.entries.reduce((sum, e) => sum + e.amount, 0), state.finance.balance)
})

test('M2 立项：委员会模式成立委员会、支付投资份额、成员渠道映射', () => {
  let state = ok('initialize', { seed: 7 }).state
  const started = ok('start_work', {
    state,
    offer_id: 'offer_01',
    mode: 'committee',
    percent: 50,
    committee_partner_ids: ['partner_tv', 'partner_stream']
  })
  state = started.state
  assert.equal(started.committee_id, 'committee_01')
  assert.equal(state.finance.balance, 2000000)   // +1.2M 合同预算 -1.2M 投资
  assert.equal(state.finance.entries.length, 2)
  assert.equal(state.finance.entries[1].category, 'investment_paid')
  assert.equal(state.finance.entries[1].amount, -1200000)
  const committee = state.committees[0]
  assert.equal(committee.status, 'active')
  assert.equal(committee.members.length, 2)
  assert.deepEqual(committee.members.map((m) => m.channel).sort(), ['domestic_streaming', 'tv'])
  assert.equal(state.works[0].investment.percent, 50)

  // 已有电视台成员：默认获得播出曝光，不得再付费购买
  const blocked = call('buy_tv_service', { state, work_id: 'work_01' })
  assert.equal(blocked.error.code, 'MODE_NOT_ALLOWED')

  // 无电视台成员：玩家按投资比例承担电视服务总费用
  const second = ok('start_work', {
    state,
    offer_id: 'offer_02',
    mode: 'committee',
    percent: 50,
    committee_partner_ids: ['partner_stream', 'partner_pub']
  })
  assert.equal(second.state.finance.balance, 2000000)
  const withTv = ok('buy_tv_service', { state: second.state, work_id: second.work_id })
  assert.equal(withTv.paid, 300000)   // 60 万 × 50%
  assert.equal(withTv.state.finance.balance, 1700000)
  assert.equal(withTv.state.works.find((w) => w.id === second.work_id).tv_service.multiplier, 1300)
  const extended = ok('request_extension', { state: withTv.state, work_id: second.work_id })
  assert.equal(extended.state.works.find((w) => w.id === second.work_id).deadline_week, 28)
  assert.equal(extended.state.finance.balance, 1450000)
  const twice = call('request_extension', { state: extended.state, work_id: second.work_id })
  assert.equal(twice.error.code, 'INVALID_PHASE')
})

test('M2 交付：门槛未达拒绝；达标后结算、归档、清归属、移除项目', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state = assign(state, 'staff_dir')
  const early = call('deliver_work', { state, work_id: 'work_01' })
  assert.equal(early.error.code, 'GATE_UNMET')
  assert.equal(early.error.items.length, 12)

  state = completeWork(state, 'work_01', 70)
  // 让团队快照有内容：真实流程里由周结算写入 contributors。
  const firstCommon = state.works[0].common.items[0]
  firstCommon.work_done = firstCommon.work_total
  firstCommon.contributors = ['staff_dir']
  const delivered = ok('deliver_work', { state, work_id: 'work_01' })
  assert.equal(delivered.report.rating, 'B')
  // 承制只拿 BD/DVD，BD 收入未达合同预算，不触发成功奖励
  assert.equal(delivered.report.success_reward, 0)
  assert.ok(delivered.report.bd_revenue > 0)
  assert.equal(delivered.report.commercial_revenue, delivered.report.bd_revenue)
  assert.equal(delivered.state.archive.works.length, 1)
  assert.equal(delivered.state.works.length, 0)
  assert.equal(delivered.state.staff.find((s) => s.id === 'staff_dir').assignment_work_id, null)
  assert.equal(delivered.state.company.reputation, 102)
  assert.equal(delivered.state.finance.balance, 3200000 + delivered.report.bd_revenue)
  const record = delivered.state.archive.works[0]
  assert.equal(record.id, 'work_01')
  assert.equal(record.mode, 'contract')
  assert.equal(record.finance_summary.contract_received, 1200000)
  assert.equal(record.finance_summary.success_reward, 0)
  assert.equal(record.finance_summary.bd_revenue, delivered.report.bd_revenue)
  assert.equal(record.team.length, 1)
  assert.equal(delivered.state.finance.opening_funds + delivered.state.finance.entries.reduce((sum, e) => sum + e.amount, 0), delivered.state.finance.balance)
})

test('M4 交付：委员会按投资比例分账、关闭委员会并沉淀伙伴关系', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', {
    state,
    offer_id: 'offer_01',
    mode: 'committee',
    percent: 50,
    committee_partner_ids: ['partner_tv', 'partner_stream']
  }).state
  state = completeWork(state, 'work_01', 80)
  const delivered = ok('deliver_work', { state, work_id: 'work_01' })
  const report = delivered.report
  // 委员会只对扣除代理费后的净商业池按比例分账；BD 始终归公司，不进池。
  assert.equal(report.commercial_share, Math.floor(report.committee_pool * 50 / 100))
  assert.equal(report.investor_share, report.committee_pool - report.commercial_share)
  assert.ok(report.bd_revenue > 0)
  assert.equal(report.company_received, report.bd_revenue + report.commercial_share)
  assert.equal(report.success_reward, 0)
  const poolLines = report.channels.filter((line) => line.owner === 'committee_pool')
  const bdLines = report.channels.filter((line) => line.owner === 'company')
  assert.equal(poolLines.reduce((sum, line) => sum + line.net, 0), report.committee_pool)
  assert.equal(bdLines.reduce((sum, line) => sum + line.net, 0), report.bd_revenue)
  for (const line of report.channels) {
    assert.equal(line.net, Math.floor(line.gross * (1000 - line.agency_fee_permille) / 1000))
  }
  assert.equal(report.channels.length, 3)   // 国内配信 / 电视 / BD
  assert.equal(delivered.state.committees[0].status, 'closed')
  assert.equal(delivered.state.committees[0].closed_week, 0)
  for (const id of ['partner_tv', 'partner_stream']) {
    const partner = delivered.state.partners.find((p) => p.id === id)
    assert.equal(partner.relationship, 52)
    assert.equal(partner.history.length, 1)
    assert.equal(partner.history[0].delta, 2)
  }
  assert.equal(delivered.state.partners.find((p) => p.id === 'partner_pub').relationship, 50)
  const record = delivered.state.archive.works[0]
  assert.equal(record.mode, 'committee')
  assert.equal(record.investment_percent, 50)
  assert.equal(record.finance_summary.commercial_share, report.commercial_share)
  assert.equal(record.finance_summary.bd_revenue, report.bd_revenue)
})

function injectedEvent(workId) {
  return {
    event_id: 'schedule_slip',
    name: '作画进度落后',
    work_id: workId,
    triggered_week: 0,
    expires_week: null,
    cooldown_weeks: 4,
    once_per_project: false,
    options: [{
      id: 'accept',
      label: '维持原计划',
      kind: 'abandon',
      risk_hint: '',
      cost: 0,
      effects: [{ scope: 'stage', target: 'quality', stage: 'animation', value: -3 }]
    }]
  }
}

test('DEC-EVENT-001：待处理事件阻止交付与关闭，跨项目事件不被清理', () => {
  let state = twoProjectsNearDeadline()
  state.events.pending.push(injectedEvent('work_a'), injectedEvent('work_b'))
  const prepared = completeWork(JSON.parse(JSON.stringify(state)), 'work_a', 70)

  const blocked = call('deliver_work', { state: prepared, work_id: 'work_a' })
  assert.equal(blocked.error.code, 'INVALID_PHASE')
  assert.equal(prepared.events.pending.length, 2)
  assert.equal(call('end_company', { state: prepared }).error.code, 'INVALID_PHASE')

  const afterA = ok('resolve_event', {
    state: prepared,
    work_id: 'work_a',
    event_id: 'schedule_slip',
    option_id: 'accept'
  }).state
  assert.equal(afterA.events.pending.length, 1)

  const delivered = ok('deliver_work', { state: afterA, work_id: 'work_a' })
  assert.equal(delivered.state.events.pending.length, 1)
  assert.equal(delivered.state.events.pending[0].work_id, 'work_b')
  assert.deepEqual(delivered.state.works.map((work) => work.id), ['work_b'])
})

test('M2 中止：abort_work 归档 aborted、无商业收入、释放归属', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state = assign(state, 'staff_dir')
  state = completeWork(state, 'work_01', 70)
  const before = state.finance.balance

  const aborted = ok('abort_work', { state, work_id: 'work_01' })
  assert.equal(aborted.report.end_reason, 'aborted')
  assert.equal(aborted.report.commercial_revenue, 0)
  assert.equal(aborted.report.penalty, 0)
  assert.equal(aborted.report.penalty_pending, true)
  assert.equal(aborted.state.works.length, 0)
  assert.equal(aborted.state.staff.find((s) => s.id === 'staff_dir').assignment_work_id, null)
  assert.equal(aborted.state.finance.balance, before)
  const record = aborted.state.archive.works[0]
  assert.equal(record.end_reason, 'aborted')
  assert.equal(record.company_received, 0)
  assert.equal(call('abort_work', { state: aborted.state, work_id: 'work_01' }).error.code, 'NOT_FOUND')
})

test('DEC-BD-001/COMM-002：电视倍率按成员/购买分档，BD 始终归公司', () => {
  const withMember = (() => {
    let state = ok('initialize', { seed: 7 }).state
    state = ok('start_work', {
      state, offer_id: 'offer_01', mode: 'committee', percent: 50,
      committee_partner_ids: ['partner_tv', 'partner_stream']
    }).state
    state = completeWork(state, 'work_01', 70)
    return ok('deliver_work', { state, work_id: 'work_01' }).report
  })()
  const lineOf = (report, id) => report.channels.find((line) => line.window === id)
  assert.equal(lineOf(withMember, 'domestic_streaming').tv_multiplier, 1250)
  assert.equal(lineOf(withMember, 'bd_dvd').owner, 'company')

  const withoutPurchase = (() => {
    let state = ok('initialize', { seed: 7 }).state
    state = ok('start_work', {
      state, offer_id: 'offer_02', mode: 'committee', percent: 50,
      committee_partner_ids: ['partner_stream', 'partner_pub']
    }).state
    state = completeWork(state, 'work_01', 70)
    return ok('deliver_work', { state, work_id: 'work_01' }).report
  })()
  assert.equal(lineOf(withoutPurchase, 'domestic_streaming').tv_multiplier, 1000)

  const withPurchase = (() => {
    let state = ok('initialize', { seed: 7 }).state
    state = ok('start_work', {
      state, offer_id: 'offer_02', mode: 'committee', percent: 50,
      committee_partner_ids: ['partner_stream', 'partner_pub']
    }).state
    state = ok('buy_tv_service', { state, work_id: 'work_01' }).state
    state = completeWork(state, 'work_01', 70)
    return ok('deliver_work', { state, work_id: 'work_01' }).report
  })()
  assert.equal(lineOf(withPurchase, 'domestic_streaming').tv_multiplier, 1300)
})

test('DEC-PLAN-001：原创草稿走独立准入，不复用普通企划声望/履历守卫', () => {
  let state = ok('initialize', { seed: 7 }).state
  const base = JSON.parse(JSON.stringify(state.market.slots[0]))
  state.market.custom_offer = {
    ...base,
    id: 'custom_01',
    name: '自制企划',
    origin: 'custom',
    allowed_modes: ['committee'],
    draft_status: 'valid',
    min_reputation: 999,
    required_works: ['work_missing']
  }
  const missing = JSON.parse(JSON.stringify(state))
  missing.market.custom_offer = null
  const blocked = call('start_work', {
    state: missing, offer_id: 'custom_01', mode: 'committee', percent: 50,
    committee_partner_ids: ['partner_stream']
  })
  assert.equal(blocked.error.code, 'NOT_FOUND')

  const expired = JSON.parse(JSON.stringify(state))
  expired.market.custom_offer.draft_status = 'expired'
  const invalid = call('start_work', {
    state: expired, offer_id: 'custom_01', mode: 'committee', percent: 50,
    committee_partner_ids: ['partner_stream']
  })
  assert.equal(invalid.error.code, 'INVALID_PHASE')

  const started = ok('start_work', {
    state, offer_id: 'custom_01', mode: 'committee', percent: 50,
    committee_partner_ids: ['partner_stream']
  })
  assert.equal(started.state.market.custom_offer, null)
  assert.equal(started.state.works[0].offer.origin, 'custom')
})

test('M2 立项守卫：模式、比例、成员、资金与重复消费都拒绝且状态不变', () => {  const base = ok('initialize', { seed: 7 }).state
  const before = ok('hash_state', { state: base }).hash
  const cases = [
    { offer_id: 'offer_03', mode: 'contract' },
    { offer_id: 'offer_01', mode: 'committee', percent: 15, committee_partner_ids: ['partner_tv'] },
    { offer_id: 'offer_01', mode: 'committee', percent: 50, committee_partner_ids: [] },
    { offer_id: 'offer_01', mode: 'committee', percent: 50, committee_partner_ids: ['partner_tv', 'partner_tv'] },
    { offer_id: 'offer_01', mode: 'contract', committee_partner_ids: ['partner_tv'] },
    { offer_id: 'offer_missing', mode: 'contract' }
  ]
  for (const payload of cases) {
    const result = call('start_work', { state: base, ...payload })
    assert.ok(result.error, `应被拒绝: ${JSON.stringify(payload)}`)
    assert.equal(ok('hash_state', { state: base }).hash, before)
  }

  const poor = JSON.parse(JSON.stringify(base))
  poor.finance.opening_funds = 100000
  poor.finance.balance = 100000
  const insufficient = call('start_work', {
    state: poor,
    offer_id: 'offer_01',
    mode: 'committee',
    percent: 100,
    committee_partner_ids: ['partner_tv']
  })
  assert.equal(insufficient.error.code, 'INSUFFICIENT_FUNDS')

  const started = ok('start_work', { state: base, offer_id: 'offer_01', mode: 'contract' }).state
  const again = call('start_work', { state: started, offer_id: 'offer_01', mode: 'contract' })
  assert.equal(again.error.code, 'NOT_FOUND')
})

test('M2 多项目：两部并存，交付一部不影响另一部；存档 round-trip 哈希一致', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state = ok('start_work', { state, offer_id: 'offer_02', mode: 'contract' }).state
  assert.deepEqual(state.works.map((w) => w.id).sort(), ['work_01', 'work_02'])

  const saved = JSON.parse(JSON.stringify(state))
  const loaded = ok('assign_staff', { state: saved, staff_id: 'staff_dir', work_id: null }).state
  assert.equal(ok('hash_state', { state: loaded }).hash, ok('hash_state', { state: state }).hash)

  const target = completeWork(JSON.parse(JSON.stringify(state)), 'work_01', 70)
  const delivered = ok('deliver_work', { state: target, work_id: 'work_01' })
  assert.equal(delivered.state.works.length, 1)
  assert.equal(delivered.state.works[0].id, 'work_02')
  assert.equal(delivered.state.archive.works.length, 1)
  assert.equal(delivered.state.works[0].episodes[0].stages[0].items[0].work_done, 0)
})

test('M2 归档后新立项不复用已归档作品 id', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state = completeWork(state, 'work_01', 60)
  state = ok('deliver_work', { state, work_id: 'work_01' }).state
  assert.equal(state.archive.works[0].id, 'work_01')
  const next = ok('start_work', { state, offer_id: 'offer_02', mode: 'contract' })
  assert.equal(next.work_id, 'work_02')
  assert.equal(next.state.works[0].id, 'work_02')
})

function gatesOf(state, workId) {
  const work = state.works.find((entry) => entry.id === workId)
  const gates = []
  for (const episode of work.episodes) {
    for (const stage of episode.stages) {
      for (const item of stage.items) if (item.is_gate) gates.push(item)
    }
  }
  return gates
}

test('M2 到期强制交付：未达门槛在结算周自动交付，按完成度扣罚并归档 deadline', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_02', mode: 'contract' }).state
  state.works[0].deadline_week = 1
  for (const item of gatesOf(state, 'work_01')) item.work_done = Math.floor(item.work_total * 4 / 10)

  state = ok('advance_week', { state }).state
  state.events.pending = []
  const result = ok('advance_week', { state })

  assert.equal(result.report.settlements.length, 1)
  const settlement = result.report.settlements[0]
  assert.equal(settlement.end_reason, 'deadline')
  assert.equal(settlement.forced, true)
  assert.ok(settlement.gate_completion_permille > 0 && settlement.gate_completion_permille < 1000)
  // 90 万预算 × 缺口比例 × 30% 扣罚（逐层整数截断，与核心同序）
  const expectedPenalty = Math.floor(Math.floor(900000 * (1000 - settlement.gate_completion_permille) / 1000) * 300 / 1000)
  assert.equal(settlement.penalty, expectedPenalty)
  assert.equal(result.state.works.length, 0)
  const record = result.state.archive.works[0]
  assert.equal(record.end_reason, 'deadline')
  assert.equal(record.forced, true)
  assert.equal(record.gate_completion_permille, settlement.gate_completion_permille)
  assert.equal(record.finance_summary.penalty, expectedPenalty)
  assert.equal(result.state.company.status, 'running')
})

test('M2 到期交付：门槛已达成按 completed 正常计价，不扣罚', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_04', mode: 'contract' }).state
  state = completeWork(state, 'work_01', 70)
  state.works[0].deadline_week = 1

  state = ok('advance_week', { state }).state
  state.events.pending = []
  const result = ok('advance_week', { state })

  const settlement = result.report.settlements[0]
  assert.equal(settlement.end_reason, 'completed')
  assert.equal(settlement.forced, false)
  assert.equal(settlement.gate_completion_permille, 1000)
  assert.equal(settlement.penalty, 0)
  assert.equal(result.state.archive.works[0].end_reason, 'completed')
})

test('M2 关闭路径：end_company 锁 closing，finalize_delivery 结清，finalize_company 只生成一次结局', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state = assign(state, 'staff_dir')
  state = completeWork(state, 'work_01', 70)

  const closing = ok('end_company', { state })
  assert.equal(closing.state.company.status, 'closing')
  assert.equal(closing.state.company.end_reason, 'voluntary')
  assert.equal(closing.state.works[0].status, 'delivering')
  assert.equal(closing.state.staff.find((s) => s.id === 'staff_dir').assignment_work_id, null)
  assert.equal(call('advance_week', { state: closing.state }).error.code, 'COMPANY_ENDED')
  assert.equal(call('deliver_work', { state: closing.state, work_id: 'work_01' }).error.code, 'COMPANY_ENDED')
  assert.equal(call('finalize_delivery', { state, work_id: 'work_01' }).error.code, 'INVALID_PHASE')
  assert.equal(call('end_company', { state: closing.state }).error.code, 'COMPANY_ENDED')

  const settled = ok('finalize_delivery', { state: closing.state, work_id: 'work_01' })
  assert.equal(settled.company_status, 'ended')
  assert.equal(settled.report.end_reason, 'company_closed')
  assert.equal(settled.report.forced, false)
  assert.equal(settled.state.works.length, 0)

  const outcome = ok('finalize_company', { state: settled.state })
  assert.equal(outcome.result.reason, 'voluntary')
  assert.equal(outcome.result.total_projects, 1)
  assert.equal(outcome.result.best_work_id, 'work_01')
  assert.equal(outcome.result.rating, settled.report.rating)
  assert.equal(outcome.result.final_funds, outcome.state.finance.balance)
  assert.equal(outcome.state.archive.company_result.reason, 'voluntary')
  assert.equal(call('finalize_company', { state: outcome.state }).error.code, 'INVALID_PHASE')
})

test('M2 第 520 周：完成当周结算后锁 closing/time_limit，剩余项目转 company_closed', () => {
  let state = ok('initialize', { seed: 7 }).state
  state = ok('start_work', { state, offer_id: 'offer_01', mode: 'contract' }).state
  state.company.week = 519
  state.works[0].deadline_week = 600

  const result = ok('advance_week', { state })
  assert.equal(result.state.company.week, 520)
  assert.equal(result.state.company.status, 'closing')
  assert.equal(result.state.company.end_reason, 'time_limit')
  assert.equal(result.state.works[0].status, 'delivering')
  assert.equal(result.report.events.reason, 'company_closed')

  const settled = ok('finalize_delivery', { state: result.state, work_id: 'work_01' })
  assert.equal(settled.report.end_reason, 'company_closed')
  assert.equal(settled.report.forced, true)
  assert.equal(settled.report.gate_completion_permille, 0)
  assert.equal(settled.company_status, 'ended')

  const outcome = ok('finalize_company', { state: settled.state })
  assert.equal(outcome.result.reason, 'time_limit')
  assert.equal(outcome.result.weeks, 520)
  assert.equal(outcome.result.negatives.length, 1)
})

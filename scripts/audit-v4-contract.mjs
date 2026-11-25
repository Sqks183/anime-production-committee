#!/usr/bin/env node
// v4 契约形状审计（#53）：把 docs/v4-contract-shape.json 与真实 WASM 输出逐字段比对。
//
// 为什么需要它：M0 冻结的是文档表格，文档说"已冻结"不等于代码就是这个形状。
// 本脚本双向检查——字段消失、字段新增、契约要求的字段被悄悄实现，都会红。
//
// 用法：npm run build:v4 && npm run audit:v4
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shape = JSON.parse(readFileSync(join(root, 'docs', 'v4-contract-shape.json'), 'utf8'))
const factory = (await import(pathToFileURL(join(root, 'build', 'v4', 'v4.mjs')).href)).default
const core = await factory()

const failures = []
const fail = (msg) => failures.push(msg)
const call = (name, payload) => JSON.parse(core[name](JSON.stringify(payload)))
const unwrap = (name, payload) => {
  const result = call(name, payload)
  if (result.error) throw new Error(`${name} 失败: ${result.error.code} ${result.error.message}`)
  return result
}

// ---- 采集一次覆盖事件闭环的真实运行（轻量夹具，避免长周期把现金烧穿） ----
const tinyBlueprint = {
  schema_version: 1,
  id: 'audit_tiny',
  name: '审计夹具',
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
const init = unwrap('initialize_game', { seed: 20261126 })
const created = unwrap('instantiate_work', { state: init.state, blueprint: tinyBlueprint, work_id: 'work_audit', duration_weeks: 26 })
const assigned = unwrap('assign_staff', {
  state: created.state,
  staff_id: created.state.staff.find((person) => person.role === 'director').id,
  work_id: 'work_audit'
})
let state = assigned.state
// 形状审计要跑满"触发 → 查看 → 处理（带支出）"闭环，不能被周固定成本在第 9 周上下把现金烧穿；
// 同时保持 INV-16 恒等式（balance = opening_funds + Σentries），所以期初与余额同额抬升。
state.finance.opening_funds += 50_000_000
state.finance.balance += 50_000_000
const funded = call('hash_state', { state })
if (funded.error) fail(`抬升现金后的状态未通过校验：${funded.error.code} ${funded.error.message}`)

let pendingState = null
let drawnReport = null
let viewReceipt = null
let resolveReceipt = null
for (let week = 0; week < 24; week++) {
  for (const pending of state.events.pending.filter((event) => !event.viewed)) {
    if (!pendingState) pendingState = structuredClone(state)
    viewReceipt = unwrap('view_event', { state, work_id: pending.work_id, event_id: pending.event_id })
    state = viewReceipt.state
    // 选一个真要花钱的选项，才能覆盖事件的 funds 效果与 events 账本类目。
    const paid = pending.options.slice().sort((a, b) => b.cost - a.cost)[0]
    if (paid && paid.cost > 0) {
      resolveReceipt = unwrap('resolve_event', {
        state,
        work_id: pending.work_id,
        event_id: pending.event_id,
        option_id: paid.id
      })
      state = resolveReceipt.state
    }
  }
  const result = unwrap('advance_week', { state })
  state = result.state
  if (result.report.events.drawn && !drawnReport) drawnReport = result.report
  if (state.finance.entries.some((entry) => entry.category === 'events')) break
}
if (!drawnReport) fail('24 周内未触发任何事件，无法审计事件回执形状（检查 seed 或内容目录）')
if (!pendingState) fail('未捕获到含 pending 事件的样例状态，事件字段形状无法审计')
if (!viewReceipt || !resolveReceipt) fail('未走通"查看 + 处理（付费选项）"闭环，事件回执与 events 账本类目无法审计')

// ---- 1. 命令导出集合 ----
const v4Exports = shape.commands.exported.filter((name) => typeof core[name] === 'function')
const missingExports = shape.commands.exported.filter((name) => typeof core[name] !== 'function')
const unexpectedExports = v4Exports.filter(
  (name) => !shape.commands.exported.includes(name)
)
const leakedCommands = shape.commands.documented_not_exported.filter((name) => typeof core[name] === 'function')
if (missingExports.length) fail(`核心缺少已登记入口：${missingExports.join(', ')}`)
if (unexpectedExports.length) fail(`核心新增未登记入口：${unexpectedExports.join(', ')}`)
if (leakedCommands.length) fail(`M0 §5 未实现命令已出现入口，请同步数据字典 §4：${leakedCommands.join(', ')}`)

// ---- 2. 状态/回执键树 ----
// events.per_work / cooldowns 的键是 work_id / event_id（业务数据，不是字段名），
// 归一化成 `*` 再登记，否则形状表会随每次运行的 id 变化而误报。
function collect(node, path, out) {
  if (Array.isArray(node)) {
    for (const element of node) collect(element, `${path}[]`, out)
    return
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node)
    if (keys.length === 0) return
    if (shape.dynamic_key_maps.includes(path)) {
      for (const key of keys) collect(node[key], `${path}.*`, out)
      return
    }
    const previous = out.get(path) || new Set()
    for (const key of keys) previous.add(key)
    out.set(path, previous)
    for (const key of keys) collect(node[key], `${path}.${key}`, out)
    return
  }
}

const observed = new Map()
collect(state, 'state', observed)
collect(pendingState, 'state', observed)
collect(drawnReport, 'report', observed)
const dynamic = new Set(shape.dynamic_key_maps)
const golden = shape.paths
for (const [path, keys] of Object.entries(shape.optional_paths || {})) {
  const actual = observed.get(path)
  if (!actual) continue
  const expected = new Set(keys)
  const added = [...actual].filter((key) => !expected.has(key))
  const removed = keys.filter((key) => !actual.has(key))
  if (added.length) fail(`未登记字段 ${path}: ${added.sort().join(', ')}`)
  if (removed.length) fail(`字段消失 ${path}: ${removed.join(', ')}`)
}
for (const [path, keys] of Object.entries(golden)) {
  const actual = observed.get(path)
  if (!actual) {
    fail(`形状缺失：${path}（期望键 ${keys.join(', ')}）`)
    continue
  }
  const expected = new Set(keys)
  const added = [...actual].filter((key) => !expected.has(key))
  const removed = keys.filter((key) => !actual.has(key))
  if (added.length) fail(`未登记字段 ${path}: ${added.sort().join(', ')}`)
  if (removed.length) fail(`字段消失 ${path}: ${removed.join(', ')}`)
}
for (const [path, actual] of observed) {
  if (golden[path] || shape.optional_paths?.[path] || dynamic.has(path)) continue
  fail(`未登记的对象路径 ${path}: ${[...actual].sort().join(', ')}`)
}

// ---- 3. 解析必填（decode_state 的 require 清单） ----
const requiredProbes = {
  state: () => ({}),
  'state.company': (s) => delete s.company,
  'state.staff': (s) => delete s.staff,
  'state.works': (s) => delete s.works,
  'state.finance': (s) => delete s.finance,
  'state.events': (s) => delete s.events,
  'state.events.pending': (s) => delete s.events.pending,
  'state.events.pending[].viewed': (s) => delete s.events.pending[0].viewed
}
for (const path of shape.required_on_parse) {
  const mutate = requiredProbes[path]
  if (!mutate) {
    fail(`必填清单含未编写的探针：${path}`)
    continue
  }
  if (path === 'state') {
    const result = call('hash_state', {})
    if (!result.error || result.error.code !== 'INVALID_INPUT') {
      fail(`缺少必填字段 state 未被拒绝（实际：${result.error ? result.error.code : '成功返回'}）`)
    }
    continue
  }
  const base = structuredClone(path.includes('pending') ? pendingState : state)
  if (path.includes('pending[]') && !base.events.pending.length) {
    fail('探针需要含 pending 事件的样例状态，但本次运行没有')
    continue
  }
  mutate(base)
  const result = call('hash_state', { state: base })
  if (!result.error || result.error.code !== 'INVALID_INPUT') {
    fail(`缺少必填字段 ${path} 未被拒绝（实际：${result.error ? result.error.code : '成功返回'}）`)
  }
}

// ---- 4. 命令回执键 ----
const receipts = {
  initialize_game: Object.keys(init).filter((key) => key !== 'error'),
  instantiate_work: Object.keys(created).filter((key) => key !== 'error'),
  set_work_plan: Object.keys(unwrap('set_work_plan', {
    state,
    work_id: 'work_audit',
    plan: { intensity: 'standard', focus: 'quality', outsourcing: 'gap_fill', overtime: false, target: null }
  })).filter((key) => key !== 'error'),
  assign_staff: Object.keys(assigned).filter((key) => key !== 'error'),
  advance_week: ['report', 'state'],
  hash_state: Object.keys(unwrap('hash_state', { state })).filter((key) => key !== 'error')
}
if (viewReceipt) receipts.view_event = Object.keys(viewReceipt).filter((key) => key !== 'error')
if (resolveReceipt) receipts.resolve_event = Object.keys(resolveReceipt).filter((key) => key !== 'error')
for (const [command, expected] of Object.entries(shape.receipt_keys)) {
  const actual = receipts[command]
  if (!actual) {
    fail(`回执未采集：${command}`)
    continue
  }
  if (actual.slice().sort().join(',') !== expected.slice().sort().join(',')) {
    fail(`回执键不一致 ${command}: 期望 [${expected.join(', ')}] 实际 [${actual.sort().join(', ')}]`)
  }
}

// ---- 5. initialize_game 的空聚合（§3.10 缺口登记） ----
for (const [path, expected] of Object.entries(shape.empty_at_initialize)) {
  const actual = path.split('.').slice(1).reduce((node, key) => (node == null ? node : node[key]), init.state)
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) {
    fail(`初始化聚合已变化 ${path}: 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)?.slice(0, 120)}`)
  }
}

// ---- 6. 契约要求但未实现 / 代码多余 ----
const fieldPresent = (path, field) => {
  const node = observed.get(path)
  return Boolean(node && node.has(field))
}
for (const item of shape.contract_required_missing) {
  if (fieldPresent(item.path, item.field)) {
    fail(`契约字段 ${item.path}.${item.field} 已实现（${item.ref}）：请把它移入 paths 并更新数据字典`)
  }
}
for (const item of shape.code_extra_fields) {
  if (!fieldPresent(item.path, item.field)) {
    fail(`超契约字段 ${item.path}.${item.field} 已移除（${item.ref}）：请更新 shape 与数据字典 §3/§8`)
  }
}

// ---- 7. 账本约定 ----
const categories = new Set(state.finance.entries.map((entry) => entry.category))
for (const category of shape.ledger.categories_produced) {
  if (!categories.has(category)) fail(`账本类目未出现：${category}（本次运行产出 ${[...categories].sort().join(', ')}）`)
}
for (const category of categories) {
  if (!shape.ledger.categories_frozen.includes(category)) fail(`未冻结的账本类目：${category}`)
}
const badIds = state.finance.entries.filter(
  (entry) => !/^w\d+\.(salary\.|operations$|production\.|event\.)/.test(entry.id)
)
if (badIds.length) fail(`账本 id 不符合约定前缀：${badIds.slice(0, 3).map((entry) => entry.id).join(', ')}`)
const ids = state.finance.entries.map((entry) => entry.id)
if (new Set(ids).size !== ids.length) fail('账本 id 重复（INV-02）')

// ---- 8. 不变式与错误码（源码侧） ----
const v4Sources = ['runtime.cpp', 'event.cpp', 'kernel.cpp', 'model.cpp']
  .map((name) => readFileSync(join(root, 'packages', 'game-core', 'src', 'v4', name), 'utf8'))
  .join(String.fromCharCode(10))
const runtimeSource = readFileSync(join(root, 'packages', 'game-core', 'src', 'v4', 'runtime.cpp'), 'utf8')
const asserted = [...new Set(runtimeSource.match(/INV-\d{2}/g) || [])].sort()
if (asserted.join(',') !== shape.invariants.asserted_in_validate.slice().sort().join(',')) {
  const added = asserted.filter((tag) => !shape.invariants.asserted_in_validate.includes(tag))
  const gone = shape.invariants.asserted_in_validate.filter((tag) => !asserted.includes(tag))
  if (added.length) fail(`新增不变式断言未登记：${added.join(', ')}`)
  if (gone.length) fail(`不变式断言消失：${gone.join(', ')}`)
}
if (shape.invariants.declared_total !== 29) fail('数据字典声明的不变式总数应为 29（M0 §4）')
const codesInSource = [...new Set(v4Sources.match(/"(?:[A-Z][A-Z_]{3,})"/g) || [])].map((text) => text.replaceAll('"', ''))
const unknownCodes = codesInSource.filter((code) => !shape.error_codes.documented.includes(code))
if (unknownCodes.length) fail(`核心产生了 M0 §6 未登记的错误码：${unknownCodes.sort().join(', ')}`)
const produced = shape.error_codes.produced_by_v4_source.filter((code) => codesInSource.includes(code))
const missingProduced = shape.error_codes.produced_by_v4_source.filter((code) => !codesInSource.includes(code))
if (missingProduced.length) fail(`登记的错误码已不再产生：${missingProduced.join(', ')}`)

// ---- 9. 资金预检失败信封（§4.3）与失败后状态不变 ----
const heavyBlueprint = JSON.parse(readFileSync(join(root, 'docs', 'blueprints', 'tv_standard.blueprint.json'), 'utf8'))
let heavy = unwrap('instantiate_work', { state: structuredClone(init.state), blueprint: heavyBlueprint, work_id: 'work_heavy', duration_weeks: 26 }).state
heavy = unwrap('assign_staff', {
  state: heavy,
  staff_id: heavy.staff.find((person) => person.role === 'director').id,
  work_id: 'work_heavy'
}).state
let precheckFailure = null
for (let week = 0; week < 40 && !precheckFailure; week++) {
  for (const pending of heavy.events.pending.filter((event) => !event.viewed)) {
    heavy = unwrap('view_event', { state: heavy, work_id: pending.work_id, event_id: pending.event_id }).state
  }
  const before = unwrap('hash_state', { state: heavy }).hash
  const result = call('advance_week', { state: heavy })
  if (result.error) {
    precheckFailure = result
    const after = unwrap('hash_state', { state: heavy }).hash
    if (after !== before) fail('预检失败前后状态哈希不一致（不应发生）')
    if ('state' in result) fail('失败信封不得携带 state（数据字典 §4.2）')
  } else {
    heavy = result.state
  }
}
if (!precheckFailure) {
  fail('未触发资金预检失败路径，无法验证 INSUFFICIENT_FUNDS.gap（数据字典 §4.3）')
} else {
  if (precheckFailure.error.code !== 'INSUFFICIENT_FUNDS') {
    fail(`预检失败应为 INSUFFICIENT_FUNDS，实际 ${precheckFailure.error.code}`)
  }
  if (typeof precheckFailure.error.gap !== 'number' || precheckFailure.error.gap < 0) {
    fail('INSUFFICIENT_FUNDS 缺少非负整数 gap 键（数据字典 §4.3 已冻结该字段）')
  }
}

// ---- 结果 ----
if (failures.length) {
  console.error(`v4 契约形状审计失败（${failures.length} 项）：`)
  for (const message of failures) console.error(`  - ${message}`)
  console.error('\n处置：改代码对齐契约，或在 docs/DATA_DICTIONARY_V4.md 与 docs/v4-contract-shape.json 同步登记并按 M0 §13 分级评审。')
  process.exit(1)
}
console.log(
  `v4 契约形状审计通过：${Object.keys(shape.paths).length} 条形状、${Object.keys(shape.receipt_keys).length} 条回执、` +
    `${shape.invariants.asserted_in_validate.length}/${shape.invariants.declared_total} 条不变式有断言、` +
    `${produced.length} 个错误码在用、账本类目 ${[...categories].sort().join('/')}`
)

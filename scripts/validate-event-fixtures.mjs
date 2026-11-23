#!/usr/bin/env node
// 校验事件测试夹具：结构、覆盖矩阵、与事件目录的交叉引用。
// 用法: node scripts/validate-event-fixtures.mjs [夹具路径] [目录路径]
import { readFileSync } from 'node:fs'

const fixturePath = process.argv[2] || 'docs/event_test_fixtures.json'
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const errors = []
const fail = (where, message) => errors.push(`${where}: ${message}`)

let fixtures
try {
  fixtures = read(fixturePath)
} catch (error) {
  console.error(`无法读取或解析 ${fixturePath}: ${error.message}`)
  process.exit(1)
}

const catalogPath = process.argv[3] || fixtures.catalog
let catalog
try {
  catalog = read(catalogPath)
} catch (error) {
  console.error(`无法读取事件目录 ${catalogPath}: ${error.message}`)
  process.exit(1)
}

const events = new Map((catalog.events || []).map((event) => [event.id, event]))
const tags = new Set((catalog.events || []).map((event) => event.tag))
const STAGES = ['script', 'storyboard', 'key_animation', 'animation_check', 'postproduction']

if (fixtures.schema_version !== 1) fail('root', 'schema_version 必须为 1')
if (!Array.isArray(fixtures.cases) || fixtures.cases.length === 0) fail('root', 'cases 必须是非空数组')
if (!Array.isArray(fixtures.required_covers)) fail('root', 'required_covers 必须是数组')

const covered = new Set()
const seen = new Set()

for (const [index, item] of (fixtures.cases || []).entries()) {
  const where = `cases[${index}]${item.id ? ` (${item.id})` : ''}`
  if (typeof item.id !== 'string' || item.id.length < 3) fail(where, 'id 必须是非空字符串')
  else if (seen.has(item.id)) fail(where, `id 重复: ${item.id}`)
  else seen.add(item.id)

  if (!Array.isArray(item.covers) || item.covers.length === 0) fail(where, 'covers 必须是非空数组')
  else for (const tag of item.covers) covered.add(tag)

  const given = item.given || {}
  if (given.stage !== undefined && !STAGES.includes(given.stage)) fail(where, `未知阶段: ${given.stage}`)
  if (given.cooldowns && typeof given.cooldowns === 'object') {
    for (const key of Object.keys(given.cooldowns)) {
      if (!tags.has(key)) fail(where, `cooldowns 键 ${key} 不是目录中任何事件的 tag`)
    }
  }
  if (given.major_seen) {
    for (const id of given.major_seen) if (!events.has(id)) fail(where, `major_seen 引用了不存在的事件: ${id}`)
  }

  const expect = item.expect || {}
  const triggered = expect.pending_event
  if (triggered !== undefined && triggered !== null) {
    const event = events.get(triggered)
    if (!event) fail(where, `expect.pending_event 引用了不存在的事件: ${triggered}`)
    else if (given.stage && !event.stages.includes(given.stage)) {
      fail(where, `${triggered} 不适用于阶段 ${given.stage}`)
    }
  }
  if (expect.option !== undefined && triggered) {
    const event = events.get(triggered)
    const option = event && event.options.find((entry) => entry.id === expect.option)
    if (!option) fail(where, `expect.option ${expect.option} 不在 ${triggered} 中`)
    else if (given.funds !== undefined && option.cost <= given.funds) {
      fail(where, `disabled 用例不成立：cost ${option.cost} 未超过 funds ${given.funds}`)
    }
  }
  if (expect.stage_effect && !STAGES.includes(expect.stage_effect.stage)) {
    fail(where, `expect.stage_effect.stage 未知: ${expect.stage_effect.stage}`)
  }
  if (expect.action === 'advance_week' && expect.error !== 'INVALID_PHASE') {
    fail(where, '暂停用例应断言 INVALID_PHASE')
  }
}

for (const required of fixtures.required_covers || []) {
  if (!covered.has(required)) fail('root', `覆盖矩阵缺少: ${required}`)
}

if (errors.length > 0) {
  for (const message of errors) console.error(`错误 ${message}`)
  console.error(`\n校验失败：${errors.length} 个错误`)
  process.exit(1)
}

console.log(`夹具 ${fixtures.cases.length} 条，覆盖 ${covered.size} 类：${[...covered].join(', ')}`)
console.log(`校验通过：${fixturePath}`)

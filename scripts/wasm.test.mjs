import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const moduleUrl = new URL('../apps/web/public/wasm/game-core.mjs', import.meta.url)
const binaryUrl = new URL('../apps/web/public/wasm/game-core.wasm', import.meta.url)
const binary = await readFile(binaryUrl)
assert.deepEqual([...binary.subarray(0, 4)], [0, 97, 115, 109], '必须是真实 WASM 二进制')
assert.equal(WebAssembly.validate(binary), true)
const { default: createGameCore } = await import(moduleUrl.href)
const core = await createGameCore({ locateFile: (file) => fileURLToPath(new URL(file, moduleUrl)) })
const invoke = (input) => JSON.parse(core.advance_day(JSON.stringify(input)))

test('真实 WASM 接收 JSON 并执行 C++ 示例计算', () => {
  assert.deepEqual(invoke({ budget: 100000, progress: 20, seed: 12345 }), {
    budget: 95000, progress: 25, message: '制作进度已更新',
  })
})

test('真实 WASM 确定性与连续推进', () => {
  const input = { budget: 100000, progress: 20, seed: 12345 }
  assert.deepEqual(invoke(input), invoke(input))
  const next = invoke({ ...invoke(input), seed: input.seed })
  assert.equal(next.budget, 90000)
  assert.equal(next.progress, 30)
})

test('真实 WASM 返回结构化输入与预算错误', () => {
  assert.equal(JSON.parse(core.advance_day('{')).error.code, 'INVALID_INPUT')
  for (const input of [null, [], {}, { budget: 10000, progress: 20, seed: -1 }, { budget: 10000, progress: 20, seed: 1.5 }, { budget: Number.MAX_SAFE_INTEGER + 1, progress: 20, seed: 1 }]) {
    assert.equal(invoke(input).error.code, 'INVALID_INPUT')
  }
  assert.equal(invoke({ budget: 4999, progress: 20, seed: 1 }).error.code, 'INSUFFICIENT_BUDGET')
})

test('进度上限与已完成项目不再扣款', () => {
  assert.equal(invoke({ budget: 5000, progress: 98, seed: 0 }).progress, 100)
  const result = invoke({ budget: 0, progress: 100, seed: 0 })
  assert.equal(result.budget, 0)
  assert.equal(result.progress, 100)
})

test('预留接口明确返回未实现', () => {
  for (const method of ['initialize_game', 'start_project', 'apply_decision', 'resolve_event', 'calculate_result']) {
    assert.equal(typeof core[method], 'function')
    assert.equal(JSON.parse(core[method]('{}')).error.code, 'NOT_IMPLEMENTED')
  }
})

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import createGameCore from '../../../apps/web/public/wasm/game-core.mjs';

const wasmUrl = new URL('../../../apps/web/public/wasm/game-core.wasm', import.meta.url);
const core = await createGameCore();
const example = JSON.stringify({ budget: 100000, progress: 20, seed: 12345 });
const expected = { budget: 95000, progress: 25, message: '制作进度已更新' };
const reserved = ['initialize_game', 'start_project', 'apply_decision', 'resolve_event', 'calculate_result'];

function advance(input) {
  const output = core.advance_day(typeof input === 'string' ? input : JSON.stringify(input));
  assert.equal(typeof output, 'string');
  return JSON.parse(output);
}

function expectError(output, code) {
  const result = typeof output === 'string' ? JSON.parse(output) : output;
  assert.deepEqual(Object.keys(result), ['error']);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
  assert.ok(result.error.message.length > 0);
}

test('default createGameCore factory loads a real standalone WebAssembly binary', async () => {
  assert.equal(typeof createGameCore, 'function');
  assert.equal(createGameCore.name, 'createGameCore');
  const bytes = await readFile(wasmUrl);
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
  assert.ok(WebAssembly.validate(bytes));
  for (const name of ['advance_day', ...reserved]) assert.equal(typeof core[name], 'function');
});

test('example and UTF-8 message cross the Embind string boundary', () => {
  assert.deepEqual(advance(example), expected);
});

test('budget and progress boundaries', () => {
  assert.deepEqual(advance({ budget: 5000, progress: 0, seed: 0 }), {
    budget: 0, progress: 5, message: expected.message,
  });
  for (let progress = 95; progress < 100; progress++) {
    assert.deepEqual(advance({ budget: 10000, progress, seed: 1 }), {
      budget: 5000, progress: 100, message: expected.message,
    });
  }
  assert.deepEqual(advance({ budget: Number.MAX_SAFE_INTEGER, progress: 20, seed: 4294967295 }), {
    budget: Number.MAX_SAFE_INTEGER - 5000, progress: 25, message: expected.message,
  });
});

test('completion does not deduct money, including zero budget', () => {
  for (const budget of [0, 4999, 5000, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(advance({ budget, progress: 100, seed: 0 }), {
      budget, progress: 100, message: expected.message,
    });
  }
});

test('insufficient funds return only a structured error and leave caller input intact', () => {
  for (const budget of [0, 1, 4999]) {
    const state = Object.freeze({ budget, progress: 99, seed: 0 });
    expectError(advance(state), 'INSUFFICIENT_BUDGET');
    assert.deepEqual(state, { budget, progress: 99, seed: 0 });
  }
});

test('JSON parse exceptions are caught inside WASM, with subsequent calls still working', () => {
  for (const input of ['', '{', 'undefined', 'null', 'true', '42', '"text"', '[]', '{}',
    '{"budget":1e1000,"progress":20,"seed":1}',
    '{"budget":100000,"progress":20,"seed":1} trailing',
    '{"budget":100000,"progress":20,"seed":1,}',
    '{"budget":18446744073709551615,"progress":20,"seed":1}',
    '{"budget":18446744073709551616,"progress":20,"seed":1}',
    '{"budget":5000.0,"progress":20,"seed":1}',
  ]) {
    expectError(advance(input), 'INVALID_INPUT');
    assert.deepEqual(advance(example), expected);
  }
});

test('each required field rejects non-integer types, missing values, and out-of-range values', () => {
  const invalid = {
    budget: [-1, Number.MAX_SAFE_INTEGER + 1, 5000.5, '5000', true, null, [], {}],
    progress: [-1, 101, 2.5, '20', true, null, [], {}],
    seed: [-1, 4294967296, 1.5, '1', true, null, [], {}],
  };
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      expectError(advance({ budget: 100000, progress: 20, seed: 1, [field]: value }), 'INVALID_INPUT');
    }
    const missing = { budget: 100000, progress: 20, seed: 1 };
    delete missing[field];
    expectError(advance(missing), 'INVALID_INPUT');
  }
  expectError(advance({ budget: 0, progress: 100, seed: -1 }), 'INVALID_INPUT');
});

test('same input is deterministic across calls and independent module instances', async () => {
  const second = await createGameCore();
  for (let i = 0; i < 100; i++) {
    advance({ budget: 8000, progress: 95, seed: i });
    assert.equal(core.advance_day(example), second.advance_day(example));
    assert.deepEqual(advance(example), expected);
  }
});

test('seed and extra fields cannot alter the fixed prototype increments', () => {
  for (const seed of [0, 1, 12345, 4294967295]) {
    assert.deepEqual(advance({ budget: 100000, progress: 20, seed, dailyCost: 1, progressGain: 90 }), expected);
  }
});

test('all five reserved APIs return NOT_IMPLEMENTED for every input', () => {
  for (const name of reserved) {
    for (const input of ['{}', '', 'invalid', 'null', example]) {
      const output = core[name](input);
      assert.equal(typeof output, 'string');
      expectError(output, 'NOT_IMPLEMENTED');
    }
  }
});

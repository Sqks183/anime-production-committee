import { expect, it } from 'vitest'
import { isGameState } from './game'

it.each([
  null, undefined, [], {},
  { budget: -1, progress: 20, seed: 1 },
  { budget: 0.5, progress: 20, seed: 1 },
  { budget: Number.MAX_SAFE_INTEGER + 1, progress: 20, seed: 1 },
  { budget: 100000, progress: 101, seed: 1 },
  { budget: 100000, progress: -1, seed: 1 },
  { budget: 100000, progress: 20.5, seed: 1 },
  { budget: 100000, progress: 20, seed: 0x100000000 },
  { budget: 100000, progress: 20, seed: -1 },
  { budget: '100000', progress: 20, seed: 1 },
])('拒绝外部非法状态 %j', (state) => expect(isGameState(state)).toBe(false))

it('接受边界状态', () => {
  expect(isGameState({ budget: 0, progress: 0, seed: 0 })).toBe(true)
  expect(isGameState({ budget: Number.MAX_SAFE_INTEGER, progress: 100, seed: 0xffffffff })).toBe(true)
})

import { beforeEach, expect, it, vi } from 'vitest'

const moduleUrl = new URL('/wasm/game-core.mjs', window.location.href).href

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock(moduleUrl)
  vi.doUnmock(`${moduleUrl}?retry=1`)
})

async function mockCore(advance: () => string) {
  vi.doMock(moduleUrl, () => ({ default: vi.fn().mockResolvedValue({ advance_day: advance }) }))
  return import('./gameCore')
}

it('将真实边界字符串序列化/解析（工厂隔离测试）', async () => {
  const advance = vi.fn(() => JSON.stringify({ budget: 1, progress: 99, message: '边界测试' }))
  const { advanceDay } = await mockCore(advance)
  const input = { budget: 100000, progress: 20, seed: 12345 }
  expect(await advanceDay(input)).toEqual({ budget: 1, progress: 99, message: '边界测试' })
  expect(advance).toHaveBeenCalledWith(JSON.stringify(input))
})

it('将 C++ 结构化错误保留为 GameCoreError', async () => {
  const { advanceDay } = await mockCore(() => JSON.stringify({ error: { code: 'INSUFFICIENT_BUDGET', message: '预算不足' } }))
  await expect(advanceDay({ budget: 0, progress: 20, seed: 1 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BUDGET', message: '预算不足' })
})

it.each(['null', '[]', '{', '{}', '{"error":null}', '{"budget":-1,"progress":25,"message":"invalid"}'])('拒绝非法返回 %s', async (response) => {
  const { advanceDay } = await mockCore(() => response)
  await expect(advanceDay({ budget: 100000, progress: 20, seed: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('捕获导出函数抛出的异常', async () => {
  const { advanceDay } = await mockCore(() => { throw new Error('wasm trap') })
  await expect(advanceDay({ budget: 100000, progress: 20, seed: 1 })).rejects.toMatchObject({ code: 'CALL_FAILED' })
})

it('加载失败清理缓存并允许重试，同一请求共用工厂', async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error('missing wasm')).mockResolvedValue({ advance_day: vi.fn() })
  vi.doMock(moduleUrl, () => ({ default: create }))
  vi.doMock(`${moduleUrl}?retry=1`, () => ({ default: create }))
  const { loadGameCore } = await import('./gameCore')
  await expect(loadGameCore()).rejects.toMatchObject({ code: 'LOAD_FAILED' })
  const first = loadGameCore()
  expect(loadGameCore()).toBe(first)
  await first
  expect(create).toHaveBeenCalledTimes(2)
})

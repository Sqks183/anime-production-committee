import { beforeEach, expect, it } from 'vitest'
import { idleState, v3IdleState, v3ProducingState, v3EventState, v3ReadyState, v3SettledState, v3EndedState } from '../test/fixtures'
import { decodeV3SaveRecord, loadGame, saveGame } from './saveGame'

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('anime-production-committee')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

async function rawRecord(value?: unknown): Promise<{ record: unknown; version: number }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('anime-production-committee', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('saves')
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('saves', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('saves')
      if (value !== undefined) store.put(value, 'current')
      const read = store.get('current')
      transaction.oncomplete = () => { database.close(); resolve({ record: read.result, version: database.version }) }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

it('不存在存档时返回 null', async () => {
  expect(await loadGame()).toBeNull()
})

it.each([1, 2])('读取拒绝旧 v%s 信封且不覆盖原记录', async (version) => {
  const record = { version, savedAt: '2026-11-21T00:00:00.000Z', state: idleState() }
  await rawRecord(record)
  await expect(loadGame()).rejects.toThrow(`v${version} 存档不兼容周制经营 v3，请新开游戏；旧存档未被覆盖。`)
  expect((await rawRecord()).record).toEqual(record)
})

it('读取完整恢复事件、作品与终局，DB schema 不变且没有写操作', async () => {
  for (const state of [v3IdleState(), v3ProducingState(), v3EventState(), v3ReadyState(), v3SettledState(), v3EndedState()]) {
    const record = { version: 3, savedAt: '2026-11-21T00:00:00.000Z', state }
    await rawRecord(record)
    expect(await loadGame()).toEqual(state)
    expect(await rawRecord()).toEqual({ record, version: 1 })
  }
})

it('拒绝信封/状态版本错配、缺失字段和损坏记录，原档保持不变', async () => {
  const valid = { version: 3, savedAt: '2026-11-21T00:00:00.000Z', state: v3IdleState() }
  for (const record of [null, {}, Object.assign([], valid), { ...valid, version: 99 }, { ...valid, savedAt: 'invalid' },
    { ...valid, savedAt: 42 }, { version: 3, state: valid.state }, { version: 3, savedAt: valid.savedAt },
    { ...valid, state: idleState() }, { ...valid, state: { ...valid.state, company: null } }]) {
    await rawRecord(record)
    await expect(loadGame()).rejects.toThrow('存档损坏或版本不受支持')
    expect((await rawRecord()).record).toEqual(record)
  }
  expect(decodeV3SaveRecord(undefined)).toBeNull()
})

it('IndexedDB 事务保存完整 v3 状态与 savedAt，数据库仍为 version 1', async () => {
  const state = v3ProducingState()
  await saveGame(state)
  expect(await loadGame()).toEqual(state)
  const { record, version } = await rawRecord()
  expect(version).toBe(1)
  expect(record).toEqual({ version: 3, savedAt: expect.any(String), state })
  expect(Number.isFinite(Date.parse((record as { savedAt: string }).savedAt))).toBe(true)
  const next = v3EventState()
  await saveGame(next)
  expect(await loadGame()).toEqual(next)
})

it('保存验证深层数据，失败保留已有有效存档', async () => {
  const state = v3ProducingState()
  await saveGame(state)
  const invalid = v3ProducingState()
  invalid.company.staff[0].morale = 101
  const badWeek = v3ProducingState()
  badWeek.company.week = Number.MAX_SAFE_INTEGER + 1
  for (const value of [invalid, { ...state, company: { ...state.company, funds: -1 } }, { ...state, seed: 0x100000000 }, badWeek]) {
    await expect(saveGame(value)).rejects.toThrow('经营数据无效')
    expect(await loadGame()).toEqual(state)
  }
})

it.each([
  null, {}, { version: 99, state: {} },
  { version: 2, state: idleState() },
  { version: 2, savedAt: 'not-a-date', state: idleState() },
  { version: 2, savedAt: 42, state: idleState() },
  { version: 2, savedAt: '2026-01-01T00:00:00.000Z', state: { ...idleState(), funds: -1 } },
])('拒绝损坏/不兼容存档且不改写原记录 %j', async (record) => {
  await rawRecord(record)
  await expect(loadGame()).rejects.toThrow(/存档损坏或版本不受支持|不兼容周制经营/)
  expect((await rawRecord()).record).toEqual(record)
})

import { beforeEach, expect, it } from 'vitest'
import { loadGame, saveGame } from './saveGame'

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('anime-production-committee')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

it('不存在存档时返回 null', async () => {
  expect(await loadGame()).toBeNull()
})

it('通过 IndexedDB 事务保存并恢复种子和状态', async () => {
  const state = { budget: 95000, progress: 25, seed: 12345 }
  await saveGame(state)
  expect(await loadGame()).toEqual(state)
  await saveGame({ ...state, progress: 30 })
  expect((await loadGame())?.progress).toBe(30)
})

it('拒绝非法数值，保留有效存档', async () => {
  const state = { budget: 95000, progress: 25, seed: 12345 }
  await saveGame(state)
  await expect(saveGame({ ...state, budget: -1 })).rejects.toThrow('经营数据无效')
  expect(await loadGame()).toEqual(state)
})

it('拒绝损坏或不兼容的存档', async () => {
  await saveGame({ budget: 95000, progress: 25, seed: 12345 })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('anime-production-committee', 1)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('saves', 'readwrite')
      transaction.objectStore('saves').put({ version: 99, state: {} }, 'current')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
    request.onerror = () => reject(request.error)
  })
  await expect(loadGame()).rejects.toThrow('存档损坏或版本不受支持')
})

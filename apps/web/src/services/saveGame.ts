import { isGameState } from '../types/game'
import type { GameState } from '../types/game'

const databaseName = 'anime-production-committee'
const storeName = 'saves'

interface SaveRecord {
  version: 1
  savedAt: string
  state: GameState
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地存档'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('存档数据库被其他页面占用，请关闭旧页面后重试。'))
    }
  })
}

export async function saveGame(state: GameState): Promise<void> {
  if (!isGameState(state)) throw new Error('经营数据无效，无法保存。')
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put({ version: 1, savedAt: new Date().toISOString(), state } satisfies SaveRecord, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('保存失败'))
      transaction.onerror = () => reject(transaction.error ?? new Error('保存失败'))
    })
  } finally {
    database.close()
  }
}

export async function loadGame(): Promise<GameState | null> {
  const database = await openDatabase()
  let record: unknown
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get('current')
      request.onsuccess = () => { record = request.result }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('读取失败'))
      transaction.onerror = () => reject(transaction.error ?? new Error('读取失败'))
    })
  } finally {
    database.close()
  }
  if (record === undefined) return null
  if (typeof record !== 'object' || record === null || !('version' in record) || record.version !== 1 || !('state' in record) || !isGameState(record.state)) {
    throw new Error('存档损坏或版本不受支持，当前数据未改变。')
  }
  return record.state
}

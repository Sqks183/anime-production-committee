import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGameCore } from '../services/gameCore'

export function useGameCore() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const retry = useCallback(async () => {
    const id = ++requestId.current
    setStatus('loading')
    setError(null)
    try {
      await loadGameCore()
      if (id === requestId.current) setStatus('ready')
    } catch (cause) {
      if (id === requestId.current) {
        setStatus('error')
        setError(cause instanceof Error ? cause.message : '游戏核心加载失败。')
      }
    }
  }, [])
  useEffect(() => {
    void retry()
    return () => { requestId.current += 1 }
  }, [retry])
  return { status, error, retry }
}

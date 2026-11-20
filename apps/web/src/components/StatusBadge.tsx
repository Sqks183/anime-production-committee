import { CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react'

export function StatusBadge({ status }: { status: 'loading' | 'ready' | 'error' }) {
  const Icon = status === 'ready' ? CircleCheck : status === 'error' ? CircleAlert : LoaderCircle
  return <span className={`status-badge status-${status}`} role="status">
    <Icon size={15} aria-hidden="true" />
    {status === 'ready' ? 'C++ / WASM 已就绪' : status === 'error' ? '核心未连接' : '正在加载游戏核心'}
  </span>
}

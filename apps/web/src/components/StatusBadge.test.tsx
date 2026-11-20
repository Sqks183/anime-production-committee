import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('核心状态提示', () => {
  it.each([
    ['loading', '正在加载游戏核心'],
    ['ready', 'C++ / WASM 已就绪'],
    ['error', '核心未连接'],
  ] as const)('显示 %s 状态', (status, text) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByRole('status')).toHaveTextContent(text)
  })
})

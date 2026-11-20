import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { useGameCore } from './hooks/useGameCore'
import { useGameStore } from './stores/gameStore'

vi.mock('./hooks/useGameCore', () => ({ useGameCore: vi.fn() }))

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState())
  vi.mocked(useGameCore).mockReturnValue({ status: 'ready', error: null, retry: vi.fn() })
})

it('开始经营后显示初始资金和进度', async () => {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(screen.getByTestId('budget')).toHaveTextContent('100,000')
  expect(screen.getByTestId('progress')).toHaveTextContent('20%')
  expect(screen.getByRole('button', { name: /推进一次制作进度/ })).toBeEnabled()
})

it('加载失败显示重试入口，并阻止推进', async () => {
  const retry = vi.fn()
  vi.mocked(useGameCore).mockReturnValue({ status: 'error', error: '游戏核心加载失败', retry })
  render(<App />)
  expect(screen.getByRole('alert')).toHaveTextContent('游戏核心加载失败')
  await userEvent.click(screen.getByRole('button', { name: /重试加载/ }))
  expect(retry).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(screen.getByRole('button', { name: /推进一次制作进度/ })).toBeDisabled()
})

it('加载中不允许推进，加载提示可读', async () => {
  vi.mocked(useGameCore).mockReturnValue({ status: 'loading', error: null, retry: vi.fn() })
  render(<App />)
  expect(screen.getByRole('status')).toHaveTextContent('正在加载游戏核心')
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(screen.getByRole('button', { name: /推进一次制作进度/ })).toBeDisabled()
})

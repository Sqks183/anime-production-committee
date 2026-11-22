import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { useGameStore } from '../stores/gameStore'
import { initializeGame } from '../services/gameCore'
import { loadGame } from '../services/saveGame'
import { deferred, v3IdleState, v3ProducingState } from '../test/fixtures'

vi.mock('../services/gameCore', () => ({ initializeGame: vi.fn(), startProject: vi.fn(), applyDecision: vi.fn(), advanceWeek: vi.fn(), calculateProjectResult: vi.fn(), calculateCompanyResult: vi.fn() }))
vi.mock('../services/saveGame', () => ({ loadGame: vi.fn(), saveGame: vi.fn() }))
const ready = { status: 'ready' as const, error: null, retry: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  useGameStore.setState(useGameStore.getInitialState())
  window.history.replaceState(null, '', '/?seed=12345')
})

it('保留首页设计内容，开始经营调用初始化后进入经营页', async () => {
  vi.mocked(initializeGame).mockResolvedValue({ state: v3IdleState(), message: '公司成立' })
  render(<HomePage core={ready} />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('动画制作委员会')
  expect(screen.getByText('ANIME PRODUCTION COMMITTEE')).toBeVisible()
  expect(screen.getByLabelText('制作企划说明')).toBeVisible()
  expect(screen.queryByRole('button', { name: '继续经营' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(initializeGame).toHaveBeenCalledWith(12345)
  expect(useGameStore.getState().screen).toBe('studio')
})

it.each(['loading', 'error'] as const)('核心 %s 时禁止新开但保留载入与继续', async (status) => {
  const game = v3ProducingState()
  useGameStore.setState({ game })
  vi.mocked(loadGame).mockResolvedValue(game)
  render(<HomePage core={{ status, error: status === 'error' ? '加载失败' : null, retry: vi.fn() }} />)
  expect(screen.getByRole('button', { name: /开始经营/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: '继续经营' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '读取本地存档' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '继续经营' }))
  expect(useGameStore.getState().game).toBe(game)
  expect(useGameStore.getState().screen).toBe('studio')
  await userEvent.click(screen.getByRole('button', { name: '读取本地存档' }))
  expect(loadGame).toHaveBeenCalledTimes(1)
  expect(initializeGame).not.toHaveBeenCalled()
})

it('已有游戏时开始经营仍执行全新初始化，不等同于继续', async () => {
  const next = v3IdleState()
  useGameStore.setState({ game: v3ProducingState() })
  vi.mocked(initializeGame).mockResolvedValue({ state: next, message: '公司成立' })
  render(<HomePage core={ready} />)
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(initializeGame).toHaveBeenCalledTimes(1)
  expect(useGameStore.getState().game).toBe(next)
})

it('初始化期间禁用所有首页操作，失败仍保留旧游戏', async () => {
  const pending = deferred<{ state: ReturnType<typeof v3IdleState>; message: string }>()
  const game = v3ProducingState()
  useGameStore.setState({ game })
  vi.mocked(initializeGame).mockReturnValue(pending.promise)
  render(<HomePage core={ready} />)
  await userEvent.click(screen.getByRole('button', { name: /开始经营/ }))
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  await act(async () => pending.reject(new Error('核心初始化失败')))
  expect(screen.getByRole('button', { name: /开始经营/ })).toBeEnabled()
  expect(useGameStore.getState().busy).toBe(false)
  expect(useGameStore.getState().screen).toBe('home')
  expect(useGameStore.getState().game).toBe(game)
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { StudioPage } from './StudioPage'
import { useGameStore } from '../stores/gameStore'
import { v3EventState } from '../test/fixtures'
import * as core from '../services/gameCore'

vi.mock('../services/gameCore', () => ({
  initializeGame: vi.fn(), startProject: vi.fn(), applyDecision: vi.fn(), advanceWeek: vi.fn(),
  resolveEvent: vi.fn(), calculateProjectResult: vi.fn(), calculateCompanyResult: vi.fn(),
}))
vi.mock('../services/saveGame', () => ({ loadGame: vi.fn(), saveGame: vi.fn() }))

const ready = { status: 'ready' as const, error: null, retry: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  useGameStore.setState(useGameStore.getInitialState())
})

it('事件阶段展示异常与选项，禁用选项带原因，选择后交给核心', async () => {
  const state = v3EventState()
  const next = { ...state, phase: 'producing' as const, pending_event: null }
  useGameStore.setState({ game: state, screen: 'studio' })
  vi.mocked(core.resolveEvent).mockResolvedValue({ state: next, message: '已处理「剧本意见分歧」' })
  render(<StudioPage core={ready} />)
  expect(screen.getByTestId('event-panel')).toBeVisible()
  expect(screen.getByText('剧本意见分歧')).toBeVisible()
  expect(screen.getByRole('button', { name: /外部顾问/ })).toBeDisabled()
  expect(screen.getByText('顾问暂无档期')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /维持方案/ }))
  expect(core.resolveEvent).toHaveBeenCalledWith(state, 'v3_keep')
  expect(useGameStore.getState().game).toBe(next)
})

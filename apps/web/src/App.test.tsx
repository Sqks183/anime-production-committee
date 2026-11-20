import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { useGameCore } from './hooks/useGameCore'
import * as core from './services/gameCore'
import { loadGame, saveGame } from './services/saveGame'
import { useGameStore } from './stores/gameStore'
import { dayReport, deferred, endedState, eventState, idleState, producingState, projectResult } from './test/fixtures'
import type { AdvanceDayResult } from './types/game'

// 只隔离 React 交互与服务边界；真实 WASM / 浏览器验收由独立测试负责。
vi.mock('./hooks/useGameCore', () => ({ useGameCore: vi.fn() }))
vi.mock('./services/gameCore', () => ({ initializeGame: vi.fn(), startProject: vi.fn(), applyDecision: vi.fn(), advanceDay: vi.fn(), resolveEvent: vi.fn(), calculateResult: vi.fn() }))
vi.mock('./services/saveGame', () => ({ loadGame: vi.fn(), saveGame: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/?seed=12345')
  useGameStore.setState(useGameStore.getInitialState())
  vi.mocked(useGameCore).mockReturnValue({ status: 'ready', error: null, retry: vi.fn() })
})

it('串联新开、报价、推进、事件、结算与下一轮企划，展示核心返回值', async () => {
  const user = userEvent.setup()
  const initial = idleState()
  const producing = producingState()
  const event = eventState()
  const ended = endedState()
  const settled = { ...idleState(), day: 21, funds: 7654321, reputation: 20 }
  vi.mocked(core.initializeGame).mockResolvedValue({ state: initial })
  vi.mocked(core.startProject).mockResolvedValue({ state: producing, message: '企划拨款已到账' })
  vi.mocked(core.advanceDay).mockResolvedValueOnce({ state: event, report: dayReport() }).mockResolvedValueOnce({ state: ended, report: { ...dayReport(), message: '项目已到交付节点' } })
  vi.mocked(core.resolveEvent).mockResolvedValue({ state: producing, message: '事件已处理' })
  vi.mocked(core.calculateResult).mockResolvedValue({ state: settled, result: projectResult() })
  render(<App />)
  await user.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(core.initializeGame).toHaveBeenCalledWith(12345)
  expect(screen.getByTestId('funds')).toHaveTextContent('2,000,000')
  expect(screen.getByTestId('day')).toHaveTextContent('1')
  const offers = within(screen.getByRole('region', { name: '企划报价' }))
  expect(offers.getAllByRole('button')).toHaveLength(3)
  expect(offers.getByRole('button', { name: '接手：未寄出的夏天' })).toBeDisabled()
  await user.click(offers.getByRole('button', { name: '接手：放学后的第七帧' }))
  expect(core.startProject).toHaveBeenCalledWith(initial, 'proj_ova_01')
  expect(screen.getByTestId('funds')).toHaveTextContent('10,000,000')
  expect(screen.getByTestId('progress-pre')).toHaveTextContent('30%')
  expect(screen.getByTestId('progress-mid')).toHaveTextContent('20%')
  expect(screen.getByTestId('progress-post')).toHaveTextContent('10%')
  expect(screen.getByText('截止日')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '推进今天' }))
  expect(core.advanceDay).toHaveBeenCalledWith(producing)
  expect(screen.getByTestId('day')).toHaveTextContent('2')
  expect(screen.getByTestId('day-report')).toHaveTextContent(dayReport().message)
  expect(screen.getByTestId('day-report')).toHaveTextContent('-345,678')
  expect(screen.getByTestId('day-report')).toHaveTextContent('返工：是')
  expect(screen.getByTestId('day-report')).toHaveTextContent('进度 +7 / 质量 -2')
  expect(screen.getByRole('button', { name: '推进今天' })).toBeDisabled()
  const eventPanel = within(screen.getByRole('region', { name: '制作事件' }))
  await user.click(eventPanel.getByRole('button', { name: '延期方案（核心标签）' }))
  expect(core.resolveEvent).toHaveBeenCalledWith(event, 'opt_b')
  expect(screen.queryByRole('region', { name: '制作事件' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '推进今天' }))
  expect(screen.queryByRole('button', { name: '推进今天' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('制作方针')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '结算项目' }))
  expect(core.calculateResult).toHaveBeenCalledWith(ended)
  const result = screen.getByRole('region', { name: '项目结算' })
  expect(result).toHaveAttribute('data-testid', 'project-result')
  expect(result).toHaveTextContent('4,321,987')
  expect(result).toHaveTextContent('5,678,901')
  expect(result).toHaveTextContent('-1,356,914')
  expect(result).toHaveTextContent('B')
  expect(screen.getByTestId('funds')).toHaveTextContent('7,654,321')
  expect(screen.getByRole('button', { name: '接手：未寄出的夏天' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '结算项目' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '接手：星轨列车' }))
  expect(core.startProject).toHaveBeenLastCalledWith(settled, 'proj_tv_01')
  expect(screen.queryByTestId('project-result')).not.toBeInTheDocument()
  expect(screen.queryByTestId('day-report')).not.toBeInTheDocument()
})

it('排班、加班、制作方针与各工序外包仅提交决策，控件反映服务返回状态', async () => {
  const user = userEvent.setup()
  const original = producingState()
  useGameStore.setState({ screen: 'studio', game: original })
  render(<App />)
  const resting = producingState()
  resting.staff[0].assignment = 'rest'
  vi.mocked(core.applyDecision).mockResolvedValueOnce({ state: resting, message: '排班回执' })
  await user.selectOptions(screen.getByLabelText('林导演排班'), 'rest')
  expect(core.applyDecision).toHaveBeenLastCalledWith(original, { type: 'assign', staff_id: 'staff_01', assignment: 'rest' })
  expect(screen.getByLabelText('林导演排班')).toHaveValue('rest')
  expect(screen.getByLabelText('林导演加班')).toBeDisabled()
  const overtime = structuredClone(resting)
  overtime.staff[1].overtime = true
  vi.mocked(core.applyDecision).mockResolvedValueOnce({ state: overtime, message: '加班回执' })
  await user.click(screen.getByLabelText('陈原画加班'))
  expect(core.applyDecision).toHaveBeenLastCalledWith(resting, { type: 'overtime', staff_id: 'staff_02', enabled: true })
  expect(screen.getByLabelText('陈原画加班')).toBeChecked()
  const polish = structuredClone(overtime)
  polish.project!.policy = 'polish'
  vi.mocked(core.applyDecision).mockResolvedValueOnce({ state: polish, message: '方针回执' })
  await user.selectOptions(screen.getByLabelText('制作方针'), 'polish')
  expect(core.applyDecision).toHaveBeenLastCalledWith(overtime, { type: 'policy', policy: 'polish' })
  expect(screen.getByLabelText('制作方针')).toHaveValue('polish')
  let previous = polish
  for (const [stage, name] of [['pre', '前期 · 分镜演出'], ['mid', '中期 · 原画动画'], ['post', '后期 · 摄影合成']] as const) {
    const next = structuredClone(previous)
    next.project!.stages[stage].outsourced = true
    vi.mocked(core.applyDecision).mockResolvedValueOnce({ state: next, message: '外包回执' })
    const checkbox = within(screen.getByRole('region', { name })).getByRole('checkbox', { name: '当日外包' })
    await user.click(checkbox)
    expect(core.applyDecision).toHaveBeenLastCalledWith(previous, { type: 'outsource', stage, enabled: true })
    expect(checkbox).toBeChecked()
    previous = next
  }
  vi.mocked(core.applyDecision).mockResolvedValueOnce({ state: polish, message: '取消外包' })
  await user.click(within(screen.getByRole('region', { name: '前期 · 分镜演出' })).getByRole('checkbox'))
  expect(core.applyDecision).toHaveBeenLastCalledWith(previous, { type: 'outsource', stage: 'pre', enabled: false })
  expect(screen.getByTestId('funds')).toHaveTextContent('10,000,000')
})

it('保存、返回首页、继续与读取保留完整状态，不进行隐式初始化', async () => {
  const user = userEvent.setup()
  const game = eventState()
  useGameStore.setState({ screen: 'studio', game, report: dayReport() })
  vi.mocked(saveGame).mockResolvedValue()
  vi.mocked(loadGame).mockResolvedValue(endedState())
  render(<App />)
  await user.click(screen.getByRole('button', { name: '保存进度' }))
  expect(saveGame).toHaveBeenCalledWith(game)
  expect(screen.getByText('已保存到此浏览器。')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '返回首页' }))
  await user.click(screen.getByRole('button', { name: '继续经营' }))
  expect(screen.getByRole('region', { name: '制作事件' })).toBeVisible()
  expect(screen.getByTestId('day-report')).toBeVisible()
  expect(core.initializeGame).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '读取存档' }))
  expect(loadGame).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '结算项目' })).toBeEnabled()
  expect(screen.queryByTestId('day-report')).not.toBeInTheDocument()
})

it('推进等待期间禁止重复请求与所有操作，失败保留状态和回执', async () => {
  const user = userEvent.setup()
  const game = producingState()
  const pending = deferred<AdvanceDayResult>()
  useGameStore.setState({ screen: 'studio', game, report: dayReport() })
  vi.mocked(core.advanceDay).mockReturnValue(pending.promise)
  render(<App />)
  await user.click(screen.getByRole('button', { name: '推进今天' }))
  await user.click(screen.getByRole('button', { name: '推进今天' }))
  for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('combobox'), ...screen.getAllByRole('checkbox')]) expect(control).toBeDisabled()
  expect(core.advanceDay).toHaveBeenCalledTimes(1)
  await act(async () => pending.reject(new Error('核心调用失败：原状态保留')))
  expect(screen.getByRole('alert')).toHaveTextContent('核心调用失败：原状态保留')
  expect(screen.getByTestId('funds')).toHaveTextContent('10,000,000')
  expect(screen.getByTestId('progress-pre')).toHaveTextContent('30%')
  expect(screen.getByTestId('day-report')).toHaveTextContent(dayReport().message)
  expect(screen.getByRole('button', { name: '推进今天' })).toBeEnabled()
  expect(useGameStore.getState().game).toBe(game)
})

it('读取损坏存档显示错误，不替换当前工作台', async () => {
  const game = producingState()
  useGameStore.setState({ screen: 'studio', game })
  vi.mocked(loadGame).mockRejectedValue(new Error('存档损坏或版本不受支持，当前数据未改变。'))
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: '读取存档' }))
  expect(screen.getByRole('alert')).toHaveTextContent('存档损坏')
  expect(useGameStore.getState().game).toBe(game)
  expect(screen.getByTestId('progress-pre')).toHaveTextContent('30%')
})

it('加载失败提供可操作重试入口，重试成功前禁止新开', async () => {
  const retry = vi.fn()
  vi.mocked(useGameCore).mockReturnValue({ status: 'error', error: '游戏核心加载失败', retry })
  const { rerender } = render(<App />)
  expect(screen.getByRole('alert')).toHaveTextContent('游戏核心加载失败')
  expect(screen.getByRole('button', { name: /开始经营/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: '读取本地存档' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '重试加载' }))
  expect(retry).toHaveBeenCalledTimes(1)
  vi.mocked(useGameCore).mockReturnValue({ status: 'ready', error: null, retry })
  rerender(<App />)
  expect(screen.getByRole('button', { name: /开始经营/ })).toBeEnabled()
})

it('核心加载错误不会遮住 v1 存档拒绝提示', async () => {
  vi.mocked(useGameCore).mockReturnValue({ status: 'error', error: '游戏核心加载失败', retry: vi.fn() })
  vi.mocked(loadGame).mockRejectedValue(new Error('v1 存档不支持载入，请新开游戏；旧存档未被覆盖。'))
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: '读取本地存档' }))
  expect(screen.getByText('游戏核心加载失败')).toBeVisible()
  expect(screen.getByText(/v1 存档不支持载入/)).toBeVisible()
  expect(screen.getAllByRole('alert')).toHaveLength(2)
})

it('加载中的提示可读，新游戏按钮不可用', () => {
  vi.mocked(useGameCore).mockReturnValue({ status: 'loading', error: null, retry: vi.fn() })
  render(<App />)
  expect(screen.getByRole('status')).toHaveTextContent('正在加载游戏核心')
  expect(screen.getByRole('button', { name: /开始经营/ })).toBeDisabled()
})

it.each(['loading', 'error'] as const)('核心 %s 时继续已存在的制作台，生产控件禁用，存档与返回可用', async (status) => {
  useGameStore.setState({ game: producingState() })
  vi.mocked(useGameCore).mockReturnValue({ status, error: status === 'error' ? '加载失败' : null, retry: vi.fn() })
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: '继续经营' }))
  expect(screen.getByRole('button', { name: '推进今天' })).toBeDisabled()
  for (const control of [...screen.getAllByRole('combobox'), ...screen.getAllByRole('checkbox')]) expect(control).toBeDisabled()
  for (const name of ['保存进度', '读取存档', '返回首页']) expect(screen.getByRole('button', { name })).toBeEnabled()
})

it.each([
  { game: idleState(), region: '企划报价' },
  { game: eventState(), region: '制作事件' },
  { game: endedState(), region: '项目制作' },
])('核心未就绪时禁用 $region 中的核心操作', ({ game, region }) => {
  useGameStore.setState({ screen: 'studio', game })
  vi.mocked(useGameCore).mockReturnValue({ status: 'loading', error: null, retry: vi.fn() })
  render(<App />)
  for (const button of within(screen.getByRole('region', { name: region })).getAllByRole('button')) expect(button).toBeDisabled()
})

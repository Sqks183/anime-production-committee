import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import { HomePage } from './HomePage'
import { useGameStore } from '../stores/gameStore'

beforeEach(() => useGameStore.setState(useGameStore.getInitialState()))

it('展示项目名称并通过状态操作进入经营页', async () => {
  const user = userEvent.setup()
  render(<HomePage />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('动画制作委员会')
  expect(screen.getByText('ANIME PRODUCTION COMMITTEE')).toBeVisible()
  expect(screen.getByText(/项目开发中/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: /开始经营/ }))
  expect(useGameStore.getState().screen).toBe('studio')
})

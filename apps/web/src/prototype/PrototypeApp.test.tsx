import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import PrototypeApp from './PrototypeApp'
import { prototypeData } from './mockData'

const here = fileURLToPath(import.meta.url)
const prototypeFiles = readdirSync(here.replace(/[^/\\]+$/, '')).filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
const mainSource = readFileSync(resolve(here, '../..', 'main.tsx'), 'utf8')

beforeEach(() => render(<PrototypeApp />))

it('默认落在公司总览，公司账与多项目状态可横向比较', () => {
  const ledger = screen.getByRole('region', { name: '公司现金与承诺' })
  expect(ledger).toHaveTextContent('¥1,842,000')
  expect(ledger).toHaveTextContent('¥428,000')
  expect(ledger).toHaveTextContent('4 周')
  const portfolio = screen.getByRole('region', { name: '同时在制的作品' })
  expect(within(portfolio).getAllByRole('button', { name: '打开作品详情' })).toHaveLength(prototypeData.projects.length)
  expect(within(portfolio).getByText('雾港信使 II')).toBeInTheDocument()
  expect(within(portfolio).getAllByText(/落后/).length).toBeGreaterThan(0)
  expect(screen.getByRole('region', { name: '谁在哪个项目上' })).toHaveTextContent('周慕')
  expect(screen.getByRole('region', { name: '市场企划与长期合作' })).toHaveTextContent('核心作画产能不足')
})

it('进入作品详情后五阶段、计划差距、资源冲突与项目账同屏呈现', async () => {
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: '打开作品详情' })[0])
  expect(screen.getByRole('region', { name: '雾港信使 II' })).toBeInTheDocument()
  const stages = screen.getAllByRole('article')
  expect(stages).toHaveLength(5)
  expect(stages[2]).toHaveTextContent('原画制作')
  expect(stages[2]).toHaveTextContent('38 / 85')
  expect(stages[2]).toHaveTextContent('已超时')
  expect(screen.getByRole('region', { name: '这个项目占了谁和本周还剩多少产能' })).toHaveTextContent('星野线上')
  expect(screen.getByRole('region', { name: '雾港信使 II的花费与回款' })).toHaveTextContent('¥5,200,000')
  expect(screen.getByRole('region', { name: '雾港信使 II的花费与回款' })).toHaveTextContent('冬青社')
  await user.click(screen.getByRole('button', { name: /夜行电车/ }))
  expect(screen.getByRole('region', { name: '夜行电车' })).toHaveTextContent('承制')
  expect(screen.getByText(/承制不参与非 BD 渠道分成/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /返回公司总览/ }))
  expect(screen.getByRole('region', { name: '同时在制的作品' })).toBeVisible()
})

it('每周经营把必须决定、自动执行、仅报告分层，周次快照可切换', async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '每周经营' }))
  expect(screen.getByRole('region', { name: '产出与原因' })).toHaveTextContent('集中投入没有兑现')
  const decide = screen.getByRole('region', { name: '本周真正需要玩家处理的三件事' })
  expect(within(decide).getAllByText(/查看作品/)).toHaveLength(2)
  expect(screen.getByRole('region', { name: '自动执行与仅报告' })).toHaveTextContent('沿用上周')
  expect(screen.getByRole('region', { name: '原画返工：第 7 场夜戏构图偏离演出要求' })).toHaveTextContent('明石動画')
  await user.click(screen.getByRole('button', { name: /第 16 周/ }))
  expect(screen.getByRole('region', { name: '本周没有需要处理的事件' })).toBeVisible()
  expect(screen.getByRole('region', { name: '最值得盯住的事' })).toHaveTextContent('原画阶段的工作量是脚本的 2.1 倍')
  expect(screen.queryByText('集中投入没有兑现')).not.toBeInTheDocument()
})

it('周次快照里的工作项可跳回对应作品，不改动周数据', async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '每周经营' }))
  await user.click(within(screen.getByRole('region', { name: '产出与原因' })).getByRole('button', { name: '小满' }))
  expect(screen.getByRole('region', { name: '小满' })).toHaveTextContent('摄影与后期')
  await user.click(screen.getByRole('button', { name: /返回公司总览/ }))
  await user.click(screen.getByRole('button', { name: '每周经营' }))
  expect(screen.getByRole('region', { name: /《小满》进入收口/ })).toBeInTheDocument()
})

it('标注体系覆盖四类信息口径', () => {
  expect(screen.getAllByText('待负责人决定').length).toBeGreaterThan(0)
  expect(screen.getAllByText('原型样本').length).toBeGreaterThan(0)
  expect(screen.getByText(/「待负责人决定」的内容不得当作已确认规则实现/)).toBeInTheDocument()
})

it('原型保持纯静态：不引用核心服务、存档与旧 GameState', () => {
  for (const name of prototypeFiles) {
    const source = readFileSync(resolve(here.replace(/[^/\\]+$/, ''), name), 'utf8')
    expect(source, name).not.toMatch(/gameV3|gameCore|gameStore|useGameCore|indexedDB|fake-indexeddb|wasm|fetch\(/i)
  }
  expect(Object.keys(prototypeData).sort().join(',')).toBe('allocations,company,history,ledger,marketOffers,outsourcing,projects,receipts,relationships,staff,suppliers')
})

it('生产入口只在 ?view=prototype 时进入原型，默认仍是原界面', () => {
  expect(mainSource).toMatch(/get\('view'\) === 'prototype'/)
  expect(mainSource).toMatch(/lazy\(\(\) => import\('\.\/prototype\/PrototypeApp'\)\)/)
  expect(mainSource).toContain('<App />')
})

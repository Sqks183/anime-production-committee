import { useState } from 'react'
import { CompanyOverview } from './CompanyOverview'
import { WeeklyOperations } from './WeeklyOperations'
import { WorkDetail } from './WorkDetail'
import { prototypeData } from './mockData'
import { scaleNames } from './model'
import './prototype.css'

type Screen = 'company' | 'work' | 'week'

const tabNames: Record<Screen, string> = { company: '公司总览', work: '作品详情', week: '每周经营' }

export default function PrototypeApp() {
  const data = prototypeData
  const [screen, setScreen] = useState<Screen>('company')
  const [projectId, setProjectId] = useState(data.projects[0].id)
  const project = data.projects.find((item) => item.id === projectId) ?? data.projects[0]
  const openProject = (id: string) => { setProjectId(id); setScreen('work') }
  const totalWork = data.projects.reduce((sum, item) => sum + Object.values(item.stages).reduce((acc, stage) => acc + stage.workTotal, 0), 0)
  const doneWork = data.projects.reduce((sum, item) => sum + Object.values(item.stages).reduce((acc, stage) => acc + stage.workDone, 0), 0)

  return <div className="proto-root">
    <header className="proto-top">
      <div className="proto-brand">
        <p className="eyebrow">动画制作委员会 / 静态原型 WP10</p>
        <h1>{data.company.name}<span className="title-period">。</span></h1>
        <p className="proto-sub">第 {data.company.week} / {data.company.totalWeeks} 周 · {data.projects.length} 部在制 · 总工作量 {doneWork} / {totalWork}</p>
      </div>
      <nav className="proto-nav" aria-label="原型界面切换">
        {(Object.keys(tabNames) as Screen[]).map((item) => <button key={item} className={`nav-tab${screen === item ? ' is-active' : ''}`} onClick={() => setScreen(item)}>{tabNames[item]}</button>)}
      </nav>
      {screen === 'work' && <div className="proto-switch" aria-label="作品切换">{data.projects.map((item) => <button key={item.id} className={`switch-chip${item.id === project.id ? ' is-active' : ''}`} onClick={() => setProjectId(item.id)}>{item.title}<small>{scaleNames[item.scale]}</small></button>)}</div>}
    </header>

    {screen === 'company' ? <CompanyOverview data={data} onOpen={openProject} /> : screen === 'work' ? <WorkDetail project={project} data={data} onBack={() => setScreen('company')} /> : <WeeklyOperations data={data} onOpenProject={openProject} />}

    <footer className="proto-foot">
      <p>本页面是 WP10「UI 信息架构与静态原型」：结构、线框、信息字段与交互层级用于可玩性评审，全部为模拟数据，不读取后端接口、不实现周推进与存档，也不代表玩法参数已冻结。</p>
      <p className="proto-foot-meta">依据 docs/CORE_GAMEPLAY_REBUILD_FRAMEWORK.md（2026-11-24 重构基线）· 标记含义：已确认 / 设计建议 / 待负责人决定 / 原型样本 · 访问方式 <code>?view=prototype</code></p>
    </footer>
  </div>
}

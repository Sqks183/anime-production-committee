import { ArrowUpRight, FolderOpen } from 'lucide-react'
import { useGameStore } from '../stores/gameStore'
import type { useGameCore } from '../hooks/useGameCore'

export function HomePage({ core }: { core: ReturnType<typeof useGameCore> }) {
  const { start, load, resume, game, busy } = useGameStore()
  return <main className="home-layout">
    <section className="home-copy enter">
      <p className="eyebrow">制作室 / PRODUCTION OFFICE</p>
      <h1>动画制作<br /><span>委员会</span><span className="title-period">。</span></h1>
      <p className="english-title">ANIME PRODUCTION COMMITTEE</p>
      <p className="intro">从一份企划，到最后一帧。<br />你的动画制作公司，从这里开始。</p>
      <button className="button primary start-button" onClick={() => void start()} disabled={busy || core.status !== 'ready'}>
        开始经营 <ArrowUpRight size={22} aria-hidden="true" />
      </button>
      {game && <button className="text-button" onClick={resume} disabled={busy}>继续经营</button>}
      <button className="text-button" onClick={() => void load()} disabled={busy}>
        <FolderOpen size={17} aria-hidden="true" />读取本地存档
      </button>
    </section>
    <aside className="project-sheet enter" aria-label="制作企划说明">
      <div className="sheet-top"><span>PROJECT FILE</span><span>NO. 001</span></div>
      <div className="sheet-illustration" aria-hidden="true">
        <div className="frame-corner corner-a" /><div className="frame-corner corner-b" />
        <img className="sheet-frame" src="/assets/production/colored_frame.png" alt="" />
        <span>第一份动画企划</span><span className="frame-count">CUT 001 / TAKE 01</span>
      </div>
      <div className="sheet-title"><h2>制作，准备开始。</h2><span className="seal">筹备中</span></div>
      <p>接手企划，安排团队，应对制作现场。<br />从每周排班到项目结算，写下工作室的第一章。</p>
      <div className="sheet-bottom"><span>PRODUCTION SLICE</span><span>v3</span></div>
    </aside>
  </main>
}

import { ArrowUpRight, Clapperboard, FolderOpen } from 'lucide-react'
import { useGameStore } from '../stores/gameStore'

export function HomePage() {
  const start = useGameStore((state) => state.start)
  const load = useGameStore((state) => state.load)
  const busy = useGameStore((state) => state.busy)
  return <main className="home-layout">
    <section className="home-copy enter">
      <p className="eyebrow">制作室 / PRODUCTION OFFICE</p>
      <h1>动画制作<br /><span>委员会</span><span className="title-period">。</span></h1>
      <p className="english-title">ANIME PRODUCTION COMMITTEE</p>
      <p className="intro">从一份企划，到最后一帧。<br />你的动画制作公司，从这里开始。</p>
      <button className="button primary start-button" onClick={start} disabled={busy}>
        开始经营 <ArrowUpRight size={22} aria-hidden="true" />
      </button>
      <button className="text-button" onClick={() => void load()} disabled={busy}>
        <FolderOpen size={17} aria-hidden="true" />读取本地存档
      </button>
    </section>
    <aside className="project-sheet enter" aria-label="工程验证企划说明">
      <div className="sheet-top"><span>PROJECT FILE</span><span>NO. 001</span></div>
      <div className="sheet-illustration" aria-hidden="true">
        <div className="frame-corner corner-a" /><div className="frame-corner corner-b" />
        <Clapperboard strokeWidth={1} size={104} />
        <span>第一份动画企划</span><span className="frame-count">CUT 001 / TAKE 01</span>
      </div>
      <div className="sheet-title"><h2>制作，准备开始。</h2><span className="seal">筹备中</span></div>
      <p>项目开发中。本版本仅验证工程链路，<br />不代表最终玩法或视觉设计。</p>
      <div className="sheet-bottom"><span>ENGINEERING PREVIEW</span><span>v0.1</span></div>
    </aside>
  </main>
}

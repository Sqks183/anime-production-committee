import { Clapperboard, RotateCw } from 'lucide-react'
import { StatusBadge } from './components/StatusBadge'
import { useGameCore } from './hooks/useGameCore'
import { HomePage } from './pages/HomePage'
import { StudioPage } from './pages/StudioPage'
import { useGameStore } from './stores/gameStore'

export default function App() {
  const core = useGameCore()
  const screen = useGameStore((state) => state.screen)
  const error = useGameStore((state) => state.error)
  const notice = useGameStore((state) => state.notice)
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><Clapperboard size={24} aria-hidden="true" /><span>动画制作委员会<small>ANIME PRODUCTION COMMITTEE</small></span></div><StatusBadge status={core.status} /></header>
    {(core.error || error) && <div className="feedback error" role="alert"><span>{core.error || error}</span>{core.status === 'error' && <button className="text-button" onClick={() => void core.retry()}><RotateCw size={16} aria-hidden="true" />重试加载</button>}</div>}
    {notice && <div className="feedback" role="status">{notice}</div>}
    {screen === 'home' ? <HomePage /> : <StudioPage core={core} />}
    <footer className="app-footer"><span>独立动画制作室 <span className="footer-divider">/</span> 工程验证版</span><span>项目开发中 · 本地存档 · 单人体验</span></footer>
  </div>
}

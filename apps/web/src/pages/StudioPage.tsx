import { ArrowLeft, ArrowRight, Coins, Save, FolderOpen, Code2 } from 'lucide-react'
import { useGameStore } from '../stores/gameStore'
import type { useGameCore } from '../hooks/useGameCore'

export function StudioPage({ core }: { core: ReturnType<typeof useGameCore> }) {
  const { game, busy, result, advance, save, load, goHome } = useGameStore()
  return <main className="studio-layout enter">
    <div className="studio-heading">
      <div><p className="eyebrow">PRODUCTION DESK / 工程验证</p><h1>制作进行室<span className="title-period">。</span></h1></div>
      <button className="text-button" onClick={goHome} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />返回首页</button>
    </div>
    <div className="studio-grid">
      <section className="ledger" aria-label="经营状态">
        <div className="ledger-heading"><h2>第一份动画企划</h2><span>示例数据</span></div>
        <div className="budget-block"><p><Coins size={17} aria-hidden="true" />当前资金</p><strong data-testid="budget"><small>¥</small>{game.budget.toLocaleString('zh-CN')}</strong></div>
        <div className="progress-heading"><span>当前制作进度</span><strong data-testid="progress">{game.progress}<small>%</small></strong></div>
        <progress value={game.progress} max={100} aria-label="当前制作进度">{game.progress}%</progress>
        <div className="progress-labels"><span>企划启动</span><span>制作完成</span></div>
        <button className="button primary advance-button" onClick={() => void advance()} disabled={busy || core.status !== 'ready' || game.progress >= 100}>
          {busy ? '处理中…' : game.progress >= 100 ? '示例制作已完成' : '推进一次制作进度'}<ArrowRight size={20} aria-hidden="true" />
        </button>
        <p className="demo-note">仅用于接口验证：每次消耗 5,000，进度增加 5。<br />不是正式游戏数值；计算由 C++ 完成。</p>
        <div className="save-actions"><button className="button secondary" onClick={() => void save()} disabled={busy}><Save size={16} aria-hidden="true" />保存进度</button><button className="button secondary" onClick={() => void load()} disabled={busy}><FolderOpen size={16} aria-hidden="true" />读取存档</button></div>
        <p className="local-note">存档仅保存在此浏览器，不会上传。</p>
      </section>
      <section className="result-panel" aria-label="C++ 计算结果">
        <div className="result-heading"><Code2 size={19} aria-hidden="true" /><h2>核心计算回执</h2><span>JSON</span></div>
        <dl className="connection-details"><div><dt>规则引擎</dt><dd>C++17 → WebAssembly</dd></div><div><dt>调用接口</dt><dd>advance_day()</dd></div><div><dt>固定示例种子</dt><dd>{game.seed}</dd></div></dl>
        <div className="receipt" aria-live="polite">
          {result ? <><p className="receipt-label">C++ 返回结果</p><pre className="font-mono" data-testid="core-result">{JSON.stringify(result, null, 2)}</pre><p className="receipt-message">{result.message}</p></> : <div className="empty-receipt"><span>—</span><p>等待第一份制作回执</p><small>推进制作后，在这里查看真实核心返回值。</small></div>}
        </div>
        <p className="result-footnote">相同输入，得到相同结果。<br />种子由 TypeScript 持有并传入核心。</p>
      </section>
    </div>
  </main>
}

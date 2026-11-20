import { ArrowLeft, ArrowRight, Coins, Save, FolderOpen, FileText } from 'lucide-react'
import { useGameStore } from '../stores/gameStore'
import type { useGameCore } from '../hooks/useGameCore'
import { isAssignment, isPolicy } from '../types/game'
import type { EndReason, Phase, ProjectType, StaffRole, Stage } from '../types/game'

const stages: Stage[] = ['pre', 'mid', 'post']
const stageNames: Record<Stage, string> = { pre: '前期 · 分镜演出', mid: '中期 · 原画动画', post: '后期 · 摄影合成' }
const roles: Record<StaffRole, string> = { director: '导演', key_animator: '原画', animator: '动画', photographer: '摄影' }
const projectTypes: Record<ProjectType, string> = { ova: 'OVA', tv: '电视动画', movie: '剧场版' }
const phases: Record<Phase, string> = { idle: '等待企划', producing: '制作中', event_pending: '等待事件处理', ended: '等待结算' }
const endReasons: Record<EndReason, string> = { completed: '制作完成', deadline: '截止强制交付', bankrupt: '资金破产' }
const money = (value: number) => value.toLocaleString('zh-CN')
const signed = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`

export function StudioPage({ core }: { core: ReturnType<typeof useGameCore> }) {
  const { game, busy, report, result, startProject, decide, advance, resolveEvent, settle, save, load, goHome } = useGameStore()
  if (!game) return null
  const unavailable = busy || core.status !== 'ready'
  const producing = game.phase === 'producing'
  const project = game.project
  return <main className="studio-layout enter" aria-busy={busy}>
    <div className="studio-heading">
      <div><p className="eyebrow">PRODUCTION DESK / 今日制作台</p><h1>制作进行室<span className="title-period">。</span></h1></div>
      <button className="text-button" onClick={goHome} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />返回首页</button>
    </div>
    <section className="studio-summary" aria-label="经营状态">
      <div className="budget-block"><p><Coins size={17} aria-hidden="true" />当前资金 / 日元</p><strong data-testid="funds"><small>¥</small>{money(game.funds)}</strong></div>
      <dl className="studio-facts">
        <div><dt>当前日</dt><dd data-testid="day">{game.day}</dd></div>
        <div><dt>公司声望</dt><dd>{game.reputation}</dd></div>
        <div><dt>经营阶段</dt><dd>{phases[game.phase]}</dd></div>
        <div><dt>当前种子</dt><dd>{game.seed}</dd></div>
      </dl>
    </section>

    {result && <section className="settlement ledger" aria-label="项目结算" data-testid="project-result">
      <div className="ledger-heading"><h2>项目结算</h2><span>{endReasons[result.end_reason]}</span></div>
      <div className="settlement-content"><div className="result-grade"><span>质量评级</span><strong>{result.grade}</strong></div>
        <dl className="result-values">
          <div><dt>成品质量</dt><dd>{result.quality_score}</dd></div>
          <div><dt>商业收入</dt><dd>¥{money(result.revenue)}</dd></div>
          <div><dt>累计成本</dt><dd>¥{money(result.cost)}</dd></div>
          <div><dt>项目利润</dt><dd>¥{signed(result.profit)}</dd></div>
          <div><dt>声望变化</dt><dd>{signed(result.reputation_delta)}</dd></div>
        </dl>
      </div>
      <p className="local-note">结算已由核心入账，可以接手下一份企划。</p>
    </section>}

    {game.phase === 'idle' && <section className="offers-section" aria-label="企划报价">
      <div className="section-heading"><h2>桌上的三份企划</h2><p>选择下一部作品，制作拨款由核心入账。</p></div>
      <div className="offer-grid">{game.offers.map((offer) => {
        const locked = game.reputation < offer.min_reputation
        return <article className="offer-card" key={offer.id}>
          <p className="eyebrow">{projectTypes[offer.type]} / 企划书</p><h3>{offer.name}</h3>
          <dl className="connection-details">
            <div><dt>制作拨款</dt><dd>¥{money(offer.budget)}</dd></div>
            <div><dt>工期</dt><dd>{offer.duration_days} 天</dd></div>
            <div><dt>目标质量</dt><dd>{offer.target_quality}</dd></div>
            <div><dt>声望要求</dt><dd>{offer.min_reputation}{locked ? ' · 尚未解锁' : ' · 可接手'}</dd></div>
          </dl>
          <button className="button secondary" disabled={unavailable || locked} onClick={() => void startProject(offer.id)}>接手：{offer.name}</button>
        </article>
      })}</div>
    </section>}

    {project && <div className="studio-grid">
      <section className="ledger" aria-label="项目制作">
        <div className="ledger-heading"><h2>{project.name}</h2><span>{projectTypes[project.type]}</span></div>
        <dl className="project-facts">
          <div><dt>开工日</dt><dd>{project.start_day}</dd></div><div><dt>截止日</dt><dd>{project.deadline_day}</dd></div>
          <div><dt>目标质量</dt><dd>{project.target_quality}</dd></div><div><dt>累计支出</dt><dd>¥{money(project.spent)}</dd></div>
        </dl>
        <div className="stage-grid">{stages.map((stage) => <section className="stage-card" key={stage} aria-label={stageNames[stage]}>
          <h3>{stageNames[stage]}</h3>
          <div className="progress-heading"><span>进度</span><strong data-testid={`progress-${stage}`}>{project.stages[stage].progress}<small>%</small></strong></div>
          <progress value={project.stages[stage].progress} max={100} aria-label={`${stageNames[stage]}进度`} />
          <p className="stage-quality">质量 <strong>{project.stages[stage].quality}</strong></p>
          <label className="check-control"><input type="checkbox" checked={project.stages[stage].outsourced} disabled={unavailable || !producing} onChange={(event) => void decide({ type: 'outsource', stage, enabled: event.target.checked })} />当日外包</label>
        </section>)}</div>
        <label className="policy-control">制作方针<select aria-label="制作方针" value={project.policy} disabled={unavailable || !producing} onChange={(event) => {
          if (isPolicy(event.target.value)) void decide({ type: 'policy', policy: event.target.value })
        }}><option value="rush">赶工</option><option value="normal">正常</option><option value="polish">精修</option></select></label>
        <p className="local-note">排班与方针交由核心处理；加班、外包仅对当天有效。</p>
        {game.phase !== 'ended' && <button className="button primary advance-button" onClick={() => void advance()} disabled={unavailable || !producing}>推进今天<ArrowRight size={20} aria-hidden="true" /></button>}
        {game.phase === 'event_pending' && <p className="action-note">请先处理制作事件，再推进今天。</p>}
        {game.phase === 'ended' && <><p className="action-note">{game.end_reason && endReasons[game.end_reason]}，请领取项目结算。</p><button className="button primary advance-button" onClick={() => void settle()} disabled={unavailable}>结算项目<ArrowRight size={20} aria-hidden="true" /></button></>}
      </section>
      <section className="ledger staff-panel" aria-label="员工排班">
        <div className="ledger-heading"><h2>今日人员安排</h2><span>STAFF SHEET</span></div>
        {game.staff.map((person) => <div className="staff-row" key={person.id}>
          <div className="staff-name"><h3>{person.name}</h3><span>{roles[person.role]}</span></div>
          <p className="staff-stats">技能 {person.skill} <span>士气 {person.morale}</span></p>
          <div className="staff-controls"><label>排班<select aria-label={`${person.name}排班`} value={person.assignment} disabled={unavailable || !producing} onChange={(event) => {
            if (isAssignment(event.target.value)) void decide({ type: 'assign', staff_id: person.id, assignment: event.target.value })
          }}><option value="pre">前期</option><option value="mid">中期</option><option value="post">后期</option><option value="rest">休息</option></select></label>
            <label className="check-control"><input type="checkbox" aria-label={`${person.name}加班`} checked={person.overtime} disabled={unavailable || !producing || person.assignment === 'rest'} onChange={(event) => void decide({ type: 'overtime', staff_id: person.id, enabled: event.target.checked })} />加班</label>
          </div>
        </div>)}
      </section>
    </div>}

    {game.phase === 'event_pending' && game.pending_event && <section className="event-panel ledger" aria-label="制作事件">
      <p className="eyebrow">PRODUCTION EVENT / 待处理</p><h2>{game.pending_event.title}</h2><p>{game.pending_event.description}</p>
      <div className="event-options">{game.pending_event.options.map((option) => <button className="button secondary" key={option.id} disabled={unavailable} onClick={() => void resolveEvent(option.id)}>{option.label}</button>)}</div>
    </section>}

    <section className="result-panel daily-report" aria-label="每日制作回执">
      <div className="result-heading"><FileText size={19} aria-hidden="true" /><h2>每日制作回执</h2><span>C++ / WASM</span></div>
      {report ? <div className="report-content" data-testid="day-report">
        <div><p className="receipt-label">第 {report.day} 日 / 核心回执</p><p className="receipt-message">{report.message}</p><p className="report-rework">返工：{report.rework ? '是' : '否'}</p></div>
        <dl className="report-values"><div><dt>资金变化</dt><dd>¥{signed(report.funds_delta)}</dd></div><div><dt>平均士气变化</dt><dd>{signed(report.morale_delta)}</dd></div>
          {report.stage_deltas.map((item) => <div key={item.stage}><dt>{stageNames[item.stage]}</dt><dd>进度 {signed(item.progress)} / 质量 {signed(item.quality)}</dd></div>)}
        </dl>
      </div> : <p className="empty-report">等待第一份制作回执。推进今天后，在这里查阅核心返回的制作结果。</p>}
    </section>
    <div className="save-actions"><button className="button secondary" onClick={() => void save()} disabled={busy}><Save size={16} aria-hidden="true" />保存进度</button><button className="button secondary" onClick={() => void load()} disabled={busy}><FolderOpen size={16} aria-hidden="true" />读取存档</button></div>
    <p className="local-note">存档仅保存在此浏览器，不会上传。当前种子随核心每日推进，用于复现经营状态。</p>
  </main>
}

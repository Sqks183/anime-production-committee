import { ArrowLeft } from 'lucide-react'
import { abilityNames, channelNames, effortNames, ledgerNames, modeNames, outsourceNames, priorityNames, roleNames, scaleNames, sourceNames, stageNames, STAGES } from './model'
import type { Project, PrototypeData } from './model'
import { Bar, Panel, RiskTag, signedYuan, Stat, yuan } from './bits'

const projectStatusNames = { producing: '制作中', ready_to_deliver: '待交付', wrapping: '收尾中' } as const
const stageStatusNames = { pending: '未开始', active: '进行中', completed: '已完成' } as const
const outsourceStatusNames = { active: '在制', delivered: '已交付', at_risk: '排期风险' } as const
const rushNames = { off: '关闭', conditional: '有条件开启' } as const

export function WorkDetail({ project, data, onBack }: { project: Project; data: PrototypeData; onBack: () => void }) {
  const { company, staff, allocations, suppliers, outsourcing, ledger } = data
  const people = staff.filter((person) => {
    const allocation = allocations.find((item) => item.staffId === person.id)
    return allocation?.primaryProjectId === project.id || allocation?.supportProjectIds.includes(project.id)
  })
  const tasks = outsourcing.filter((task) => task.projectId === project.id)
  const entries = ledger.filter((entry) => entry.projectId === project.id)
  const gap = project.completion - project.plannedCompletion
  const weeksLeft = project.deadlineWeek - company.week

  return <div className="proto-screen">
    <Panel eyebrow={`${scaleNames[project.scale]} / ${modeNames[project.mode]} PROJECT FILE`} title={project.title}
      marks={project.marks}
      aside={<button className="text-button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />返回公司总览</button>}
      note={`${sourceNames[project.source]} · ${projectStatusNames[project.status]} · 第 ${project.startWeek} 周开工，第 ${project.deadlineWeek} 周交付，剩余 ${weeksLeft} 周`}>
      <dl className="proto-stats">
        <Stat strong label="完成度" value={`${project.completion}%`} hint={`计划 ${project.plannedCompletion}%，${gap < 0 ? `落后 ${Math.abs(gap)}` : `领先 ${gap}`} 个百分点`} />
        <Stat label="当前阶段" value={stageNames[project.currentStage]} hint={`${project.stages[project.currentStage].workDone} / ${project.stages[project.currentStage].workTotal} 工作量`} />
        <Stat label="作品质量" value={String(project.quality)} hint="质量与商业表现分开计算" />
        <Stat label="受众期待 / 商业潜力" value={`${project.audienceExpectation} / ${project.commercialPotential}`} hint={project.account.projectedCommercial} />
      </dl>
      <Bar value={project.completion} tone={gap < 0 ? 'behind' : 'lead'} />
      {project.series && <p className="proto-inline-note">系列关系：{project.series.parentTitle} · {project.series.relation}——{project.series.carried}。</p>}
    </Panel>

    <Panel eyebrow="PIPELINE / 五阶段" title="前期成果影响后期，后期无法无限修复" marks={['confirmed']}>
      <div className="stage-rail">{STAGES.map((stage) => {
        const item = project.stages[stage]
        const percent = item.workTotal === 0 ? 0 : Math.round(item.workDone / item.workTotal * 100)
        const behind = item.status === 'active' && item.weeksActual > item.weeksPlanned
        return <article className={`stage-node stage-${item.status}`} key={stage}>
          <header><h3>{stageNames[stage]}</h3><span className="stage-state">{stageStatusNames[item.status]}</span></header>
          <Bar value={percent} tone={behind ? 'behind' : item.status === 'completed' ? 'lead' : 'neutral'} />
          <p className="stage-line">工作量 <strong>{item.workDone} / {item.workTotal}</strong> · 质量 <strong>{item.quality || '—'}</strong></p>
          <p className="stage-line stage-weeks">计划 {item.weeksPlanned} 周{item.weeksActual > 0 ? ` / 实际 ${item.weeksActual} 周` : ''}{behind ? <span className="behind-tag">已超时</span> : null}</p>
          <p className="stage-focus">{item.qualityFocus.map((ability) => <span key={ability} className="chip">{abilityNames[ability]}</span>)}</p>
          {item.note && <p className="stage-note">{item.note}</p>}
        </article>
      })}</div>
      <p className="proto-footnote">阶段间不要求其他项目同步；同一项目的阶段切换由本项目的工作量与质量状态决定。</p>
    </Panel>

    <div className="proto-two-col">
      <Panel eyebrow="PLAN / 计划与执行" title="持续方针与实际差距" marks={['confirmed', 'pending']}
        aside={<p className="proto-since">自第 {project.plan.sinceWeek} 周起生效</p>}
        note="方针默认沿用，不需要每周重设；下表只展示计划与实际执行的偏离及其原因。">
        <dl className="plan-setting">
          <div><dt>投入强度</dt><dd>{effortNames[project.plan.effort]}</dd></div>
          <div><dt>优先级</dt><dd>{priorityNames[project.plan.priority]}</dd></div>
          <div><dt>外包策略</dt><dd>{outsourceNames[project.plan.outsource]}</dd></div>
          <div><dt>赶工</dt><dd>{rushNames[project.plan.rush]}</dd></div>
        </dl>
        <table className="proto-table">
          <thead><tr><th>环节</th><th>计划</th><th>实际</th><th>原因</th></tr></thead>
          <tbody>{project.planGaps.map((line) => <tr key={line.label}>
            <th scope="row">{line.label}</th><td>{line.planned}</td><td className={line.planned === line.actual ? undefined : 'cell-behind'}>{line.actual}</td><td>{line.reason}</td>
          </tr>)}</tbody>
        </table>
        <p className="proto-footnote">具体选项名称、参数与随机波动区间在玩法验证后确定（第 12 节待决事项），本页只验证信息能否被读懂。</p>
      </Panel>

      <Panel eyebrow="RESOURCES / 资源占用" title="这个项目占了谁和本周还剩多少产能" marks={['confirmed', 'sample']}>
        <ul className="people-list">{people.map((person) => {
          const allocation = allocations.find((item) => item.staffId === person.id)
          const isPrimary = allocation?.primaryProjectId === project.id
          return <li key={person.id}>
            <div className="people-head"><strong>{person.name}</strong><span>{roleNames[person.role]} · {isPrimary ? '主项目' : '本周支援'}</span></div>
            <p className="people-meta">专注 {abilityNames[allocation?.focus ?? 'planning']} · 疲劳 {person.fatigue} · 士气 {person.morale}{person.employment === 'temporary' ? ` · 项目费 ${yuan(person.projectFee)}` : ` · 周薪 ${yuan(person.weeklySalary)}`}</p>
            <p className="people-note">{person.statusNote}</p>
          </li>
        })}</ul>
        <ul className="conflict-list">{project.conflicts.map((text) => <li key={text}>{text}</li>)}</ul>
        <table className="proto-table">
          <thead><tr><th>外包任务</th><th>供应商</th><th>进度</th><th>已付</th><th>交付</th><th>状态</th></tr></thead>
          <tbody>{tasks.map((task) => {
            const supplier = suppliers.find((item) => item.id === task.supplierId)
            return <tr key={task.id}>
              <th scope="row">{stageNames[task.stage]} · {abilityNames[task.ability]}</th>
              <td>{supplier?.name ?? task.supplierId}<small className="cell-sub">可靠 {supplier?.reliability ?? '—'}</small></td>
              <td>{task.workDone} / {task.workTotal}</td>
              <td>{yuan(task.feePaid)}</td>
              <td>第 {task.dueWeek} 周</td>
              <td className={task.status === 'at_risk' ? 'cell-behind' : undefined}>{outsourceStatusNames[task.status]}</td>
            </tr>
          })}</tbody>
        </table>
        <p className="proto-footnote">支援有上限和可见代价：陈砚、郑桥、何茵、周慕同时挂在多部作品上，本周产能不能重复计算。</p>
      </Panel>
    </div>

    <Panel eyebrow="RISK / 风险与预兆" title="风险从哪来" marks={['proposal']}>
      <ul className="risk-list">{project.risks.map((risk) => <li key={risk.label}>
        <RiskTag level={risk.level} />
        <div><strong>{risk.label}</strong><p>{risk.signal}</p><span className="risk-meta">自第 {risk.sinceWeek} 周起累积</span></div>
      </li>)}</ul>
    </Panel>

    <Panel eyebrow="PROJECT ACCOUNT / 项目账" title={`${project.title}的花费与回款`} marks={['confirmed']}
      note="项目账用于分析单部作品表现；现金实际进出的是公司统一现金池，同一笔钱只扣一次。">
      <div className="proto-two-col">
        <dl className="proto-stats proto-stats-tight">
          <Stat label="合同预算" value={yuan(project.account.contractBudget)} hint={`已到账 ${yuan(project.account.received)}`} />
          <Stat label="委员会投资规模" value={project.account.investmentTotal === 0 ? '不适用（承制）' : yuan(project.account.investmentTotal)} hint={`公司承担 ${project.account.companyInvestPercent}%`} />
          <Stat label="制作费 / 外包" value={`${yuan(project.account.productionCost)} / ${yuan(project.account.outsourcingCost)}`} />
          <Stat label="项目账面结余" value={signedYuan(project.account.balance)} hint="未含未来商业分成，非公司可支配现金" />
        </dl>
        <div className="proto-stack">
          <table className="proto-table">
            <thead><tr><th>周</th><th>科目</th><th>说明</th><th>金额</th></tr></thead>
            <tbody>{entries.map((entry) => <tr key={entry.id}>
              <td>{entry.week}</td><td>{ledgerNames[entry.category]}</td><td>{entry.label}</td><td className={entry.amount < 0 ? 'cell-behind' : 'cell-ahead'}>{signedYuan(entry.amount)}</td>
            </tr>)}</tbody>
          </table>
          {project.mode === 'committee' ? <table className="proto-table">
            <thead><tr><th>委员会成员</th><th>提供渠道</th><th>投资比例</th><th>合作始于</th></tr></thead>
            <tbody>{project.committee.map((member) => <tr key={member.id}>
              <th scope="row">{member.name}</th><td>{channelNames[member.channel]}</td><td>{member.investPercent}%</td><td>第 {member.since} 周</td>
            </tr>)}</tbody>
          </table> : <p className="proto-inline-note">承制路线：合同预算即制作预算，不承担投资本金；可取得合同结余、BD 收益与委托方成功奖励，不参与委员会成员开放的非 BD 渠道分成。</p>}
          <p className="proto-footnote">{project.mode === 'committee' ? '委员会随本作成立，结算后停止活动，成员关系转入公司长期关系。' : '承制模式不通过委员会成员拓展渠道。'}</p>
        </div>
      </div>
    </Panel>
  </div>
}

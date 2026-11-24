import { useState } from 'react'
import { FileText, Flag } from 'lucide-react'
import { decisionKindNames, episodeStageShortNames, ledgerNames, riskNames, weekStateNames } from './model'
import type { PrototypeData, WorkItem } from './model'
import { Panel, RiskTag, signedPoint, signedYuan, Stat, yuan } from './bits'

const stateTones = { normal: 'state-normal', event_pending: 'state-event', cash_crisis: 'state-crisis' } as const

export function WeeklyOperations({ data, onOpenProject }: { data: PrototypeData; onOpenProject: (projectId: string) => void }) {
  const [week, setWeek] = useState(data.receipts[0].week)
  const receipt = data.receipts.find((item) => item.week === week) ?? data.receipts[0]
  const staffName = (staffId: string) => data.staff.find((person) => person.id === staffId)?.name ?? staffId
  const itemOf = (projectId: string, key: string | null): WorkItem | undefined => {
    const project = data.projects.find((item) => item.id === projectId)
    if (project === undefined || key === null) return undefined
    return [...project.commonItems, ...project.episodes.flatMap((episode) => episode.workItems)].find((item) => item.key === key)
  }

  return <div className="proto-screen">
    <div className="week-tabs" role="group" aria-label="周次快照">
      {data.receipts.map((item) => <button key={item.week} className={`week-tab${item.week === week ? ' is-active' : ''}`} onClick={() => setWeek(item.week)}>
        <span>第 {item.week} 周</span><span className={`tab-state tab-${item.state}`}>{weekStateNames[item.state]}</span>{item.event && <Flag size={13} aria-hidden="true" />}
      </button>)}
      <span className="week-note">静态快照，切换周次不会触发真实结算</span>
    </div>

    <div className={`state-banner ${stateTones[receipt.state]}`} role="status">
      <p className="state-name">{weekStateNames[receipt.state]}</p>
      <p className="state-note">{receipt.stateNote}</p>
      {receipt.crisis && <dl className="crisis-facts">
        <div><dt>结算后现金</dt><dd>{yuan(receipt.crisis.cashAfterSettle)}</dd></div>
        <div><dt>下周强制支出</dt><dd>{yuan(receipt.crisis.forcedNextWeek)}</dd></div>
        <div><dt>缺口</dt><dd className="cell-behind">{yuan(Math.max(0, receipt.crisis.forcedNextWeek - receipt.crisis.cashAfterSettle))}</dd></div>
        <div><dt>危机期限</dt><dd>第 {receipt.crisis.deadlineWeek} 周前</dd></div>
      </dl>}
    </div>

    {receipt.crisis && <Panel eyebrow="SELF RESCUE / 危机自救" title="期限内允许做什么、不允许做什么" marks={['confirmed']}
      note="危机期间周数照常推进，固定成本继续计提；制作费不计提，因为不生产。现金允许暂时为负，负数表示欠付。">
      <div className="proto-two-col">
        <ul className="quiet-list">{receipt.crisis.waysOut.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className="proto-inline-note">禁止：立项、签外包、招聘、购买电视服务、创建自定企划，以及融资以外的重大承诺与新增项目支出。系统不自动借款、不自动追加投资、也不立即破产；期限内未恢复偿付能力才进入破产结算。</p>
      </div>
    </Panel>}

    <Panel eyebrow={`WEEKLY REPORT / 第 ${receipt.week} 周公司周报`} title={receipt.headline} marks={['confirmed']}>
      <dl className="proto-stats">
        <Stat strong label="本周现金变化" value={signedYuan(receipt.cashDelta)} hint="全公司同一周统一结算，含所有在制项目" />
        <Stat label="有产出的项目" value={`${receipt.projectLines.length} 部`} hint={receipt.projectLines.length === 0 ? '危机周不生产' : `公司共 ${data.projects.length} 部在制`} />
        <Stat label="需要玩家决定" value={`${receipt.mustDecide.length} 项`} hint="其余变化不打断节奏" />
        <Stat label="状态明显变化的员工" value={`${receipt.staffLines.length} 人`} hint="疲劳与士气影响下周效率" />
      </dl>
      <ul className="cost-lines">{receipt.costLines.map((line) => <li key={line.category}>
        <span className="cost-cat">{ledgerNames[line.category]}</span><span className="cost-label">{line.label}</span>
        <span className={line.amount < 0 ? 'cost-out' : 'cost-in'}>{signedYuan(line.amount)}</span>
      </li>)}</ul>
    </Panel>

    <div className="proto-two-col">
      <Panel eyebrow="PRODUCTION / 本周各项目做了什么" title="产出与原因" marks={['confirmed', 'proposal']}
        note="一次推进，所有项目在同一事务中结算；玩家能理解结果从哪里来，但不能提前精确预知。">
        {receipt.projectLines.length === 0 ? <p className="proto-inline-note"><FileText size={16} aria-hidden="true" /> 本周所有项目工作量为 0：资金危机期间不生产，因此没有制作费计提，也没有半结算状态。</p> :
          <ul className="week-projects">{receipt.projectLines.map((line) => {
            const item = itemOf(line.projectId, line.itemKey)
            return <li key={`${line.projectId}-${line.itemKey}`}>
              <div className="week-project-head">
                <button className="link-button" onClick={() => onOpenProject(line.projectId)}>{line.title}</button>
                <span className="chip">{line.episodeIndex === null ? '公共制作' : `第 ${line.episodeIndex} 集`}</span>
                {line.stage && <span className="chip">{episodeStageShortNames[line.stage]}</span>}
                {item && <span className="chip chip-item">{item.name}</span>}
              </div>
              <p className="week-deltas">工作量 <strong>{signedPoint(line.workDelta)}</strong> · 质量 <strong>{signedPoint(line.qualityDelta)}</strong></p>
              <p className="week-detail">{line.detail}</p>
              <p className="week-reason">原因：{line.reason}</p>
            </li>
          })}</ul>}
        <ul className="people-list staff-changes">{receipt.staffLines.map((line) => <li key={line.staffId}>
          <div className="people-head"><strong>{staffName(line.staffId)}</strong><span>疲劳 {signedPoint(line.fatigueDelta)} · 士气 {signedPoint(line.moraleDelta)}</span></div>
          <p className="people-note">{line.note}</p>
        </li>)}</ul>
      </Panel>

      <div className="proto-stack">
        <Panel eyebrow="DECIDE / 必须决定" title={`本周真正需要玩家处理的 ${receipt.mustDecide.length} 件事`} marks={['confirmed', 'proposal']}
          note="只有这几类会打断玩家：核心人员重新分配、新增外包、新增花钱承诺、交付动作。持续方针与既有资源计划自动执行。">
          <ul className="decide-list">{receipt.mustDecide.map((item) => {
            const target = item.projectId
            return <li key={item.id}>
              <div className="decide-head"><strong>{item.label}</strong>{target !== null && <button className="link-button" onClick={() => onOpenProject(target)}>查看作品</button>}</div>
              <p className="decide-kind">{decisionKindNames[item.kind]}</p>
              <p className="decide-detail">{item.detail}</p>
              <ul className="decide-options">{item.options.map((option) => <li key={option}>{option}</li>)}</ul>
            </li>
          })}</ul>
          <p className="proto-footnote">选项在原型中不可点击：真实代价与结算属于后续工作流，本页只验证决策数量与表达是否够清楚。</p>
        </Panel>

        <Panel eyebrow="NO ACTION / 不用管的部分" title="自动执行与仅报告" marks={['confirmed']}>
          <h3 className="sub-heading">持续方针自动执行，未要求确认</h3>
          <ul className="quiet-list">{receipt.autoExecuted.map((line) => <li key={line}>{line}</li>)}</ul>
          <h3 className="sub-heading">仅报告，不产生操作</h3>
          <ul className="quiet-list">{receipt.reportOnly.map((line) => <li key={line}>{line}</li>)}</ul>
        </Panel>

        <Panel eyebrow="NEXT WEEK / 下周关注" title="最值得盯住的事" marks={['proposal']}>
          <ol className="focus-list">{receipt.nextFocus.map((line) => <li key={line}>{line}</li>)}</ol>
        </Panel>
      </div>
    </div>

    {receipt.event ? <Panel eyebrow="EVENT / 制作异常" title={receipt.event.title}
      marks={['proposal']}
      aside={<p className="proto-since">{receipt.event.scope === 'project' ? `归属：${data.projects.find((project) => project.id === receipt.event?.projectId)?.title ?? '—'}` : '公司级'} · 需在 {receipt.event.deadlineWeek} 周前处理</p>}
      note={`${receipt.event.tier === 'major' ? '重大事件' : '普通事件'} —— ${receipt.event.description}`}>
      <ul className="signal-list">{receipt.event.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>
      <table className="proto-table event-options">
        <thead><tr><th>选项</th><th>确定代价</th><th>可能收益</th><th>风险</th><th>适用判断</th></tr></thead>
        <tbody>{receipt.event.options.map((option) => <tr key={option.id}>
          <th scope="row">{option.label}</th>
          <td>{option.cost === 0 ? '不额外支出' : yuan(option.cost)}</td>
          <td>{option.gain}</td>
          <td><RiskTag level={option.risk} label={riskNames[option.risk]} /><span className="cell-sub">{option.riskNote}</span></td>
          <td>{option.fits}</td>
        </tr>)}</tbody>
      </table>
      <p className="proto-footnote">事件归属具体项目，多数周只显示回执；同时满足触发条件时按优先级与种子选择，不允许一周大量弹窗。</p>
    </Panel> : <Panel eyebrow="EVENT / 制作异常" title="本周没有需要处理的事件" marks={['confirmed']}>
      <p className="proto-inline-note"><FileText size={16} aria-hidden="true" /> 普通周只呈现经营回执，事件不追求每周填满。</p>
    </Panel>}

    <p className="proto-legend">图示：<span>已确认＝框架与决策登记已定</span><span>设计建议＝框架裁定</span><span>待细化参数＝框架第 11 节</span><span>原型样本＝数值仅用于评审</span>
      <span className="legend-note">口径与《核心玩法重构框架》第 12 节一致：D1–D6 均已由负责人确认，界面不把它们重列为待决事项。</span></p>
  </div>
}

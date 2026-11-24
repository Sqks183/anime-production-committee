import { channelNames, heatNames, markNames, modeNames, offerOriginNames, roleNames, scaleNames, sourceNames, stageShortNames } from './model'
import type { PrototypeData, RiskLevel } from './model'
import { Bar, Panel, RiskTag, Stat, yuan } from './bits'

const riskOrder: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

export function CompanyOverview({ data, onOpen }: { data: PrototypeData; onOpen: (projectId: string) => void }) {
  const { company, projects, staff, allocations, suppliers, marketOffers, relationships } = data
  const allocationOf = (staffId: string) => allocations.find((item) => item.staffId === staffId)
  const titleOf = (projectId: string | null) => projectId ? projects.find((project) => project.id === projectId)?.title ?? '—' : '公司级'
  const risks = projects.flatMap((project) => project.risks.map((risk) => ({ ...risk, project: project.title }))).sort((a, b) => riskOrder[a.level] - riskOrder[b.level])

  return <div className="proto-screen">
    <Panel eyebrow="COMPANY LEDGER / 公司账" title="公司现金与承诺" marks={['confirmed']}
      aside={<p className="proto-week">第 <strong>{company.week}</strong> / {company.totalWeeks} 周</p>}
      note={company.headline}>
      <dl className="proto-stats">
        <Stat strong label="现金" value={yuan(company.cash)} hint="全公司只有一个现金池，作品不设独立钱包" />
        <Stat label="下周强制支出" value={yuan(company.committedNextWeek)} hint={`工资 ${yuan(company.weeklyFixed.salary)} + 运营 ${yuan(company.weeklyFixed.operations)} + 已承诺制作费`} />
        <Stat label="可支撑周数" value={`${company.runwayWeeks} 周`} hint="按当前承诺支出估算，未计未来回款" />
        <Stat label="公司声望" value={String(company.reputation)} hint="影响可接触企划、人才与合作方" />
      </dl>
      <p className="proto-footnote">现金按周统一结算，同一笔钱只扣一次；项目账只用于分析单部作品表现，不代表公司还能花多少钱。</p>
    </Panel>

    <Panel eyebrow="PORTFOLIO / 项目组合" title="同时在制的作品" marks={['confirmed', 'sample']}
      note="三部作品处于不同阶段，进度与风险可横向比较；普通周不需要逐个打开。">
      <div className="portfolio-grid">{projects.map((project) => {
        const gap = project.completion - project.plannedCompletion
        const people = staff.filter((person) => allocationOf(person.id)?.primaryProjectId === project.id)
        const supporting = staff.filter((person) => allocationOf(person.id)?.supportProjectIds.includes(project.id))
        const weeksLeft = project.deadlineWeek - company.week
        return <article className="portfolio-card" key={project.id}>
          <p className="eyebrow">{sourceNames[project.source]} · {scaleNames[project.scale]} · {modeNames[project.mode]}</p>
          <h3>{project.title}</h3>
          <div className="portfolio-stage"><span>当前阶段：{stageShortNames[project.currentStage]}</span><span className={gap < 0 ? 'gap-behind' : 'gap-ahead'}>{gap < 0 ? '落后' : '领先'}计划 {Math.abs(gap)} 个百分点</span></div>
          <Bar value={project.completion} tone={gap < 0 ? 'behind' : 'lead'} />
          <dl className="portfolio-facts">
            <div><dt>完成度</dt><dd>{project.completion}% / 计划 {project.plannedCompletion}%</dd></div>
            <div><dt>距截止</dt><dd>{weeksLeft} 周</dd></div>
            <div><dt>质量</dt><dd>{project.quality}</dd></div>
            <div><dt>人手</dt><dd>主 {people.length} / 支援 {supporting.length}</dd></div>
          </dl>
          <p className="portfolio-risk">{project.risks.slice(0, 2).map((risk) => <RiskTag key={risk.label} level={risk.level} label={risk.label} />)}</p>
          <button className="button secondary" onClick={() => onOpen(project.id)}>打开作品详情</button>
        </article>
      })}</div>
    </Panel>

    <div className="proto-two-col">
      <Panel eyebrow="PEOPLE / 人员负荷" title="谁在哪个项目上" marks={['pending']}
        note="核心员工按「本周主项目 + 少量支援」表达；能否同周支援两部以上仍未定案（D1）。">
        <div className="staff-load">{staff.map((person) => {
          const allocation = allocationOf(person.id)
          return <div className="staff-load-row" key={person.id}>
            <div className="staff-load-id"><h3>{person.name}</h3><span>{roleNames[person.role]}{person.employment === 'temporary' ? ' · 临时' : ''}</span></div>
            <div className="staff-load-where"><strong>{titleOf(allocation?.primaryProjectId ?? null)}</strong>
              {(allocation?.supportProjectIds.length ?? 0) > 0 && <span className="support-tag">支援 {allocation!.supportProjectIds.map(titleOf).join(' / ')}</span>}
            </div>
            <div className="staff-load-meter"><label>疲劳 <b>{person.fatigue}</b></label><Bar value={person.fatigue} tone={person.fatigue >= 70 ? 'behind' : 'neutral'} /></div>
            <div className="staff-load-meter"><label>士气 <b>{person.morale}</b></label><Bar value={person.morale} tone={person.morale <= 60 ? 'behind' : 'lead'} /></div>
            {person.departureWarning && <span className="warn-tag">离职预警</span>}
          </div>
        })}</div>
        <p className="proto-footnote">周慕没有主项目、同时挂在三部作品上，是管理负荷超限的直接来源；临时员工按项目计酬、不参与长期培养。</p>
      </Panel>

      <div className="proto-stack">
        <Panel eyebrow="RISK / 近期风险" title="需要留意的经营问题" marks={['proposal']}
          note="风险带预兆出现，不按周随机摧毁项目。">
          <ul className="risk-list">{risks.map((risk) => <li key={`${risk.project}-${risk.label}`}>
            <RiskTag level={risk.level} />
            <div><strong>{risk.label}</strong><p>{risk.signal}</p><span className="risk-meta">{risk.project} · 自第 {risk.sinceWeek} 周起</span></div>
          </li>)}</ul>
        </Panel>

        <Panel eyebrow="CAPACITY / 共享产能" title="外包与管理" marks={['confirmed', 'pending']}>
          <dl className="proto-stats proto-stats-tight">
            <Stat label="管理负荷 / 容量" value={`${company.managementLoad} / ${company.managementCapacity}`} hint="超出后计划执行效率下降（数值为样本）" />
            <Stat label="已满产能供应商" value={`${suppliers.filter((item) => item.reserved >= item.weeklyCapacity).length} 家`} hint="星野线上本周产能已全部承诺给两个项目" />
          </dl>
          <ul className="conflict-list">{projects.flatMap((project) => project.conflicts.map((text) => <li key={`${project.id}-${text}`}><span>{project.title}</span>{text}</li>))}</ul>
        </Panel>
      </div>
    </div>

    <Panel eyebrow="OPPORTUNITY / 机会与关系" title="市场企划与长期合作" marks={['confirmed', 'sample']}
      note="市场按周期刷新，不会因开工一部作品就清空全公司企划。">
      <div className="proto-two-col">
        <ul className="offer-list">{marketOffers.map((offer) => <li key={offer.id}>
          <div className="offer-head"><strong>{offer.title}</strong><span>{offerOriginNames[offer.origin]} · {scaleNames[offer.scale]} · 热度{heatNames[offer.heat]}</span></div>
          <p>{offer.hook}</p>
          <p className="offer-meta">预算 {yuan(offer.budget)} · {offer.durationWeeks} 周 · 声望门槛 {offer.minReputation}{offer.blockedBy ? ` · 受阻：${offer.blockedBy}` : ''}</p>
        </li>)}</ul>
        <ul className="relation-list">{relationships.map((item) => <li key={item.id}>
          <div className="relation-head"><strong>{item.name}</strong><span>{item.kind === 'studio' ? '制作伙伴' : channelNames[item.kind]} · 自第 {item.since} 周</span></div>
          <Bar value={item.strength} tone={item.strength >= 60 ? 'lead' : 'behind'} />
          <p>{item.note}</p>
        </li>)}</ul>
      </div>
      <p className="proto-footnote">委员会随单部作品成立、结算后停止活动，但成员关系转入公司长期关系；上表为原型样本，不代表正式解锁条件。</p>
    </Panel>

    <p className="proto-legend">图示：{(['confirmed', 'proposal', 'pending', 'sample'] as const).map((mark) => <span key={mark} className={`mark mark-${mark}`}>{markNames[mark]}</span>)}
      <span className="legend-note">「待负责人决定」的内容不得当作已确认规则实现。</span></p>
  </div>
}

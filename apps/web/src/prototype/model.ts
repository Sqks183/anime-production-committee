/* WP10 静态原型：只描述界面要承载的信息，不代表已确认的规则与数值。
   依据 docs/CORE_GAMEPLAY_REBUILD_FRAMEWORK.md 与 docs/CORE_GAMEPLAY_WORKSTREAM_BREAKDOWN_2026-11-24.md。 */

export type Stage = 'script' | 'storyboard' | 'key_animation' | 'animation_check' | 'postproduction'
export type Role = 'director' | 'scriptwriter' | 'animation_director' | 'key_animator' | 'animator' | 'production_manager' | 'postproduction'
export type Ability = 'planning' | 'direction' | 'drawing' | 'animation' | 'management' | 'postproduction'
export type Source = 'manga' | 'light_novel' | 'game' | 'original'
export type Scale = 'ova' | 'short' | 'tv' | 'movie'
export type Mode = 'contract' | 'committee'
export type Channel = 'bd' | 'publisher' | 'toy' | 'music' | 'tv_broadcast'
export type Effort = 'conservative' | 'standard' | 'focused'
export type Priority = 'quality' | 'progress' | 'cost'
export type OutsourcePolicy = 'off' | 'gap' | 'active'
export type RiskLevel = 'low' | 'medium' | 'high'
export type Mark = 'confirmed' | 'proposal' | 'pending' | 'sample'

export const STAGES: Stage[] = ['script', 'storyboard', 'key_animation', 'animation_check', 'postproduction']
export const ABILITIES: Ability[] = ['planning', 'direction', 'drawing', 'animation', 'management', 'postproduction']

export const stageNames: Record<Stage, string> = {
  script: '企划与脚本', storyboard: '分镜与演出', key_animation: '原画制作', animation_check: '动画与作画检查', postproduction: '摄影与后期',
}
export const stageShortNames: Record<Stage, string> = {
  script: '脚本', storyboard: '分镜', key_animation: '原画', animation_check: '作画检查', postproduction: '后期',
}
export const roleNames: Record<Role, string> = {
  director: '导演', scriptwriter: '编剧', animation_director: '作画监督', key_animator: '原画', animator: '动画', production_manager: '制作进行', postproduction: '摄影',
}
export const abilityNames: Record<Ability, string> = {
  planning: '企划', direction: '演出', drawing: '作画', animation: '动画', management: '管理', postproduction: '后期',
}
export const sourceNames: Record<Source, string> = { manga: '漫画改编', light_novel: '轻小说改编', game: '游戏改编', original: '原创' }
export const scaleNames: Record<Scale, string> = { ova: 'OVA', short: '短篇', tv: '电视动画', movie: '剧场版' }
export const modeNames: Record<Mode, string> = { contract: '承制', committee: '制作委员会' }
export const channelNames: Record<Channel, string> = { bd: 'BD', publisher: '出版', toy: '玩具', music: '音乐', tv_broadcast: '电视' }
export const effortNames: Record<Effort, string> = { conservative: '保守', standard: '标准', focused: '集中' }
export const priorityNames: Record<Priority, string> = { quality: '质量', progress: '进度', cost: '成本' }
export const outsourceNames: Record<OutsourcePolicy, string> = { off: '不主动外包', gap: '按缺口补充', active: '积极外包' }
export const riskNames: Record<RiskLevel, string> = { low: '低', medium: '中', high: '高' }
export const markNames: Record<Mark, string> = { confirmed: '已确认', proposal: '设计建议', pending: '待负责人决定', sample: '原型样本' }

export interface Company {
  name: string
  week: number
  totalWeeks: number
  cash: number
  committedNextWeek: number
  weeklyFixed: { salary: number; operations: number }
  reputation: number
  managementCapacity: number
  managementLoad: number
  runwayWeeks: number
  headline: string
}

export interface Staff {
  id: string
  name: string
  role: Role
  employment: 'core' | 'temporary'
  abilities: Record<Ability, number>
  specialty: Ability
  fatigue: number
  morale: number
  weeklySalary: number
  projectFee: number
  departureWarning: boolean
  statusNote: string
}

export interface Allocation {
  staffId: string
  primaryProjectId: string | null
  supportProjectIds: string[]
  focus: Ability
}

export interface Supplier {
  id: string
  name: string
  specialty: Ability
  weeklyCapacity: number
  reserved: number
  unitPrice: number
  reliability: number
  note: string
}

export interface OutsourceTask {
  id: string
  supplierId: string
  projectId: string
  stage: Stage
  ability: Ability
  workTotal: number
  workDone: number
  rush: boolean
  feePaid: number
  dueWeek: number
  status: 'active' | 'delivered' | 'at_risk'
}

export interface StageProgress {
  status: 'pending' | 'active' | 'completed'
  workDone: number
  workTotal: number
  quality: number
  qualityFocus: Ability[]
  weeksPlanned: number
  weeksActual: number
  note: string | null
}

export interface PlanSetting {
  effort: Effort
  priority: Priority
  outsource: OutsourcePolicy
  rush: 'off' | 'conditional'
  sinceWeek: number
}

export interface PlanGap {
  label: string
  planned: string
  actual: string
  reason: string
}

export interface CommitteeMember {
  id: string
  name: string
  channel: Channel
  investPercent: number
  since: number
}

export interface ProjectAccount {
  contractBudget: number
  received: number
  investmentTotal: number
  companyInvestPercent: number
  productionCost: number
  outsourcingCost: number
  projectedCommercial: string
  balance: number
}

export interface RiskSignal {
  level: RiskLevel
  label: string
  signal: string
  sinceWeek: number
}

export interface Project {
  id: string
  title: string
  source: Source
  scale: Scale
  mode: Mode
  status: 'producing' | 'ready_to_deliver' | 'wrapping'
  startWeek: number
  deadlineWeek: number
  currentStage: Stage
  stages: Record<Stage, StageProgress>
  completion: number
  plannedCompletion: number
  quality: number
  audienceExpectation: number
  commercialPotential: number
  plan: PlanSetting
  planGaps: PlanGap[]
  teamIds: string[]
  conflicts: string[]
  risks: RiskSignal[]
  committee: CommitteeMember[]
  account: ProjectAccount
  series: { parentTitle: string; relation: string; carried: string } | null
  marks: Mark[]
}

export type LedgerCategory = 'contract' | 'investment' | 'commercial' | 'salary' | 'operations' | 'production' | 'temporary' | 'outsourcing' | 'event' | 'extension' | 'penalty' | 'development' | 'distribution'

export interface LedgerEntry {
  id: string
  week: number
  scope: 'company' | 'project'
  projectId: string | null
  category: LedgerCategory
  label: string
  amount: number
}

export const ledgerNames: Record<LedgerCategory, string> = {
  contract: '合同拨款', investment: '委员会投资', commercial: '商业分成', salary: '工资', operations: '运营', production: '制作费',
  temporary: '临时人员', outsourcing: '外包', event: '事件支出', extension: '延期追加', penalty: '违约扣罚', development: '前期开发', distribution: '发行成本',
}

export interface ProjectWeekLine {
  projectId: string
  title: string
  stage: Stage
  workDelta: number
  qualityDelta: number
  detail: string
  reason: string
}

export interface StaffWeekLine {
  staffId: string
  name: string
  fatigueDelta: number
  moraleDelta: number
  note: string
}

export interface DecisionItem {
  id: string
  projectId: string | null
  label: string
  detail: string
  options: string[]
}

export interface EventOption {
  id: string
  label: string
  cost: number
  gain: string
  risk: RiskLevel
  riskNote: string
  fits: string
}

export interface EventCard {
  id: string
  scope: 'project' | 'company'
  projectId: string | null
  tier: 'normal' | 'major'
  title: string
  description: string
  signals: string[]
  options: EventOption[]
  deadlineWeek: number
}

export interface WeeklyReceipt {
  week: number
  headline: string
  cashDelta: number
  costLines: { category: LedgerCategory; label: string; amount: number }[]
  projectLines: ProjectWeekLine[]
  staffLines: StaffWeekLine[]
  mustDecide: DecisionItem[]
  autoExecuted: string[]
  reportOnly: string[]
  nextFocus: string[]
  event: EventCard | null
}

export interface MarketOffer {
  id: string
  title: string
  source: Source
  scale: Scale
  origin: 'market' | 'ip_incoming' | 'self_original' | 'staff_proposal'
  budget: number
  durationWeeks: number
  minReputation: number
  heat: 'cold' | 'warm' | 'hot'
  hook: string
  blockedBy: string | null
}

export const offerOriginNames: Record<MarketOffer['origin'], string> = {
  market: '市场企划', ip_incoming: 'IP 上门', self_original: '自定原创', staff_proposal: '员工提案',
}
export const heatNames: Record<MarketOffer['heat'], string> = { cold: '偏冷', warm: '平稳', hot: '正热' }

export interface PartnerRelationship {
  id: string
  name: string
  kind: Channel | 'studio'
  since: number
  strength: number
  lastProject: string
  note: string
}

export interface WorkRecord {
  id: string
  title: string
  source: Source
  scale: Scale
  endWeek: number
  quality: number
  commercial: number
  profit: number
  rating: 'S' | 'A' | 'B' | 'C' | 'D'
  note: string
}

export interface PrototypeData {
  company: Company
  staff: Staff[]
  allocations: Allocation[]
  suppliers: Supplier[]
  outsourcing: OutsourceTask[]
  projects: Project[]
  receipts: WeeklyReceipt[]
  ledger: LedgerEntry[]
  marketOffers: MarketOffer[]
  relationships: PartnerRelationship[]
  history: WorkRecord[]
}

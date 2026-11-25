// v4 市场规则参考实现（oracle，纯函数）。
//
// 定位同 scripts/check-handover-cases.mjs / recruit-oracle.mjs：规则样本，不是运行时。
// C++ 领域实现必须给出与本模块一致的结论；改规则先改用例与 M0 §14.7，再改实现。
//
// 契约依据：M0_CONTRACT_FREEZE §14.7.2（#53 裁决）、DECISION_LOG §17 Q4、
// DESIGN_BACKLOG STATUS-49/51（初始 4/上限 10、每周自然补充、有效期 1–3 周、锁定保护）。
// 数值全部 [PLACEHOLDER]（DEFAULT_PARAMS），由 #59 标定；锁定期两周为 Q4 已确认语义。
//
// 随机原语与 kernel.cpp / recruit-oracle.mjs 同一算法（逐行 BigInt 镜像）。
// 自包含一份以避免跨未合并 PR 依赖；#99 合入后可抽共享 lib。
// 坐标：stream=market(4)，purpose=hash('offer_gen') / hash('heat')，
// 候选内 index*16+k 子坐标（k=0..15）。同 (seed,week,index) 的企划 id 终身唯一。

const MASK64 = (1n << 64n) - 1n

export const Stream = Object.freeze({
  production: 1, quality: 2, event: 3, market: 4,
  competition: 5, partner: 6, staff: 7, misc: 8,
})

export function hashText(text) {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i) & 0xff
    value = Math.imul(value, 16777619) >>> 0
  }
  return value >>> 0
}

function splitmix64(value) {
  value = (value + 0x9E3779B97F4A7C15n) & MASK64
  value = ((value ^ (value >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64
  value = ((value ^ (value >> 27n)) * 0x94D049BB133111EBn) & MASK64
  return (value ^ (value >> 31n)) & MASK64
}

export function draw(seed, week, stream, purpose, index) {
  let mixed = 0x9E3779B97F4A7C15n
  mixed ^= (BigInt(seed >>> 0) * 0x9E3779B97F4A7C15n) & MASK64
  mixed ^= (BigInt(week >>> 0) * 0xC2B2AE3D27D4EB4Fn) & MASK64
  mixed ^= (BigInt(stream >>> 0) * 0x165667B19E3779F9n) & MASK64
  mixed ^= (BigInt(purpose >>> 0) * 0x27D4EB2F165667C5n) & MASK64
  mixed ^= (BigInt(index >>> 0) * 0x9E3779B185EBCA87n) & MASK64
  return Number((splitmix64(mixed & MASK64) >> 32n) & 0xFFFFFFFFn)
}

export function drawBelow(seed, week, stream, purpose, index, bound) {
  if (bound === 0) return 0
  return draw(seed, week, stream, purpose, index) % bound
}

export const PURPOSE = Object.freeze({
  offer_gen: hashText('offer_gen'),
  heat: hashText('heat'),
})

// [PLACEHOLDER] 内容样本与生成参数，不是标定结论。
export const GENRES = Object.freeze(['action', 'fantasy', 'scifi', 'daily', 'idol', 'sports'])
export const SCALES = Object.freeze(['short', 'ova', 'tv', 'movie'])
export const HEAT_LEVELS = Object.freeze(['low', 'mid', 'high', 'boom'])

export const DEFAULT_PARAMS = Object.freeze({
  market_cap: 10,        // STATUS-49/51 已确认上限
  initial_slots: 4,      // STATUS-49/51 已确认初始
  weekly_add: 2,         // [PLACEHOLDER] 每周自然补充数量
  expiry_min: 1,         // [PLACEHOLDER] 有效期范围 1–3 周（STATUS-49 确认范围）
  expiry_max: 3,
  lock_weeks: 2,         // Q4 已确认：锁定期两周，非待标定参数
})

// ---- 企划生成 ----

export function generateOffer(seed, week, index, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const sub = (k) => draw(seed, week, Stream.market, PURPOSE.offer_gen, index * 16 + k)
  const subBelow = (k, bound) => sub(k) % bound

  const genre = GENRES[subBelow(0, GENRES.length)]
  const scale = SCALES[subBelow(1, SCALES.length)]
  const episodeCount = { short: 1, ova: 2, tv: 12, movie: 1 }[scale]
  const budget = (500 + subBelow(2, 1500)) * 10000

  return {
    id: `offer_${PURPOSE.offer_gen.toString(16)}_${week}_${index}`,
    name: `${genre}_${scale}_${week}_${index}`,
    source: 'market',
    genre,
    scale,
    contract_budget: budget,
    duration_weeks: 12 + subBelow(3, 27),
    target_quality: 40 + subBelow(4, 51),
    audience_base: 1000 + subBelow(5, 9000),
    commercial_potential: subBelow(6, 101),
    channel_potentials: {},
    channels_baseline: ['bd'],
    allowed_modes: ['contract', 'committee'],
    committee_candidates: [],
    min_reputation: subBelow(7, 120),
    required_works: [],
    previous_work_id: null,
    blueprint_id: 'tv_standard',
    episode_count: episodeCount,
    workload_scale_permille: 1000,
    origin: 'market',
    style: 'standard',
    expires_week: week + params.expiry_min + subBelow(8, params.expiry_max - params.expiry_min + 1),
    locked_until: null,
    lock_used: false,
    deposit_paid: 0,
  }
}

export function initialMarket(seed, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const slots = []
  for (let i = 0; i < params.initial_slots; i++) slots.push(generateOffer(seed, 0, i, { params }))
  return slots
}

// ---- 自然过期与锁定保护 ----

// 自然过期：week > expires_week 移除；锁定期内（week <= locked_until）不受自然过期影响。
export function expireOffers(slots, week) {
  return slots.filter((o) => week <= o.expires_week || (o.locked_until != null && week <= o.locked_until))
}

// 锁定到期未接单：锁定失效、释放市场槽位、定金不退（Q4）。
// 退款与否是 Finance 语义；oracle 只表达槽位释放，不产生任何退款流水。
export function releaseExpiredLocks(slots, week) {
  return slots.filter((o) => !(o.locked_until != null && week > o.locked_until))
}

// ---- 每周自然补充（不是清空重抽）----

export function topUpMarket(slots, seed, week, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const alive = expireOffers(slots, week)
  const free = Math.max(0, params.market_cap - alive.length)
  const add = Math.min(free, params.weekly_add)
  const added = []
  for (let i = 0; i < add; i++) added.push(generateOffer(seed, week, i, { params }))
  return { slots: [...alive, ...added], added_ids: added.map((o) => o.id) }
}

// 周结算市场步：先释放到期锁定，再自然过期，最后补充。
export function weeklyMarketStep(slots, seed, week, opts = {}) {
  const released = releaseExpiredLocks(slots, week)
  return topUpMarket(released, seed, week, opts)
}

// ---- 定金锁定（lock_offer 的企划侧效果；现金走 Finance，不在 oracle）----

export function lockOffer(offer, week, deposit) {
  if (offer.lock_used) return { error: 'INVALID_INPUT' }
  if (week > offer.expires_week) return { error: 'NOT_FOUND' }
  return {
    error: null,
    offer: { ...offer, locked_until: week + DEFAULT_PARAMS.lock_weeks, lock_used: true, deposit_paid: deposit },
  }
}

// 定金计算基数提案：企划生成时已确定的基础立项费用（Q4 优先评估方向，比例待标定）。
export function depositBase(offer) {
  return offer.contract_budget
}

// 正式接单抵扣：定金 100% 抵扣（预付款），现金守卫按差额；不得重复计成本。
export function startWorkCash(offer, totalPayable) {
  const applied = Math.min(offer.deposit_paid, totalPayable)
  return { cash_due: totalPayable - applied, deposit_applied: applied }
}

// ---- 终身唯一防绕过（INV-24）----

export function isIdReuse(id, historyIds) {
  return historyIds.includes(id)
}

// ---- 市场热度 ----

export function heatLevel(seed, week, genre) {
  return HEAT_LEVELS[drawBelow(seed, week, Stream.market, PURPOSE.heat, hashText(genre), HEAT_LEVELS.length)]
}
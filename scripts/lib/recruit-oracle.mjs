// v4 招聘规则参考实现（oracle，纯函数）。
//
// 定位与 scripts/check-handover-cases.mjs 相同：这不是游戏运行时，而是规则样本。
// M2/M3 的 C++ 领域实现必须给出与本模块一致的结论；若规则要改，先改用例与
// M0_CONTRACT_FREEZE §14.13，再改实现。
//
// 契约依据：M0_CONTRACT_FREEZE §14.13（#53 裁决，PR #97 合入）、DECISION_LOG §17 Q3、
// DEC-STAFF-006/007、DATA_DICTIONARY_V4 §3.2/§3.12。
// 目标 Staff 形状 = signing_fee + weekly_salary；project_fee 属 historical_fields，禁止出现。
// abilities/experience/potential/revealed_potential 的 JSON 形状是固定 6 键对象（不是数组），
// 与名册 Staff 一致（数据字典 §3.2）。
//
// 危机机制已废除：当前 solvency.state 恒为 normal，CRISIS_COMMITMENT_BLOCKED 是废弃占位码，
// scout 守卫不含危机分支（M0 §5 行 6 / §14.13）。
//
// 池容量、轮换数、窗口周数、概率与费用为 [PLACEHOLDER]（见 DEFAULT_PARAMS），由 #59/#58 标定；
// 职业→能力映射是 DEC-STAFF-006 留给员工模块的提案，未冻结。
//
// 随机：逐位镜像 packages/game-core/src/v4/kernel.cpp 的 draw/splitmix64/hash_text，
// 坐标 (seed, week, stream, purpose, index)，无计数器、无调用顺序依赖。
// purpose 坐标：hash_text('recruit')（常规生成）、hash_text('recruit_regular')（轮换选槽）、
// hash_text('recruit_scout')（scout 生成）。候选内部用 index*16+k 展开子坐标（k=0..15）。

const MASK64 = (1n << 64n) - 1n

export const Stream = Object.freeze({
  production: 1, quality: 2, event: 3, market: 4,
  competition: 5, partner: 6, staff: 7, misc: 8,
})

export const ABILITIES = Object.freeze([
  'planning', 'direction', 'drawing', 'animation', 'management', 'postproduction',
])

// DEC-STAFF-006 八职业。主能力映射为提案（最终映射表由员工/制作模块细化）。
export const PROFESSIONS = Object.freeze([
  '作画', '演出', '脚本', '摄影', '监督', '音乐', '声优', '美术',
])
export const PROFESSION_ABILITY = Object.freeze({
  '作画': 'drawing',
  '演出': 'direction',
  '脚本': 'planning',
  '摄影': 'postproduction',
  '监督': 'direction',
  '音乐': 'postproduction',
  '声优': 'postproduction',
  '美术': 'drawing',
})

// DEC-STAFF-007 八个特性原型（标签占位，效果不在本模块范围）。
export const TALENT_ARCHETYPES = Object.freeze([
  'burst_drain', 'steady_floor', 'mentor_boost', 'team_smooth',
  'fast_push', 'deadline_calm', 'slow_polish', 'genre_specialist',
])

export const DEFAULT_PARAMS = Object.freeze({
  scout_fee: 50000,            // [PLACEHOLDER]
  scout_count: 1,              // [PLACEHOLDER] 每次 scout 生成候选数
  scout_window_weeks: 2,       // [PLACEHOLDER] 讨论范围 1–2 周
  pool_cap: 6,                 // [PLACEHOLDER] 常规池上限（scout 候选另计）
  rotate_count: 2,             // [PLACEHOLDER] 每周部分轮换的常规候选数
  ssr_rate: 30,                // [PLACEHOLDER] 千分比
  sr_rate: 150,                // [PLACEHOLDER] 千分比
  pity_sr: 10,                 // [PLACEHOLDER] 讨论值，未冻结
  pity_ssr: 50,                // [PLACEHOLDER] 讨论值，未冻结
  signing_fee_per_ability: 1000,   // [PLACEHOLDER]
  salary_base: 20000,              // [PLACEHOLDER]
  salary_per_primary: 300,         // [PLACEHOLDER]
})

// ---- 坐标式随机（镜像 kernel.cpp）----

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
  recruit: hashText('recruit'),
  recruit_regular: hashText('recruit_regular'),
  recruit_scout: hashText('recruit_scout'),
})

// ---- 候选生成 ----

function tierOf(roll, pity, params) {
  if (roll < params.ssr_rate || pity.since_ssr >= params.pity_ssr) return 'ssr'
  if (roll < params.sr_rate || pity.since_sr >= params.pity_sr) return 'sr'
  return 'n'
}

// 保底计数推进：抽出 sr/ssr 重置对应计数；语义为提案，阈值 [PLACEHOLDER]。
export function advancePity(pity, tier) {
  return {
    since_sr: tier === 'n' ? pity.since_sr + 1 : 0,
    since_ssr: tier === 'ssr' ? 0 : pity.since_ssr + 1,
  }
}

export function generateCandidate(seed, week, index, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const pity = opts.pity ?? { since_sr: 0, since_ssr: 0 }
  const purpose = opts.purpose ?? PURPOSE.recruit
  const sub = (k) => draw(seed, week, Stream.staff, purpose, index * 16 + k)
  const subBelow = (k, bound) => sub(k) % bound

  const profession = opts.profession ?? PROFESSIONS[subBelow(1, PROFESSIONS.length)]
  const primaryAbility = PROFESSION_ABILITY[profession]
  const tier = tierOf(subBelow(0, 1000), pity, params)

  const primaryRange = { n: [20, 31], sr: [45, 31], ssr: [65, 36] }[tier]
  const primary = primaryRange[0] + subBelow(2, primaryRange[1])

  const abilities = Object.fromEntries(ABILITIES.map((ability, i) =>
    [ability, ability === primaryAbility ? primary : 5 + subBelow(3 + i, 41)]))
  const potential = Object.fromEntries(ABILITIES.map((ability, i) =>
    [ability, Math.min(100, abilities[ability] + (ability === primaryAbility ? 10 + subBelow(9, 31) : subBelow(9, 41)))]))
  const abilitySum = ABILITIES.reduce((sum, ability) => sum + abilities[ability], 0)

  const staff = {
    id: `cand_${purpose.toString(16)}_${week}_${index}`,
    name: `${profession}_${week}_${index}`,
    role: profession,
    employment: 'core',
    abilities,
    experience: Object.fromEntries(ABILITIES.map((ability) => [ability, 0])),
    potential,
    revealed_potential: Object.fromEntries(ABILITIES.map((ability) => [ability, false])),
    talent_type: TALENT_ARCHETYPES[subBelow(15, TALENT_ARCHETYPES.length)],
    signing_fee: abilitySum * params.signing_fee_per_ability,
    weekly_salary: params.salary_base + primary * params.salary_per_primary,
    fatigue: 0,
    morale: 60,
    departure_warning: false,
    assignment_work_id: null,
    last_participation: null,
    temporary_contract: null,
  }
  return { staff, tier }
}

// ---- scout 守卫（M0 §5 行 6 / §14.13；无危机分支，危机机制已废除）----

export function scoutGuard(ctx) {
  const hasRole = ctx.role != null
  const hasFocus = ctx.focus_ability != null
  if (hasRole && hasFocus) return { error: 'INVALID_INPUT' }
  if (ctx.company_status !== 'running') return { error: 'INVALID_PHASE' }
  if ((ctx.pending_count ?? 0) > 0) return { error: 'INVALID_PHASE' }
  if (ctx.last_scout_week === ctx.week) return { error: 'INVALID_PHASE' }
  if (ctx.balance < (ctx.fee ?? DEFAULT_PARAMS.scout_fee)) return { error: 'INSUFFICIENT_FUNDS' }
  return { error: null }
}

// scout 结果：新候选 + 推进后的保底计数 + last_scout_week。
// 费用扣款在真实命令中走 Finance 流水；oracle 只报告 fee，不记账。
export function scout(ctx, pool, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const fee = ctx.fee ?? params.scout_fee
  const guard = scoutGuard({ ...ctx, fee })
  if (guard.error) return { error: guard.error }

  let pity = ctx.pity ?? { since_sr: 0, since_ssr: 0 }
  const added = []
  for (let i = 0; i < params.scout_count; i++) {
    const forced = ctx.role ?? (ctx.focus_ability
      ? PROFESSIONS.find((p) => PROFESSION_ABILITY[p] === ctx.focus_ability)
      : undefined)
    const { staff, tier } = generateCandidate(ctx.seed, ctx.week, i, {
      purpose: PURPOSE.recruit_scout,
      profession: forced,
      pity,
      params,
    })
    pity = advancePity(pity, tier)
    added.push({ staff, expires_week: ctx.week + params.scout_window_weeks, origin: 'scout' })
  }
  return {
    error: null,
    pool: [...pool, ...added],
    added_ids: added.map((c) => c.staff.id),
    pity,
    last_scout_week: ctx.week,
    fee,
  }
}

// ---- 窗口到期与部分轮换（周结算固定阶段调用）----

// 窗口语义（§14.13.1）：expires_week 是首个不可签约周；week < expires_week 期间可签约，
// 进入 expires_week 周开局即失效移除。regular 候选 expires_week=null，不受窗口影响。
export function expireCandidates(pool, week) {
  return pool.filter((c) => !(c.origin === 'scout' && c.expires_week != null && week >= c.expires_week))
}

// 常规池部分轮换：先到期清理，再确定性选 rotate_count 个常规槽替换；
// 未选中的常规候选逐字段不变；scout 候选不参与常规轮换。
// pool_cap 只约束常规候选数量（提案）。
export function rotatePool(pool, seed, week, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }
  const alive = expireCandidates(pool, week)
  const regulars = alive.filter((c) => c.origin === 'regular')
  const scouts = alive.filter((c) => c.origin === 'scout')

  const slots = new Set()
  for (let i = 0; i < Math.min(params.rotate_count, regulars.length); i++) {
    slots.add(drawBelow(seed, week, Stream.staff, PURPOSE.recruit_regular, i, regulars.length))
  }
  const kept = regulars.filter((_, i) => !slots.has(i))
  const added = []
  for (const slot of [...slots].sort((a, b) => a - b)) {
    const { staff } = generateCandidate(seed, week, slot, { purpose: PURPOSE.recruit, params })
    added.push({ staff, expires_week: null, origin: 'regular' })
  }
  const regularPool = [...kept, ...added].slice(0, params.pool_cap)
  return { pool: [...regularPool, ...scouts], added_ids: added.map((c) => c.staff.id) }
}

// ---- hire 解包：包装字段不得残留名册 ----

export function unpackOnHire(candidate) {
  return { ...candidate.staff }
}
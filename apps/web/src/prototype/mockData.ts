import type { PrototypeData } from './model'

const ab = (planning: number, direction: number, drawing: number, animation: number, management: number, postproduction: number) => ({
  planning, direction, drawing, animation, management, postproduction,
})

/* 全部为静态样本数值，用于验证信息层级是否读得懂，不是平衡后的正式参数。 */
export const prototypeData: PrototypeData = {
  company: {
    name: '青梧动画制作室',
    week: 18,
    totalWeeks: 520,
    cash: 1_842_000,
    committedNextWeek: 428_000,
    weeklyFixed: { salary: 186_000, operations: 92_000 },
    reputation: 58,
    managementCapacity: 62,
    managementLoad: 78,
    runwayWeeks: 4,
    headline: '三部作品同时在制，作画产能与现金余量同时吃紧。',
  },

  staff: [
    { id: 's1', name: '林岸', role: 'director', employment: 'core', abilities: ab(62, 78, 40, 32, 55, 30), specialty: 'direction', fatigue: 61, morale: 72, weeklySalary: 42_000, projectFee: 0, departureWarning: false, statusNote: '同时挂在两部作品，演出检查被拆成两半' },
    { id: 's2', name: '陈砚', role: 'animation_director', employment: 'core', abilities: ab(48, 66, 82, 58, 40, 34), specialty: 'drawing', fatigue: 74, morale: 58, weeklySalary: 36_000, projectFee: 0, departureWarning: false, statusNote: '连续两周跨项目支援，作画修正积压' },
    { id: 's3', name: '苏未', role: 'key_animator', employment: 'core', abilities: ab(30, 44, 74, 62, 22, 26), specialty: 'drawing', fatigue: 69, morale: 55, weeklySalary: 28_000, projectFee: 0, departureWarning: false, statusNote: '本周加班一天，产出仍低于计划' },
    { id: 's4', name: '郑桥', role: 'animator', employment: 'core', abilities: ab(24, 30, 52, 68, 20, 30), specialty: 'animation', fatigue: 58, morale: 64, weeklySalary: 24_000, projectFee: 0, departureWarning: false, statusNote: '主《夜行电车》，被《雾港II》借走两天' },
    { id: 's5', name: '何茵', role: 'postproduction', employment: 'core', abilities: ab(20, 34, 26, 30, 24, 76), specialty: 'postproduction', fatigue: 44, morale: 70, weeklySalary: 26_000, projectFee: 0, departureWarning: false, statusNote: '《小满》收尾后下周可释放' },
    { id: 's6', name: '周慕', role: 'production_manager', employment: 'core', abilities: ab(56, 38, 26, 28, 72, 30), specialty: 'management', fatigue: 66, morale: 61, weeklySalary: 30_000, projectFee: 0, departureWarning: true, statusNote: '三部作品同时协调，管理负荷已超过公司容量' },
    { id: 's7', name: '白鹭', role: 'scriptwriter', employment: 'temporary', abilities: ab(64, 46, 22, 18, 20, 16), specialty: 'planning', fatigue: 35, morale: 78, weeklySalary: 0, projectFee: 90_000, departureWarning: false, statusNote: '按项目计酬，只绑定《夜行电车》' },
  ],

  allocations: [
    { staffId: 's1', primaryProjectId: 'p1', supportProjectIds: ['p3'], focus: 'direction' },
    { staffId: 's2', primaryProjectId: 'p1', supportProjectIds: ['p2'], focus: 'drawing' },
    { staffId: 's3', primaryProjectId: 'p1', supportProjectIds: [], focus: 'drawing' },
    { staffId: 's4', primaryProjectId: 'p2', supportProjectIds: ['p1'], focus: 'animation' },
    { staffId: 's5', primaryProjectId: 'p3', supportProjectIds: ['p2'], focus: 'postproduction' },
    { staffId: 's6', primaryProjectId: null, supportProjectIds: ['p1', 'p2', 'p3'], focus: 'management' },
    { staffId: 's7', primaryProjectId: 'p2', supportProjectIds: [], focus: 'planning' },
  ],

  suppliers: [
    { id: 'sp1', name: '星野线上', specialty: 'drawing', weeklyCapacity: 3, reserved: 3, unitPrice: 28_000, reliability: 74, note: '本周产能已全额承诺给两个项目' },
    { id: 'sp2', name: '藤森色彩', specialty: 'postproduction', weeklyCapacity: 2, reserved: 1, unitPrice: 22_000, reliability: 86, note: '剩一份排期，可临时加塞' },
    { id: 'sp3', name: '明石動画', specialty: 'animation', weeklyCapacity: 4, reserved: 2, unitPrice: 18_000, reliability: 62, note: '便宜但不稳定，上周返工一张' },
  ],

  outsourcing: [
    { id: 'o1', supplierId: 'sp1', projectId: 'p1', stage: 'key_animation', ability: 'drawing', workTotal: 60, workDone: 42, rush: false, feePaid: 84_000, dueWeek: 21, status: 'active' },
    { id: 'o2', supplierId: 'sp1', projectId: 'p2', stage: 'storyboard', ability: 'drawing', workTotal: 40, workDone: 12, rush: false, feePaid: 56_000, dueWeek: 24, status: 'at_risk' },
    { id: 'o3', supplierId: 'sp3', projectId: 'p1', stage: 'animation_check', ability: 'animation', workTotal: 50, workDone: 18, rush: false, feePaid: 45_000, dueWeek: 26, status: 'active' },
    { id: 'o4', supplierId: 'sp2', projectId: 'p3', stage: 'postproduction', ability: 'postproduction', workTotal: 30, workDone: 30, rush: false, feePaid: 44_000, dueWeek: 18, status: 'delivered' },
  ],

  projects: [
    {
      id: 'p1', title: '雾港信使 II', source: 'manga', scale: 'tv', mode: 'committee', status: 'producing',
      startWeek: 8, deadlineWeek: 34, currentStage: 'key_animation', completion: 50, plannedCompletion: 61,
      quality: 74, audienceExpectation: 71, commercialPotential: 66,
      stages: {
        script: { status: 'completed', workDone: 40, workTotal: 40, quality: 78, qualityFocus: ['planning', 'direction'], weeksPlanned: 3, weeksActual: 3, note: null },
        storyboard: { status: 'completed', workDone: 55, workTotal: 55, quality: 76, qualityFocus: ['direction'], weeksPlanned: 4, weeksActual: 4, note: null },
        key_animation: { status: 'active', workDone: 38, workTotal: 85, quality: 71, qualityFocus: ['drawing'], weeksPlanned: 8, weeksActual: 10, note: '比计划落后 2 周，返工与跨项目支援同时发生' },
        animation_check: { status: 'pending', workDone: 0, workTotal: 60, quality: 0, qualityFocus: ['animation'], weeksPlanned: 6, weeksActual: 0, note: null },
        postproduction: { status: 'pending', workDone: 0, workTotal: 25, quality: 0, qualityFocus: ['postproduction'], weeksPlanned: 5, weeksActual: 0, note: null },
      },
      plan: { effort: 'focused', priority: 'progress', outsource: 'gap', rush: 'conditional', sinceWeek: 15 },
      planGaps: [
        { label: '作画产出', planned: '每周 12', actual: '每周 8', reason: '陈砚被《夜行电车》借走两天，原画修正排队' },
        { label: '外包补位', planned: '按缺口补充', actual: '已承诺但排不上', reason: '星野线上本周产能已全部承诺给两个项目' },
        { label: '演出检查', planned: '每周 1 次', actual: '两周 1 次', reason: '林岸的主项目与支援项目冲突' },
      ],
      teamIds: ['s1', 's2', 's3', 's4'],
      conflicts: ['陈砚（作画）本周同时被《雾港信使 II》与《夜行电车》需要', '星野线上无法在本周再接新任务'],
      risks: [
        { level: 'high', label: '作画阶段落后累积', signal: '连续两周产出低于计划（-4、-6）', sinceWeek: 16 },
        { level: 'medium', label: '核心作画人员疲劳', signal: '陈砚疲劳 74 / 士气 58', sinceWeek: 15 },
        { level: 'low', label: '委员会催稿', signal: '玩具渠道要求第 20 周前看到角色设计', sinceWeek: 17 },
      ],
      committee: [
        { id: 'c1', name: '冬青社', channel: 'publisher', investPercent: 25, since: 6 },
        { id: 'c2', name: '星野周边', channel: 'toy', investPercent: 15, since: 11 },
        { id: 'c3', name: '潮汐唱片', channel: 'music', investPercent: 10, since: 9 },
        { id: 'c4', name: '青梧动画', channel: 'bd', investPercent: 40, since: 8 },
      ],
      account: {
        contractBudget: 2_600_000, received: 1_300_000, investmentTotal: 5_200_000, companyInvestPercent: 40,
        productionCost: 1_180_000, outsourcingCost: 129_000, projectedCommercial: '按当前质量与热度区间 3.1–4.6M', balance: -9000,
      },
      series: { parentTitle: '雾港信使', relation: '续作', carried: '受众认知与合作关系继承，制作质量不继承' },
      marks: ['confirmed', 'pending'],
    },
    {
      id: 'p2', title: '夜行电车', source: 'light_novel', scale: 'ova', mode: 'contract', status: 'producing',
      startWeek: 13, deadlineWeek: 29, currentStage: 'storyboard', completion: 25, plannedCompletion: 33,
      quality: 68, audienceExpectation: 59, commercialPotential: 52,
      stages: {
        script: { status: 'completed', workDone: 24, workTotal: 24, quality: 72, qualityFocus: ['planning'], weeksPlanned: 3, weeksActual: 4, note: '编剧更换导致多花一周' },
        storyboard: { status: 'active', workDone: 14, workTotal: 36, quality: 66, qualityFocus: ['direction'], weeksPlanned: 5, weeksActual: 3, note: '比计划落后 1 周' },
        key_animation: { status: 'pending', workDone: 0, workTotal: 48, quality: 0, qualityFocus: ['drawing'], weeksPlanned: 7, weeksActual: 0, note: null },
        animation_check: { status: 'pending', workDone: 0, workTotal: 30, quality: 0, qualityFocus: ['animation'], weeksPlanned: 4, weeksActual: 0, note: null },
        postproduction: { status: 'pending', workDone: 0, workTotal: 12, quality: 0, qualityFocus: ['postproduction'], weeksPlanned: 3, weeksActual: 0, note: null },
      },
      plan: { effort: 'standard', priority: 'progress', outsource: 'gap', rush: 'off', sinceWeek: 13 },
      planGaps: [
        { label: '分镜推进', planned: '每周 6', actual: '每周 4.5', reason: '白鹭到岗晚一周，演出人手不足' },
        { label: '赶工', planned: '关闭', actual: '关闭', reason: '承制合同违约扣罚高，暂不开启' },
      ],
      teamIds: ['s4', 's7', 's2', 's5'],
      conflicts: ['陈砚的作画支援要到《雾港II》原画收口后才能稳定'],
      risks: [
        { level: 'medium', label: '分镜截止临近', signal: '第 22 周为分镜内部节点，当前落后 1 周', sinceWeek: 17 },
        { level: 'low', label: '承制结余薄', signal: '已用制作费占合同款 46%', sinceWeek: 13 },
      ],
      committee: [],
      account: {
        contractBudget: 1_450_000, received: 700_000, investmentTotal: 0, companyInvestPercent: 0,
        productionCost: 660_000, outsourcingCost: 56_000, projectedCommercial: '承制不参与非 BD 渠道分成', balance: -16_000,
      },
      series: null,
      marks: ['confirmed'],
    },
    {
      id: 'p3', title: '小满', source: 'original', scale: 'short', mode: 'committee', status: 'producing',
      startWeek: 10, deadlineWeek: 22, currentStage: 'postproduction', completion: 97, plannedCompletion: 94,
      quality: 79, audienceExpectation: 52, commercialPotential: 45,
      stages: {
        script: { status: 'completed', workDone: 12, workTotal: 12, quality: 80, qualityFocus: ['planning'], weeksPlanned: 2, weeksActual: 2, note: null },
        storyboard: { status: 'completed', workDone: 16, workTotal: 16, quality: 79, qualityFocus: ['direction'], weeksPlanned: 2, weeksActual: 3, note: '原创反复磨分镜，多花一周' },
        key_animation: { status: 'completed', workDone: 20, workTotal: 20, quality: 76, qualityFocus: ['drawing'], weeksPlanned: 3, weeksActual: 3, note: null },
        animation_check: { status: 'completed', workDone: 18, workTotal: 18, quality: 75, qualityFocus: ['animation'], weeksPlanned: 2, weeksActual: 2, note: null },
        postproduction: { status: 'active', workDone: 10, workTotal: 12, quality: 79, qualityFocus: ['postproduction'], weeksPlanned: 2, weeksActual: 2, note: '本周收口' },
      },
      plan: { effort: 'standard', priority: 'quality', outsource: 'off', rush: 'off', sinceWeek: 10 },
      planGaps: [ { label: '后期收口', planned: '第 18 周完成', actual: '预计第 19 周完成', reason: '藤森色彩排期顺延一天' } ],
      teamIds: ['s5', 's1'],
      conflicts: ['何茵若提前释放，可缓解《夜行电车》的后期排队'],
      risks: [ { level: 'low', label: '原创短篇商业回收有限', signal: '受众认知低，靠口碑与奖项', sinceWeek: 10 } ],
      committee: [
        { id: 'c5', name: '潮汐唱片', channel: 'music', investPercent: 20, since: 9 },
        { id: 'c6', name: '第四电视台', channel: 'tv_broadcast', investPercent: 10, since: 2 },
        { id: 'c7', name: '青梧动画', channel: 'bd', investPercent: 50, since: 10 },
      ],
      account: {
        contractBudget: 900_000, received: 900_000, investmentTotal: 1_800_000, companyInvestPercent: 50,
        productionCost: 742_000, outsourcingCost: 44_000, projectedCommercial: '短篇区间 0.6–1.1M，含奖项加成', balance: 114_000,
      },
      series: null,
      marks: ['confirmed', 'sample'],
    },
  ],

  ledger: [
    { id: 'l1', week: 18, scope: 'company', projectId: null, category: 'salary', label: '正式员工工资（7 人）', amount: -186_000 },
    { id: 'l2', week: 18, scope: 'company', projectId: null, category: 'operations', label: '工作室运营与水电设备', amount: -92_000 },
    { id: 'l3', week: 18, scope: 'project', projectId: 'p2', category: 'contract', label: '《夜行电车》第二期合同款', amount: 350_000 },
    { id: 'l4', week: 18, scope: 'project', projectId: 'p1', category: 'production', label: '《雾港II》原画制作费', amount: -60_000 },
    { id: 'l5', week: 18, scope: 'project', projectId: 'p1', category: 'outsourcing', label: '星野线上作画外包（第 4 批）', amount: -28_000 },
    { id: 'l6', week: 17, scope: 'project', projectId: 'p3', category: 'outsourcing', label: '藤森色彩后期收尾', amount: -22_000 },
    { id: 'l7', week: 17, scope: 'company', projectId: null, category: 'salary', label: '正式员工工资（7 人）', amount: -186_000 },
    { id: 'l8', week: 16, scope: 'project', projectId: 'p1', category: 'investment', label: '《雾港II》委员会首期投资到账', amount: 1_300_000 },
  ],

  receipts: [
    {
      week: 18,
      headline: '《小满》进入收口，作画缺口成为本周唯一硬约束。',
      cashDelta: -16_000,
      costLines: [
        { category: 'contract', label: '《夜行电车》合同款', amount: 350_000 },
        { category: 'salary', label: '工资', amount: -186_000 },
        { category: 'operations', label: '运营', amount: -92_000 },
        { category: 'production', label: '制作费', amount: -60_000 },
        { category: 'outsourcing', label: '外包', amount: -28_000 },
      ],
      projectLines: [
        { projectId: 'p1', title: '雾港信使 II', stage: 'key_animation', workDelta: 8, qualityDelta: 2, detail: '原画 38 / 85，落后计划 2 周', reason: '陈砚本周被两个项目分摊，集中投入没有兑现' },
        { projectId: 'p2', title: '夜行电车', stage: 'storyboard', workDelta: 6, qualityDelta: 1, detail: '分镜 14 / 36，落后计划 1 周', reason: '白鹭到岗，脚本返修完成，演出重新排期' },
        { projectId: 'p3', title: '小满', stage: 'postproduction', workDelta: 10, qualityDelta: 3, detail: '后期 10 / 12，下周可交付', reason: '藤森色彩交付，摄影合成一次通过' },
      ],
      staffLines: [
        { staffId: 's2', name: '陈砚', fatigueDelta: 9, moraleDelta: -7, note: '连续两周跨项目支援' },
        { staffId: 's3', name: '苏未', fatigueDelta: 6, moraleDelta: -3, note: '加班一天，仍有两张未修正' },
        { staffId: 's6', name: '周慕', fatigueDelta: 4, moraleDelta: -4, note: '同时协调三部作品，管理负荷 78 / 62' },
        { staffId: 's5', name: '何茵', fatigueDelta: -5, moraleDelta: 6, note: '《小满》收口，下周可释放' },
      ],
      mustDecide: [
        { id: 'd1', projectId: 'p1', label: '补上《雾港信使 II》的作画缺口', detail: '原画产出连续两周低于计划，落后 2 周。', options: ['追加星野线上外包（¥56,000，下周起）', '本周让陈砚只投入《雾港II》，《夜行电车》分镜顺延一周', '维持现状，把缺口推到作画检查阶段'] },
        { id: 'd2', projectId: 'p3', label: '《小满》是否本周交付', detail: '后期完成 10 / 12，质量 79。', options: ['本周交付', '延后一周打磨（追加 ¥38,000）'] },
        { id: 'd3', projectId: null, label: '现金还能撑 4 周，是否继续接企划', detail: '下周强制支出 ¥428,000，除《小满》外没有确定回款。', options: ['先接下周的短篇企划回款', '暂缓接单，等《雾港II》第三期拨款'] },
      ],
      autoExecuted: [
        '《夜行电车》持续方针「标准投入 / 进度优先 / 按缺口外包」沿用上周，未要求确认。',
        '《小满》后期检查按既定计划自动推进，收口后进入待交付。',
        '市场企划本周刷新 2 条，进入机会列表而不是弹窗。',
      ],
      reportOnly: [
        '白鹭经验 +1（企划方向），临时员工不参与长期培养。',
        '明石動画可靠性 62，本周返工一张，已计入下周排期风险。',
        '公司声望 58，本周未变化。',
      ],
      nextFocus: [
        '第 19 周：《小满》交付与公司账结算。',
        '第 21 周：星野线上产能被两部作品同时占用，需要提前排产。',
        '第 22 周：《夜行电车》分镜内部节点，当前落后 1 周。',
      ],
      event: {
        id: 'e1', scope: 'project', projectId: 'p1', tier: 'normal',
        title: '原画返工：第 7 场夜戏构图偏离演出要求',
        description: '第 7 场两张关键原画与分镜演出要求不一致，作画监督要求返工；本周作画产能本来就低于计划。',
        signals: ['连续两周作画产出低于计划（-4、-6）', '陈砚疲劳 74 / 士气 58', '第 7 场在分镜阶段已被标注为重点场次'],
        deadlineWeek: 19,
        options: [
          { id: 'o1', label: '本周返工', cost: 0, gain: '质量 +2，避免返工累积到交付阶段', risk: 'medium', riskNote: '原画进度再落后约一周', fits: '工期压力可以承受时' },
          { id: 'o2', label: '推迟到第 21 周集中返工', cost: 12_000, gain: '保住本周产出', risk: 'high', riskNote: '返工压力累积到作画检查，若届时疲劳未缓解损失更大', fits: '只在本周绝不能延期时' },
          { id: 'o3', label: '交给明石動画修正', cost: 46_000, gain: '进度与质量同时保住', risk: 'low', riskNote: '该供应商可靠性 62，可能仍需二次修正；委员会会看到外包比例上升', fits: '现金有余量时' },
        ],
      },
    },
    {
      week: 17,
      headline: '《雾港II》原画启动，外包产能第一次被两个项目抢。',
      cashDelta: -312_000,
      costLines: [
        { category: 'salary', label: '工资', amount: -186_000 },
        { category: 'operations', label: '运营', amount: -92_000 },
        { category: 'temporary', label: '临时人员', amount: -34_000 },
      ],
      projectLines: [
        { projectId: 'p1', title: '雾港信使 II', stage: 'key_animation', workDelta: 9, qualityDelta: 1, detail: '原画 30 / 85', reason: '阶段切换第一周，主要在试做镜头' },
        { projectId: 'p2', title: '夜行电车', stage: 'storyboard', workDelta: 4, qualityDelta: 0, detail: '分镜 8 / 36', reason: '脚本返修占用演出，本周分镜几乎停住' },
        { projectId: 'p3', title: '小满', stage: 'postproduction', workDelta: 8, qualityDelta: 2, detail: '后期 8 / 12', reason: '摄影稳定推进' },
      ],
      staffLines: [
        { staffId: 's2', name: '陈砚', fatigueDelta: 7, moraleDelta: -2, note: '开始跨项目支援' },
        { staffId: 's1', name: '林岸', fatigueDelta: 3, moraleDelta: 2, note: '《小满》试映反馈好于预期' },
      ],
      mustDecide: [{ id: 'd17', projectId: 'p2', label: '《夜行电车》分镜是否延后一周', detail: '演出被《雾港II》占满。', options: ['延后一周', '追加外包分镜'] }],
      autoExecuted: ['三部作品持续方针均沿用上周，未打断。'],
      reportOnly: ['《小满》音乐 demo 到位，质量 +1。'],
      nextFocus: ['原画产能缺口开始成形。'],
      event: null,
    },
    {
      week: 16,
      headline: '《雾港II》进入原画阶段，委员会催角色设计。',
      cashDelta: -278_000,
      costLines: [
        { category: 'salary', label: '工资', amount: -186_000 },
        { category: 'operations', label: '运营', amount: -92_000 },
      ],
      projectLines: [
        { projectId: 'p1', title: '雾港信使 II', stage: 'storyboard', workDelta: 11, qualityDelta: 2, detail: '分镜收口', reason: '分镜集中评审一次通过' },
        { projectId: 'p3', title: '小满', stage: 'animation_check', workDelta: 9, qualityDelta: 1, detail: '作画检查 14 / 18', reason: '外包回收两张，质量稳定' },
      ],
      staffLines: [{ staffId: 's3', name: '苏未', fatigueDelta: 5, moraleDelta: -1, note: '进入原画高负荷期' }],
      mustDecide: [{ id: 'd16', projectId: 'p1', label: '角色设计定稿送审', detail: '玩具渠道要求第 20 周前看到设计。', options: ['本周定稿', '延后一周并告知委员会'] }],
      autoExecuted: ['《夜行电车》脚本返修按方针继续。'],
      reportOnly: ['声望 +1（《小满》试映口碑）。'],
      nextFocus: ['原画阶段的工作量是脚本的 2.1 倍。'],
      event: null,
    },
  ],

  marketOffers: [
    { id: 'm1', title: '深夜食堂的季节', source: 'manga', scale: 'tv', origin: 'market', budget: 2_400_000, durationWeeks: 26, minReputation: 55, heat: 'warm', hook: '原作稳定，作画需求高，正好撞上当前的作画缺口', blockedBy: '核心作画产能不足' },
    { id: 'm2', title: '转生成路由器', source: 'light_novel', scale: 'short', origin: 'market', budget: 620_000, durationWeeks: 8, minReputation: 40, heat: 'hot', hook: '短平快，能在第 26 周前回款', blockedBy: null },
    { id: 'm3', title: '雾港·前夜', source: 'original', scale: 'ova', origin: 'self_original', budget: 900_000, durationWeeks: 12, minReputation: 50, heat: 'warm', hook: '系列认知可继承，商业基础比新 IP 稳', blockedBy: '原创必须采用委员会模式' },
    { id: 'm4', title: '《夜行》番外（员工提案）', source: 'original', scale: 'short', origin: 'staff_proposal', budget: 380_000, durationWeeks: 6, minReputation: 0, heat: 'cold', hook: '周慕提出，可作为团队练手', blockedBy: '提案槽位只有一个' },
  ],

  relationships: [
    { id: 'r1', name: '冬青社', kind: 'publisher', since: 6, strength: 72, lastProject: 'p1', note: '《雾港》原作版权方，续作由其引荐' },
    { id: 'r2', name: '星野周边', kind: 'toy', since: 11, strength: 55, lastProject: 'p1', note: '要求第 20 周前看到角色设计' },
    { id: 'r3', name: '潮汐唱片', kind: 'music', since: 9, strength: 61, lastProject: 'p3', note: '已连续合作两部，愿意小额跟投' },
    { id: 'r4', name: '第四电视台', kind: 'tv_broadcast', since: 2, strength: 38, lastProject: 'p3', note: '首次合作，档期尚未确认' },
  ],

  history: [
    { id: 'h1', title: '雾港信使', source: 'manga', scale: 'tv', endWeek: 7, quality: 74, commercial: 68, profit: 420_000, rating: 'B', note: '第一季，系列基础与冬青社关系由此建立' },
    { id: 'h2', title: '纸飞机同盟', source: 'original', scale: 'ova', endWeek: 3, quality: 61, commercial: 44, profit: -180_000, rating: 'C', note: '首部委员会原创，投资本金亏损' },
    { id: 'h3', title: '通勤星座', source: 'light_novel', scale: 'short', endWeek: 5, quality: 70, commercial: 62, profit: 96_000, rating: 'B', note: '短篇试水，回款稳定' },
  ],
}

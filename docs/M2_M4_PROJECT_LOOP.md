# M2 项目全链路 + M4 商业结算（实现说明）

> 状态：**分支实现，未完成里程碑验收**。M2 主链路（立项 → 制作 → 交付/到期强制交付 → 公司关闭 → Archive → 财务）与 M4 商业结算核心（委员会、投资、渠道、分成、伙伴关系）已落地；M2.5 危机结算与 M3 供应商/市场刷新仍是缺口。
> 契约依据：[M0_CONTRACT_FREEZE.md](M0_CONTRACT_FREEZE.md) 命令 2/10/15/16/20/21/22、§7；[DOMAIN_ARCHITECTURE.md](DOMAIN_ARCHITECTURE.md) §7.3.6/§9.3/§10.1/§10.3/§10.6；[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) M2/M4。

## 1. 已实现命令

| 命令 | 守卫 | 原子范围 |
| --- | --- | --- |
| `start_work(offer_id, mode, percent?, committee_partner_ids?)` | running ∧ 非危机 ∧ 企划存在 ∧ 模式合法 ∧（普通企划：`min_reputation` + `required_works`；原创草稿：`draft_status=valid`）∧ 委员会比例 10..100/10 ∧ 成员渠道不重复 ∧ 现金 ≥ 应付款 | 冻结企划快照、实例化蓝图、成立委员会、合同预算与投资两笔账、消费企划/草稿 |
| `deliver_work(work_id)` | running ∧ producing ∧ 本项目无 pending 事件 ∧ 全部门槛项 delivered ∧ 未过截止 | 质量聚合 → 评级 → 六窗口结算 → 分账/BD 收入 → 委员会关闭/伙伴关系 → Archive → 清归属 → 移除项目 |
| `abort_work(work_id)` | running ∧ producing ∧ 本项目无 pending 事件 | 终止归档（`aborted`）、清归属；违约扣罚系数待标定，记 0 并标记 `penalty_pending` |
| `buy_tv_service(work_id)` | 委员会模式 ∧ 无电视台成员 ∧ 未购买 ∧ 非危机 ∧ 现金 ≥ 总费用×投资比例 | 记 `distribution` 支出；结算时对适用窗口应用 130% 电视倍率 |
| `request_extension(work_id)` | 委员会模式 ∧ 未用过 ∧ 未过截止 ∧ 非危机 ∧ 现金 ≥ 25 万 | 截止周 +4、记延期费 |
| `end_company()` | running ∧ 无 pending 事件 | 锁 closing/voluntary；全部 producing 项目转 delivering、清归属；无项目时直接 ended |
| `finalize_delivery(work_id)` | closing ∧ 项目 delivering | 关闭路径交付结算；最后一个项目结清后公司转 ended |
| `finalize_company()` | ended ∧ 无在制项目 ∧ 结局未生成 | 由 Archive 生成 `company_result`，只执行一次 |

`advance_week` 内置两条自动路径（无需玩家确认）：项目到达 `deadline_week` 时按门槛完成度结算（达标 `completed`，未达标 `deadline`）；第 520 周完成当周结算后锁 `closing/time_limit`，剩余项目转 `delivering`。

通用：除 `initialize_game` 外全部“工作副本 + 一次提交”；失败不改变状态。

## 2. 企划与伙伴（M2 固定 fixture）

`initialize` 建立 3 名员工、3 个合作伙伴、4 个企划槽：

| 企划 | 题材 | 预算 | 工期 | 开放窗口（基线） | 可用模式 |
| --- | --- | --- | --- | --- | --- |
| offer_01 星海邮差 | sf | 120 万 | 26 周 | 国内配信、电视 | contract / committee |
| offer_02 雨夜食堂 | drama | 90 万 | 24 周 | 国内配信 | contract / committee |
| offer_03 机甲夏令营 | family | 150 万 | 30 周 | 国内配信、周边、电视 | committee |
| offer_04 无声的告白 | romance | 70 万 | 20 周 | 国内配信 | contract / committee |

伙伴：`partner_tv`（电视窗口）、`partner_stream`（国内配信）、`partner_pub`（出版社/IP 伙伴，不占商业窗口），关系初始 50，`status=known`。

> 这是 M2 允许的固定 fixture；M3 必须用市场刷新/竞争产生企划，并接入供应商目录，不得把 fixture 当成玩法来源。

## 3. 蓝图目录

`docs/blueprints/*.blueprint.json` 在构建期先跑 `validate-blueprint.mjs`，再打包成 `blueprint_catalog_generated.cpp`；运行时 `blueprint::find(id)` 取模板。`start_work` 按 `workload_scale_permille` 缩放 `work_total`，不改 `deliver_at`；实例化不消耗随机。

## 4. 交付结算公式（结构已定，数值全部 `[PLACEHOLDER]`）

```text
六个窗口 = 国内配信 / 海外发行 / 玩具周边 / 音乐 / 电视 / BD·DVD

质量兑现 = clamp(200 + 质量均值 × 8, 200, 1000)‰       // 均值 100 → 1000
热度     = boom 1200 / high 1100 / mid 1000 / low 900
声望     = clamp(800 + 声望 × 2, 800, 1400)‰           // 声望 100 → 1000
窗口毛收入 = 潜力 × 质量兑现 × 热度 × 声望 × 电视倍率
电视倍率 = 无播出 1000 / 成员 1250 / 无成员购买 1300
          只作用于国内配信、周边、音乐、BD/DVD
代理费   = 无对应成员但基线开放时 400‰（[PLACEHOLDER]）；成员渠道 0
净收入   = 毛收入 × (1000 − 代理费) / 1000
评级     = S ≥85 / A ≥75 / B ≥65 / C ≥50 / D（强制交付先扣 (1000−完成度)/100，最多 10 分）
强制系数 = 正常 1000 / 未达门槛 600‰
扣罚     = 预算 × (1000 − 门槛完成度) × 300/1000/1000   // 仅强制/关闭路径
```

**收入归属（DEC-BD-001 / DEC-COMM-002/003）**

- **承制**：只获得 BD/DVD 收入（归公司）；BD 收入 ≥ 合同预算时另付成功奖励 预算×20%（占位）；不参与其他窗口。
- **委员会**：BD/DVD 归公司、不进池；其余开放窗口扣代理费后汇总为 `committee_pool`；按投资比例 Pro-rata 分给公司（`commercial_share`）与其他成员（`investor_share`）。
- 电视：有电视台成员时默认获得 125% 强力播出、不可再购买；无成员时玩家可购买 130%，支付总费用 × 投资比例，其余成员共同出资。
- 声望变化：S+8 / A+5 / B+2 / C0 / D−5，唯一入口写 `reputation_log`；强制/中止不产生正向声望。
- 委员会关闭时按评级更新成员关系：S+3 / A+2 / B+1 / C0 / D−2（强制不产生正向关系），并追加 `history`。
- 门槛完成度 `gate_completion_permille` = 各门槛项 `min(1000, work_done×1000/(deliver_at×work_total))` 的平均值；正常交付恒为 1000。
- 交付结算后余额为负时只置 `solvency=crisis`（since/deadline/gap）；危机周结算与融资未实现，属 M2.5。

## 5. 财务与 Archive

流水科目：`contract_received`（+）、`investment_paid`（−）、`commercial_share_received`（+，含 BD/DVD 与委员会净池份额，靠 `memo` 区分）、`success_reward_received`（+）、`penalty`（−）、`distribution`（−，电视服务）；延期费暂记 `production`。

周薪按 DEC-ECON-001 归因：已分配到项目的核心员工记 `work_id=项目`，闲置员工记 `work_id=null`（公司级成本）。

`Archive.works` 追加一条 `WorkRecord`：作品事实、六维质量、质量分、评级、`end_reason`（`completed` / `deadline` / `company_closed` / `aborted`）、`forced`、`gate_completion_permille`、`commercial_revenue`、`bd_revenue`、`committee_pool`、`investor_share`、`company_received`、逐窗口对账、单集质量摘要、团队快照，以及 `finance_summary`（合同收入、投资本金、商业份额、BD、奖励、扣罚、`costs` 分类、`total_costs`、`profit`）。记录只追加。

`Archive.company_result` 由 `finalize_company` 写入一次：`reason`（voluntary / bankrupt / time_limit）、周数、期末现金、净现金变化、作品数、最佳作品、公司评级（暂复用作品分数线）与 highlights/negatives。

> 文中的“存档 round-trip”仅指 **GameState JSON 序列化往返**（含 pending 事件与哈希一致）；#49 的 SaveRecord envelope 尚未交付，不是完整存档功能。

## 6. 状态校验（新增）

- Staff：`signing_fee`（≥0）+ `weekly_salary`（>0），不再有 `project_fee`；employment 枚举。
- Finance：`loans` 与 `solvency.state` 必填；缺字段返回 `INVALID_INPUT`，不静默补 0。
- Project：`mode` 枚举；`status` 枚举（planning/producing/delivering/settled）；`deadline > opened`；真实项目渠道非空；承制 `committee_id=null` 且投资全 0；委员会项目必须有 `committee_id` 且比例 10..100/10。
- Committee：成员/渠道不重复、成员必须是已知伙伴、活跃委员会必须指向在制项目、成立/关闭周合法。
- Partner：类型枚举、渠道非空且唯一、关系 0..100、状态枚举。
- Market：槽位 ≤4、企划预算/工期/蓝图/渠道/模式必填、热度档位合法。
- Archive：记录 id 全局唯一、评级与 `end_reason` 枚举、`gate_completion_permille` 0..1000、结束周不晚于当前周。
- 待处理事件：`expires_week` 必须为 null；同项目至多一条；交付/中止/关闭前必须先处理，不得清空（DEC-EVENT-001）。
- 立项后 id 全局唯一（含 Archive），避免归档后复用 `work_01`。

## 7. 测试

`scripts/v4.test.mjs` 共 47 条；本轮与商业/关闭路径相关的关键用例：

1. 到期强制交付：未达门槛在结算周自动交付，`deadline`、按完成度扣罚、归档并移除项目；
2. 到期交付：门槛达成按 `completed` 正常计价，不扣罚；
3. 关闭路径：`end_company` 锁 closing 并拒绝非结清命令，`finalize_delivery` 结清转 ended，`finalize_company` 只生成一次结局；
4. 第 520 周：完成当周结算后锁 closing/time_limit，剩余项目转 `company_closed` 并可在关闭后结清；
5. 事件保留：项目有 pending 时交付/关闭被拒，跨项目事件不被清理；
6. 中止：`abort_work` 归档 `aborted`、无商业收入、释放归属；
7. 商业归属：BD 恒归公司、委员会净池按比例分账、电视倍率 1000/1250/1300 分档、代理费逐行对账；
8. 原创草稿：缺草稿/失效/有效三种路径，证明不走普通企划声望与履历守卫；
9. M1 输入边界：Staff 报酬字段与 `solvency.state` 缺失返回 `INVALID_INPUT`。

本机无 Emscripten，`npm run test:v4` 未跑；同一份测试正文用 MSVC 19.51 原生 CLI 执行 **47/47**。

## 8. 里程碑判定（如实）

| 阶段 | 已具备 | 仍缺 |
| --- | --- | --- |
| M2 | 立项（含原创草稿准入）、蓝图实例化、制作、正常交付、到期强制交付、中止、公司关闭/结清/结局、Archive、成本归因、事件闭环（PR #92） | `create_custom_offer` 草稿创建命令（开发费/槽位待标定）、真实市场来源、12 集完整人工试玩 |
| M2.5 | 预检失败拒绝整周、交付后负余额置 crisis | 危机周结算、白名单、融资、自救、破产 |
| M3 | 多项目并存、人员单项目归属、遍历顺序无关 | 企划槽刷新/竞争、供应商目录与外包、520 周长跑 |
| M4 | 委员会、投资比例、六窗口、BD 归属、净池分成、电视倍率、伙伴关系与 history | 更多伙伴/渠道类型、合作关系玩法、特殊商业机会、完整对账报表 |

**结论：不能宣称 M4 已验收。** 当前是把 M4 的商业结算核心接在 M2 主链路上；M2.5/M3 的缺口不补，M4 的“产业关系”只是一条单项目结算路径。

**实现口径待 zm 确认**：①`closing → ended` 由“无在制项目”驱动（`close_company` 或最后一个 `finalize_delivery`）；②强制系数 600‰、扣罚 30%、评价修正 10 分、代理费 40%、电视总费用 60 万均为 `[PLACEHOLDER]`；③`abort_work` 的违约扣罚系数未标定，暂记 0 并输出 `penalty_pending`；④Archive `end_reason` 增加 `aborted`（原枚举只有 completed/deadline/company_closed），需确认后再冻结。

## 9. 下一步

1. M2.5 危机状态机与融资（含危机周 7 步结算、白名单、破产判定）；
2. M2 真实市场来源与 12 集完整人工试玩；
3. M3 企划槽刷新 + 供应商/外包 + 520 周压测；
4. M4 特殊商业机会、更多伙伴渠道与关系玩法；
5. 以上全部在有 emsdk 的环境跑 `npm run test:v4` 并附输出。

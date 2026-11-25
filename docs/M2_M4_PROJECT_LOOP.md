# M2 项目全链路 + M4 商业结算（实现说明）

> 状态：**分支实现，未完成里程碑验收**。M2 主链路（立项 → 制作 → 交付 → Archive → 财务）与 M4 商业结算核心（委员会、投资、渠道、分成、伙伴关系）已落地；M2.5 危机与 M3 供应商/市场刷新仍是缺口。
> 契约依据：[M0_CONTRACT_FREEZE.md](M0_CONTRACT_FREEZE.md) 命令 2/10/15/16、§7.4/§7.5；[DOMAIN_ARCHITECTURE.md](DOMAIN_ARCHITECTURE.md) §10.1/§10.3/§10.6；[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) M2/M4。

## 1. 已实现命令

| 命令 | 守卫 | 原子范围 |
| --- | --- | --- |
| `start_work(offer_id, mode, percent?, committee_partner_ids?)` | running ∧ 非危机 ∧ 企划存在 ∧ 模式被企划允许 ∧ 委员会比例 10..100/10 ∧ 成员渠道不重复 ∧ 现金 ≥ 投资额 | 冻结企划快照、实例化蓝图、成立委员会、合同预算与投资两笔账、消费企划 |
| `deliver_work(work_id)` | producing ∧ 全部门槛项 delivered ∧ 未过截止 | 质量聚合 → 评级 → 渠道结算 → 分账入账 → 委员会关闭/伙伴关系 → Archive → 清归属/事件 → 移除项目 |
| `buy_tv_service(work_id)` | 委员会模式 ∧ 未购买 ∧ 非危机 ∧ 现金 ≥ 30 万 | 渠道集合加 tv、记发行费 |
| `request_extension(work_id)` | 委员会模式 ∧ 未用过 ∧ 未过截止 ∧ 非危机 ∧ 现金 ≥ 25 万 | 截止周 +4、记延期费 |

通用：除 `initialize_game` 外全部“工作副本 + 一次提交”；失败不改变状态。

## 2. 企划与伙伴（M2 固定 fixture）

`initialize` 建立 3 名员工、3 个合作伙伴、4 个企划槽：

| 企划 | 题材 | 预算 | 工期 | 基线渠道 | 可用模式 |
| --- | --- | --- | --- | --- | --- |
| offer_01 星海邮差 | sf | 120 万 | 26 周 | tv | contract / committee |
| offer_02 雨夜食堂 | drama | 90 万 | 24 周 | streaming | contract / committee |
| offer_03 机甲夏令营 | family | 150 万 | 30 周 | tv, publishing | committee |
| offer_04 无声的告白 | romance | 70 万 | 20 周 | streaming | contract / committee |

伙伴：`partner_tv`（tv）、`partner_stream`（streaming）、`partner_pub`（publishing），关系初始 50，`status=known`。

> 这是 M2 允许的固定 fixture；M3 必须用市场刷新/竞争产生企划，并接入供应商目录，不得把 fixture 当成玩法来源。

## 3. 蓝图目录

`docs/blueprints/*.blueprint.json` 在构建期先跑 `validate-blueprint.mjs`，再打包成 `blueprint_catalog_generated.cpp`；运行时 `blueprint::find(id)` 取模板。`start_work` 按 `workload_scale_permille` 缩放 `work_total`，不改 `deliver_at`；实例化不消耗随机。

## 4. 交付结算公式（全部 `[PLACEHOLDER]`）

```text
质量兑现 = clamp(200 + 质量均值 × 8, 200, 1000)‰       // 均值 100 → 1000
热度     = boom 1200 / high 1100 / mid 1000 / low 900
声望     = clamp(800 + 声望 × 2, 800, 1400)‰           // 声望 100 → 1000
单渠道毛收入 = 潜力 × 质量兑现 × 热度 × 声望
评级     = S ≥85 / A ≥75 / B ≥60 / C ≥45 / D
承制     = 渠道收入 0；毛收入 ≥ 预算时另付成功奖励 预算×20%
委员会   = 毛收入 × 投资比例%
```

- 渠道集合 = 企划基线渠道 ∪ 委员会成员渠道 ∪ 电视服务。
- 声望变化：S+8 / A+5 / B+2 / C0 / D−5，唯一入口写 `reputation_log`。
- 委员会关闭时按评级更新成员关系：S+3 / A+2 / B+1 / C0 / D−2，并追加 `history`。

## 5. 财务与 Archive

新增/使用的流水科目：`contract_received`（+）、`investment_paid`（−）、`commercial_share_received`（+）、`success_reward_received`（+）；电视服务与延期费暂记 `production` 并带 `memo`。

`Archive.works` 追加一条 `WorkRecord`：作品事实、六维质量、质量分、评级、商业收入、公司实收、`finance_summary`、逐渠道对账、单集质量摘要、团队快照。记录只追加；交付后项目从 `works` 移除，归属与待处理事件一并清理。

## 6. 状态校验（新增）

- Project：`mode` 枚举；`deadline > opened`；真实项目渠道非空；承制 `committee_id=null` 且投资全 0；委员会项目必须有 `committee_id` 且比例 10..100/10。
- Committee：成员/渠道不重复、成员必须是已知伙伴、活跃委员会必须指向在制项目、成立/关闭周合法。
- Partner：类型枚举、渠道非空且唯一、关系 0..100、状态枚举。
- Market：槽位 ≤4、企划预算/工期/蓝图/渠道/模式必填、热度档位合法。
- Archive：记录 id 全局唯一、评级枚举、结束周不晚于当前周。
- 立项后 id 全局唯一（含 Archive），避免归档后复用 `work_01`。

## 7. 测试

`scripts/v4.test.mjs` 新增 6 条（总 37）：

1. 承制立项：企划消费、合同预算入账、174 工作项、财务恒等式；
2. 委员会立项：委员会成立、投资两笔账、电视服务、延期只能一次；
3. 交付：门槛未达 `GATE_UNMET`；达标后评级/成功奖励/Archive/清归属/移除项目；
4. 委员会交付：按比例分账、委员会关闭、伙伴关系与 history；
5. 立项守卫：模式、比例、成员重复、资金不足、重复消费全部拒绝且状态不变；
6. 多项目 + 存档 round-trip：两部并存、交付一部不影响另一部、哈希一致。

本机无 Emscripten，`npm run test:v4` 未跑；同一份测试正文用 MSVC 19.51 原生 CLI 执行 **37/37**。

## 8. 里程碑判定（如实）

| 阶段 | 已具备 | 仍缺 |
| --- | --- | --- |
| M2 | 立项、蓝图实例化、制作、正常交付、Archive、财务流水、存档 round-trip、事件闭环（PR #92） | 到期强制交付、公司关闭路径、真实市场来源、12 集完整人工试玩 |
| M2.5 | 预检失败拒绝整周 | 危机状态、白名单、融资、自救、破产 |
| M3 | 多项目并存、人员单项目归属、遍历顺序无关 | 企划槽刷新/竞争、供应商目录与外包、520 周长跑 |
| M4 | 委员会、投资比例、渠道集合、BD/委员会分成、伙伴关系与 history | 更多伙伴/渠道类型、合作关系玩法、完整对账报表 |

**结论：不能宣称 M4 已验收。** 当前是把 M4 的商业结算核心接在 M2 主链路上；M2.5/M3 的缺口不补，M4 的“产业关系”只是一条单项目结算路径。

## 9. 下一步

1. M2 补齐到期强制交付、`end_company`/`finalize_delivery`/`finalize_company`；
2. M2.5 危机状态机与融资；
3. M3 企划槽刷新 + 供应商/外包 + 520 周压测；
4. M4 扩展伙伴类型/渠道与关系玩法；
5. 以上全部在有 emsdk 的环境跑 `npm run test:v4` 并附输出。

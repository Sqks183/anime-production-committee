# 游戏规则与暂定参数（v2）

本文对应 [game_core.cpp](../packages/game-core/src/game_core.cpp) 和唯一参数入口 [game_rules.hpp](../packages/game-core/include/game_rules.hpp)。这些参数用于最小纵向切片，**不是最终数值平衡**；体验时长、策略差异和经济口径仍需团队复核。状态字段见 [DATA_MODEL.md](DATA_MODEL.md)，接口与错误见 [API.md](API.md)。

## 确定性与责任边界

同一初始状态、相同决策和相同种子应产生相同结果。C++ 不获取系统时间、系统随机源、浏览器状态或网络数据。TypeScript 持有完整状态和种子，通过请求显式传入，并整体采用 C++ 返回的状态；存档记录种子。`?seed=12345` 可用于固定新局种子，不能用前端规则代替核心复现。

规则属于 C++ 核心，不属于 React 或 Zustand。React 只发出操作，Zustand 协调异步调用并采用结果。C++ 接口保持明确输入输出，不保存全局游戏会话、不读写存档；种子计算发生在纯规则调用内，不另建内部随机状态。当前核心以 `nlohmann::json`（`Json`）承载状态，不要求独立的强类型状态结构体。

所有带 state 的动作验证完整状态与阶段，必须传入 schema v2；初始化只接收 seed。不得通过修改员工技能、报价或事件选项绕过固定目录校验。

## 1. 暂定参数表

金额单位为日元；进度、质量、士气为 0–100 整数；乘法系数采用整数千分比（1000 = ×1）。

| 参数 | 当前值 | 含义 |
| --- | --- | --- |
| `initial_funds` / `initial_reputation` / `initial_morale` | 2000000 / 0 / 80 | 初始公司资金、声望、全员士气 |
| `fixed_cost` / `salary` | 120000 / 45000 | 每日固定成本 / 每员工工资，休息也支付 |
| `overtime_cost` / `outsource_cost` | 25000 / 500000 | 每位加班员工 / 每个外包工序的当日费用 |
| `base_speed` | 9 | 基础速度，具体整数计算见第 3 节 |
| `specialty` / `nonspecialty` | 1200 / 800 | 擅长 / 非擅长工序的速度与质量系数 |
| `morale_base` / `morale_scale` | 600 / 4 | 速度的士气系数 = 600 + 4 × morale |
| `overtime_speed` / `overtime_quality` | 1300 / 900 | 加班速度 / 质量系数 |
| `overtime_morale` / `rest_morale` | 6 / 10 | 加班额外士气消耗 / 休息士气恢复 |
| `outsource_progress` / `outsource_quality` | 8 / 50 | 每工序外包提供的工作量 / 该批工作质量 |
| `rework_threshold` / `rework_progress` | 45 / 4 | 有新增进度且质量低于 45 时回退 4 点 |
| `event_chance` / `overtime_event_chance` | 150 / 50 | 基础事件千分概率 / 每位当日加班员工追加值 |
| `quality_weights` | 300 / 400 / 300 | 前、中、后期成品质量权重 |
| `below_target_revenue` / `deadline_revenue` | 700 / 600 | 未达目标质量 / 截止强制交付收入系数 |
| `success_reputation` / `failure_reputation` | +10 / -5 | 完成且达目标质量 / 其余结局的基础声望变化 |
| `over_budget_reputation` | -3 | spent 超过拨款 budget 时额外声望惩罚 |
| `grade_thresholds` | 85 / 75 / 65 / 50 | S / A / B / C 最低质量分；其余 D |

### 方针

| `policy` | 速度系数 | 质量系数 | 工作员工每日士气消耗 |
| --- | --- | --- | --- |
| `rush` | 1300 | 800 | 5 |
| `normal` | 1000 | 1000 | 1 |
| `polish` | 750 | 1200 | 1 |

### 固定 4 人名册

| ID | 名称 | role | 擅长工序 / 初始排班 | skill |
| --- | --- | --- | --- | --- |
| `staff_01` | 林导演 | `director` | `pre` | 70 |
| `staff_02` | 陈原画 | `key_animator` | `mid` | 75 |
| `staff_03` | 许动画 | `animator` | `mid` | 55 |
| `staff_04` | 周摄影 | `photographer` | `post` | 65 |

技能固定不成长，初始均不加班。排班和士气跨企划保留；无招聘解雇或休闲期自动恢复。

### 固定 3 个报价

| ID / 名称 | type | budget | duration_days | target_quality | min_reputation | 制作速度系数 |
| --- | --- | --- | --- | --- | --- | --- |
| `proj_ova_01` / 放学后的第七帧 | `ova` | 8000000 | 20 | 60 | 0 | 1000 |
| `proj_tv_01` / 星轨列车 | `tv` | 14000000 | 26 | 68 | 0 | 850 |
| `proj_movie_01` / 未寄出的夏天 | `movie` | 24000000 | 30 | 78 | 20 | 700 |

初始化和每次结算后均按表中顺序提供相同 3 个报价，不随机刷新；电影在声望 20 解锁。速度系数只在 C++ 参数目录中，不进入报价 JSON。接取时 `funds += budget`、`spent = 0`、`start_day = day`、`deadline_day = day + duration_days - 1`，三工序进度和质量均为 0，`outsourced = false`，方针重置为 `normal`。

## 2. 决策与每日固定顺序

排班、方针持续到再次修改；外包和加班只安排今天，均可通过 `enabled: false` 撤销。启用外包或加班时校验**全部已安排的当日总费用**，此时不扣款、不增加进度或 spent。排班为 `rest` 会清除该员工加班，休息员工不能启用加班。

`advance_day` 仅允许 `producing`，顺序不可调换：

1. 计算 `cost = 120000 + 45000 × 4 + 25000 × 加班人数 + 500000 × 外包工序数`。资金不足时直接成功返回 `ended / bankrupt`；**不扣款、不改变 spent、制作数值、日期或 seed，也不执行后续标记清除**。报告变化为 0，工序变化数组为空。
2. 资金充足则 `funds -= cost`、`spent += cost`。记录本日加班人数供后续事件判定。
3. 按 `pre → mid → post` 计算员工和外包工作量、流水线进度与质量；后工序使用本日已更新的上游进度，计算细节见第 3 节。
4. 对本日新增进度且质量低于 45 的工序返工，进度回退 4（最低 0）。随后再次按流水线钳制下游，清除各工序 `outsourced`。返工不回滚已扣费用或重新计算质量。
5. 工作员工按方针消耗士气，加班额外 -6；休息 +10。钳制到 0–100，清除全员 `overtime`。
6. `day += 1`。报告的 `day` 仍为刚结算的旧日期，工序增量为整日净变化，`morale_delta` 为全员实际变化之和除以 4。
7. 推进一次 LCG 种子，依其结果最多生成一个事件候选。
8. 判定终局：三工序均 100 → `completed`；否则 `day > deadline_day` → `deadline`。终局优先于事件，转 `ended` 并清空事件候选；非终局才保留 `event_pending`，否则继续 `producing`。

截止日当天仍可制作；当日日结后若未完成，立即强制按现有进度交付/违约结算，不能一直制作到完成。截止日当日完成按 `completed` 处理；当日新事件不能在终局后补救延期。此前已处理的延期事件会修改截止日。

## 3. 整数公式与流水线

C++ 整数除法向零截断；非负计算等同向下取整。定义 `T(v, k) = floor(v × k / 1000)`（核心用商余拆分实现），`clamp(x) = min(100, max(0, x))`。**每一层 T 和除法分别截断，不能先合并浮点系数再统一取整。** 金额加法超过安全整数上限会报 `INVALID_INPUT`，不会回绕。

对分配到某工序的每位员工，取其擅长系数 `fit`（1200 或 800）、企划速度系数 `project_speed`：

```text
speed = 9 × skill × 10
speed = T(speed, fit)
speed = T(speed, policy_speed)
speed = T(speed, 600 + 4 × morale)
speed = T(speed, project_speed)
若加班：speed = T(speed, 1300)
points = floor(speed / 1000)

worker_quality = T(T(skill, fit), policy_quality)
若加班：worker_quality = T(worker_quality, 900)
worker_quality = clamp(worker_quality)
```

每工序 `work = Σpoints`，`quality_sum = Σ(points × worker_quality)`；已安排外包则额外 `work += 8`、`quality_sum += 8 × 50`。外包质量是本批工作固定为 50，并不是把整个工序质量乘以折扣。

```text
upstream = 100                          // 前期的上限
new_progress = min(upstream, old_progress + work)
gain = new_progress - old_progress
若 gain > 0：
  batch_quality = floor(quality_sum / work)
  new_quality = clamp(floor(
    (old_quality × old_progress + gain × batch_quality) / new_progress
  ))
否则：质量保持不变
upstream = new_progress                 // 供下一工序使用
```

上游堵塞或工序已满时，超出上限的工作量丢弃，无退款、无跨日储备；无新增进度也不单独提升质量。返工判定后再钳制一次，始终保证 `0 ≤ post.progress ≤ mid.progress ≤ pre.progress ≤ 100`；回退与二次钳制只改进度。`stage_deltas` 记录最终进度/质量减去日初数值，可为负。士气平均变化含负数时向零截断（不是向下取整）。

## 4. 随机协议与固定事件目录

LCG 使用 uint32：

```text
s' = (s × 1664525 + 1013904223) mod 2^32
触发条件：s' % 1000 < 150 + 50 × 当日加班人数
事件索引：floor(s' / 1000) % 3
```

每次实际完成日结仅推进一次种子，无论是否触发事件、是否成为终局；阈值与目录索引复用同一个 `s'`，不二次抽签。初始化按请求保存 seed；接取、决策、事件处理、结算不消耗种子。费用不足导致破产时没有完成日结，日期与 seed 均不推进。加班影响当日概率，没有“连续加班天数”隐藏计数器。

事件目录固定为以下 3 项，每项 2 个选项，顺序对应索引 0–2。只允许从当前待处理事件选择，前端不能传入任意效果。

| 事件 | `opt_a` | `opt_b` |
| --- | --- | --- |
| `evt_001` 原画支援请求 | funds -300000、全员 morale +8 | deadline_day +1、mid.quality -3 |
| `evt_002` 临时修改分镜 | pre.quality +5、全员 morale -5 | pre.quality -4、全员 morale +5 |
| `evt_003` 摄影设备维护 | funds -200000、post.quality +4 | 全员 morale -6、post.quality -2 |

事件费用计入 `spent`；支付不足返回 `INSUFFICIENT_BUDGET`，不改变原状态且事件仍待处理。质量和士气变化钳制到 0–100；延期修改绝对截止日，不改变当前日。当前目录无进度效果。处理成功后清空事件、回到制作并执行终局检查，不额外推进日期或种子。

## 5. 结算公式

`calculate_result` 仅允许 `ended`。按以下顺序计算，所有除法仍逐步截断：

```text
quality_score = floor((pre.quality × 300 + mid.quality × 400 + post.quality × 300) / 1000)
progress_average = floor((pre.progress + mid.progress + post.progress) / 3)
revenue = T(T(budget, quality_score × 10), progress_average × 10)
若 quality_score < target_quality：revenue = T(revenue, 700)
若 end_reason == 'deadline'：revenue = T(revenue, 600)
若 end_reason == 'bankrupt'：revenue = 0
cost = spent
profit = revenue - spent
```

收入没有另一个“类型乘数”；类型差异通过当前报价的预算、速度、目标质量与工期体现。`quality_score` 不因未完成而另打折，完成度已作用于收入。评级仅看质量：S ≥85、A ≥75、B ≥65、C ≥50、否则 D，不另按终局原因改评级。

完成且达到目标质量时声望基础 +10，否则 -5；超预算（`spent > budget`）再 -3。公司声望最低 0，`result.reputation_delta` 返回钳制后的实际变化，而非未经钳制的惩罚值。

最后 `funds += revenue`，更新声望，清空企划、事件、终局原因，重新供应相同 3 个报价并转 `idle`；保留日期、seed、员工士气和排班，清除加班。

**经济口径待复核：** 开工拨款已加入公司资金，但草案利润只定义为 `revenue - spent`，不含拨款，所以不是该企划对公司现金的总净贡献。工资、固定费用、加班、外包和付费事件均计入 spent。不要在 TypeScript 中自行改成另一套利润公式。

## 6. 未完项与变更纪律

最终平衡、单局实测时长、策略是否存在支配解、拨款与利润口径仍需评审；当前并未承诺平衡完成。复杂事件、招聘解雇、员工成长、市场/发行、多企划并行不在切片范围。只有单槽本地状态存档，无旧版迁移或历史结算持久化。

未来规则变更需同时更新协议、C++ 单元测试、真实 WASM 集成测试和规则文档；影响状态展示时同步前端类型、校验与状态测试。不得悄悄替换 RNG 算法或抽样顺序破坏重放，也不能把尚未运行的验收写成已通过。

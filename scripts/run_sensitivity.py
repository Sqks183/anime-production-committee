#!/usr/bin/env python3
"""Sensitivity checks for in-house capacity, outsourcing prices, channel count and penalties."""
import csv, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import economic_simulator as sim

OUT=Path("simulation-sensitivity")
OUT.mkdir(exist_ok=True)
base=sim.deep_merge(sim.DEFAULTS,{"trials":500,"seed":20261123})
base_rates=base["stage_outsource_cost_per_unit"]
scenarios=[
    ("capacity_60",{"weekly_work_capacity":60.0}),
    ("capacity_70",{"weekly_work_capacity":70.0}),
    ("capacity_80",{"weekly_work_capacity":80.0}),
    ("outsourcing_cost_minus20",{"stage_outsource_cost_per_unit":[x*0.8 for x in base_rates]}),
    ("outsourcing_cost_base",{"stage_outsource_cost_per_unit":base_rates}),
    ("outsourcing_cost_plus20",{"stage_outsource_cost_per_unit":[x*1.2 for x in base_rates]}),
    ("non_bd_channels_1",{"non_bd_channel_count":1}),
    ("non_bd_channels_2",{"non_bd_channel_count":2}),
    ("non_bd_channels_3",{"non_bd_channel_count":3}),
    ("low_delivery_40",{"minimum_low_delivery_ratio":0.40}),
    ("low_delivery_50",{"minimum_low_delivery_ratio":0.50}),
    ("low_delivery_60",{"minimum_low_delivery_ratio":0.60}),
    ("breach_penalty_25",{"breach_penalty_ratio":0.25}),
    ("breach_penalty_50",{"breach_penalty_ratio":0.50}),
    ("breach_penalty_75",{"breach_penalty_ratio":0.75})
]
results=[]
for name,override in scenarios:
    cfg=sim.deep_merge(base,override)
    summaries,_=sim.run(cfg)
    results.extend({"scenario":name,**row} for row in summaries)
with (OUT/"sensitivity.csv").open("w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=list(results[0].keys())); w.writeheader(); w.writerows(results)
(OUT/"sensitivity.json").write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(results,ensure_ascii=False,indent=2))

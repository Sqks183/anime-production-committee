#!/usr/bin/env python3
"""Run sensitivity checks for stage workload, production capacity and penalties."""
import csv, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import economic_simulator as sim

OUT=Path("simulation-sensitivity")
OUT.mkdir(exist_ok=True)
scenarios=[
 ("capacity_95",{"weekly_work_capacity":95.0}),
 ("capacity_110",{"weekly_work_capacity":110.0}),
 ("capacity_125",{"weekly_work_capacity":125.0}),
 ("low_delivery_40",{"minimum_low_delivery_ratio":0.40}),
 ("low_delivery_50",{"minimum_low_delivery_ratio":0.50}),
 ("low_delivery_60",{"minimum_low_delivery_ratio":0.60}),
 ("breach_penalty_25",{"breach_penalty_ratio":0.25}),
 ("breach_penalty_50",{"breach_penalty_ratio":0.50}),
 ("breach_penalty_75",{"breach_penalty_ratio":0.75})
]
results=[]
base=sim.deep_merge(sim.DEFAULTS,{"trials":500,"seed":20261123})
for name,override in scenarios:
 cfg=sim.deep_merge(base,override)
 summaries,_=sim.run(cfg)
 results.extend({"scenario":name,**row} for row in summaries)
with (OUT/"sensitivity.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.DictWriter(f,fieldnames=list(results[0].keys())); w.writeheader(); w.writerows(results)
(OUT/"sensitivity.json").write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(results,ensure_ascii=False,indent=2))

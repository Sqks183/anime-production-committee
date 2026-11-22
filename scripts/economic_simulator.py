#!/usr/bin/env python3
"""Reproducible 520-week Monte Carlo model with stage-gated workload progression."""
from __future__ import annotations
import argparse, csv, json, math, random, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "seed": 20261123, "trials": 500, "weeks": 520,
    "initial_cash": 50_000_000, "weekly_fixed_cost": 680_000,
    "project_types": [
        {"name":"short","budget":30_000_000,"weeks":16,"workload":1800,"weight":1,"target_quality":62},
        {"name":"ova","budget":20_000_000,"weeks":12,"workload":1200,"weight":1,"target_quality":60},
        {"name":"tv","budget":200_000_000,"weeks":52,"workload":6000,"weight":1,"target_quality":70},
        {"name":"movie","budget":300_000_000,"weeks":72,"workload":8000,"weight":1,"target_quality":75}
    ],
    "committee_investment_multiple":2.0, "bd_company_share":0.5,
    "bd_multipliers":{"D":0.1,"C":0.4,"B":0.8,"A":1.5,"S":3.0},
    "commercial_score_weights":{"audience":0.50,"heat":0.20,"quality":0.20,"fit":0.10},
    "commercial_score_noise_sd":8.0, "non_bd_gross_per_budget_per_channel":0.0,
    "committee_channel_count":0, "contract_success_bonus_ratio":0.10,
    "contract_success_bonus_score":65,
    "stage_shares":[0.10,0.15,0.35,0.25,0.15],
    "stage_gate_ratio_min":0.65, "stage_gate_ratio_max":0.80,
    "workload_variation_sd":0.12, "weekly_work_capacity":110.0,
    "weekly_capacity_variation_sd":0.12, "polish_probability":0.35,
    "polish_extra_work_ratio":0.20, "polish_quality_gain":1.5,
    "quality_performance_noise_sd":7.0, "minimum_low_delivery_ratio":0.50,
    "committee_extension_ratio":0.20, "extension_pressure_per_week":10,
    "pressure_reputation_thresholds":[20,40,60,80],
    "pressure_reputation_penalties":[2,4,7,10],
    "low_delivery_reputation_penalty":10, "breach_penalty_ratio":0.50,
    "production_cost_per_work_unit":0.0,
    "strategies":["contract","committee_10","committee_50","committee_100"]
}

@dataclass
class Trial:
    strategy:str; bankrupt:bool; final_cash:float; completed:int; low_deliveries:int
    breaches:int; extensions:int; reputation:float; weeks_used:int
    total_workload:float; completed_workload:float; avg_final_quality:float

def deep_merge(base:dict, override:dict)->dict:
    out=dict(base)
    for k,v in override.items():
        out[k]=deep_merge(out[k],v) if isinstance(v,dict) and isinstance(out.get(k),dict) else v
    return out

def score_band(score:float)->str:
    if score>=80:return "S"
    if score>=65:return "A"
    if score>=50:return "B"
    if score>=35:return "C"
    return "D"

def draw_score(rng:random.Random,cfg:dict,quality:float)->float:
    w=cfg["commercial_score_weights"]
    base=sum(rng.uniform(0,100)*w[k] for k in ("audience","heat","fit"))+quality*w["quality"]
    return max(0.0,min(100.0,base+rng.gauss(0,cfg["commercial_score_noise_sd"])))

def choose_project(rng:random.Random,cfg:dict)->dict:
    ps=cfg["project_types"]
    return rng.choices(ps,weights=[p["weight"] for p in ps],k=1)[0]

def sample_stage_targets(rng:random.Random,requirements:list[float],cfg:dict):
    gates=[rng.uniform(cfg["stage_gate_ratio_min"],cfg["stage_gate_ratio_max"]) for _ in requirements]
    polish=[rng.random()<cfg["polish_probability"] for _ in requirements]
    targets=[x*(g+(cfg["polish_extra_work_ratio"] if p else 0.0)) for x,g,p in zip(requirements,gates,polish)]
    return gates,polish,targets

def produce_project(rng:random.Random,project:dict,cfg:dict,strategy:str,weeks_left:int):
    total=max(1.0,float(project["workload"])*max(0.5,rng.gauss(1.0,cfg["workload_variation_sd"])))
    shares=cfg["stage_shares"]
    if not math.isclose(sum(shares),1.0,abs_tol=1e-6): raise ValueError("stage_shares must sum to 1.0")
    req=[total*x for x in shares]; done=[0.0 for _ in shares]
    _,polish,targets=sample_stage_targets(rng,req,cfg)
    stage=elapsed=0; work=quality_bonus=0.0; extended=False
    base_deadline=int(project["weeks"]); deadline=base_deadline
    max_deadline=base_deadline*(1+cfg["committee_extension_ratio"]) if strategy!="contract" else base_deadline
    while elapsed<min(deadline,weeks_left) and stage<len(shares):
        cap=max(0.0,cfg["weekly_work_capacity"]*rng.lognormvariate(-0.5*cfg["weekly_capacity_variation_sd"]**2,cfg["weekly_capacity_variation_sd"]))
        while cap>1e-9 and stage<len(shares):
            amount=min(max(0.0,targets[stage]-done[stage]),cap)
            done[stage]+=amount; work+=amount; cap-=amount
            if done[stage]+1e-8>=targets[stage]:
                if polish[stage]: quality_bonus+=cfg["polish_quality_gain"]
                stage+=1
        elapsed+=1
        if elapsed>=base_deadline and stage<len(shares) and strategy!="contract" and not extended:
            extended=True; deadline=max_deadline
    progress=min(1.0,work/max(1.0,total)); stage_complete=stage>=len(shares)
    pressure=max(0,elapsed-base_deadline)*cfg["extension_pressure_per_week"] if extended else 0
    outcome="normal" if stage_complete else ("low" if progress>=cfg["minimum_low_delivery_ratio"] else "breach")
    quality=max(0.0,min(100.0,float(project["target_quality"])+quality_bonus+rng.gauss(0,cfg["quality_performance_noise_sd"])))
    return outcome,elapsed,pressure,work,total,quality,extended

def simulate_one(seed:int,strategy:str,cfg:dict)->Trial:
    rng=random.Random(seed); cash=float(cfg["initial_cash"]); reputation=100.0
    week=completed=low=breaches=extensions=0
    total_work=done_work=quality_sum=quality_count=0.0; bankrupt=False
    pct=0 if strategy=="contract" else int(strategy.split("_")[1])
    while week<cfg["weeks"]:
        offers=[choose_project(rng,cfg) for _ in range(4)]; affordable=[]
        for p in offers:
            inv=float(p["budget"])*cfg["committee_investment_multiple"]*pct/100.0
            if cash>=inv: affordable.append((p,inv))
        if not affordable:
            if cash<cfg["weekly_fixed_cost"]: bankrupt=True; break
            cash-=cfg["weekly_fixed_cost"]; week+=1; continue
        project,investment=rng.choice(affordable); budget=float(project["budget"])
        cash-=investment; cash+=budget
        outcome,elapsed,pressure,work,required,quality,extended=produce_project(rng,project,cfg,strategy,cfg["weeks"]-week)
        extensions+=int(extended); total_work+=required; done_work+=work
        quality_sum+=quality; quality_count+=1
        project_cost=work*cfg["production_cost_per_work_unit"]
        for _ in range(elapsed):
            cost=cfg["weekly_fixed_cost"]+project_cost/max(1,elapsed)
            if cash<cost: bankrupt=True; break
            cash-=cost; week+=1
        if bankrupt: break
        for threshold,penalty in zip(cfg["pressure_reputation_thresholds"],cfg["pressure_reputation_penalties"]):
            if pressure>=threshold: reputation-=penalty
        if outcome=="breach":
            breaches+=1; cash-=budget*cfg["breach_penalty_ratio"]
            if cash<0: bankrupt=True; break
        else:
            if outcome=="normal": completed+=1
            else: low+=1; reputation-=cfg["low_delivery_reputation_penalty"]
            band=score_band(draw_score(rng,cfg,quality))
            cash+=budget*cfg["bd_multipliers"][band]*cfg["bd_company_share"]
            if strategy=="contract" and draw_score(rng,cfg,quality)>=cfg["contract_success_bonus_score"]:
                cash+=budget*cfg["contract_success_bonus_ratio"]
            if strategy!="contract":
                cash+=budget*cfg["non_bd_gross_per_budget_per_channel"]*cfg["committee_channel_count"]*pct/100.0
        if week>=cfg["weeks"]: break
    return Trial(strategy,bankrupt,cash,completed,low,breaches,extensions,reputation,week,
                 total_work,done_work,quality_sum/max(1,quality_count))

def summarize(rows:list[Trial])->dict:
    cash=[r.final_cash for r in rows]; ordered=sorted(cash)
    return {"strategy":rows[0].strategy,"trials":len(rows),
      "bankruptcy_rate":sum(r.bankrupt for r in rows)/len(rows),
      "mean_final_cash":statistics.mean(cash),"median_final_cash":statistics.median(cash),
      "p10_final_cash":ordered[max(0,int(.10*(len(cash)-1)))],
      "p90_final_cash":ordered[min(len(cash)-1,int(.90*(len(cash)-1)))],
      "mean_completed":statistics.mean(r.completed for r in rows),
      "mean_low_deliveries":statistics.mean(r.low_deliveries for r in rows),
      "mean_breaches":statistics.mean(r.breaches for r in rows),
      "mean_extensions":statistics.mean(r.extensions for r in rows),
      "mean_final_reputation":statistics.mean(r.reputation for r in rows),
      "mean_weeks_used":statistics.mean(r.weeks_used for r in rows),
      "mean_required_workload":statistics.mean(r.total_workload for r in rows),
      "mean_completed_workload":statistics.mean(r.completed_workload for r in rows),
      "mean_final_quality":statistics.mean(r.avg_final_quality for r in rows)}

def run(cfg:dict):
    all_rows=[]; summaries=[]; master=random.Random(cfg["seed"])
    for strategy in cfg["strategies"]:
        rows=[simulate_one(master.randrange(0,2**63),strategy,cfg) for _ in range(cfg["trials"])]
        all_rows.extend(rows); summaries.append(summarize(rows))
    return summaries,all_rows

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",type=Path); parser.add_argument("--out",type=Path,default=Path("simulation-output"))
    args=parser.parse_args(); cfg=DEFAULTS
    if args.config: cfg=deep_merge(DEFAULTS,json.loads(args.config.read_text(encoding="utf-8")))
    summaries,rows=run(cfg); args.out.mkdir(parents=True,exist_ok=True)
    (args.out/"summary.json").write_text(json.dumps({"config":cfg,"results":summaries},ensure_ascii=False,indent=2),encoding="utf-8")
    with (args.out/"trials.csv").open("w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=list(asdict(rows[0]).keys())); w.writeheader(); w.writerows(asdict(r) for r in rows)
    print(json.dumps(summaries,ensure_ascii=False,indent=2))

if __name__=="__main__": main()

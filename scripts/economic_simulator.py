#!/usr/bin/env python3
"""Reproducible 520-week Monte Carlo model with stage-gated workload progression."""
from __future__ import annotations
import argparse, csv, json, math, random, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "seed": 20261123, "trials": 500, "weeks": 520,
    "initial_cash": 50_000_000, "weekly_fixed_cost": 200_000,
    "core_employee_count": 4, "weekly_salary_per_employee": 50_000,
    "overtime_multiplier": 1.5, "overtime_capacity_ratio": 0.20,
    "project_types": [
        {"name":"short","budget":30_000_000,"weeks":16,"workload":1800,"weight":1,"target_quality":62},
        {"name":"ova","budget":20_000_000,"weeks":12,"workload":1200,"weight":1,"target_quality":60},
        {"name":"tv","budget":200_000_000,"weeks":52,"workload":6000,"weight":1,"target_quality":70},
        {"name":"movie","budget":300_000_000,"weeks":72,"workload":8000,"weight":1,"target_quality":75}
    ],
    "committee_investment_multiple":2.0, "bd_company_share":0.5,
    "bd_multipliers":{"D":0.1,"C":0.4,"B":0.8,"A":1.5,"S":3.0},
    "commercial_score_weights":{"audience":0.50,"heat":0.20,"quality":0.20,"fit":0.10},
    "commercial_score_noise_sd":8.0,
    "non_bd_channel_rates":{"publisher":0.25,"toy":0.35,"music":0.15,"tv_broadcast":0.30},
    "non_bd_channel_count":2, "channel_fit_min":20, "channel_fit_max":40,
    "non_bd_commercial_multipliers":{"D":0.3,"C":0.6,"B":1.0,"A":1.5,"S":2.5}, "contract_success_bonus_ratio":0.10,
    "contract_success_bonus_score":65,
    "stage_shares":[0.10,0.15,0.35,0.25,0.15],
    "stage_names":["script","storyboard","key_animation","animation_check","postproduction"],
    "stage_outsource_shares":[0.20,0.25,0.45,0.30,0.35],
    "stage_outsource_cost_per_unit":[8000,10000,14000,7000,9000],
    "stage_gate_ratio_min":0.65, "stage_gate_ratio_max":0.80,
    "workload_variation_sd":0.12, "weekly_work_capacity":70.0,
    "weekly_capacity_variation_sd":0.12, "polish_probability":0.35,
    "polish_extra_work_ratio":0.20, "polish_quality_gain":1.5,
    "quality_performance_noise_sd":7.0, "minimum_low_delivery_ratio":0.50,
    "committee_extension_ratio":0.20, "extension_pressure_per_week":10,
    "pressure_reputation_thresholds":[20,40,60,80],
    "pressure_reputation_penalties":[2,4,7,10],
    "low_delivery_reputation_penalty":10, "breach_penalty_ratio":0.50,
    "dynamic_policy": {
        "dynamic_conservative":{"cash_reserve_ratio":0.60,"project_operating_reserve_ratio":1.0,"minimum_operating_reserve_weeks":0,"max_investment_ratio":30},
        "dynamic_opportunity":{"cash_reserve_ratio":0.35,"project_operating_reserve_ratio":0.5,"minimum_operating_reserve_weeks":0,"max_investment_ratio":70},
        "dynamic_aggressive":{"cash_reserve_ratio":0.10,"project_operating_reserve_ratio":0.0,"minimum_operating_reserve_weeks":8,"max_investment_ratio":100}
    },
    "strategies":["contract","committee_10","committee_50","committee_100","dynamic_conservative","dynamic_opportunity","dynamic_aggressive"]
}

@dataclass
class Trial:
    strategy:str; bankrupt:bool; final_cash:float; completed:int; low_deliveries:int
    breaches:int; extensions:int; reputation:float; weeks_used:int
    total_workload:float; completed_workload:float; avg_final_quality:float
    total_outsourcing_cost:float; total_overtime_cost:float; overtime_weeks:int
    total_payroll:float; total_non_bd_revenue:float
    contract_projects:int; committee_projects:int; total_investment_ratio:float; min_cash:float

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

def dynamic_offer_decision(cash:float, offers:list[dict], cfg:dict, policy:str):
    """Choose an offer and financing mode using only pre-start information."""
    burn=cfg["weekly_fixed_cost"]+cfg["core_employee_count"]*cfg["weekly_salary_per_employee"]
    if policy=="dynamic_conservative":
        project=min(offers,key=lambda p:(p["budget"]*cfg["committee_investment_multiple"]/max(1.0,p["weeks"]),p["workload"]))
    elif policy=="dynamic_opportunity":
        project=max(offers,key=lambda p:(p["target_quality"]*0.55+(p["budget"]/max(1.0,p["workload"])/10000.0)*20.0))
    elif policy=="dynamic_aggressive":
        project=max(offers,key=lambda p:(p["budget"]*p["target_quality"],p["budget"]))
    else:
        raise ValueError(f"Unknown dynamic policy: {policy}")
    policy_cfg=cfg["dynamic_policy"][policy]
    reserve=max(cfg["initial_cash"]*policy_cfg["cash_reserve_ratio"],
                burn*max(policy_cfg["minimum_operating_reserve_weeks"],
                         project["weeks"]*policy_cfg["project_operating_reserve_ratio"]))
    cap=policy_cfg["max_investment_ratio"]
    affordable_pct=max(0,int((cash-reserve)/(cfg["committee_investment_multiple"]*float(project["budget"]))*10)*10)
    pct=min(cap,affordable_pct)
    return project, ("committee" if pct>=10 else "contract"), pct

def sample_stage_targets(rng:random.Random,requirements:list[float],cfg:dict):
    gates=[rng.uniform(cfg["stage_gate_ratio_min"],cfg["stage_gate_ratio_max"]) for _ in requirements]
    polish=[rng.random()<cfg["polish_probability"] for _ in requirements]
    targets=[x*(g+(cfg["polish_extra_work_ratio"] if p else 0.0)) for x,g,p in zip(requirements,gates,polish)]
    return gates,polish,targets

def produce_project(rng:random.Random,project:dict,cfg:dict,strategy:str,weeks_left:int):
    total=max(1.0,float(project["workload"])*max(0.5,rng.gauss(1.0,cfg["workload_variation_sd"])))
    shares=cfg["stage_shares"]; out_shares=cfg["stage_outsource_shares"]; rates=cfg["stage_outsource_cost_per_unit"]
    if not math.isclose(sum(shares),1.0,abs_tol=1e-6): raise ValueError("stage_shares must sum to 1.0")
    if not (len(shares)==len(out_shares)==len(rates)): raise ValueError("stage arrays must have equal lengths")
    req=[total*x for x in shares]; done=[0.0 for _ in shares]
    _,polish,targets=sample_stage_targets(rng,req,cfg)
    stage=elapsed=0; work=quality_bonus=0.0; extended=False
    base_deadline=int(project["weeks"]); deadline=base_deadline
    max_deadline=base_deadline*(1+cfg["committee_extension_ratio"]) if strategy!="contract" else base_deadline
    weekly_outsource=[]; weekly_overtime=[]
    while elapsed<min(deadline,weeks_left) and stage<len(shares):
        variation=rng.lognormvariate(-0.5*cfg["weekly_capacity_variation_sd"]**2,cfg["weekly_capacity_variation_sd"])
        regular_internal=cfg["weekly_work_capacity"]*variation
        remaining_weeks=max(1,deadline-elapsed)
        regular_left=regular_internal; overtime_left=regular_internal*cfg["overtime_capacity_ratio"]
        overtime_used_total=0.0; outsource_cost=0.0
        # Consume regular capacity first. Overtime is activated only when needed to meet deadline pace.
        while stage<len(shares):
            need=max(0.0,targets[stage]-done[stage])
            if need<=1e-8:
                if polish[stage]: quality_bonus+=cfg["polish_quality_gain"]
                stage+=1; continue
            out_share=out_shares[stage]
            required_internal_rate=need*(1.0-out_share)/remaining_weeks
            overtime_needed=min(overtime_left,max(0.0,required_internal_rate-regular_internal))
            internal_available=regular_left+overtime_needed
            amount=min(need,internal_available/max(1e-9,1.0-out_share))
            done[stage]+=amount; work+=amount
            outsource_cost+=amount*out_share*rates[stage]
            used_internal=amount*(1.0-out_share)
            regular_used=min(regular_left,used_internal); regular_left-=regular_used
            overtime_used=max(0.0,used_internal-regular_used); overtime_left=max(0.0,overtime_left-overtime_used)
            overtime_used_total+=overtime_used
            if done[stage]+1e-8>=targets[stage]:
                if polish[stage]: quality_bonus+=cfg["polish_quality_gain"]
                stage+=1
                if regular_left+overtime_left<=1e-8: break
            else: break
        weekly_outsource.append(outsource_cost)
        weekly_overtime.append(min(cfg["overtime_capacity_ratio"],overtime_used_total/max(1e-9,regular_internal)))
        elapsed+=1
        if elapsed>=base_deadline and stage<len(shares) and strategy!="contract" and not extended:
            extended=True; deadline=max_deadline
    progress=min(1.0,work/max(1.0,total)); stage_complete=stage>=len(shares)
    pressure=max(0,elapsed-base_deadline)*cfg["extension_pressure_per_week"] if extended else 0
    outcome="normal" if stage_complete else ("low" if progress>=cfg["minimum_low_delivery_ratio"] else "breach")
    quality=max(0.0,min(100.0,float(project["target_quality"])+quality_bonus+rng.gauss(0,cfg["quality_performance_noise_sd"])))
    return outcome,elapsed,pressure,work,total,quality,extended,weekly_outsource,weekly_overtime

def simulate_one(seed:int,strategy:str,cfg:dict)->Trial:
    rng=random.Random(seed); cash=float(cfg["initial_cash"]); reputation=100.0
    week=completed=low=breaches=extensions=overtime_weeks=0
    total_work=done_work=quality_sum=quality_count=0.0
    total_outsource=total_overtime=total_payroll=total_non_bd=0.0; bankrupt=False
    contract_projects=committee_projects=0; investment_ratio_sum=0.0; min_cash=cash
    pct=0 if strategy=="contract" or strategy.startswith("dynamic_") else int(strategy.split("_")[1])
    weekly_payroll=cfg["core_employee_count"]*cfg["weekly_salary_per_employee"]
    while week<cfg["weeks"]:
        offers=[choose_project(rng,cfg) for _ in range(4)]
        if strategy.startswith("dynamic_"):
            project,mode,pct=dynamic_offer_decision(cash,offers,cfg,strategy)
            investment=float(project["budget"])*cfg["committee_investment_multiple"]*pct/100.0
        else:
            pct=0 if strategy=="contract" else int(strategy.split("_")[1])
            affordable=[(p,float(p["budget"])*cfg["committee_investment_multiple"]*pct/100.0) for p in offers
                        if cash>=float(p["budget"])*cfg["committee_investment_multiple"]*pct/100.0]
            if not affordable:
                weekly_cost=cfg["weekly_fixed_cost"]+weekly_payroll
                if cash<weekly_cost: bankrupt=True; break
                cash-=weekly_cost; min_cash=min(min_cash,cash); total_payroll+=weekly_payroll; week+=1; continue
            project,investment=rng.choice(affordable)
            mode="contract" if strategy=="contract" else "committee"
        budget=float(project["budget"])
        if mode=="committee": committee_projects+=1; investment_ratio_sum+=pct
        else: contract_projects+=1
        cash-=investment; cash+=budget
        min_cash=min(min_cash,cash)
        outcome,elapsed,pressure,work,required,quality,extended,outsource_by_week,overtime_by_week=produce_project(
            rng,project,cfg,mode,cfg["weeks"]-week)
        extensions+=int(extended); total_work+=required; done_work+=work
        quality_sum+=quality; quality_count+=1
        for i in range(elapsed):
            overtime_cost=weekly_payroll*cfg["overtime_multiplier"]*overtime_by_week[i]
            outsourcing_cost=outsource_by_week[i]
            weekly_cost=cfg["weekly_fixed_cost"]+weekly_payroll+overtime_cost+outsourcing_cost
            if cash<weekly_cost: bankrupt=True; break
            cash-=weekly_cost; min_cash=min(min_cash,cash); total_payroll+=weekly_payroll
            total_overtime+=overtime_cost; total_outsource+=outsourcing_cost
            overtime_weeks+=int(overtime_by_week[i]>1e-8); week+=1
        if bankrupt: break
        for threshold,penalty in zip(cfg["pressure_reputation_thresholds"],cfg["pressure_reputation_penalties"]):
            if pressure>=threshold: reputation-=penalty
        if outcome=="breach":
            breaches+=1; cash-=budget*cfg["breach_penalty_ratio"]; min_cash=min(min_cash,cash)
            if cash<0: bankrupt=True; break
        else:
            if outcome=="normal": completed+=1
            else: low+=1; reputation-=cfg["low_delivery_reputation_penalty"]
            score=draw_score(rng,cfg,quality); band=score_band(score)
            cash+=budget*cfg["bd_multipliers"][band]*cfg["bd_company_share"]
            if mode=="contract" and score>=cfg["contract_success_bonus_score"]:
                cash+=budget*cfg["contract_success_bonus_ratio"]
            if mode=="committee" and cfg["non_bd_channel_count"]>0:
                channels=list(cfg["non_bd_channel_rates"].items())
                chosen=rng.sample(channels,k=min(cfg["non_bd_channel_count"],len(channels)))
                channel_gross=0.0
                for _,rate in chosen:
                    fit=rng.uniform(cfg["channel_fit_min"],cfg["channel_fit_max"])
                    channel_gross+=budget*rate*(fit/100.0)*cfg["non_bd_commercial_multipliers"][band]
                share=channel_gross*pct/100.0
                cash+=share; total_non_bd+=share
        if week>=cfg["weeks"]: break
    return Trial(strategy,bankrupt,cash,completed,low,breaches,extensions,reputation,week,
        total_work,done_work,quality_sum/max(1,quality_count),total_outsource,total_overtime,
        overtime_weeks,total_payroll,total_non_bd,contract_projects,committee_projects,
        investment_ratio_sum/max(1,committee_projects),min_cash)

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
      "mean_final_quality":statistics.mean(r.avg_final_quality for r in rows),
      "mean_outsourcing_cost":statistics.mean(r.total_outsourcing_cost for r in rows),
      "mean_overtime_cost":statistics.mean(r.total_overtime_cost for r in rows),
      "mean_overtime_weeks":statistics.mean(r.overtime_weeks for r in rows),
      "mean_payroll":statistics.mean(r.total_payroll for r in rows),
      "mean_non_bd_revenue":statistics.mean(r.total_non_bd_revenue for r in rows),
      "mean_contract_projects":statistics.mean(r.contract_projects for r in rows),
      "mean_committee_projects":statistics.mean(r.committee_projects for r in rows),
      "mean_committee_investment_ratio":statistics.mean(r.total_investment_ratio for r in rows),
      "median_min_cash":statistics.median(r.min_cash for r in rows)}

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

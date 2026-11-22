#!/usr/bin/env python3
"""Reproducible, deliberately simplified 520-week economy simulator.

All uncertain values are configuration parameters. This is a sensitivity model,
not the game's runtime and not a claim that provisional assumptions are balanced.
"""
from __future__ import annotations
import argparse, csv, json, math, random, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "seed": 20261123, "trials": 2000, "weeks": 520,
    "initial_cash": 50_000_000, "weekly_fixed_cost": 680_000,
    "project_types": [
        {"name":"short", "budget":30_000_000, "weeks":16, "weight":1, "target_quality":62},
        {"name":"ova", "budget":20_000_000, "weeks":12, "weight":1, "target_quality":60},
        {"name":"tv", "budget":200_000_000, "weeks":52, "weight":1, "target_quality":70},
        {"name":"movie", "budget":300_000_000, "weeks":72, "weight":1, "target_quality":75}
    ],
    "committee_investment_multiple": 2.0,
    "bd_company_share": 0.5,
    "bd_multipliers": {"D":0.1,"C":0.4,"B":0.8,"A":1.5,"S":3.0},
    "commercial_score_weights": {"audience":0.50,"heat":0.20,"quality":0.20,"fit":0.10},
    "commercial_score_noise_sd": 8.0,
    "non_bd_gross_per_budget_per_channel": 0.0,
    "committee_channel_count": 0,
    "contract_success_bonus_ratio": 0.10,
    "contract_success_bonus_score": 65,
    "actual_duration_lognormal_sigma": 0.22,
    "actual_duration_median_ratio": 1.0,
    "minimum_low_delivery_ratio": 0.70,
    "committee_extension_ratio": 0.20,
    "extension_pressure_per_week": 10,
    "pressure_reputation_thresholds": [20, 40, 60, 80],
    "pressure_reputation_penalties": [2, 4, 7, 10],
    "breach_penalty_ratio": 0.50,
    "production_cost_ratio": 0.0,
    "strategies": ["contract", "committee_10", "committee_50", "committee_100"]
}

@dataclass
class Trial:
    strategy: str
    bankrupt: bool
    final_cash: float
    completed: int
    low_deliveries: int
    breaches: int
    extensions: int
    reputation: float
    weeks_used: int


def deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def score_band(score: float) -> str:
    if score >= 80: return "S"
    if score >= 65: return "A"
    if score >= 50: return "B"
    if score >= 35: return "C"
    return "D"


def draw_score(rng: random.Random, cfg: dict) -> float:
    w = cfg["commercial_score_weights"]
    # Project market attributes are sampled independently of project size/type.
    base = sum(rng.uniform(0, 100) * w[k] for k in ("audience", "heat", "quality", "fit"))
    return max(0.0, min(100.0, base + rng.gauss(0, cfg["commercial_score_noise_sd"]))


def choose_project(rng: random.Random, cfg: dict) -> dict:
    projects = cfg["project_types"]
    return rng.choices(projects, weights=[p["weight"] for p in projects], k=1)[0]


def simulate_one(seed: int, strategy: str, cfg: dict) -> Trial:
    rng = random.Random(seed)
    cash = float(cfg["initial_cash"])
    reputation = 100.0
    week = completed = low = breaches = extensions = 0
    bankrupt = False
    investment_percent = 0 if strategy == "contract" else int(strategy.split("_")[1])

    while week < cfg["weeks"]:
        # Four offers per market refresh. Choose randomly among offers affordable
        # using pre-grant cash; the grant itself cannot finance the investment.
        offers = [choose_project(rng, cfg) for _ in range(4)]
        affordable = []
        for offer in offers:
            required = (float(offer["budget"]) * cfg["committee_investment_multiple"]
                        * investment_percent / 100.0)
            if cash >= required:
                affordable.append((offer, required))
        if not affordable:
            if cash < cfg["weekly_fixed_cost"]:
                bankrupt = True
                break
            cash -= cfg["weekly_fixed_cost"]
            week += 1
            continue

        project, investment = rng.choice(affordable)
        budget, contract_weeks = float(project["budget"]), int(project["weeks"])
        cash -= investment
        cash += budget  # Contract production budget enters the common cash pool.

        # Placeholder duration model pending the real stage/workload/capacity model.
        actual_duration = contract_weeks * rng.lognormvariate(
            math.log(cfg["actual_duration_median_ratio"]),
            cfg["actual_duration_lognormal_sigma"])
        deadline = float(contract_weeks)
        extension_used = strategy != "contract" and actual_duration > deadline
        if extension_used:
            deadline += contract_weeks * cfg["committee_extension_ratio"]
            extensions += 1

        planned_weeks = math.ceil(min(actual_duration, deadline))
        actual_weeks = min(planned_weeks, cfg["weeks"] - week)
        project_cost = budget * cfg["production_cost_ratio"]
        weekly_project_cost = project_cost / max(1, planned_weeks)
        for _ in range(actual_weeks):
            cost = cfg["weekly_fixed_cost"] + weekly_project_cost
            if cash < cost:
                bankrupt = True
                break
            cash -= cost
            week += 1
        if bankrupt:
            break

        # Do not pretend a project interrupted by week 520 reached its deadline.
        horizon_cut = actual_weeks < planned_weeks
        elapsed = actual_weeks
        progress = min(1.0, elapsed / actual_duration if horizon_cut else deadline / actual_duration)
        pressure = 0.0
        if extension_used:
            extra_weeks = max(0, elapsed - contract_weeks)
            pressure = extra_weeks * cfg["extension_pressure_per_week"]

        if not horizon_cut and actual_duration <= deadline and progress >= 1.0:
            outcome = "normal"
        elif progress >= cfg["minimum_low_delivery_ratio"]:
            outcome = "low"
        else:
            outcome = "breach"

        # Pressure reputation loss applies at close even if the project breaches.
        for threshold, penalty in zip(cfg["pressure_reputation_thresholds"],
                                      cfg["pressure_reputation_penalties"]):
            if pressure >= threshold:
                reputation -= penalty

        if outcome == "breach":
            breaches += 1
            # No commercial settlement. Investment was already paid; the
            # contract penalty is a separate cash deduction, not a second
            # write-off of the same investment principal.
            cash -= budget * cfg["breach_penalty_ratio"]
            if cash < 0:
                bankrupt = True
                break
        else:
            if outcome == "normal":
                completed += 1
            else:
                low += 1
                reputation -= 10  # Experimental low-delivery reputation penalty.

            score = draw_score(rng, cfg)
            band = score_band(score)
            bd_gross = budget * cfg["bd_multipliers"][band]
            cash += bd_gross * cfg["bd_company_share"]
            if strategy == "contract" and score >= cfg["contract_success_bonus_score"]:
                cash += budget * cfg["contract_success_bonus_ratio"]
            if strategy != "contract":
                cash += (budget * cfg["non_bd_gross_per_budget_per_channel"]
                         * cfg["committee_channel_count"] * investment_percent / 100.0)

        if week >= cfg["weeks"]:
            break

    return Trial(strategy, bankrupt, cash, completed, low, breaches,
                 extensions, reputation, week)


def summarize(rows: list[Trial]) -> dict:
    cashes = [r.final_cash for r in rows]
    ordered = sorted(cashes)
    return {
        "strategy": rows[0].strategy,
        "trials": len(rows),
        "bankruptcy_rate": sum(r.bankrupt for r in rows) / len(rows),
        "mean_final_cash": statistics.mean(cashes),
        "median_final_cash": statistics.median(cashes),
        "p10_final_cash": ordered[max(0, int(0.10 * (len(cashes) - 1)))],
        "p90_final_cash": ordered[min(len(cashes) - 1, int(0.90 * (len(cashes) - 1)))],
        "mean_completed": statistics.mean(r.completed for r in rows),
        "mean_low_deliveries": statistics.mean(r.low_deliveries for r in rows),
        "mean_breaches": statistics.mean(r.breaches for r in rows),
        "mean_extensions": statistics.mean(r.extensions for r in rows),
        "mean_final_reputation": statistics.mean(r.reputation for r in rows),
        "mean_weeks_used": statistics.mean(r.weeks_used for r in rows)
    }


def run(cfg: dict) -> tuple[list[dict], list[Trial]]:
    all_rows, summaries = [], []
    master = random.Random(cfg["seed"])
    for strategy in cfg["strategies"]:
        rows = [simulate_one(master.randrange(0, 2**63), strategy, cfg)
                for _ in range(cfg["trials"])]
        all_rows.extend(rows)
        summaries.append(summarize(rows))
    return summaries, all_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="JSON config override")
    parser.add_argument("--out", type=Path, default=Path("simulation-output"))
    args = parser.parse_args()
    cfg = DEFAULTS
    if args.config:
        cfg = deep_merge(DEFAULTS, json.loads(args.config.read_text(encoding="utf-8")))
    summaries, rows = run(cfg)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(
        json.dumps({"config": cfg, "results": summaries}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    with (args.out / "trials.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=list(asdict(rows[0]).keys()))
        writer.writeheader()
        writer.writerows(asdict(row) for row in rows)
    print(json.dumps(summaries, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

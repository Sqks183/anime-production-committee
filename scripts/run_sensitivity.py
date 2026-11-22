#!/usr/bin/env python3
"""Run a compact parameter sensitivity matrix and emit CSV/JSON."""
import csv, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import economic_simulator as sim

OUT = Path("simulation-sensitivity")
OUT.mkdir(exist_ok=True)
scenarios = []
for penalty in (0.0, 0.25, 0.5, 0.75):
    scenarios.append((f"breach_penalty_{penalty:.2f}", {"breach_penalty_ratio": penalty}))
for pressure in (0, 5, 10, 20):
    scenarios.append((f"pressure_per_week_{pressure}", {"extension_pressure_per_week": pressure}))
for sigma in (0.10, 0.22, 0.35):
    scenarios.append((f"duration_sigma_{sigma:.2f}", {"actual_duration_lognormal_sigma": sigma}))

results = []
base = sim.deep_merge(sim.DEFAULTS, {"trials": 1000, "seed": 20261123})
for name, override in scenarios:
    cfg = sim.deep_merge(base, override)
    summaries, _ = sim.run(cfg)
    results.extend({"scenario": name, **row} for row in summaries)

with (OUT / "sensitivity.csv").open("w", newline="", encoding="utf-8-sig") as file:
    writer = csv.DictWriter(file, fieldnames=list(results[0].keys()))
    writer.writeheader()
    writer.writerows(results)
(OUT / "sensitivity.json").write_text(json.dumps(results, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
print(json.dumps(results, ensure_ascii=False, indent=2))

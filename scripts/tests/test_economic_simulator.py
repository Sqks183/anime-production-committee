import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import economic_simulator as sim

class SimulatorTests(unittest.TestCase):
    def test_score_bands(self):
        self.assertEqual([sim.score_band(x) for x in [0,34,35,49,50,64,65,79,80,100]],
                         ["D","D","C","C","B","B","A","A","S","S"])

    def test_reproducible_trial(self):
        cfg = sim.deep_merge(sim.DEFAULTS, {"weeks":120, "trials":5})
        self.assertEqual(sim.simulate_one(123456, "committee_10", cfg),
                         sim.simulate_one(123456, "committee_10", cfg))

    def test_contract_does_not_extend(self):
        cfg = sim.deep_merge(sim.DEFAULTS, {"actual_duration_median_ratio":1.2,
                                            "actual_duration_lognormal_sigma":0.000001})
        result = sim.simulate_one(7, "contract", cfg)
        self.assertEqual(result.extensions, 0)

    def test_extension_count_never_exceeds_project_count(self):
        cfg = sim.deep_merge(sim.DEFAULTS, {"weeks":520})
        result = sim.simulate_one(7, "committee_10", cfg)
        project_count = result.completed + result.low_deliveries + result.breaches
        self.assertLessEqual(result.extensions, project_count)

if __name__ == "__main__":
    unittest.main()

import sys, unittest, random
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import economic_simulator as sim

class SimulatorTests(unittest.TestCase):
    def test_score_bands(self):
        self.assertEqual([sim.score_band(x) for x in [0,34,35,49,50,64,65,79,80,100]],
                         ["D","D","C","C","B","B","A","A","S","S"])
    def test_reproducible_trial(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weeks":120,"trials":5})
        self.assertEqual(sim.simulate_one(123456,"committee_10",cfg),
                         sim.simulate_one(123456,"committee_10",cfg))
    def test_contract_does_not_extend(self):
        project=sim.DEFAULTS["project_types"][1]
        result=sim.produce_project(random.Random(7),project,sim.DEFAULTS,"contract",100)
        self.assertFalse(result[-1])
    def test_committee_extension_at_most_once_per_project(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weekly_work_capacity":50.0,"weekly_capacity_variation_sd":0.01})
        result=sim.simulate_one(7,"committee_10",cfg)
        count=result.completed+result.low_deliveries+result.breaches
        self.assertLessEqual(result.extensions,count)
    def test_stage_gates_are_dynamic_and_bounded(self):
        gates,polish,targets=sim.sample_stage_targets(random.Random(12),[100.0]*5,sim.DEFAULTS)
        self.assertGreater(len(set(gates)),1)
        self.assertTrue(all(.65<=x<=.80 for x in gates))
        self.assertTrue(all(t>=65.0 for t in targets))
    def test_low_capacity_can_trigger_extension(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weekly_work_capacity":45.0,"weekly_capacity_variation_sd":0.01})
        result=sim.produce_project(random.Random(5),sim.DEFAULTS["project_types"][1],cfg,"committee_10",100)
        self.assertTrue(result[-1])
        self.assertIn(result[0],["low","breach","normal"])

if __name__=="__main__": unittest.main()

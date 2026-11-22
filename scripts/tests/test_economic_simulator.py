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
        p=sim.DEFAULTS["project_types"][1]
        self.assertFalse(sim.produce_project(random.Random(7),p,sim.DEFAULTS,"contract",100)[6])
    def test_committee_extension_at_most_once_per_project(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weekly_work_capacity":45.0,"weekly_capacity_variation_sd":0.01})
        r=sim.simulate_one(7,"committee_10",cfg)
        self.assertLessEqual(r.extensions,r.completed+r.low_deliveries+r.breaches)
    def test_stage_gates_dynamic_and_bounded(self):
        gates,polish,targets=sim.sample_stage_targets(random.Random(12),[100.0]*5,sim.DEFAULTS)
        self.assertGreater(len(set(gates)),1)
        self.assertTrue(all(.65<=x<=.80 for x in gates))
        self.assertTrue(all(t>=65.0 for t in targets))
    def test_outsourcing_costs_are_stage_specific(self):
        p=sim.DEFAULTS["project_types"][1]
        result=sim.produce_project(random.Random(5),p,sim.DEFAULTS,"committee_10",100)
        self.assertGreater(sum(result[7]),0)
        self.assertEqual(len(result[7]),result[1])
    def test_overtime_is_capped(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weekly_work_capacity":35.0,"weekly_capacity_variation_sd":0.01})
        result=sim.produce_project(random.Random(5),sim.DEFAULTS["project_types"][1],cfg,"committee_10",100)
        self.assertTrue(all(0<=x<=cfg["overtime_capacity_ratio"]+1e-9 for x in result[8]))
    def test_non_bd_income_only_for_committee(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weeks":150})
        contract=sim.simulate_one(100,"contract",cfg)
        committee=sim.simulate_one(101,"committee_10",cfg)
        self.assertEqual(contract.total_non_bd_revenue,0)
    def test_payroll_is_four_people_at_50k(self):
        cfg=sim.deep_merge(sim.DEFAULTS,{"weeks":10})
        r=sim.simulate_one(123,"contract",cfg)
        self.assertLessEqual(r.total_payroll,10*4*50000)

if __name__=="__main__": unittest.main()

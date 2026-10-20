"""Pump-station recipe runs through the real generated C, SDK and C plant model."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]/'resources/engineering'
spec=importlib.util.spec_from_file_location('engineering',ROOT/'engineering.py')
eng=importlib.util.module_from_spec(spec);spec.loader.exec_module(eng)
RECIPE=eng.recipe('water-supply-station')
CONFIG=dict(schema='np-tools-expo-case-config/v1',caseId=RECIPE['id'],caseVersion='1.0.0',projectId=RECIPE['projectId'],projectVersion='1.0.0',bindings=RECIPE['bindings'],parameters={k:v['default'] for k,v in RECIPE['parameters'].items()},labels=RECIPE['labels'])
class Plant:
    def __init__(self,path):
        self.p=subprocess.Popen([str(path)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.id=0;self.now=0;self.inputs=1036
        self.request('hello');self.request('activate');self.tick();self.tick()
    def request(self,op,**kw):
        self.id+=1;req=dict(op=op,id=self.id);req.update(kw)
        self.p.stdin.write(json.dumps(req)+'\n');self.p.stdin.flush()
        line=self.p.stdout.readline()
        if not line:raise AssertionError('plant exited: '+self.p.stderr.read())
        return json.loads(line)
    def tick(self,**kw):
        self.now+=10
        r=dict(now=self.now,inputs=self.inputs,bad=0,commands=0,parameter=0,value=0,revision=0,environment=0,setting=0);r.update(kw)
        return self.request('tick',**r)
    def advance(self,ms):
        frames=[self.tick() for _ in range(ms//10)]
        for f in frames:
            assert not (f['fields']['P1_DO'][0] and f['fields']['P2_DO'][0])
            assert not (f['fields']['XV_OPEN_DO'][0] and f['fields']['XV_CLOSE_DO'][0])
        return frames[-1]
    def close(self):
        if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=2)
        if not self.p.stdin.closed:self.p.stdin.close()
        self.p.stdout.close();self.p.stderr.close()
class WaterStationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='np-water-');cls.work=Path(cls.tmp.name)/'project'
        eng.prepare(cls.work,(ROOT/RECIPE['directory']/'project_io.yaml').read_text())
        cls.delivery=eng.generate(cls.work,copy.deepcopy(CONFIG));cls.binary=Path(cls.delivery['directory'])/'host/runner'
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def plant(self):p=Plant(self.binary);self.addCleanup(p.close);return p
    def running(self):p=self.plant();p.tick(commands=1);p.advance(5000);return p
    def test_strict_scan_evidence_and_northbound(self):
        log=self.delivery['log'];self.assertIn('executed_scenarios=24',log);self.assertIn('HMI_SHORT_V1: PASS',log)
        fields=self.delivery['manifest']['fields'];self.assertEqual(len(fields),42)
        self.assertEqual({f['name'] for f in fields if f['bind'].startswith('point.') and f['access']!='read'},set())
    def test_normal_closed_loop_and_high_level_close(self):
        p=self.plant();f=p.tick();self.assertEqual(f['process']['tankLevelPct'],15);self.assertFalse(f['fields']['SYS_AUTO'][0])
        p.tick(commands=1);f=p.advance(5000);self.assertTrue(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['P2_RUN'][0]);self.assertTrue(f['fields']['XV_OPEN'][0])
        p.tick(environment=1,setting=9000);f=p.advance(4500);self.assertTrue(f['fields']['XV_CLOSED'][0]);self.assertTrue(f['fields']['P1_RUN'][0])
    def test_primary_fault_uses_backup_only_after_gap(self):
        p=self.running();p.inputs|=32;f=p.tick();self.assertTrue(f['fields']['P1_F_L'][0]);self.assertFalse(f['fields']['P1_DO'][0])
        f=p.advance(1990);self.assertFalse(f['fields']['P2_DO'][0]);f=p.advance(1000);self.assertTrue(f['fields']['P2_RUN'][0]);self.assertFalse(f['fields']['P1_DO'][0])
        p.inputs&=~32;p.tick(commands=8);f=p.advance(200);self.assertFalse(f['fields']['P1_F_L'][0]);self.assertFalse(f['fields']['P1_DO'][0])
    def test_low_level_stops_pump_and_refills(self):
        p=self.running();f=p.tick(environment=1,setting=1000);self.assertFalse(f['fields']['P1_DO'][0]);self.assertTrue(f['fields']['SYS_AUTO'][0]);f=p.advance(7000);self.assertTrue(f['fields']['P1_RUN'][0])
    def test_valve_stall_latch_and_separate_reset(self):
        p=self.plant();p.tick(environment=2,setting=1);p.tick(commands=1);f=p.advance(8100);self.assertTrue(f['fields']['XV_F_L'][0]);self.assertFalse(f['fields']['XV_OPEN_DO'][0])
        p.tick(environment=6,setting=1);f=p.advance(10);self.assertTrue(f['fields']['XV_F_L'][0]);p.tick(commands=32);f=p.advance(3000);self.assertFalse(f['fields']['XV_F_L'][0]);self.assertTrue(f['fields']['XV_OPEN'][0])
    def test_permission_quality_recovery_does_not_restart(self):
        p=self.running();p.inputs&=~1024;f=p.tick();self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_DO'][0]);p.inputs|=1024;f=p.advance(1000);self.assertFalse(f['fields']['SYS_AUTO'][0])
        p.tick(commands=1);p.advance(3000);f=p.tick(bad=1);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertTrue(all(not f['fields'][k][0] for k in ['P1_DO','P2_DO','XV_OPEN_DO','XV_CLOSE_DO']));f=p.advance(1000);self.assertFalse(f['fields']['SYS_AUTO'][0])
    def test_parameter_guard_and_cas(self):
        p=self.plant();f=p.tick();rev=f['parameterRevision'];f=p.tick(parameter=4,value=3000,revision=rev);self.assertEqual(f['result'],0)
        f=p.tick(parameter=4,value=4000,revision=rev);self.assertNotEqual(f['result'],0);p.tick(commands=1);f=p.tick(parameter=4,value=4000,revision=f['parameterRevision']);self.assertNotEqual(f['result'],0)
    def test_normal_stop_closes_valve_while_trip_only_removes_drive(self):
        p=self.running();p.tick(commands=2);f=p.advance(2500)
        self.assertTrue(f['fields']['XV_CLOSED'][0]);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['XV_F_L'][0])
        p=self.running();p.tick(commands=4);f=p.advance(2500)
        self.assertTrue(f['fields']['XV_OPEN'][0]);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['XV_CLOSE_DO'][0])
    def test_import_and_config_cannot_cross_cases(self):
        d=json.loads(json.dumps(eng.parse_yaml((ROOT/RECIPE['directory']/'project_io.yaml').read_text())))
        d['project']['points']['inputs'][0]['source']='board.di12'
        import yaml
        with self.assertRaises(ValueError):eng.parse_yaml(yaml.safe_dump(d))
        for key,value in [('switchDelayMs',1999),('valveTravelTimeoutMs',15001)]:
            c=copy.deepcopy(CONFIG);c['parameters'][key]=value
            with self.assertRaises(ValueError):eng.safe_config(c)
        c=copy.deepcopy(CONFIG);c['caseId']=eng.CASE_ID
        with self.assertRaises(ValueError):eng.generate(self.work,c)
    def test_flat_protocol_rejects_injected_feedback_and_unknown_model_ops(self):
        for kwargs in [dict(inputs=16),dict(environment=7),dict(environment=2,setting=5000),dict(commands=256)]:
            p=self.plant();f=p.tick(**kwargs);self.assertFalse(f['ok']);self.assertEqual(p.p.wait(timeout=2),3)
if __name__=='__main__':unittest.main()

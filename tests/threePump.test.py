"""Closed-loop plant, strict C scans, fault paths and input boundaries (host only)."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT=Path(__file__).resolve().parents[1]/'resources/engineering'
spec=importlib.util.spec_from_file_location('engineering',ROOT/'engineering.py')
eng=importlib.util.module_from_spec(spec);spec.loader.exec_module(eng)
RECIPE=eng.recipe('three-pump-level-control')
CONFIG=dict(schema='np-tools-expo-case-config/v1',caseId=RECIPE['id'],caseVersion='1.0.0',projectId=RECIPE['projectId'],projectVersion='1.0.0',bindings=RECIPE['bindings'],parameters={k:v['default'] for k,v in RECIPE['parameters'].items()},labels=RECIPE['labels'])

class Plant:
    def __init__(self,path):
        self.p=subprocess.Popen([str(path)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.id=0;self.now=0;self.inputs=2852;self.bad=0
        self.identity=self.request('hello')['identity'];self.request('activate');self.tick();self.tick()
    def request(self,op,**kw):
        self.id+=1;self.p.stdin.write(json.dumps(dict(op=op,id=self.id,**kw))+'\n');self.p.stdin.flush()
        line=self.p.stdout.readline()
        if not line:raise AssertionError('plant exited: '+self.p.stderr.read())
        return json.loads(line)
    def tick(self,**kw):
        self.now+=10;r=dict(now=self.now,inputs=self.inputs,bad=self.bad,commands=0,parameter=0,value=0,revision=0,environment=0,setting=0);r.update(kw)
        return self.request('tick',**r)
    def advance(self,ms):
        for _ in range(ms//10):
            frame=self.tick();fields=frame['fields']
            assert sum(fields[f'P{n}_DO'][0] for n in (1,2,3))<=2
            assert not fields['P1_DO'][0] or fields['F_SET_HZ'][0]<=50.001
        return frame
    def close(self):
        if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=3)
        if not self.p.stdin.closed:self.p.stdin.close()
        self.p.stdout.close();self.p.stderr.close()

class ThreePumpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='np-three-pump-');cls.work=Path(cls.tmp.name)/'project'
        eng.prepare(cls.work,(ROOT/RECIPE['directory']/'project_io.yaml').read_text())
        cls.delivery=eng.generate(cls.work,copy.deepcopy(CONFIG));cls.leaf=Path(cls.delivery['directory']);cls.binary=cls.leaf/'host/runner'
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def plant(self):p=Plant(self.binary);self.addCleanup(p.close);return p
    def single(self):p=self.plant();p.tick(commands=1);f=p.advance(120000);self.assertTrue(f['fields']['P1_RUN'][0]);return p
    def dual(self):p=self.single();p.tick(environment=2,setting=2);f=p.advance(70000);self.assertTrue(f['fields']['P2_RUN'][0]);return p
    def test_strict_executed_contract_and_complete_bundle(self):
        self.assertIn('executed_scenarios=34',self.delivery['log']);self.assertIn('HMI_SHORT_V1: PASS',self.delivery['log'])
        self.assertEqual(len(self.delivery['manifest']['fields']),74)
        self.assertIn('plant_runner.c',self.delivery['manifest']['createdFiles']);self.assertIn('flat_json.h',self.delivery['manifest']['createdFiles'])
        self.assertEqual(self.plant().identity,self.delivery['manifest']['identity'])
    def test_single_vfd_settles_to_target_using_actual_c(self):
        p=self.single();f=p.advance(40000);fields=f['fields']
        self.assertAlmostEqual(fields['LEVEL_M'][0],.8,delta=.035)
        self.assertAlmostEqual(fields['F_ACT_HZ'][0],33.333,delta=1)
        self.assertFalse(fields['P2_DO'][0]);self.assertFalse(fields['P3_DO'][0])
    def test_large_inflow_adds_one_fixed_pump_then_regulates(self):
        p=self.dual();f=p.advance(120000);fields=f['fields']
        self.assertTrue(fields['P1_RUN'][0] and fields['P2_RUN'][0]);self.assertFalse(fields['P3_DO'][0])
        self.assertAlmostEqual(fields['LEVEL_M'][0],.8,delta=.06)
        self.assertGreater(fields['F_ACT_HZ'][0],30);self.assertLess(fields['F_ACT_HZ'][0],45)
    def test_decreasing_inflow_removes_aux_without_stopping_vfd(self):
        p=self.dual();p.advance(120000);p.tick(environment=2,setting=1);f=p.advance(30000)
        self.assertTrue(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['P2_RUN'][0]);self.assertFalse(f['fields']['P3_RUN'][0]);self.assertTrue(f['fields']['SYS_AUTO'][0])
    def test_fault_waits_for_stopped_feedback_before_standby(self):
        p=self.dual();p.tick(environment=4,setting=2);p.inputs|=16;f=p.tick()
        self.assertTrue(f['fields']['P1_DO'][0]);self.assertTrue(f['fields']['P2_F_L'][0]);self.assertFalse(f['fields']['P3_DO'][0])
        f=p.advance(7000);self.assertTrue(f['fields']['P2_F_STP'][0]);self.assertFalse(f['fields']['P3_DO'][0])
        p.tick(environment=4,setting=0);f=p.advance(1990);self.assertFalse(f['fields']['P3_DO'][0])
        f=p.advance(1000);self.assertTrue(f['fields']['P3_RUN'][0]);self.assertTrue(f['fields']['P1_RUN'][0])
        p.inputs&=~16;p.tick(commands=32);f=p.advance(100);self.assertFalse(f['fields']['P2_F_L'][0]);self.assertTrue(f['fields']['P3_DO'][0]);self.assertFalse(f['fields']['P2_DO'][0])
    def test_commanded_full_speed_does_not_replace_actual_feedback(self):
        p=self.single();p.tick(environment=8,setting=40000);p.tick(environment=2,setting=2);f=p.advance(120000)
        self.assertAlmostEqual(f['fields']['F_SET_HZ'][0],50,delta=.01);self.assertAlmostEqual(f['fields']['F_ACT_HZ'][0],40,delta=.01)
        self.assertFalse(f['fields']['P2_DO'][0]);self.assertFalse(f['fields']['P3_DO'][0]);self.assertTrue(f['fields']['LEVEL_HH'][0])
    def test_signal_recovery_does_not_restore_auto(self):
        p=self.single();f=p.tick(environment=5,setting=1);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['LEVEL_OK'][0]);self.assertTrue(f['fields']['SYS_ALARM'][0])
        p.tick(environment=5,setting=0);f=p.advance(1000);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_DO'][0])
    def test_vfd_fault_requires_explicit_degraded_command(self):
        p=self.single();p.inputs|=2;f=p.tick();self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P3_DO'][0])
        p.advance(600);p.tick(commands=8);f=p.advance(12000)
        self.assertTrue(f['fields']['SYS_DEG'][0]);self.assertTrue(f['fields']['P3_RUN'][0]);self.assertFalse(f['fields']['P1_DO'][0]);self.assertFalse(f['fields']['PI_RUN'][0])
    def test_healthy_vfd_refuses_degraded_start_and_leads_normal_start(self):
        p=self.plant();f=p.tick(commands=8)
        self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['SYS_DEG'][0])
        self.assertFalse(any(f['fields'][f'P{n}_DO'][0] for n in (1,2,3)))
        p.tick(commands=1);f=p.advance(5000)
        self.assertTrue(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['P2_DO'][0]);self.assertFalse(f['fields']['P3_DO'][0])
    def test_degraded_fault_recovery_requires_stopped_feedback_and_fresh_normal_start(self):
        p=self.single();p.tick(environment=2,setting=2);p.inputs|=2;p.tick();p.advance(600)
        p.tick(commands=8);f=p.advance(12000);self.assertTrue(f['fields']['P3_RUN'][0])
        p.inputs&=~2;p.tick(commands=16);f=p.advance(1000)
        self.assertFalse(f['fields']['P1_F_L'][0]);self.assertTrue(f['fields']['FREQ_OK'][0])
        self.assertTrue(f['fields']['SYS_DEG'][0]);self.assertTrue(f['fields']['P3_RUN'][0]);self.assertFalse(f['fields']['P1_DO'][0])
        f=p.tick(commands=1);self.assertTrue(f['fields']['SYS_DEG'][0]);self.assertFalse(f['fields']['P1_DO'][0])
        f=p.tick(commands=2);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['SYS_DEG'][0])
        f=p.tick(commands=1);self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_DO'][0])
        f=p.advance(600);self.assertEqual(f['fields']['OCCUPIED'][0],0)
        f=p.advance(1000);self.assertFalse(f['fields']['SYS_AUTO'][0])
        p.tick(commands=1);f=p.advance(20000)
        self.assertTrue(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['SYS_DEG'][0])
        self.assertTrue(f['fields']['P1_RUN'][0]);self.assertFalse(f['fields']['P3_DO'][0])
    def test_frequency_recovery_does_not_silently_switch_degraded_owner(self):
        p=self.single();p.tick(environment=2,setting=2);f=p.tick(environment=6,setting=1)
        self.assertFalse(f['fields']['SYS_AUTO'][0]);self.assertFalse(f['fields']['P1_F_L'][0])
        p.advance(600);p.tick(commands=8);f=p.advance(12000)
        self.assertTrue(f['fields']['SYS_DEG'][0]);self.assertTrue(f['fields']['P3_RUN'][0])
        p.tick(environment=6,setting=0);f=p.advance(1000)
        self.assertTrue(f['fields']['FREQ_OK'][0]);self.assertFalse(f['fields']['P1_F_L'][0])
        self.assertTrue(f['fields']['SYS_DEG'][0]);self.assertFalse(f['fields']['P1_DO'][0])
    def test_float_parameter_revision_bounds_and_running_guard(self):
        p=self.plant();f=p.tick();rev=f['parameterRevision'];f=p.tick(parameter=2,value=850,revision=rev)
        self.assertEqual(f['result'],0);self.assertAlmostEqual(f['fields']['L_SP_M'][0],.85,places=4)
        f=p.tick(parameter=2,value=900,revision=rev);self.assertNotEqual(f['result'],0)
        p.tick(commands=1);f=p.tick(parameter=2,value=900,revision=f['parameterRevision']);self.assertNotEqual(f['result'],0)
        f=p.tick(environment=1,setting=1000);self.assertNotEqual(f['result'],0)
    def test_stop_low_water_and_permission_are_distinct(self):
        p=self.single();p.inputs&=~512;f=p.tick();self.assertFalse(f['fields']['P1_DO'][0]);self.assertTrue(f['fields']['SYS_AUTO'][0])
        p.inputs|=512;p.inputs&=~2048;f=p.tick();self.assertFalse(f['fields']['SYS_AUTO'][0]);p.inputs|=2048;f=p.advance(1000);self.assertFalse(f['fields']['SYS_AUTO'][0])
    def test_import_and_parameter_constraints(self):
        original=(ROOT/RECIPE['directory']/'project_io.yaml').read_text();self.assertEqual(eng.source_recipe(eng.parse_yaml(original)['project'])['id'],RECIPE['id'])
        for mutate in [lambda d:d['project']['points']['inputs'][-1].update(c_type='bool'),lambda d:d['project']['features'].update(counter=True)]:
            d=yaml.safe_load(original);mutate(d)
            with self.assertRaises(ValueError):eng.parse_yaml(yaml.safe_dump(d))
        for key,value in [('stopLevelM',.8),('targetLevelM',float('nan')),('pidKi',True),('pidKp',2.00001)]:
            c=copy.deepcopy(CONFIG);c['parameters'][key]=value
            with self.assertRaises(ValueError):eng.safe_config(c)
    def test_protocol_rejects_feedback_injection_floats_and_bad_masks(self):
        for kw in [dict(inputs=2853),dict(environment=2,setting=4),dict(environment=1,setting=3001),dict(bad=16384),dict(value=.5),dict(commands=1024)]:
            p=self.plant();f=p.tick(**kw);self.assertFalse(f['ok']);self.assertEqual(p.p.wait(timeout=2),3)
    def test_independent_mutations_are_detected_by_actual_scan_tests(self):
        sdk=self.work/'sdk';original=(self.leaf/'logic.c').read_text()
        mutations=[('permit', 'IO_IN(context,run_permit).value &&', 'true &&'),('gain-rearm','stopped || changed ||','stopped || false ||')]
        for name,before,after in mutations:
            self.assertEqual(original.count(before),1)
            source=Path(self.tmp.name)/f'{name}.c';source.write_text(original.replace(before,after,1));binary=source.with_suffix('')
            flags=['cc','-std=c11','-Werror','-Wall','-Wextra','-Wno-unused-function']
            for include in [self.leaf/'generated',self.leaf,sdk/'application',sdk/'User/Inc',sdk/'tests']:flags+=['-I',str(include)]
            sources=[source,self.leaf/'generated/point_config.c',self.leaf/'logic_project_test.c']+[sdk/f'User/Src/{n}.c' for n in ['data_manager','logic_manager','logic_parameter_store','logic_runtime_store']]+[sdk/'tests/eeprom_transport_fake.c']
            subprocess.run([*flags,*map(str,sources),'-lm','-o',str(binary)],check=True,capture_output=True,text=True)
            result=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0,name+' mutation escaped');self.assertIn('assertion',result.stderr)

if __name__=='__main__':unittest.main()

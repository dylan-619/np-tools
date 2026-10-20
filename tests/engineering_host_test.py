"""Real generated C/SDK execution. No fake frontend state or physical hardware."""
import copy
import importlib.util
import json
from pathlib import Path
import random
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]/'resources/engineering'
spec=importlib.util.spec_from_file_location('engineering',ROOT/'engineering.py')
eng=importlib.util.module_from_spec(spec);spec.loader.exec_module(eng)
CONFIG={'schema':'np-tools-expo-case-config/v1','caseId':eng.CASE_ID,'caseVersion':'1.0.0','projectId':'expo_sequence_demo','projectVersion':'1.0.0','bindings':eng.SOURCES,'parameters':{'startDelayMs':3000,'clearDelayMs':4000},'labels':{'downstream':'后级','upstream':'前级'}}
class Runner:
    def __init__(self,path):
        self.p=subprocess.Popen([str(path)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.id=0
    def request(self,op='tick',**kw):
        self.id+=1
        req={'op':op,'id':self.id}
        if op=='tick':req.update(now=0,inputs=0,bad=0,commands=0,parameter=0,value=0,revision=0)
        req.update(kw);self.p.stdin.write(json.dumps(req)+'\n');self.p.stdin.flush()
        row=self.p.stdout.readline()
        if not row:raise AssertionError('runner exited: '+self.p.stderr.read())
        return json.loads(row)
    def start(self):self.request('hello');self.request('activate');self.request(now=0);return self.request(now=10,inputs=4)
    def close(self):
        if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=2)
        self.p.stdout.close();self.p.stderr.close()
class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='np-expo-test-');cls.work=Path(cls.tmp.name)/'project'
        eng.prepare(cls.work,(ROOT/'case/project_io.yaml').read_text())
        cls.delivery=eng.generate(cls.work,copy.deepcopy(CONFIG));cls.leaf=Path(cls.delivery['directory']);cls.binary=cls.leaf/'host/runner'
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def runner(self):r=Runner(self.binary);self.addCleanup(r.close);return r
    def test_strict_execution_evidence(self):
        log=self.delivery['manifest']['hostReport']['log']
        self.assertIn('PLC_EXECUTED_V1: PASS',log);self.assertIn('executed_scenarios=15',log);self.assertIn('successful_manager_steps=93',log)
    def test_identity_and_initial_state(self):
        r=self.runner();self.assertEqual(r.request('hello')['identity'],self.delivery['manifest']['identity'])
        r.request('activate');v=r.request(now=0);self.assertFalse(v['fields']['DOWN_OUT'][0]);self.assertEqual(v['fields']['LINE_PHASE'][0],4)
    def test_real_configured_timing_and_stop(self):
        r=self.runner();r.start();v=r.request(now=20,inputs=4,commands=1);self.assertTrue(v['fields']['DOWN_OUT'][0]);self.assertFalse(v['fields']['UP_OUT'][0])
        v=r.request(now=3019,inputs=4);self.assertFalse(v['fields']['UP_OUT'][0])
        v=r.request(now=3020,inputs=4);self.assertTrue(v['fields']['UP_OUT'][0])
        r.request(now=3030,inputs=4,commands=2);v=r.request(now=7029,inputs=4);self.assertTrue(v['fields']['DOWN_OUT'][0])
        v=r.request(now=7030,inputs=4);self.assertFalse(v['fields']['DOWN_OUT'][0])
    def test_real_di_edges_and_permission(self):
        r=self.runner();r.start();self.assertEqual(r.request(now=20,inputs=5)['fields']['LINE_PHASE'][0],1)
        self.assertEqual(r.request(now=30,inputs=1)['fields']['LINE_PHASE'][0],4)
        self.assertEqual(r.request(now=40,inputs=5)['fields']['LINE_PHASE'][0],0)
        self.assertEqual(r.request(now=50,inputs=5)['fields']['LINE_PHASE'][0],0)
    def test_cas_range_and_cycle_guard(self):
        r=self.runner();v=r.start();revision=v['parameterRevision']
        v=r.request(now=20,inputs=4,parameter=1,value=1000,revision=revision);self.assertEqual(v['result'],0)
        v=r.request(now=30,inputs=4,parameter=2,value=2000,revision=revision);self.assertNotEqual(v['result'],0)
        v=r.request(now=40,inputs=4,parameter=1,value=999,revision=v['parameterRevision']);self.assertNotEqual(v['result'],0)
        v=r.request(now=50,inputs=4,commands=1);v=r.request(now=60,inputs=4,parameter=1,value=2000,revision=v['parameterRevision']);self.assertNotEqual(v['result'],0)
    def test_bad_quality_output_safe(self):
        r=self.runner();r.start();r.request(now=20,inputs=4,commands=1)
        for bit in [1,2,4]:
            v=r.request(now=30+bit,inputs=4,bad=bit);self.assertEqual(v['fields']['LINE_BLOCK_REASON'][0],2);self.assertFalse(v['fields']['DOWN_OUT'][0])
    def test_eof_releases_process(self):
        r=self.runner();r.start();r.p.stdin.close();self.assertEqual(r.p.wait(timeout=2),0)
    def test_malformed_protocol_and_unknown_fields(self):
        for line in ['{"op":"hello","id":1,"id":2}','{"op":"hello","id":1,"extra":0}','{"op":"hello","id":01}','{"op":"hello","id":1} trailing','{"op":"hello","id":4294967296}']:
            r=self.runner();out,_=r.p.communicate(line+'\n',timeout=2);self.assertFalse(json.loads(out)['ok']);self.assertNotEqual(r.p.returncode,0)
    def test_stale_request_rejected_without_replay(self):
        r=self.runner();r.request('hello');r.p.stdin.write('{"op":"activate","id":1}\n');r.p.stdin.flush();self.assertFalse(json.loads(r.p.stdout.readline())['ok'])
    def test_randomized_scan_output_invariant(self):
        r=self.runner();r.start();random.seed(427)
        for now in range(20,8020,10):
            v=r.request(now=now,inputs=random.randrange(8),commands=random.choice([0,0,0,1,2,4]))
            f=v['fields'];self.assertFalse(f['UP_OUT'][0] and not f['DOWN_OUT'][0])
    def test_yaml_rejects_ambiguity_preserves_unknown(self):
        base=(ROOT/'case/project_io.yaml').read_text()
        with self.assertRaises(ValueError):eng.parse_yaml('schema: x\nschema: y')
        with self.assertRaises(ValueError):eng.parse_yaml('a: &x [1]\nb: *x')
        with self.assertRaises(ValueError):eng.parse_yaml('rows:\n'+'- 0\n'*20001)
        with self.assertRaises(ValueError):eng.parse_yaml('rows: '+'['*30+'0'+']'*30)
        with self.assertRaises(ValueError):eng.parse_yaml(base.replace('board.di03','board.di01'))
        doc=eng.parse_yaml(base+'\nvendor_extension: keep-me\n');self.assertEqual(doc['vendor_extension'],'keep-me')
    def test_original_extensions_and_aliases_survive_materialization(self):
        text=(ROOT/'case/project_io.yaml').read_text().replace('name: start_button','name: local_start')+'\nvendor_extension: keep-me\n'
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp)/'project';eng.prepare(work,text)
            result=eng.generate(work,copy.deepcopy(CONFIG));leaf=Path(result['directory'])
            self.assertEqual(eng.yaml.safe_load(result['yaml'])['vendor_extension'],'keep-me')
            roles=json.loads((leaf/'point-role-map.json').read_text())
            self.assertEqual(roles[0]['inputName'],'local_start')
            self.assertEqual((leaf/'original-project_io.yaml').read_text(),text)
            self.assertEqual(result['code'],self.delivery['code'])
    def test_tampered_delivery_and_sdk_rejected(self):
        source=self.leaf/'logic.c';original=source.read_bytes()
        try:
            source.write_bytes(original+b'\n/* tamper */')
            with self.assertRaises(ValueError):eng.verify_delivery(self.work,self.leaf)
        finally:source.write_bytes(original)
        sdk=self.work/'sdk/User/Src/logic_manager.c';original=sdk.read_bytes()
        try:
            sdk.write_bytes(original+b'\n')
            with self.assertRaises(ValueError):eng.verify_sdk(self.work/'sdk')
        finally:sdk.write_bytes(original)
    def test_export_contains_original_and_no_absolute_workspace(self):
        result=eng.export_delivery(self.work,self.leaf)
        with eng.zipfile.ZipFile(result['path']) as archive:
            self.assertIn('original-project_io.yaml',archive.namelist())
            self.assertIn('point-role-map.json',archive.namelist())
            self.assertNotIn(str(self.work),archive.read('host/build.log').decode())
            extracted=self.work/'export-roundtrip';archive.extractall(extracted)
            self.assertTrue(eng.verify_delivery(self.work,extracted))
    def test_host_exception_does_not_relax_hardware_scope(self):
        script=ROOT/'sdk/.opencode/skills/kz3-control-engineer/scripts/verify_project.py'
        with tempfile.TemporaryDirectory() as tmp:
            leaf=Path(tmp)
            for name in ['logic.c','README.md','logic_project_test.c']:(leaf/name).write_bytes((self.leaf/name).read_bytes())
            readme=leaf/'README.md';readme.write_text(readme.read_text().replace('delivery_scope: host_simulation','delivery_scope: hardware'))
            # Run the actual verifier: a hardware scope cannot use the host-only exception.
            import sys
            sys.path.insert(0,str(script.parent))
            try:
                spec=importlib.util.spec_from_file_location('host_verifier',script)
                verifier=importlib.util.module_from_spec(spec);spec.loader.exec_module(verifier)
                with self.assertRaises(ValueError):verifier.validate_strict_quality(leaf,eng.yaml.safe_load(self.delivery['yaml'])['project'],True)
            finally:sys.path.pop(0)
    def test_config_closed_and_bounded(self):
        for change in [{'parameters':{'startDelayMs':True,'clearDelayMs':5000}},{'bindings':{}},{'extra':'int main(){}'},{'projectId':'../../bad'}]:
            c=copy.deepcopy(CONFIG);c.update(change)
            with self.assertRaises((ValueError,TypeError)):eng.safe_config(c)
    def test_materialization_deterministic_and_version_conflict(self):
        with self.assertRaises(ValueError):eng.generate(self.work,copy.deepcopy(CONFIG))
        c=copy.deepcopy(CONFIG);c['projectVersion']='1.0.1'
        other=eng.generate(self.work,c)
        self.assertEqual(self.delivery['code'],other['code']);self.assertEqual(other['manifest']['hostReport']['status'],'HOST_PASS')
if __name__=='__main__':unittest.main(verbosity=2)

"""Developer-only template qualification; never run by the model or shipped UI."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil

BASE=Path(__file__).resolve().parents[2]
ROOT=BASE/'resources/engineering'
leaf=ROOT/'cases/three-pump-level-control'
files=['project_io.yaml','logic.c','logic_project_test.c','plant_runner.c','model-profile.json']
(leaf/'case.json').write_text(json.dumps(dict(id='three-pump-level-control',version='1.0.0',files={n:hashlib.sha256((leaf/n).read_bytes()).hexdigest() for n in files}),indent=2)+'\n')
spec=importlib.util.spec_from_file_location('engineering',ROOT/'engineering.py')
eng=importlib.util.module_from_spec(spec);spec.loader.exec_module(eng)
work=BASE/'works/ai-control-expo-design/three-pump-verification/project'
if work.exists():shutil.rmtree(work)
eng.prepare(work,(leaf/'project_io.yaml').read_text())
r=eng.recipe('three-pump-level-control')
config=dict(schema='np-tools-expo-case-config/v1',caseId=r['id'],caseVersion='1.0.0',projectId=r['projectId'],projectVersion='1.0.0',bindings=r['bindings'],parameters={k:v['default'] for k,v in r['parameters'].items()},labels=r['labels'])
delivery=eng.generate(work,config)
evidence=BASE/'works/ai-control-expo-design/验证记录'
(evidence/'three-pump-build.log').write_text(delivery['log'])
(evidence/'three-pump-delivery.json').write_text(json.dumps(delivery['manifest'],ensure_ascii=False,indent=2))
print('HOST_PASS',delivery['directory'])
print(delivery['manifest']['hostReport']['log'][-2500:])

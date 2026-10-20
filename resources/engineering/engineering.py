#!/usr/bin/env python3
"""NP-Tools private engineering driver. No hardware/network/shell operations."""
from __future__ import annotations
import argparse, copy, csv, hashlib, io, json, math, os, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path
import yaml
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import water_station
import three_pump
CATALOG=json.loads((ROOT/'cases/catalog.json').read_text())
RECIPES={c['id']:c for c in CATALOG}
CASE_ID='two-device-output-sequence'
def recipe(case_id):
    if case_id not in RECIPES:raise ValueError('不支持的工艺案例')
    return RECIPES[case_id]
def source_recipe(p):
    sources={pt.get('source') for group in p.get('points',{}).values() for pt in group if isinstance(pt,dict)}
    matches=[r for r in CATALOG if set(r['bindings'].values())==sources]
    if len(matches)!=1:raise ValueError('点位未匹配支持的工艺案例：三泵液位、双泵供水或两设备顺控')
    return matches[0]
SOURCES={'startButton':'board.di01','stopButton':'board.di02','runPermit':'board.di03','downstreamOutput':'board.do01','upstreamOutput':'board.do02'}
class UniqueLoader(yaml.SafeLoader): pass
def mapping(loader,node,deep=False):
    out={}
    for k,v in node.value:
        key=loader.construct_object(k,deep=deep)
        if not isinstance(key,str) or key in out: raise ValueError('YAML key必须是唯一字符串')
        out[key]=loader.construct_object(v,deep=deep)
    return out
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,mapping)
def parse_yaml(content):
    if not isinstance(content,str) or len(content.encode())>5*1024*1024: raise ValueError('点表超过5MiB')
    depth=0
    for count,x in enumerate(yaml.parse(content),1):
        if count>20000 or isinstance(x,yaml.AliasEvent):raise ValueError('不支持YAML别名或过大文档')
        if isinstance(x,(yaml.MappingStartEvent,yaml.SequenceStartEvent)):depth+=1
        if depth>24:raise ValueError('YAML嵌套过深')
        if isinstance(x,(yaml.MappingEndEvent,yaml.SequenceEndEvent)):depth-=1
    d=yaml.load(content,Loader=UniqueLoader)
    if not isinstance(d,dict) or d.get('schema')!='kz3-project-io/v3':raise ValueError('需要kz3-project-io/v3点表')
    p=d.get('project',{})
    if not isinstance(p,dict):raise ValueError('project必须为对象')
    pts=p.get('points',{})
    if not isinstance(p,dict) or not isinstance(pts,dict):raise ValueError('project与points必须为对象')
    if any(value for key,value in pts.items() if key not in ['inputs','outputs']):raise ValueError('固定案例仅接受已声明的输入与输出组')
    if p.get('board')!='kz3_f427_standard':raise ValueError('案例只支持KZ3 F427标准板型')
    selected=source_recipe(p); expected=set(selected['bindings'].values()); found=[]; names=[]
    for direction in ['inputs','outputs']:
        for pt in pts.get(direction,[]):
            if not isinstance(pt,dict):raise ValueError('点位记录必须为对象')
            name,source,desc=pt.get('name'),pt.get('source'),pt.get('description')
            expected_type='float' if isinstance(source,str) and source.startswith(('board.ai','board.ao')) else 'bool'
            if pt.get('c_type','bool')!=expected_type:raise ValueError('点位类型与板载通道不一致')
            if not isinstance(name,str) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,47}',name):raise ValueError('点位名称无效')
            if not isinstance(desc,str) or not desc.strip():raise ValueError(f'{name}缺少描述，不能核对角色')
            if source not in expected or (direction=='inputs') != source.startswith(('board.di','board.ai')):raise ValueError(f'案例不支持点位{source}')
            found.append(source);names.append(name)
    if set(found)!=expected or len(found)!=len(expected) or len(set(names))!=len(expected):raise ValueError('点位来源和名称必须唯一，并完整匹配工艺角色')
    # Existing northbound/variables are constraints, not silently overwritten.
    baseline=yaml.safe_load((ROOT/selected['directory']/'project_io.yaml').read_text())['project']
    for key in ['devices','pids','runtime_counters','logic_blocks','startup','quality_policies']:
        if p.get(key) and p[key]!=baseline.get(key):raise ValueError(f'当前工艺不支持额外{key}')
    if p.get('required_profiles') or (p.get('features') and p['features']!=baseline['features']):raise ValueError('固定案例不支持额外硬件配置或功能')
    if p.get('scan_period_ms',10)!=10:raise ValueError('固定案例扫描周期为10ms')
    for key in ['application_variables','northbound']:
        if p.get(key) and p[key]!=baseline.get(key):raise ValueError(f'已有{key}与固定案例不一致，请使用五点输入表或完整案例原表')
    return d

class FlowRecord(dict): pass
def represent_flow(dumper,data):
    return dumper.represent_mapping('tag:yaml.org,2002:map',data,flow_style=True)
yaml.SafeDumper.add_representer(FlowRecord,represent_flow)
def project_yaml(d):
    p=d['project']
    for kind in ['inputs','outputs']:p['points'][kind]=[FlowRecord(x) for x in p['points'][kind]]
    for kind in ['parameters','commands','states']:p['application_variables'][kind]=[FlowRecord(x) for x in p['application_variables'][kind]]
    p['northbound']['fields']=[FlowRecord(x) for x in p['northbound']['fields']]
    return yaml.safe_dump(d,allow_unicode=True,sort_keys=False,width=10000)

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def safe_config(c):
    required={'schema','caseId','caseVersion','projectId','projectVersion','bindings','parameters','labels'}
    if not isinstance(c,dict) or set(c)!=required or c['schema']!='np-tools-expo-case-config/v1' or c['caseVersion']!='1.0.0':raise ValueError('案例配置schema、版本或字段无效')
    r=recipe(c['caseId'])
    if c['bindings']!=r['bindings']:raise ValueError('点位角色与工艺绑定不一致')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,48}',str(c['projectId'])) or not re.fullmatch(r'\d+\.\d+\.\d+',str(c['projectVersion'])):raise ValueError('工程ID/版本无效')
    if not isinstance(c['parameters'],dict) or set(c['parameters'])!=set(r['parameters']):raise ValueError('参数集合与工艺不一致')
    for k,v in c['parameters'].items():
        spec=r['parameters'][k]
        valid=type(v) in (int,float) and math.isfinite(v) and spec['min']<=v<=spec['max']
        if spec.get('type','u32')=='u32':valid=valid and type(v)==int
        else:valid=valid and abs(v*1000-round(v*1000))<0.00001
        if not valid:raise ValueError('参数超出工艺范围或精度：'+k)
    if c['caseId']=='three-pump-level-control':three_pump.validate_parameters(c['parameters'])
    if not isinstance(c['labels'],dict) or set(c['labels'])!=set(r['labels']) or any(not isinstance(v,str) or not v.strip() or not 1<=len(v)<=40 or any(ord(ch)<32 for ch in v) for v in c['labels'].values()) or len(set(c['labels'].values()))!=len(c['labels']) or '联动控制' in c['labels'].values():raise ValueError('设备显示名需为互异的1–40个可见字符')
    return c

def run(args,cwd=None,timeout=60):
    p=subprocess.run([str(x) for x in args],cwd=cwd,capture_output=True,text=True,timeout=timeout)
    if p.returncode:raise ValueError(f'任务失败({p.returncode}): {p.stderr[-6000:]}{p.stdout[-3000:]}')
    return p.stdout+p.stderr

def scene(c):
    if c['caseId']=='three-pump-level-control':return three_pump.scene(c,recipe(c['caseId']))
    if c['caseId']=='water-supply-station':return water_station.scene(c,recipe(c['caseId']))
    labels=c['labels']
    base={'name':'两设备顺序启停','devices':[{'name':'联动控制','type':'screen','points':{'remote':'RUN_PERMIT','phase':'LINE_PHASE'},'commands':{'start':'LINE_START','stop':'LINE_STOP'}},{'name':labels['downstream'],'type':'sensor','points':{},'commands':{}},{'name':labels['upstream'],'type':'sensor','points':{},'commands':{}}], 'measurements':[], 'parameters':[{'name':'启动间隔','point':'START_DELAY_MS','min':1000,'max':10000,'unit':'ms','persistent':False},{'name':'停止延时','point':'CLEAR_DELAY_MS','min':1000,'max':10000,'unit':'ms','persistent':False}],'externalInputs':[],'source':{'projectId':c['projectId'],'projectVersion':c['projectVersion'],'pointTable':'project_io.yaml','pointNameContract':'MGTools northbound field.name'},'notes':['本地仿真；输出目标不等于实际电机运行。']}
    side={'schema':'np-tools-scene-bindings/v1','devices':[{'name':labels['downstream'],'outputPoint':'DOWN_OUT','feedbackKind':'none'},{'name':labels['upstream'],'outputPoint':'UP_OUT','feedbackKind':'none'}],'actions':[{'label':'立即停止','point':'LINE_PROTECT_STOP','kind':'oneShot'}],'phaseLabels':{'LINE_PHASE':{'0':'待命','1':'等待前级接通','2':'两路输出接通','3':'后级延时停止','4':'禁止启动'}},'blockReasonPoint':'LINE_BLOCK_REASON','remainingPoint':'LINE_REMAIN_MS','inputPoints':['START_BTN','STOP_BTN','RUN_PERMIT'],'layout':{'template':'two-device-sequence','deviceOrder':[labels['downstream'],labels['upstream']]}}
    return base,side

def requirements_readme(work,c,identity):
    if c['caseId']=='three-pump-level-control':return three_pump.readme(c,identity)
    if c['caseId']=='water-supply-station':return water_station.readme(c,identity)
    keys=['scope','point_roles','output_safe_values','mode_owner','priority','bad_quality_policy','reset_scope','auto_restart_policy','timing_units_and_boundaries','northbound_whitelist']
    declarations=['NEGATIVE_SWITCH_WINDOW','TIME_BOUNDARY','NORMAL_PATH','BAD_QUALITY','COMMAND_CONFLICT','STOP_SAFE','RESET_FAULTS','PARAMETER_SNAPSHOT','TICK_WRAP','STARTUP_HELD','POINT_MAPPING','RECOVERY_NO_START','DEMAND_PRIORITY','PARAMETER_UPDATE','COMMUNICATION_LOSS']
    specified={'io_semantics':'POINT_MAPPING','startup_recovery':'RECOVERY_NO_START','process_arbitration':'DEMAND_PRIORITY','measurement_quality':'BAD_QUALITY','timing_parameters':'PARAMETER_UPDATE','communication':'COMMUNICATION_LOSS'}
    reasons={'ownership':'单一共享顺控owner，无手自动模式切换','feedback_interlocks':'无实际运行反馈，不模拟实际电机状态','fault_reset':'无设备故障锁存，重启演示是运行器冷启动；RESET_FAULTS检查许可恢复不自启','retention':'参数RAM保存，运行器重启回生成默认值，不声称硬件持久化','hmi_contract':'固定13字段及场景schema另由绑定校验与交互测试验证'}
    domains=['io_semantics','ownership','startup_recovery','process_arbitration','feedback_interlocks','measurement_quality','timing_parameters','fault_reset','communication','retention','hmi_contract']
    basis={
      'scope':'仅host_simulation，无实板、无烧录、无电气验证',
      'point_roles':'DI1启动上升沿、DI2正常停止、DI3许可；DO1后级、DO2前级；固定绑定',
      'output_safe_values':'两路虚拟输出false；Logic_Init/Stop及许可撤销路径均实际扫描测试',
      'mode_owner':'两输出由同一顺控owner，HMI与虚拟DI为输入来源，无独立手自动模式',
      'priority':'质量/许可、立即停止、正常停止、定时、新启动依次处理',
      'bad_quality_policy':'任意三DI质量非GOOD立即断开并禁止启动',
      'reset_scope':'没有设备故障锁存或复位命令，许可恢复只待命；运行器冷启动不自动启动',
      'auto_restart_policy':'许可恢复及同拍启动不自启；启动沿在所有状态采样，不排队',
      'timing_units_and_boundaries':'毫秒1000–10000；启动时快照两参数；uint32差值支持回绕',
      'northbound_whitelist':'固定13字段；只有3命令与2参数可写；DI注入为独立仿真接口'}
    contract={'schema':'kz3-requirements/v1','delivery_scope':'host_simulation','case_id':CASE_ID,'status':'FROZEN','version':c['projectVersion'],'project_id':c['projectId'],'evidence':{'point_source':'original-project_io.yaml SHA256='+identity['inputSha256'],'safety_source':'README#已确认控制规则；logic_project_test.c STOP_SAFE/BAD_QUALITY','control_source':'requirements.json用户确认及固定案例1.0.0'},'confirmations':{k:True for k in keys},'traceability':{k:'README#已确认控制规则 '+basis[k] for k in keys},'northbound':{'profile':'HMI_SHORT_V1'},'verification':{'execution_profile':'PLC_EXECUTED_V1','required_scenarios':declarations},'open_items':[],'engineering_review':{'profile':'TABLE_CONTROL_V1','control_features':[],'decisions':[{'id':'FIXED_HOST_CASE','status':'accepted','proposal':'使用已设计固定顺控模板，仅两个延时可变','selection':'用户在NP-Tools确认当前需求与配置','basis':'requirements.json及case-config.json'}],'boundaries':{d:{'status':'specified' if d in specified else 'not_applicable','rationale':('固定案例主机扫描检查 '+specified[d]) if d in specified else reasons[d],'scenarios':[specified[d]] if d in specified else []} for d in domains}}}
    return '# 两设备顺序启停 / '+c['projectVersion']+'\n\n## 已确认控制规则\n\n'+'\n'.join('- '+basis[k] for k in keys)+'\n\n当前参数：'+json.dumps(c['parameters'])+'\n\n## 标准与符合性\n\nKZ3 PLC_STYLE_V1 与 HMI_SHORT_V1 工程检查；仅host-only，不声明IEC/SIL认证。PLC_TEST RESET_FAULTS 表示许可恢复无自启的回归，案例不含设备故障复位功能。\n\n<!-- KZ3_REQUIREMENTS_CONTRACT_BEGIN -->\n```yaml\n'+yaml.safe_dump({'requirements_contract':contract},allow_unicode=True,sort_keys=False)+'```\n<!-- KZ3_REQUIREMENTS_CONTRACT_END -->\n'

def generate(work,c):
    verify_resources();safe_config(c); input_file=work/'original-project_io.yaml';original=parse_yaml(input_file.read_text())
    selected=source_recipe(original['project'])
    if selected['id']!=c['caseId']:raise ValueError('配置与导入点表的工艺不匹配')
    verify_sdk(work/'sdk')
    sdk=work/'sdk';destination=sdk/'application/projects/工博会'/c['projectVersion']
    if destination.exists():raise ValueError('该版本已经存在，请递增工程版本')
    # Candidate files never occupy a published revision, even after forced cancellation.
    staging=sdk/'application/projects/工博会/.building'
    shutil.rmtree(staging,ignore_errors=True)
    leaf=staging/c['projectVersion']
    leaf.mkdir(parents=True)
    try:
        baseline=yaml.safe_load((ROOT/selected['directory']/'project_io.yaml').read_text())
        d=copy.deepcopy(original);p=d['project']
        # Canonical aliases let the exact same qualified C template run for every import.
        # Keep descriptions/extensions and record every alias conversion explicitly.
        role_map=[]
        for kind in ['inputs','outputs']:
            by_source={x['source']:x for x in p['points'][kind]}
            normalized=[]
            for fixed in baseline['project']['points'][kind]:
                pt=copy.deepcopy(by_source[fixed['source']])
                role_map.append({'source':pt['source'],'inputName':pt['name'],'caseName':fixed['name'],'description':pt['description']})
                pt['name']=fixed['name'];normalized.append(pt)
            p['points'][kind]=normalized
        for key in ['application_variables','northbound','features','devices','pids','required_profiles','scan_period_ms','runtime_counters']:
            p[key]=copy.deepcopy(baseline['project'].get(key,[]))
        p.update(id=c['projectId'],version=c['projectVersion'])
        (leaf/'point-role-map.json').write_text(json.dumps(role_map,ensure_ascii=False,indent=2))
        shutil.copyfile(input_file,leaf/'original-project_io.yaml')
        for name in ['requirements.json','input-metadata.json']:
            if (work/name).is_file():shutil.copyfile(work/name,leaf/name)
        for key,spec in selected['parameters'].items():
            for par in p['application_variables']['parameters']:
                if par['name']==spec['name']:par['default']=c['parameters'][key]
        (leaf/'project_io.yaml').write_text(project_yaml(d))
        for name in ['logic.c','logic_project_test.c']:shutil.copyfile(ROOT/selected['directory']/name,leaf/name)
        if c['caseId']=='three-pump-level-control':
            for name in ['plant_runner.c','model-profile.json']:shutil.copyfile(ROOT/selected['directory']/name,leaf/name)
            shutil.copyfile(ROOT/'host-runtime/flat_json.h',leaf/'flat_json.h')
        shutil.copytree(sdk/'application/io_definitions',leaf/'io_definitions')
        generated=leaf/'generated'
        log=run([sys.executable,sdk/'tools/point_config_gen.py',leaf/'project_io.yaml','--output-dir',generated])
        (leaf/'case-config.json').write_text(json.dumps(c,ensure_ascii=False,indent=2))
        fields=p['northbound']['fields']; canonical=[]
        for f in fields:canonical.append([f['name'],SOURCES.get(f['bind'],f['bind']), 'f32' if f['c_type']=='float' else f['c_type'],f['access'],f['reference'],2 if f['c_type'] in ['u32','float'] else 1])
        # Generator resolves point.<alias> to its actual board binding in manifest.
        points={x['name']:x['source'] for kind in ['inputs','outputs'] for x in p['points'][kind]}
        for f in canonical:
            if f[1].startswith('point.'):f[1]=points[f[1][6:]]
        north_hash=hashlib.sha256(json.dumps(['kz3-point-manifest/v1',canonical],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        identity={'protocolVersion':1,'projectId':c['projectId'],'projectVersion':c['projectVersion'],'inputSha256':digest(input_file),'sourceSha256':digest(leaf/'logic.c'),'northboundManifest':north_hash,'configSha256':digest(leaf/'case-config.json')}
        if c['caseId']=='three-pump-level-control':identity.update(plantSha256=digest(leaf/'plant_runner.c'),protocolSha256=digest(leaf/'flat_json.h'))
        (leaf/'identity.h').write_text('#define EXPO_IDENTITY_JSON '+json.dumps(json.dumps(identity,separators=(',',':')))+'\n')
        base,side=scene(c)
        for name,obj in [('demo.scene.json',base),('scene.bindings.json',side)]: (leaf/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2))
        text=io.StringIO();writer=csv.writer(text);writer.writerow(['name','bind','type','access','reference','description'])
        for f in fields:writer.writerow([f['name'],f['bind'],f['c_type'],f['access'],f['reference'],f.get('description','')])
        (leaf/'northbound.csv').write_text(text.getvalue())
        (leaf/'README.md').write_text(requirements_readme(work,c,identity))
        report=build(leaf,sdk)
        manifest={'schema':'np-tools-ai-delivery/v1','identity':identity,'config':c,'fields':fields,'hostReport':report,'createdFiles':{str(x.relative_to(leaf)):digest(x) for x in leaf.rglob('*') if x.is_file() and 'io_definitions' not in x.parts}}
        (leaf/'delivery-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
        destination.parent.mkdir(parents=True,exist_ok=True)
        leaf.rename(destination);leaf=destination
        return {'directory':str(leaf),'manifest':manifest,'code':(leaf/'logic.c').read_text(),'yaml':(leaf/'project_io.yaml').read_text(),'scene':base,'bindings':side,'log':log+report['log']}
    except BaseException:
        shutil.rmtree(leaf,ignore_errors=True);raise

def build(leaf,sdk):
    host=leaf/'host';host.mkdir(exist_ok=True)
    flags=['cc','-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-function']
    for inc in [leaf/'generated',leaf,sdk/'application',sdk/'User/Inc',sdk/'tests',ROOT/'host-runtime']:flags+=['-I',str(inc)]
    platform=[sdk/f'User/Src/{n}.c' for n in ['data_manager','logic_manager','logic_parameter_store','logic_runtime_store']]+[sdk/'tests/eeprom_transport_fake.c']
    common=[leaf/'logic.c',leaf/'generated/point_config.c',*platform]
    strict=run([sys.executable,sdk/'.opencode/skills/kz3-control-engineer/scripts/verify_project.py',leaf,'--strict-quality','--require-engineering-review','--require-execution-evidence'])
    log=run([*flags,*common,leaf/'logic_project_test.c','-lm','-o',host/'logic_test'])
    log+=run([host/'logic_test'])
    log+=strict
    case_id=json.loads((leaf/'case-config.json').read_text())['caseId']
    runner=leaf/'plant_runner.c' if case_id=='three-pump-level-control' else ROOT/('host-runtime/water_runner.c' if case_id=='water-supply-station' else 'host-runtime/runner_main.c')
    log+=run([*flags,*common,runner,'-lm','-o',host/'runner'])
    (host/'build.log').write_text(log)
    return {'status':'HOST_PASS','scope':'host-only','log':log,'compiler':run(['cc','--version']).splitlines()[0],'runnerSha256':digest(host/'runner')}

def verify_resources():
    manifest=json.loads((ROOT/'sdk-manifest.json').read_text())
    for name,expected in manifest['files'].items():
        p=ROOT/'sdk'/name
        if not p.resolve().is_relative_to((ROOT/'sdk').resolve()) or p.is_symlink() or digest(p)!=expected:raise ValueError('SDK资源快照已变化，请更新受信演示包：'+name)
    for selected in CATALOG:
        directory=ROOT/selected['directory'];case=json.loads((directory/'case.json').read_text())
        for name,expected in case['files'].items():
            p=directory/name
            if not p.resolve().is_relative_to(directory.resolve()) or digest(p)!=expected:raise ValueError('固定案例已变化：'+name)

def verify_sdk(sdk):
    for name,expected in json.loads((ROOT/'sdk-manifest.json').read_text())['files'].items():
        path=sdk/name
        if path.is_symlink() or not path.resolve().is_relative_to(sdk.resolve()) or digest(path)!=expected:
            raise ValueError('工作副本SDK已变化，请重新导入：'+name)

def verify_delivery(work,directory):
    leaf=Path(directory).resolve()
    if not leaf.is_relative_to(work.resolve()):raise ValueError('交付目录越界')
    manifest=json.loads((leaf/'delivery-manifest.json').read_text())
    required={'logic.c','project_io.yaml','case-config.json','identity.h','host/runner','host/build.log'}
    if not required.issubset(manifest['createdFiles']):raise ValueError('交付清单不完整')
    for name,expected in manifest['createdFiles'].items():
        file=leaf/name
        if file.is_symlink() or not file.resolve().is_relative_to(leaf) or digest(file)!=expected:raise ValueError(f'交付文件已改变：{name}')
    return leaf,manifest

def preflight():
    verify_resources()
    compiler=run(['cc','--version']).splitlines()[0]
    with tempfile.TemporaryDirectory(prefix='np-tools-preflight-') as tmp:
        source=Path(tmp)/'probe.c';binary=Path(tmp)/'probe'
        source.write_text('int main(void){return 0;}\n')
        run(['cc','-std=c11',source,'-o',binary]);run([binary])
    return {'ready':True,'python':sys.version.split()[0],'pyyaml':yaml.__version__,'compiler':compiler,'platform':sys.platform,'scope':'host-only'}

def export_delivery(work,directory):
    leaf,manifest=verify_delivery(work,directory)
    target=work/'exports'/('expo-'+manifest['config']['projectVersion']+'.zip')
    target.parent.mkdir(exist_ok=True)
    exported=copy.deepcopy(manifest);exported['createdFiles']={}
    exported['exportedFromManifestSha256']=digest(leaf/'delivery-manifest.json')
    exported['hostReport']['log']=exported['hostReport']['log'].replace(str(work),'[workspace]').replace(str(ROOT),'[resources]')
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name in manifest['createdFiles']:
            file=leaf/name
            # Executables are host-specific, retained for rehearsal on this same computer.
            if file.suffix in ['.log','.md','.json','.yaml','.csv','.c','.h']:
                content=file.read_text().replace(str(work),'[workspace]').replace(str(ROOT),'[resources]')
                content=content.encode()
            else:content=file.read_bytes()
            exported['createdFiles'][name]=hashlib.sha256(content).hexdigest()
            archive.writestr(name,content)
        archive.writestr('delivery-manifest.json',json.dumps(exported,ensure_ascii=False,indent=2))
        for log in sorted((work/'logs').glob('*.jsonl')) if (work/'logs').exists() else []:
            archive.writestr('logs/'+log.name,log.read_text().replace(str(work),'[workspace]'))
    return {'path':str(target),'sha256':digest(target)}

def restore_version(work,version):
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('版本无效')
    leaf,manifest=verify_delivery(work,work/'sdk/application/projects/工博会'/version)
    base=json.loads((leaf/'demo.scene.json').read_text());side=json.loads((leaf/'scene.bindings.json').read_text())
    return {'directory':str(leaf),'manifest':manifest,'code':(leaf/'logic.c').read_text(),'yaml':(leaf/'project_io.yaml').read_text(),'scene':base,'bindings':side,'log':(leaf/'host/build.log').read_text()}


def prepare(work,content):
    verify_resources();d=parse_yaml(content);selected=source_recipe(d['project'])
    work.mkdir(parents=True,exist_ok=False)
    try:
        shutil.copytree(ROOT/'sdk',work/'sdk')
        (work/'original-project_io.yaml').write_text(content)
        # A dedicated host-only agent cannot edit core sources or invoke shell.
        agent=work/'sdk/.opencode/agents/kz3-expo-engineer.md'
        agent.write_text('''---
description: 现场实施协作工程师，NP-Tools工艺设计与控制逻辑协作
mode: primary
color: "#146C94"
tools:
  read: false
  glob: false
  grep: false
  list: false
  bash: false
  edit: false
  write: false
  patch: false
  webfetch: false
  websearch: false
  task: false
  skill: false
permission:
  external_directory: deny
  edit: deny
  bash: deny
  task: deny
  skill: deny
---
你是现场实施协作工程师，负责控制逻辑书写、工艺方案补全、点位核对和现场调试协作。用户在NP-Tools中完成操作。只使用消息中提供的工艺资料，不读取文件或执行代码。具备工艺设计能力，先给合理可选方案，补全联锁、故障、恢复、复位和参数边界；不让实施人员自行设计状态机。
每轮消息中的工艺案例、固定bindings、参数范围、工程ID和版本是唯一生成依据。匹配模板时复用已验证工艺，不重写C。超出当前模板时说明差异与受支持的选择，不输出虚构配置。
用户明确采用方案后，在一个json代码块输出完整np-tools-expo-case-config/v1，精确使用上下文提供的全部字段、工程ID/版本、bindings、parameters与labels。参数可在允许范围内调整，名称可按用户业务调整。
HMI请求输出 {"schema":"np-tools-expo-hmi-request/v1","projectId":"当前值","projectVersion":"当前值"}，由工具构建可信工艺界面，不输出Vue/HTML/脚本。
用简体中文，面向现场实施人员说明设备行为与方案取舍，不反复强调演示或内部实现。只有符合模板能力的需求才能给生成配置。
''')
        return {'inputSha256':digest(work/'original-project_io.yaml'),'document':d,'caseId':selected['id'],'sdkDirectory':str(work/'sdk')}
    except BaseException:shutil.rmtree(work,ignore_errors=True);raise

def main():
    ap=argparse.ArgumentParser();ap.add_argument('operation',choices=['prepare','generate','scene','validate','verify-delivery','preflight','export','restore-version']);ap.add_argument('--workspace',required=True);ap.add_argument('--request',required=True);a=ap.parse_args()
    work=Path(a.workspace).resolve();req=json.loads(Path(a.request).read_text())
    if a.operation=='preflight':result=preflight()
    elif a.operation=='restore-version':result=restore_version(work,req['version'])
    elif a.operation=='export':result=export_delivery(work,req['directory'])
    elif a.operation=='prepare':result=prepare(work,req['content'])
    elif a.operation=='generate':result=generate(work,req['config'])
    elif a.operation=='verify-delivery':
        verify_delivery(work,req['directory'])
        result={'verified':True}
    elif a.operation=='scene':
        c=safe_config(req['config']);base,side=scene(c);result={'scene':base,'bindings':side}
    else:result={'document':parse_yaml(req['content']),'inputSha256':hashlib.sha256(req['content'].encode()).hexdigest()}
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)

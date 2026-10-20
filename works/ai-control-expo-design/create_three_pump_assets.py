"""Author the closed LAB_ONLY fixture; not used by runtime or the AI model."""
from pathlib import Path
import json
import yaml

ROOT = Path(__file__).resolve().parents[2] / 'resources/engineering'
leaf = ROOT / 'cases/three-pump-level-control'
params = [
    ('stopLevelM', 'stop_level_m', 'L_STOP_M', '停泵液位', .4, .1, .8, 'm'),
    ('targetLevelM', 'target_level_m', 'L_SP_M', '调节目标液位', .8, .2, 1.5, 'm'),
    ('vfdStartLevelM', 'vfd_start_level_m', 'L_VFD_M', '启变频液位', 1., .3, 1.7, 'm'),
    ('assistStartLevelM', 'assist_start_level_m', 'L_AUX_M', '启工频液位', 1.8, 1.2, 2.4, 'm'),
    ('pidKp', 'pid_kp', 'PID_KP', '液位比例增益', 24., 0., 30., 'mA/m'),
    ('pidKi', 'pid_ki', 'PID_KI', '液位积分增益', .6, 0., 5., 'mA/(m·s)'),
    ('startConfirmMs', 'start_confirm_ms', 'START_MS', '启变频连续确认', 2000, 500, 5000, 'ms'),
    ('stageConfirmMs', 'stage_confirm_ms', 'STAGE_MS', '加减泵连续确认', 5000, 1000, 30000, 'ms'),
    ('pumpStartTimeoutMs', 'pump_start_timeout_ms', 'P_START_MS', '泵启动反馈时限', 5000, 1000, 10000, 'ms'),
    ('pumpStopTimeoutMs', 'pump_stop_timeout_ms', 'P_STOP_MS', '泵停止反馈时限', 5000, 1000, 10000, 'ms'),
]
bindings, inputs, outputs, fields = {}, [], [], []
address = {'bool_read': 10001, 'bool_write': 1, 'number_read': 30001, 'number_write': 40001}
def field(name, bind, typ, desc, writable=False):
    bucket = ('bool_' if typ == 'bool' else 'number_') + ('write' if writable else 'read')
    at = address[bucket]
    address[bucket] += 1 if typ in ('bool', 'u16') else 2
    fields.append(dict(name=name, bind=bind, c_type=typ, access='read_write' if writable else 'read', reference=f'{at:05}', description=desc))
for n in range(1, 4):
    for j, (role, alias, short, desc) in enumerate([
        ('Run', 'run_fb', 'RUN', '独立运行反馈'),
        ('Fault', 'fault', 'FLT', '故障接点'),
        ('Auto', 'remote', 'REM', '远程自动许可'),
    ]):
        source = f'board.di{(n-1)*3+j+1:02}'
        bindings[f'pump{n}{role}'] = source
        alias = f'pump{n}_{alias}'
        inputs.append(dict(name=alias, source=source, description=f'P10{n}{desc}，true为成立'))
        field(f'P{n}_{short}', 'point.'+alias, 'bool', f'P10{n}{desc}')
    source = f'board.do{n:02}'
    bindings[f'pump{n}Output'] = source
    outputs.append(dict(name=f'pump{n}_output', source=source, description=f'P10{n}启动命令'))
    field(f'P{n}_DO', f'point.pump{n}_output', 'bool', f'P10{n}启动 DO输出')
for role, alias, channel, short, desc in [
    ('waterAvailable','water_available',10,'WATER_OK','独立低水位许可'),
    ('highHigh','high_high',11,'LEVEL_HH','独立高高位报警'),
    ('runPermit','run_permit',12,'RUN_PERMIT','泵组运行许可'),
]:
    source=f'board.di{channel:02}';bindings[role]=source
    inputs.append(dict(name=alias,source=source,description=desc+'，true为成立'))
    field(short,'point.'+alias,'bool',desc)
for role, alias, source, desc in [
    ('levelInput','level_current','board.ai01','集水井连续液位，4–20mA对应0–3m'),
    ('frequencyInput','frequency_current','board.ai02','P101实际频率反馈，4–20mA对应0–50Hz'),
]:
    bindings[role]=source;inputs.append(dict(name=alias,source=source,c_type='float',description=desc))
bindings['speedOutput']='board.ao01'
outputs.append(dict(name='speed_output',source='board.ao01',c_type='float',description='P101频率给定，4–20mA对应0–50Hz；停止0mA'))
bindings['alarmOutput']='board.do04'
outputs.append(dict(name='alarm_output',source='board.do04',description='泵组综合报警'))
field('ALARM_DO','point.alarm_output','bool','泵组综合报警 DO输出')
parameters=[];specs={}
for key,name,short,label,default,low,high,unit in params:
    typ='u32' if unit=='ms' else 'float'
    specs[key]=dict(name=name,field=short,label=label,default=default,min=low,max=high,type=typ,unit=unit,step=100 if unit=='ms' else .01)
    parameters.append(dict(name=name,c_type=typ,default=default,min=low,max=high,unit=unit,persistent=False,description=label+'，软件模型参数；停止时修改后重新投入'))
    field(short,'parameter.'+name,typ,label,True)
commands=[]
for name,short,desc in [('system_start','SYS_STA','投入液位自动'),('system_stop','SYS_STP','正常停止'),('system_trip','SYS_TRIP','立即停止'),('degraded_start','DEG_STA','投入工频降级排水')]:
    commands.append(dict(name=name,c_type='bool',**({'effect':'protective'} if name=='system_trip' else {})))
    field(short,'command.'+name,'bool',desc,True)
for n in range(1,4):
    commands.append(dict(name=f'pump{n}_reset_faults',c_type='bool'))
    field(f'P{n}_RST',f'command.pump{n}_reset_faults','bool',f'P10{n}故障复位',True)
    field(f'P{n}_RT_S',f'runtime.pump{n}.seconds','u32',f'P10{n}运行累计秒数')
    field(f'P{n}_RT_CLR',f'runtime.pump{n}.clear','bool',f'P10{n}运行累计清零',True)
states=[]
def state(name,typ='u32',default=0,short=None,desc=None):
    states.append(dict(name=name,c_type=typ,default=default))
    if short: field(short,'state.'+name,typ,desc or short)
for name,typ,default,short,desc in [
    ('automatic','bool',False,'SYS_AUTO','液位自动已投入'),('degraded','bool',False,'SYS_DEG','工频降级已投入'),
    ('level_valid','bool',False,'LEVEL_OK','液位测量有效'),('frequency_valid','bool',False,'FREQ_OK','实际频率测量有效'),
    ('config_ready','bool',False,'CONFIG_OK','控制参数有效'),('level_m','float',0.,'LEVEL_M','集水井液位 m'),
    ('frequency_hz','float',0.,'F_ACT_HZ','P101实际频率 Hz'),('set_hz','float',0.,'F_SET_HZ','P101频率给定 Hz'),
    ('system_status','u32',0,'SYS_STATUS','泵组当前运行阶段'),('block_reason','u32',0,'BLOCK_REASON','泵组等待或禁止原因'),
    ('remain_ms','u32',0,'REMAIN_MS','当前等待剩余毫秒'),('occupied','u32',0,'OCCUPIED','当前已占用泵台数'),
    ('alarm','bool',False,'SYS_ALARM','泵组综合报警'),('pi_running','bool',False,'PI_RUN','液位调节运行中'),
]: state(name,typ,default,short,desc)
for name in ['selected_aux','lead_pump','start_since','high_since','confirm_since','remove_since','last_start_ms','stage_changed_ms']:
    state(name)
for name in ['sampled','blocked_previous','start_timing','high_timing','add_timing','remove_timing','start_recorded','cycling','aux_demand']:
    state(name,'bool',False)
state('trend_level','float',0.)
state('ao_current','float',0.)
state('last_scan_ms')
for _,name,_,_,default,_,_,unit in params: state('saved_'+name,'u32' if unit=='ms' else 'float',default)
for n in range(1,4):
    for name,typ,default,short,desc in [
        ('status','u32',0,'STATUS','设备运行阶段'),('fault_code','u32',0,'FAULT','当前故障原因'),
        ('total_fault','bool',False,'F_L','总故障'),('device_fault','bool',False,'F_DEV','设备故障记录'),
        ('start_fault','bool',False,'F_STA','启动反馈超时'),('stop_fault','bool',False,'F_STP','停止反馈超时'),
        ('loss_fault','bool',False,'F_RUN','运行反馈丢失'),
    ]:state(f'pump{n}_{name}',typ,default,f'P{n}_{short}',f'P10{n}{desc}')
    for name in ['since_ms','stop_since_ms','off_since_ms','loss_since_ms','run_since_ms']:state(f'pump{n}_{name}')
    for name in ['command','stopping','loss_timing','last_good']:state(f'pump{n}_{name}','bool',False)
project=dict(name='三泵集水井液位控制',id='three_pump_level_control',version='1.0.0',board='kz3_f427_standard',required_profiles=[],scan_period_ms=10,features=dict(pid=True,counter=False,retained=False),devices=[],points=dict(inputs=inputs,outputs=outputs),application_variables=dict(parameters=parameters,commands=commands,states=states),pids=[dict(name='level_loop',measurement='state.level_m',setpoint='parameter.target_level_m',output='point.speed_output',sample_period_ms=100,direction='reverse',kp=0.,ki=0.,kd=0.,derivative_filter_ms=0,output_min=12.,output_max=20.,enabled=False)],runtime_counters=[dict(name=f'pump{n}',description=f'P10{n}独立反馈累计',trigger=dict(bind=f'point.pump{n}_run_fb',active_value=True,quality='good')) for n in range(1,4)],northbound=dict(protocols=['http','modbus_tcp'],modbus_tcp=dict(address_style='modicon_5_digit',word_order_32='abcd'),fields=fields))
# Keep each flat record on one physical line, including the maintained baseline.
class Flat(dict): pass
yaml.SafeDumper.add_representer(Flat,lambda d,v:d.represent_mapping('tag:yaml.org,2002:map',v,flow_style=True))
for group in project['points']:project['points'][group]=[Flat(v) for v in project['points'][group]]
for group in project['application_variables']:project['application_variables'][group]=[Flat(v) for v in project['application_variables'][group]]
project['northbound']['fields']=[Flat(v) for v in fields]
(leaf/'project_io.yaml').write_text(yaml.safe_dump(dict(schema='kz3-project-io/v3',project=project),allow_unicode=True,sort_keys=False,width=10000))
catalog=json.loads((ROOT/'cases/catalog.json').read_text())
previous=next((v for v in catalog if v['id']=='three-pump-level-control'), {})
catalog=[v for v in catalog if v['id']!='three-pump-level-control']
catalog.append(dict(id='three-pump-level-control',directory='cases/three-pump-level-control',name=project['name'],projectId=project['id'],bindings=bindings,parameters=specs,labels=dict(tank='集水井 TK101',pump1='变频泵 P101',pump2='工频泵 P102',pump3='备用泵 P103'),description='停泵、启变频、启工频三个液位等级；P101跟踪目标液位，实际满频且高位持续不下降时投入工频增援；P102故障由P103停稳接替，正常最多两台运行。'))
catalog[-1].update({k:previous[k] for k in ['intro','ioSummary','exampleRequirement','highlights','terminals'] if k in previous})
(ROOT/'cases/catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
print(f'authored {len(fields)} northbound fields and {len(states)} states')

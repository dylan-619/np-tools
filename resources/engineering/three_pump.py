"""Closed three-pump LAB_ONLY process, engineering evidence and HMI contract."""
import json
import yaml

SCENARIOS=['NORMAL_PATH','BAD_QUALITY','COMMAND_CONFLICT','STOP_SAFE','RESET_FAULTS','POINT_MAPPING','RECOVERY_NO_START','DEMAND_PRIORITY','FEEDBACK_FAILURE','TIME_BOUNDARY','TICK_WRAP','PARAMETER_UPDATE','COMMUNICATION_LOSS','RUNTIME_PERSISTENCE','HMI_CONTRACT','MODE_TRANSFER','STAGE_TRANSITIONS','CAPACITY_OWNERSHIP','HETEROGENEOUS_REPLACEMENT','PID_OWNER','PID_TRANSFER','PID_TUNING','DEVICE_RESET_OWNERSHIP','DEVICE_RESET_ISOLATION','FAULT_LATCH_LIFECYCLE','FAULT_VISIBLE_COHERENCE','FAULT_RESET_COHERENCE','NEGATIVE_SWITCH_WINDOW','LEVEL_HYSTERESIS','FREQUENCY_FEEDBACK','TREND_WINDOW','DEGRADED_CONTROL','PARAMETER_INVALID','RUNTIME_CLEAR']

def validate_parameters(p):
    if not p['stopLevelM']<p['targetLevelM']<p['vfdStartLevelM']<p['assistStartLevelM']:
        raise ValueError('液位必须满足：停泵 < 调节目标 < 启变频 < 启工频')

def readme(c,identity):
    basis={
        'scope':'LAB_ONLY主机闭环：一变频泵、两工频泵，正常最多两台；不等于实板投用参数',
        'point_roles':'DI1–9为逐泵运行/故障/远程；DI10低水许可、DI11高高位报警、DI12组许可；AI1液位电流、AI2实际频率；DO1–3启泵、DO4报警、AO1频率电流；原点表SHA='+identity['inputSha256'],
        'output_safe_values':'冷启动、STOP、许可/关键质量丢失退出自动；三泵DO=false、AO=0mA；独立综合报警可成立',
        'mode_owner':'KZ3唯一液位PI与调度owner；固定变频P101，P102工频增援，P103备用；远程许可false不等于故障；无逐泵HMI手动命令',
        'priority':'质量/许可与保护、STOP、参数变更、逐设备故障复位、正常/明确降级新投入、液位需求；每拍至多一个新启动',
        'bad_quality_policy':'液位无效退出并需重投；频率无效退出正常PI，禁止用给定当实际满频；逐泵反馈未知仍占容量；降级不依赖变频实际频率',
        'reset_scope':'各泵独立设备记录/启动/停止/运行丢失故障，总故障为OR；输入未解除/反馈未停/质量不良不清，健康复位无副作用，累计另独立清零',
        'auto_restart_policy':'许可/质量恢复不自启；正常低位循环保留自动但需回升启变频级；修好不抢回当前备用；变频失效默认停止，操作者明确投入工频分级降级；变频条件恢复仍保持降级，需先停止降级、确认所有设备停稳，再新投入变频自动，停稳前的启动命令丢弃且不排队',
        'timing_units_and_boundaries':'控制10ms、PI100ms；高位且实际>=49.5Hz连续10s且没有下降2cm，再连续stageConfirmMs；减级重新计时；启动间隔3s、停稳接替2s、最小停机/工频运行15s，低位和停止优先；T到达反馈可接受、T+1不能覆盖超时，回绕差值',
        'northbound_whitelist':'75以内必要测量/参数/逐泵状态与报警、命令、累计；所有物理输出只读；只发布工程液位/频率及其有效性，不发布原始模拟量；KP/KI为mA/m、mA/(m*s)对应AO单位，易失软件参数，改值退出并重投'}
    domains={'io_semantics':'POINT_MAPPING','ownership':'MODE_TRANSFER','startup_recovery':'RECOVERY_NO_START','process_arbitration':'DEMAND_PRIORITY','feedback_interlocks':'FEEDBACK_FAILURE','measurement_quality':'BAD_QUALITY','timing_parameters':'PARAMETER_UPDATE','fault_reset':'RESET_FAULTS','communication':'COMMUNICATION_LOSS','retention':'RUNTIME_PERSISTENCE','hmi_contract':'HMI_CONTRACT'}
    contract=dict(schema='kz3-requirements/v1',delivery_scope='host_simulation',case_id=c['caseId'],status='FROZEN',version=c['projectVersion'],project_id=c['projectId'],evidence=dict(point_source='original-project_io.yaml SHA256='+identity['inputSha256'],safety_source='README已确认控制规则及STOP_SAFE/BAD_QUALITY真实扫描',control_source='requirements.json采用的软件固定案例及case-config.json'),confirmations={k:True for k in basis},traceability={k:'README#已确认控制规则 '+v for k,v in basis.items()},northbound=dict(profile='HMI_SHORT_V1'),verification=dict(execution_profile='PLC_EXECUTED_V1',required_scenarios=SCENARIOS),open_items=[],engineering_review=dict(profile='TABLE_CONTROL_V1',control_features=['STAGED_GROUP','HETEROGENEOUS_GROUP','PID_LOOP','PER_DEVICE_FAULT_RESET','DEVICE_FAULT_COHERENCE'],decisions=[dict(id='THREE_PUMP_LAB',status='accepted',proposal='采用三液位、一变频两工频固定软件模型与模板，普通转换软件参数独立于物理工程',selection='NP-Tools核对角色和参数后确认生成；本次实验夹具采用固定LAB模型',basis='requirements.json、case-config.json与model-profile.json')],boundaries={k:dict(status='specified',rationale='软件工艺规则及真实管理器扫描；模拟量电气、整定和持久化物理效果均不在主机证据内',scenarios=[v]) for k,v in domains.items()}))
    return '# 三泵集水井液位控制 / '+c['projectVersion']+'\n\n## 已确认控制规则\n\n'+'\n'.join('- '+v for v in basis.values())+'\n\n参数：'+json.dumps(c['parameters'],ensure_ascii=False)+'\n\n## 标准与符合性\n\nKZ3 PLC_STYLE_V1 / HMI_SHORT_V1；不声明安全认证。模型为无噪声实验夹具，趋势使用连续有效采样与2cm容差。液位4–20mA=0–3m，频率4–20mA=0–50Hz；AO0为停止安全目标，实际变频器内部PID必须关闭并确认信号丢失策略。源码、点表、模型和运行器散列共同标识交付。\n\n## 实板与现场计划\n\n软件生成不自动得到ARM固件。实板前必须构建含匹配点配置/逻辑/框架的KZ3 APP HEX，核验板型、Bootloader与固件身份；确认实际接线、接点逻辑、模拟量电气与0mA行为、远程控制、运行/故障反馈；验证保护停机、未停禁止接替、质量丢失和恢复不启；重新整定并记录液位/频率/投切曲线，不直接复制模型增益。主机fake EEPROM累计检查不代替板上保存或长期寿命。\n\n<!-- KZ3_REQUIREMENTS_CONTRACT_BEGIN -->\n```yaml\n'+yaml.safe_dump({'requirements_contract':contract},allow_unicode=True,sort_keys=False)+'```\n<!-- KZ3_REQUIREMENTS_CONTRACT_END -->\n'

def scene(c,recipe):
    labels=c['labels']
    devices=[dict(name='液位控制',type='screen',points=dict(remote='RUN_PERMIT',phase='SYS_STATUS'),commands=dict(start='SYS_STA',stop='SYS_STP',trip='SYS_TRIP',degraded='DEG_STA'))]
    for n in range(1,4):
        devices.append(dict(name=labels[f'pump{n}'],type='pump',points=dict(running=f'P{n}_RUN',fault=f'P{n}_F_L',output=f'P{n}_DO'),commands=dict(reset=f'P{n}_RST')))
    devices.append(dict(name=labels['tank'],type='sensor',points=dict(value='LEVEL_M',valid='LEVEL_OK',alarm='LEVEL_HH'),commands={}))
    base=dict(name=recipe['name'],devices=devices,measurements=[dict(name='集水井液位',point='LEVEL_M',unit='m',validPoint='LEVEL_OK'),dict(name='P101实际频率',point='F_ACT_HZ',unit='Hz',validPoint='FREQ_OK')],parameters=[dict(name=s['label'],point=s['field'],min=s['min'],max=s['max'],unit=s['unit'],persistent=False) for s in recipe['parameters'].values()],externalInputs=[],source=dict(projectId=c['projectId'],projectVersion=c['projectVersion'],pointTable='project_io.yaml',pointNameContract='MGTools northbound field.name'),notes=['LAB_ONLY：模型产生连续液位、实际频率和运行反馈；物理工程重新核验与整定。'])
    side=dict(schema='np-tools-scene-bindings/v1',devices=[dict(name=labels[f'pump{n}'],outputPoint=f'P{n}_DO',feedbackPoint=f'P{n}_RUN',faultPoint=f'P{n}_F_L',feedbackKind='discrete') for n in range(1,4)],actions=[dict(label='立即停止',point='SYS_TRIP',kind='oneShot'),dict(label='投入工频降级',point='DEG_STA',kind='oneShot')],inputPoints=['RUN_PERMIT','WATER_OK','LEVEL_HH']+[f'P{n}_{suffix}' for n in range(1,4) for suffix in ['RUN','FLT','REM']],phaseLabels={'SYS_STATUS':{'0':'已停止','1':'液位待机','2':'变频泵启动','3':'单泵液位调节','4':'满频增援确认','5':'等待工频接替','6':'双泵联合排水','7':'减泵确认','8':'工频降级模式','9':'自动未投入'}},blockReasonPoint='BLOCK_REASON',remainingPoint='REMAIN_MS',layout=dict(template='three-pump-level-control',deviceOrder=[labels['tank'],labels['pump1'],labels['pump2'],labels['pump3']]))
    return base,side

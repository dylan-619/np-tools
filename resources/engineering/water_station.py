"""Closed process recipe and delivery contract for the TK101/P101/P102/XV101 station."""
import json
import yaml

SCENARIOS=['NORMAL_PATH','BAD_QUALITY','COMMAND_CONFLICT','STOP_SAFE','RESET_FAULTS','TIME_BOUNDARY','TICK_WRAP','POINT_MAPPING','RECOVERY_NO_START','DEMAND_PRIORITY','PARAMETER_UPDATE','COMMUNICATION_LOSS','RUNTIME_PERSISTENCE','NEGATIVE_SWITCH_WINDOW','FEEDBACK_FAILURE','DEVICE_RESET_OWNERSHIP','DEVICE_RESET_ISOLATION','FAULT_LATCH_LIFECYCLE','FAULT_VISIBLE_COHERENCE','FAULT_RESET_COHERENCE','HMI_CONTRACT','VALVE_REVERSE','VALVE_TIMEOUT','LOW_WATER']

def readme(c,identity):
    basis={
      'scope':'清水箱离散液位补水与双泵主备供水；软件联调范围，未接实板',
      'point_roles':'DI1/2低高液位，DI3水源，DI4需求，DI5/7泵运行反馈，DI6/8泵故障，DI9/10阀到位，DI11许可；DO1/2泵，DO3/4阀开关',
      'output_safe_values':'冷启动、立即停止、许可撤销或输入质量异常时四路DO输出全部false；正常停止先停泵并控制关阀',
      'mode_owner':'一个自动工艺owner；HMI投入自动运行后执行；无独立手动设备命令',
      'priority':'质量与许可、立即停止、正常停止与设备复位、工艺联锁、自动需求、投入命令依次处理；冲突不启动',
      'bad_quality_policy':'任何11路DI质量非GOOD立即断开四路DO并退出自动；恢复需重新投入',
      'reset_scope':'P101、P102、XV101分别锁存和复位；泵故障接点消失且运行反馈停止才可复位；复位不直接启动，不清其他设备',
      'auto_restart_policy':'许可/质量恢复不自启；自动模式内低位停泵，补水越过低位后按需求恢复；故障泵保持隔离，备用需两泵停机反馈和切换间隔',
      'timing_units_and_boundaries':'毫秒参数投入时快照；首次反馈恰好T允许，T+1不可覆盖超时；uint32回绕；双向阀从最终全断开起等待2000ms后重新判断目标',
      'northbound_whitelist':'仅schema已声明的控制命令、设备复位、运行时间清零及四参数可写；液位百分比来自软件设备模型，不作为控制器AI输入'}
    specified={'io_semantics':'POINT_MAPPING','startup_recovery':'RECOVERY_NO_START','process_arbitration':'DEMAND_PRIORITY','feedback_interlocks':'FEEDBACK_FAILURE','measurement_quality':'BAD_QUALITY','timing_parameters':'PARAMETER_UPDATE','fault_reset':'RESET_FAULTS','communication':'COMMUNICATION_LOSS','retention':'RUNTIME_PERSISTENCE','hmi_contract':'HMI_CONTRACT'}
    domains=['io_semantics','ownership','startup_recovery','process_arbitration','feedback_interlocks','measurement_quality','timing_parameters','fault_reset','communication','retention','hmi_contract']
    contract={'schema':'kz3-requirements/v1','delivery_scope':'host_simulation','case_id':c['caseId'],'status':'FROZEN','version':c['projectVersion'],'project_id':c['projectId'],'evidence':{'point_source':'original-project_io.yaml SHA256='+identity['inputSha256'],'safety_source':'README已确认控制规则；logic_project_test.c STOP_SAFE/BAD_QUALITY','control_source':'requirements.json与固定工艺模板1.0.0'},'confirmations':{k:True for k in basis},'traceability':{k:'README#已确认控制规则 '+v for k,v in basis.items()},'northbound':{'profile':'HMI_SHORT_V1'},'verification':{'execution_profile':'PLC_EXECUTED_V1','required_scenarios':SCENARIOS},'open_items':[],'engineering_review':{'profile':'TABLE_CONTROL_V1','control_features':['PER_DEVICE_FAULT_RESET','DEVICE_FAULT_COHERENCE'],'decisions':[{'id':'WATER_STATION','status':'accepted','proposal':'使用离散液位、双泵主备与双向阀固定工艺模板','selection':'用户确认参数、角色及工艺规则','basis':'requirements.json及case-config.json'}],'boundaries':{d:{'status':'specified' if d in specified else 'not_applicable','rationale':'真实LogicManager扫描验证；运行时间持久化仅fake EEPROM，不代表硬件存储验证' if d in specified else '单一自动owner，没有设备手自动模式转移','scenarios':[specified[d]] if d in specified else []} for d in domains}}}
    return '# 清水箱补水与双泵供水 / '+c['projectVersion']+'\n\n## 已确认控制规则\n\n'+'\n'.join('- '+v for v in basis.values())+'\n\n当前参数：'+json.dumps(c['parameters'])+'\n\n## 标准与符合性\n\nKZ3 PLC_STYLE_V1与HMI_SHORT_V1工程约束；host-only扫描测试，未执行电气、烧录或现场验收，不声明SIL认证。\n\n<!-- KZ3_REQUIREMENTS_CONTRACT_BEGIN -->\n```yaml\n'+yaml.safe_dump({'requirements_contract':contract},allow_unicode=True,sort_keys=False)+'```\n<!-- KZ3_REQUIREMENTS_CONTRACT_END -->\n'

def scene(c,recipe):
    l=c['labels']
    base={'name':recipe['name'],'devices':[{'name':'供水控制','type':'screen','points':{'remote':'RUN_PERMIT','phase':'SYS_STATUS'},'commands':{'start':'SYS_STA','stop':'SYS_STP'}},{'name':l['pump1'],'type':'pump','points':{'running':'P1_RUN','fault':'P1_F_L'},'commands':{'reset':'P1_RST'}},{'name':l['pump2'],'type':'pump','points':{'running':'P2_RUN','fault':'P2_F_L'},'commands':{'reset':'P2_RST'}},{'name':l['valve'],'type':'valve','points':{'open':'XV_OPEN','closed':'XV_CLOSED','fault':'XV_F_L'},'commands':{'reset':'XV_RST'}},{'name':l['tank'],'type':'sensor','points':{'low':'TK_LOW','high':'TK_HIGH'},'commands':{}}],'measurements':[],'parameters':[{'name':v['label'],'point':v['field'],'min':v['min'],'max':v['max'],'unit':'ms','persistent':False} for v in recipe['parameters'].values()],'externalInputs':[],'source':{'projectId':c['projectId'],'projectVersion':c['projectVersion'],'pointTable':'project_io.yaml','pointNameContract':'MGTools northbound field.name'},'notes':['软件联调：设备模型提供离散反馈；现场投用前核验接线、极性和保护回路。']}
    side={'schema':'np-tools-scene-bindings/v1','devices':[{'name':l['pump1'],'outputPoint':'P1_DO','feedbackPoint':'P1_RUN','faultPoint':'P1_F_L','feedbackKind':'discrete'},{'name':l['pump2'],'outputPoint':'P2_DO','feedbackPoint':'P2_RUN','faultPoint':'P2_F_L','feedbackKind':'discrete'},{'name':l['valve'],'openOutput':'XV_OPEN_DO','closeOutput':'XV_CLOSE_DO','openFeedback':'XV_OPEN','closeFeedback':'XV_CLOSED','faultPoint':'XV_F_L','feedbackKind':'limits'}],'actions':[{'label':'立即停止','point':'SYS_TRIP','kind':'oneShot'}],'inputPoints':['TK_LOW','TK_HIGH','SOURCE_OK','DEMAND','P1_RUN','P1_FLT','P2_RUN','P2_FLT','XV_OPEN','XV_CLOSED','RUN_PERMIT'],'phaseLabels':{'SYS_STATUS':{'0':'已停止','1':'低位补水','2':'主泵供水','3':'备用泵供水','4':'自动待机','5':'联锁停机','6':'切换等待','7':'停止关阀'}},'blockReasonPoint':'BLOCK_REASON','remainingPoint':'REMAIN_MS','layout':{'template':'water-supply-station','deviceOrder':[l['valve'],l['tank'],l['pump1'],l['pump2']]}}
    return base,side

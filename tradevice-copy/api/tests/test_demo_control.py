import json,time,uuid
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.demo_control import *
from app.demo_settings import default_settings

def snapshot():return dict(settingsProtocol=SETTINGS_PROTOCOL,observedMs=int(time.time()*1000),bootId=str(uuid.uuid4()),activeSkillId=str(uuid.uuid4()),activeHash=APPROVED_HASH,revision=1,state='READY',checks={k:True for k in CHECKS},blockers=[],receipts=[])
def command():return dict(actor_id=str(uuid.uuid4()),requestId=str(uuid.uuid4()),action='START',targetCycles=1,confirmDemo=True,expectedRevision=1,settings=default_settings())

def auto_evidence():return dict(protocol=AUTOMATIC_PROTOCOL,enabled=False,completedCycles=0,cycleRequestId=None)

def test_automatic_requires_explicit_mode_confirmation_and_no_count():
 p=command()|dict(cycleMode='AUTOMATIC',targetCycles=None)
 with pytest.raises(SkillError,match='SKILL_AUTOMATIC_VALIDATION_REQUIRED'):
  validate_command(p)
 for patch in [dict(targetCycles=1),dict(confirmDemo=False),dict(cycleMode='FOREVER'),dict(settings=p['settings']|{'cycleMode':'AUTOMATIC'})]:
  with pytest.raises(SkillError):validate_command(p|patch)
 for action in ['STOP','PAUSE','EMERGENCY_CLOSE']:
  with pytest.raises(SkillError):validate_command(p|dict(action=action,confirmDemo=False,settings=None))

def test_arming_can_wait_for_market_but_requires_fresh_bound_supported_engine():
 s=snapshot()|dict(automatic=auto_evidence(),checks={k:False for k in CHECKS})
 sel=dict(selected_skill_id=s['activeSkillId'],revision=1);now=s['observedMs']
 assert arm_blockers(s,sel,now)==['AUTOMATIC_VALIDATION_REQUIRED']
 assert 'AUTOMATIC_UPGRADE_REQUIRED' in arm_blockers(s|{'automatic':None},sel,now)
 assert 'ENGINE_OFFLINE_OR_STALE' in arm_blockers(s,sel,now+8001)
 assert 'SKILL_ENGINE_ACK_MISMATCH' in arm_blockers(s,sel|{'revision':2},now)
 assert 'ENGINE_NOT_READY' in arm_blockers(s|{'state':'RECOVERY_REQUIRED'},sel,now)
 assert 'AUTOMATIC_ALREADY_ENABLED' in arm_blockers(s|{'automatic':auto_evidence()|{'enabled':True}},sel,now)

def test_automatic_snapshot_validation():
 s=snapshot()|dict(automatic=auto_evidence()|{'enabled':True},state='AUTO_WAITING')
 validate_snapshot(s,s['observedMs'])
 for patch in [dict(enabled=False),dict(completedCycles=True),dict(completedCycles=-1),dict(cycleRequestId='bad'),dict(protocol='old')]:
  with pytest.raises(SkillError):validate_snapshot(s|dict(automatic=s['automatic']|patch),s['observedMs'])

def test_automatic_refused_before_database_access(monkeypatch):
 import app.demo_control as control
 p=command()|dict(cycleMode='AUTOMATIC',targetCycles=None)
 def unsafe(_):raise AssertionError('database should not be accessed')
 monkeypatch.setattr(control,'connection',unsafe)
 with pytest.raises(SkillError,match='SKILL_AUTOMATIC_VALIDATION_REQUIRED'):
  control.submit('fixture',p,False)
 for n in (2,3,10,True,0):
  with pytest.raises(SkillError,match='SKILL_VALIDATION_SINGLE_CYCLE_ONLY'):
   validate_command(command()|dict(targetCycles=n))
 validate_command(command())
 assert start_blocker('AUTOMATIC',None)=='AUTOMATIC_VALIDATION_REQUIRED'
 assert start_blocker('CUSTOM',1) is None


def test_all_start_gates_and_skill_binding():
 s=snapshot();sel=dict(selected_skill_id=s['activeSkillId'],revision=1);now=s['observedMs']
 assert start_blockers(s,sel,now,True)==[]
 for k in CHECKS:
  assert 'PREFLIGHT_'+k.upper() in start_blockers(s|{'checks':s['checks']|{k:False}},sel,now,True)
 assert 'NEWS_NOT_CLEAR' in start_blockers(s,sel,now,False)
 assert 'EXPOSURE_PLAN_CAP_EXCEEDED' in start_blockers(s|{'blockers':['EXPOSURE_PLAN_CAP_EXCEEDED']},sel,now,True)
 assert 'ENGINE_OFFLINE_OR_STALE' in start_blockers(s,sel,now+8001,True)
 assert 'SKILL_ENGINE_ACK_MISMATCH' in start_blockers(s,sel|{'revision':2},now,True)
 assert 'ENGINE_NOT_READY' in start_blockers(s|{'state':'RUNNING'},sel,now,True)

@pytest.mark.parametrize('p',[{'targetCycles':0},{'targetCycles':11},{'targetCycles':True},{'confirmDemo':False},{'expectedRevision':True},{'action':'SHELL'},{'extra':1}])
def test_reject_invalid_commands(p):
 with pytest.raises(SkillError):validate_command(command()|p)

def test_pause_does_not_require_news_or_flat_at_validation():
 validate_command(command()|dict(action='PAUSE',targetCycles=None,confirmDemo=False,settings=None))

def test_report_validates_provenance_and_values():
 s=snapshot();validate_snapshot(s,s['observedMs'])
 for patch in [dict(observedMs=0),dict(activeHash='x'),dict(checks={}),dict(state='LIVE'),dict(blockers=['private text']),dict(receipts=[{}]),dict(revision=True)]:
  with pytest.raises(SkillError):validate_snapshot(s|patch,s['observedMs'])

def test_validation_snapshot_is_signed_and_cannot_claim_approval():
 from app.validation_gate import status
 p=snapshot()|{'validation':status()}
 validate_snapshot(p,p['observedMs'])
 for v in (status()|{'automaticAllowed':True},status()|{'approvalId':'faked'},
           status()|{'maxCustomCycles':5},status()|{'extra':True},
           status()|{'status':'APPROVED'},None,{}):
  with pytest.raises(SkillError,match='SKILL_VALIDATION_REPORT_INVALID'):
   validate_snapshot(p|{'validation':v},p['observedMs'])

def test_hmac_separate_namespace_body_and_time():
 body=b'{}';stamp=str(int(time.time()*1000));secret='a'*64
 authenticate(secret,stamp,signature(secret,stamp,body),body,int(stamp))
 for bad,now in [(b'changed',int(stamp)),(body,int(stamp)+10001)]:
  with pytest.raises(SkillError):authenticate(secret,stamp,signature(secret,stamp,body),bad,now)

def test_endpoint_denies_observer_secret_and_missing_admin(monkeypatch):
 monkeypatch.setenv('MASTER_DEMO_BRIDGE_SECRET','b'*64);monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
 with TestClient(create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))) as c:
  assert c.get('/internal/master/demo').status_code==401
  assert c.post('/internal/master/demo',json=command()).status_code==401
  assert c.post('/internal/master/demo/exchange',json=snapshot(),headers={'x-tradevice-observer-signature':'a'*64}).status_code==401
  assert c.post('/internal/master/demo/exchange',content='x'*131073).status_code==413

def test_api_response_is_signed_and_errors_do_not_leak(monkeypatch):
 import app.main as main
 # app.main may resolve to the module through importlib consistently.
 import importlib
 main=importlib.import_module('app.main')
 monkeypatch.setenv('MASTER_DEMO_BRIDGE_SECRET','b'*64)
 p=snapshot();body=json.dumps(p).encode();stamp=str(p['observedMs'])
 monkeypatch.setattr(main.demo_control,'exchange',lambda *a:dict(serverMs=int(stamp),selection={},commands=[],confirmed=[]))
 with TestClient(create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))) as c:
  r=c.post('/internal/master/demo/exchange',content=body,headers={'x-tradevice-demo-time':stamp,'x-tradevice-demo-signature':signature('b'*64,stamp,body)})
  assert r.status_code==200 and r.headers['x-tradevice-demo-signature']==signature('b'*64,stamp,r.content)

@pytest.mark.parametrize('age,kill,unconfirmed,expected',[
 (1000,False,False,True),(8001,False,False,False),
 (1000,None,False,False),(1000,True,False,False),(1000,False,True,False)])
def test_projection_uses_consistent_snapshot_and_preserves_guards(age,kill,unconfirmed,expected):
 s=snapshot()
 class Conn:
  waiting=False
  def execute(self,query):self.waiting='master_demo.automatic_waiting' in query;return self
  def fetchone(self):return None if self.waiting else dict(snapshot=s,ms=s['observedMs']+age,selected_skill_id=s['activeSkillId'],revision=1,kill_switch=kill,unconfirmed=unconfirmed,history=[])
 result=projection(Conn(),news_clear=True)
 assert result['canStart'] is expected
 assert result['canArmAutomatic'] is False
 assert result['validation']['status']=='LOCKED_VALIDATION_PENDING'
 assert result['validation']['automaticAllowed'] is False
 assert result['bridgeValidationVerified'] is False
 assert result['riskPolicy']['maxBookedLots']==0.40
 assert result['online'] is (age<=8000)
 if age>8000:assert result['activeSkillId'] is None and result['checks']=={}


def test_settings_upgrade_required_and_invalid_parameters_rejected():
 s=snapshot();sel=dict(selected_skill_id=s['activeSkillId'],revision=1)
 assert 'ENGINE_SETTINGS_UPGRADE_REQUIRED' in start_blockers(s|{'settingsProtocol':None},sel,s['observedMs'],True)
 for settings in [None,{},default_settings()|{'baseLot':.11},default_settings()|{'tpMode':'CUSTOM','customTpUsd':True}]:
  with pytest.raises(SkillError):validate_command(command()|{'settings':settings})
 with pytest.raises(SkillError,match='SKILL_EXPOSURE_PLAN_CAP_EXCEEDED'):
  validate_command(command()|{'settings':default_settings()|{'tpMode':'ATR_2','baseLot':.1}})


def test_legacy_pause_stop_remain_available_during_upgrade():
 for action in ['PAUSE','STOP']:
  p=command()|dict(action=action,targetCycles=None,confirmDemo=False);p.pop('settings')
  validate_command(p)

def test_command_retry_cannot_change_bound_settings(monkeypatch):
 from contextlib import contextmanager
 import app.demo_control as control
 p=command();old=dict(actor_id=p['actor_id'],action=p['action'],target_cycles=p['targetCycles'],selection_revision=p['expectedRevision'],settings=p['settings'],status='APPLIED')
 class Conn:
  def execute(self,*args):return self
  def fetchone(self):return old
 @contextmanager
 def connection(dsn):yield Conn()
 monkeypatch.setattr(control,'connection',connection)
 monkeypatch.setattr(control,'locked',lambda conn:({}, {}, 0))
 assert control.submit('fixture',p,True)['status']=='APPLIED'
 with pytest.raises(SkillError):control.submit('fixture',p|{'settings':p['settings']|{'baseLot':.02}},True)


def test_legacy_atr_protocol_can_heartbeat_but_cannot_start():
 old=snapshot()|{'settingsProtocol':'V51_CLOSE_DISTANCE_20261015'}
 validate_snapshot(old,old['observedMs'])
 assert 'ENGINE_SETTINGS_UPGRADE_REQUIRED' in start_blockers(old,dict(selected_skill_id=old['activeSkillId'],revision=1),old['observedMs'],True)
 with pytest.raises(SkillError):validate_command(command()|{'settings':default_settings()|{'protocol':'V51_CLOSE_DISTANCE_20261015'}})

def emergency_command():return command()|dict(action='EMERGENCY_CLOSE',targetCycles=None,confirmDemo=False,confirmClose=True,expectedRevision=None,settings=None)

def test_emergency_requires_specific_confirmation_and_no_entry_parameters():
 validate_command(emergency_command())
 for patch in [dict(confirmClose=False),dict(targetCycles=1),dict(settings=default_settings()),dict(confirmDemo=True),dict(expectedRevision=1)]:
  with pytest.raises(SkillError):validate_command(emergency_command()|patch)
 with pytest.raises(SkillError):validate_command(command()|dict(confirmClose=True))

def test_emergency_report_cannot_claim_complete_with_open_exposure():
 s=snapshot()|dict(emergencyCloseProtocol=EMERGENCY_PROTOCOL)
 e=dict(protocol=EMERGENCY_PROTOCOL,requestId=str(uuid.uuid4()),expiresMs=s['observedMs']+60000,observedMs=s['observedMs'],phase='COMPLETE',positionsRemaining=0,ordersRemaining=0)
 validate_snapshot(s|dict(emergencyClose=e),s['observedMs'])
 for patch in [dict(positionsRemaining=1),dict(ordersRemaining=None),dict(phase='READY'),dict(observedMs=s['observedMs']+2000)]:
  with pytest.raises(SkillError):validate_snapshot(s|dict(emergencyClose=e|patch),s['observedMs'])

@pytest.mark.parametrize('supported',[False,True])
def test_emergency_queue_independent_of_stale_news_kill_revision(monkeypatch,supported):
 import app.demo_control as m
 from contextlib import contextmanager
 calls=[]
 class Conn:
  def execute(self,q,args=()):calls.append((q,args));self.q=q;return self
  def fetchone(self):return {'n':0} if 'count(*)' in self.q else None
 conn=Conn()
 @contextmanager
 def connection(_):yield conn
 monkeypatch.setattr(m,'connection',connection)
 monkeypatch.setattr(m,'locked',lambda _:(dict(revision=42,selected_skill_id=None),dict(snapshot={'emergencyCloseProtocol':EMERGENCY_PROTOCOL} if supported else {}),int(time.time()*1000)))
 if supported:
  assert submit('fixture',emergency_command(),False)['status']=='PENDING'
  assert any('EMERGENCY_SUPERSEDED' in q for q,_ in calls)
  assert any('INSERT INTO' in q for q,_ in calls)
 else:
  with pytest.raises(SkillError,match='SKILL_EMERGENCY_UPGRADE_REQUIRED'):submit('fixture',emergency_command(),False)
  assert not any('INSERT INTO' in q for q,_ in calls)

def test_account_scope_is_explicit_and_bound_to_retry(monkeypatch):
 from contextlib import contextmanager
 import app.demo_control as control
 p=emergency_command()|{'closeScope':'ALL_DEMO_ACCOUNT'};validate_command(p)
 with pytest.raises(SkillError):validate_command(p|{'closeScope':'ANY'})
 with pytest.raises(SkillError):validate_command(command()|{'closeScope':'ALL_DEMO_ACCOUNT'})
 old=dict(actor_id=p['actor_id'],action=p['action'],target_cycles=None,selection_revision=1,settings={'close_scope':'ALL_DEMO_ACCOUNT'},status='PENDING')
 class Conn:
  def execute(self,*args):return self
  def fetchone(self):return old
 @contextmanager
 def connection(dsn):yield Conn()
 monkeypatch.setattr(control,'connection',connection);monkeypatch.setattr(control,'locked',lambda conn:({}, {}, 0))
 assert control.submit('fixture',p,False)['status']=='PENDING'
 with pytest.raises(SkillError):control.submit('fixture',emergency_command(),False)

def diagnostic():
 return dict(observedMs=int(time.time()*1000),settings=default_settings()|{'baseLot':.1},checks={k:k not in ('margin','atr','adx') for k in CHECKS},blockers=['MARGIN_ENVELOPE_INSUFFICIENT','PREFLIGHT_MARGIN'],margin=dict(currency='USD',freeMargin=2000,usedMargin=0,exposureMargin=6041.39,reserve=265,requiredFreeMargin=6306.39,minimumEquity=6306.39,shortfall=4306.39))

def test_strict_preflight_numeric_evidence_and_receipt_protocol():
 e=diagnostic();now=e['observedMs'];validate_preflight_evidence(e,now)
 for patch in [dict(observedMs=now+1001),dict(settings={}),dict(checks={}),dict(blockers=['private broker text']),dict(margin=e['margin']|{'freeMargin':float('nan')}),dict(margin=e['margin']|{'minimumEquity':6000}),dict(margin=e['margin']|{'shortfall':True}),dict(account='private')]:
  with pytest.raises(SkillError):validate_preflight_evidence(e|patch,now)
 s=snapshot()|{'observedMs':now};r=dict(requestId=str(uuid.uuid4()),status='REJECTED',errorCode='MARGIN_ENVELOPE_INSUFFICIENT',diagnostics=e)
 validate_snapshot(s|dict(preflightEvidence=e,receipts=[r]),now)
 with pytest.raises(SkillError):validate_snapshot(s|dict(receipts=[r|{'status':'APPLIED'}]),now)
 validate_snapshot(s|dict(receipts=[{k:v for k,v in r.items() if k!='diagnostics'}]),now)

def test_receipt_diagnostics_cannot_be_attached_to_other_command_settings(monkeypatch):
 from contextlib import contextmanager
 import app.demo_control as control
 e=diagnostic();s=snapshot();s['receipts']=[dict(requestId=str(uuid.uuid4()),status='REJECTED',errorCode='MARGIN_ENVELOPE_INSUFFICIENT',diagnostics=e)]
 writes=[]
 class Conn:
  def execute(self,q,args=()):
   if q.startswith('UPDATE'):writes.append(q)
   return self
  def fetchone(self):return dict(action='START',status='DISPATCHED',error_code=None,settings=default_settings())
 @contextmanager
 def connection(_):yield Conn()
 monkeypatch.setattr(control,'connection',connection)
 monkeypatch.setattr(control,'locked',lambda _:({},dict(snapshot={},observed_ms=0),s['observedMs']))
 with pytest.raises(SkillError,match='SKILL_PREFLIGHT_SETTINGS_MISMATCH'):exchange('fixture',s)
 assert writes==[]

def test_legacy_reports_remain_readable_but_cannot_authorize_start():
 s=snapshot();s['checks'].pop('atr');s['checks'].pop('adx')
 validate_snapshot(s,s['observedMs'])
 errors=start_blockers(s,dict(selected_skill_id=s['activeSkillId'],revision=1),s['observedMs'],True)
 assert 'PREFLIGHT_ATR' in errors and 'PREFLIGHT_ADX' in errors

def test_market_evidence_contract_and_failed_check_cannot_be_promoted():
 from app.demo_control import validate_market_evidence
 now=1800000000000
 m=dict(policy='V51_RANGE_PREFLIGHT_20261016',observedMs=now,atrMethod='SMA_TR_14',adxMethod='WILDER_14',atrM1=1.21,atrPoints=1210,minAtr=1.2,maxAtr=1.66,adxM1=35.56,adxM5=24.65,adxM1Max3=36.,adxM5Max3=25.,adxLimit=20,stableBars=3,lookbackBars=1440,m1ClosedMs=now,m5ClosedMs=now,atrPassed=True,adxPassed=False)
 checks={'atr':True,'adx':False}
 validate_market_evidence(m,checks,now)
 for patch in [dict(adxPassed=True),dict(atrM1=2),dict(adxLimit=30),dict(adxM1=float('nan')),dict(m1ClosedMs=now-60000),dict(observedMs=now+1),dict(policy='old'),dict(account='private')]:
  with pytest.raises(SkillError):validate_market_evidence(m|patch,checks,now)
 with pytest.raises(SkillError):validate_market_evidence(m,dict(atr=True,adx=True),now)
 with pytest.raises(SkillError):validate_market_evidence(None,checks,now)
 validate_market_evidence(None,dict(atr=False,adx=False),now)

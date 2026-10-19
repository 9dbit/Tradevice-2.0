import pytest
from uuid import uuid4
from app.automatic_waiting import validate_intent,risk_budget,request,read,PROTOCOL
from app.master_skills import SkillError

def intent(action='REQUEST_AUTOMATIC_WAITING',target=100):
 return dict(actor_id=str(uuid4()),requestId=str(uuid4()),action=action,targetCycles=target)

def test_exact_100_preparation_only():
 for action in ('REQUEST_AUTOMATIC_WAITING','CANCEL_AUTOMATIC_WAITING'):
  assert validate_intent(intent(action))['targetCycles']==100
 for invalid in (0,1,10,99,101,1000,True,100.0,'100'):
  with pytest.raises(SkillError,match='SKILL_WAITING_TARGET_INVALID'):
   validate_intent(intent(target=invalid))

def test_fail_closed_input_schema():
 for change in (dict(action='START'),dict(action='EMERGENCY_CLOSE'),dict(actor_id='bad'),dict(requestId='bad'),dict(extra=True)):
  with pytest.raises(SkillError):
   validate_intent(intent()|change)

def test_budget_never_unlocks_execution():
 for equity,loss,booked,flat in ((1000,0,.1,True),(1000,40,.5,False),(500,15,.38,True)):
  r=risk_budget(equity,loss,booked,flat)
  assert r['verified'] and r['admissionGranted'] is False
  assert r['reason']=='VALIDATION_RELEASE_PENDING'
 assert risk_budget(1000,0,.38,True)['cycleTriggerUsd']==30
 assert risk_budget(500,0,.38,True)['cycleTriggerUsd']==15
 assert risk_budget(1000,40,.38,True)['researchRemainingUsd']==0

@pytest.mark.parametrize('inputs',[(float('nan'),0,0,True),(0,0,0,True),(1000,-1,0,True),(1000,0,-1,True),(1000,0,.1,None)])
def test_bad_risk_evidence_is_not_verified(inputs):
 assert risk_budget(*inputs)['verified'] is False

def test_request_isolated_from_broker_commands(monkeypatch):
 import app.automatic_waiting as mod
 p=intent()
 executed=[]
 class Transaction:
  def __init__(self):self.old=None
  def execute(self,sql,params=None):
   executed.append(sql)
   assert 'master_demo.commands' not in sql
   assert 'automatic_waiting' in sql
   return self
  def fetchone(self):return self.old
 class Context:
  def __init__(self):self.tx=Transaction()
  def __enter__(self):return self.tx
  def __exit__(self,*_):return False
 monkeypatch.setattr(mod,'connection',lambda d:Context())
 result=request('testing',p)
 assert result==dict(requestId=p['requestId'],status='WAITING_VALIDATION',targetCycles=100,automaticExecutionAllowed=False)
 assert len(executed)==2

def test_read_only_reports_zero_executions():
 class Conn:
  def execute(self,sql):return self
  def fetchone(self):return None
 r=read(Conn())
 assert r['protocol']==PROTOCOL
 assert r['completedCycles']==0
 assert r['status']=='OFF'
 assert r['automaticExecutionAllowed'] is False

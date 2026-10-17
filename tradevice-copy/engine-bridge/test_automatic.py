"""Regression tests for hard-locked Automatic and single-cycle V5.1 UAT."""
import os
import time
import pytest
from test_bridge import setup,cmd,invoke,receipt,b,Runtime
from validation_gate import (
    start_blocker,automatic_blocker,status,valid_status,MAX_CUSTOM_CYCLES,
)

def test_auto_cannot_arm_with_valid_broker_and_fresh_checks(tmp_path):
 c,r,skill=setup(tmp_path)
 x=cmd(skill);x.update(cycleMode='AUTOMATIC',targetCycles=None)
 invoke(c,x)
 assert receipt(c,x['requestId'])==('REJECTED','AUTOMATIC_VALIDATION_REQUIRED')
 assert c.automatic is False and c.thread is None
 assert c.state=='READY' and r.started==0
 assert c.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()==(None,)
 assert c.snapshot()['automatic']['enabled'] is False
 assert 'validation' not in c.snapshot()  # legacy API accepts known fields only

def test_auto_direct_api_envelope_rejected_even_if_preflight_stale(tmp_path):
 c,r,skill=setup(tmp_path)
 r.good=False
 x=cmd(skill);x.update(cycleMode='AUTOMATIC',targetCycles=None)
 c.received(dict(killSwitch=False,selection=dict(skillId=skill,revision=1,sha256=b.APPROVED_HASH),commands=[x],confirmed=[]))
 assert receipt(c,x['requestId'])==('REJECTED','AUTOMATIC_VALIDATION_REQUIRED')
 assert r.started==0 and not c.running() and not c.automatic

@pytest.mark.parametrize('cycles',[0,2,3,5,10,11,True,None])
def test_only_one_custom_cycle_can_reach_adapter(tmp_path,cycles):
 c,r,skill=setup(tmp_path)
 x=cmd(skill);x['targetCycles']=cycles
 invoke(c,x)
 assert receipt(c,x['requestId'])==('REJECTED','VALIDATION_SINGLE_CYCLE_ONLY')
 assert r.started==0 and c.thread is None
 assert c.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()==(None,)

def test_duplicate_auto_command_remains_rejected(tmp_path):
 c,r,skill=setup(tmp_path)
 x=cmd(skill);x.update(cycleMode='AUTOMATIC',targetCycles=None)
 invoke(c,x);invoke(c,x)
 assert receipt(c,x['requestId'])==('REJECTED','AUTOMATIC_VALIDATION_REQUIRED')
 assert c.db.execute('SELECT count(*) FROM receipts WHERE id=?',(x['requestId'],)).fetchone()[0]==1

def test_legacy_direct_auto_worker_has_no_execution_path(tmp_path):
 c,r,skill=setup(tmp_path)
 c.automatic=True;c.state='AUTO_WAITING'
 c.execute_automatic({})
 assert not c.automatic and c.state=='STOPPED' and c.thread is None
 assert c.reason=='AUTOMATIC_VALIDATION_REQUIRED'
 assert r.started==0

def test_no_environment_override_enables_automatic(monkeypatch):
 for key in ('TRADEVICE_VALIDATION_APPROVED','AUTOMATIC_ENABLED','TRADEVICE_AUTOMATIC_UNLOCK'):
  monkeypatch.setenv(key,'true')
 assert automatic_blocker()=='AUTOMATIC_VALIDATION_REQUIRED'
 assert start_blocker('AUTOMATIC',None)==automatic_blocker()
 assert start_blocker('CUSTOM',MAX_CUSTOM_CYCLES) is None

def test_validation_evidence_cannot_be_forged():
 expected=status()
 assert valid_status(expected)
 assert expected['automaticAllowed'] is False
 for changed in (expected|{'automaticAllowed':True},expected|{'approvalId':'fake'},
                 expected|{'maxCustomCycles':10},expected|{'extra':'skip'},
                 expected|{'protocol':'legacy'},None,{}):
  assert not valid_status(changed)

def test_stop_pause_and_emergency_code_remain_independent(tmp_path):
 c,r,skill=setup(tmp_path)
 for action in ('PAUSE','STOP'):
  x=cmd(skill,action)
  invoke(c,x)
  assert receipt(c,x['requestId'])==('APPLIED',None)
 assert r.started==0 and not c.automatic

def test_restart_does_not_restore_automatic(tmp_path):
 c,r,skill=setup(tmp_path)
 x=cmd(skill);x.update(cycleMode='AUTOMATIC',targetCycles=None)
 invoke(c,x)
 other=b.Controller(tmp_path/'state.db',Runtime())
 assert other.automatic is False and not other.running()
 assert other.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()==(None,)

def test_validation_evidence_negotiates_only_after_api_ack(tmp_path):
 from validation_gate import PROTOCOL
 c,r,skill=setup(tmp_path)
 assert 'validation' not in c.snapshot()
 base=dict(killSwitch=False,selection=dict(skillId=skill,revision=1,sha256=b.APPROVED_HASH),commands=[],confirmed=[])
 c.received(base|{'validationEvidencePolicy':PROTOCOL})
 assert c.snapshot()['validation']==status()
 assert c.snapshot()['validation']['approvalId'] is None
 c.received(base)
 assert 'validation' not in c.snapshot()
 assert r.started==0

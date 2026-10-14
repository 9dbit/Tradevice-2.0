import json
from importlib import import_module
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.growth_history import GrowthBuffer,signature,validate
NOW=1792000000000;KEY='ab'*32
def packet(now=NOW):return dict(schema='tradevice.growth.v1',source='TRADEVICEPC_V51_COMPLETED_JOURNALS',readOnly=True,observedMs=now,status='AVAILABLE',coverageStartMs=NOW-100000,currency='USD',rows=[dict(cycleId='1234abcd',closedMs=NOW-60000,netUsd=-120.5)])
def test_auth_freshness_limits_replay_and_protected_projection(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',KEY);clock=[NOW]
 monkeypatch.setattr(import_module('app.main').time,'time',lambda:clock[0]/1000)
 app=create_app(settings=Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
 with TestClient(app) as c:
  def send(p,auth=True):
   raw=json.dumps(p).encode();ts=str(clock[0]);headers={'x-tradevice-growth-time':ts,'x-tradevice-growth-signature':signature(KEY,ts,raw)} if auth else {}
   return c.post('/internal/master/growth',content=raw,headers=headers)
  assert send(packet(),False).status_code==401
  assert send(packet()).status_code==202
  clock[0]+=100;assert send(packet(clock[0])).status_code==429
  clock[0]+=5000;assert send(packet()).status_code==422
  p=packet(clock[0]);p['rows'][0]['account']='SECRET';assert send(p).status_code==422
  assert send(packet(clock[0])).status_code==202
  old=app.state.growth_history.projection(clock[0]+180001);assert old['stale'] and old['rows'][0]['closedMs']==NOW-60000
  assert c.post('/internal/master/growth',content=b'x'*262145).status_code==413
  assert c.get('/internal/master/telemetry').status_code==503
  assert 'growthHistory' not in c.get('/health').text

def test_invalid_values_duplicate_rows_and_coverage_fail_closed():
 for change in ['future','nan','duplicate','currency']:
  p=packet()
  if change=='future':p['rows'][0]['closedMs']=NOW+1
  if change=='nan':p['rows'][0]['netUsd']=float('nan')
  if change=='duplicate':p['rows']*=2
  if change=='currency':p['currency']='IDR'
  with pytest.raises(ValueError):validate(p,NOW)
 assert GrowthBuffer().projection(NOW) is None

def test_nonstaging_never_accepts_history(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',KEY)
 app=create_app(settings=Settings(environment='local',project_ref='scqzlcivherovlwqypeu'))
 with TestClient(app) as c:assert c.post('/internal/master/growth',json=packet()).status_code==503

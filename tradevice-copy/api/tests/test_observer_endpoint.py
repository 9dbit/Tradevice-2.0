"""Signed observer admission stays isolated from command/database paths."""
import hashlib,hmac
from importlib import import_module
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from test_observer_telemetry import fixture,NOW,SECRET

def headers(raw,now=NOW):
 stamp=str(now)
 return {'x-tradevice-observer-time':stamp,
         'x-tradevice-observer-signature':hmac.new(bytes.fromhex(SECRET),stamp.encode()+b'\n'+raw,hashlib.sha256).hexdigest()}

def test_observer_missing_key_and_bad_auth_fail_closed(monkeypatch):
 monkeypatch.delenv('MASTER_OBSERVER_SHARED_SECRET',raising=False)
 app=create_app(settings=Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
 with TestClient(app) as client:
  assert client.post('/internal/master/observer',content=fixture()).status_code==503
  monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',SECRET)
  assert client.post('/internal/master/observer',content=fixture()).status_code==401

def test_observer_admission_rate_limit_and_replay(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',SECRET)
 clock=[NOW];monkeypatch.setattr(import_module('app.main').time,'time',lambda:clock[0]/1000)
 app=create_app(settings=Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
 with TestClient(app) as client:
  a=fixture();r=client.post('/internal/master/observer',content=a,headers=headers(a))
  assert r.status_code==202
  assert r.json()=={'status':'ACCEPTED_READ_ONLY','tradingReady':False,'executionEnabled':False}
  clock[0]=NOW+100;b=fixture(collected_utc_ms=NOW+100)
  assert client.post('/internal/master/observer',content=b,headers=headers(b,NOW+100)).status_code==429
  clock[0]=NOW+1100;b=fixture(collected_utc_ms=NOW+1100)
  assert client.post('/internal/master/observer',content=b,headers=headers(b,NOW+1100)).status_code==202
  clock[0]=NOW+1200
  assert client.post('/internal/master/observer',content=a,headers=headers(a,NOW+1200)).status_code==422
  assert app.state.observer_market.market(NOW+10000)['equity'] is None

def test_observer_denies_nonstaging_and_oversized_body(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',SECRET)
 for environment,code in [('local',503),('staging',413)]:
  app=create_app(settings=Settings(environment=environment,project_ref='scqzlcivherovlwqypeu'))
  with TestClient(app) as client:
   assert client.post('/internal/master/observer',content=b'x'*8193).status_code==code

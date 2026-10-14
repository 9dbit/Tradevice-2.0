import json,hashlib,hmac
from importlib import import_module
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.terminal_mirror import TerminalBuffer,signature
import pytest
NOW=1792000000000;KEY='ab'*32
def packet(now=NOW):return dict(schema='tradevice.powershell.journal.v1',source='TRADEVICEPC_POWERSHELL_JOURNAL_VIEWER',readOnly=True,observedMs=now,batchId='v51_dashboard_'+'a'*32,status='LIVE',lines=[dict(atMs=NOW-5000,event='CYCLE_STARTED',cycle='1234abcd',sequence=1)])
def test_admission_auth_domain_replay_limits_and_expiry(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',KEY);clock=[NOW]
 monkeypatch.setattr(import_module('app.main').time,'time',lambda:clock[0]/1000)
 app=create_app(settings=Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
 with TestClient(app) as c:
  def send(p,sign=True):
   raw=json.dumps(p).encode();stamp=str(clock[0]);headers={'x-tradevice-terminal-time':stamp,'x-tradevice-terminal-signature':signature(KEY,stamp,raw)} if sign else {}
   return c.post('/internal/master/terminal',content=raw,headers=headers)
  assert send(packet(),False).status_code==401
  raw=json.dumps(packet()).encode();stamp=str(NOW)
  observer_sig=hmac.new(bytes.fromhex(KEY),stamp.encode()+b'\n'+raw,hashlib.sha256).hexdigest()
  assert c.post('/internal/master/terminal',content=raw,headers={'x-tradevice-terminal-time':stamp,'x-tradevice-terminal-signature':observer_sig}).status_code==401
  assert send(packet()).status_code==202
  clock[0]+=100;assert send(packet(clock[0])).status_code==429
  clock[0]+=1000;assert send(packet()).status_code==422
  p=packet(clock[0]);p['lines'][0]['account']='private';assert send(p).status_code==422
  assert send(packet(clock[0])).status_code==202
  result=app.state.terminal_mirror.projection(clock[0]+12001)
  assert result['status']=='STALE' and result['lines'][0]['atMs']==NOW-5000
  assert c.post('/internal/master/terminal',content=b'x'*32769).status_code==413
  assert c.get('/internal/master/telemetry').status_code==503
  assert 'terminalMirror' not in c.get('/health').text

def test_terminal_wrong_project_and_arbitrary_text_denied(monkeypatch):
 monkeypatch.setenv('MASTER_OBSERVER_SHARED_SECRET',KEY)
 app=create_app(settings=Settings(environment='staging',project_ref='other'))
 with TestClient(app) as c:assert c.post('/internal/master/terminal',json=packet()).status_code==503
 p=packet();p['lines'][0]['event']='password=private'
 with pytest.raises(ValueError):TerminalBuffer().receive(json.dumps(p).encode(),NOW)

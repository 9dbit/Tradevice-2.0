import json,time,uuid
from datetime import datetime,timezone
import pytest
from fastapi.testclient import TestClient
from app import preflight_diagnostics as d
from app.main import create_app
from app.config import Settings

SETTINGS=dict(protocol='V51_DYNAMIC_ATR_USD_20261015',baseLot=.1,tpMode='POINTS',tpPoints=400,customTpUsd=None)
def runtime():
 now=int(time.time()*1000)
 return dict(online=True,state='AUTO_WAITING',observedMs=now,canStart=False,checks={k:k!='adx' for k in d.FACTORS},blockers=['PREFLIGHT_ADX'],
  accountNumber='SECRET_ACCOUNT',token='SECRET_TOKEN',preflightEvidence=dict(observedMs=now,settings=SETTINGS,
   margin=dict(currency='USD',freeMargin=19766.35,usedMargin=0,requiredFreeMargin=6285.59,exposureMargin=6020.59,reserve=265,minimumEquity=6285.59,shortfall=0),market={'adxM1':23.4,'secret':'SECRET'}))
def payload():return dict(actor_id=str(uuid.uuid4()),requestId=str(uuid.uuid4()),factor='margin',prompt='Check margin',settings=SETTINGS)
def test_margin_19766_is_normal_for_matching_6285_requirement():
 e=d.snapshot(runtime(),SETTINGS,int(time.time()*1000));result=d.assess('margin',e)
 assert result['status']=='NORMAL';assert '$19,766.35' in result['summary'];assert '$6,285.59' in result['summary']
 assert 'SECRET' not in json.dumps(e)
 assert d.assess('adx',e)['status']=='EXPECTED_BLOCK'
def test_settings_mismatch_stale_and_missing_are_not_insufficient():
 r=runtime();now=r['observedMs']
 for selected,stamp in [(SETTINGS|{'baseLot':.01},now),(SETTINGS,now+8001)]:
  assert d.assess('margin',d.snapshot(r,selected,stamp))['status']=='INCONCLUSIVE'
 r['preflightEvidence']=None
 assert d.assess('margin',d.snapshot(r,SETTINGS,now))['status']=='INCONCLUSIVE'
def test_numeric_shortfall_and_inconsistency_are_distinct():
 r=runtime();r['preflightEvidence']['margin']['shortfall']=100;r['checks']['margin']=False
 e=d.snapshot(r,SETTINGS,r['observedMs']);assert d.assess('margin',e)['status']=='EXPECTED_BLOCK'
 e['checks']['margin']=True;assert d.assess('margin',e)['status']=='ANOMALY'
def test_active_cycle_checks_are_deferred():
 r=runtime()|{'state':'RUNNING'}
 assert d.assess('margin',d.snapshot(r,SETTINGS,r['observedMs']))['status']=='INCONCLUSIVE'
def test_validation_forbids_commands_and_invalid_requests():
 d.validate(payload())
 for patch in [{'action':'START'},{'factor':'execute'},{'prompt':'x'*2001},{'requestId':'bad'},{'settings':{'baseLot':.01}}]:
  with pytest.raises(d.SkillError):d.validate(payload()|patch)
def test_provider_schema_rejects_incomplete_refusal_and_malformed():
 answer=dict(status='NORMAL',summary='Observed margin sufficient',evidence=['19766'],requirements=[])
 body=dict(status='completed',output=[{'type':'message','content':[{'type':'output_text','text':json.dumps(answer)}]}])
 assert d.parse_response(body)==answer
 for bad in [body|{'status':'incomplete'},body|{'output':[]},body|{'output':[{'type':'message','content':[{'type':'refusal'}]}]}]:
  with pytest.raises(ValueError):d.parse_response(bad)
def test_internal_auth_and_storage_error_redaction(monkeypatch):
 monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
 app=create_app(settings=Settings(project_ref='scqzlcivherovlwqypeu',environment='staging'))
 def fail(*args):raise RuntimeError('SECRET_DSN')
 monkeypatch.setattr(d,'history',fail)
 with TestClient(app) as c:
  assert c.get('/internal/master/diagnostics').status_code==401
  r=c.get('/internal/master/diagnostics',params={'actor_id':str(uuid.uuid4()),'factor':'margin'},headers={'x-tradevice-master-secret':'a'*64})
  assert r.status_code==503;assert 'SECRET' not in r.text

def test_actual_provider_path_uses_snapshot_no_tools_and_persists(monkeypatch):
 from contextlib import contextmanager
 p=payload();e=d.snapshot(runtime(),SETTINGS,int(time.time()*1000));saved=[];posted=[]
 row=dict(request_id=p['requestId'],actor_id=p['actor_id'],factor='margin',prompt=p['prompt'],status='CHECKING',evidence=e,assessment=d.assess('margin',e),model='fixture-model',created_at=datetime.now(timezone.utc))
 class Cursor:
  def fetchone(self):return row
  def fetchall(self):return []
 class Conn:
  def execute(self,sql,args=()):
   if sql.startswith('UPDATE'):saved.append(args)
   return Cursor()
 @contextmanager
 def connection(*args):yield Conn()
 monkeypatch.setattr(d,'actor_connection',connection);monkeypatch.setenv('OPENAI_API_KEY','fixture-not-real')
 answer=dict(status='NORMAL',summary='The supplied evidence passes.',evidence=['Free margin 19766.35'],requirements=[])
 class Client:
  def __init__(self,**kw):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*a):pass
  async def post(self,url,**kw):
   posted.append((url,kw['json']));return d.httpx.Response(200,json={'status':'completed','model':'actual-fixture-model','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(answer)}]}]})
 monkeypatch.setattr(d.httpx,'AsyncClient',Client)
 import asyncio
 asyncio.run(d.run('dsn',p['actor_id'],p['requestId']))
 assert posted[0][0]=='https://api.openai.com/v1/responses';assert 'tools' not in posted[0][1];assert posted[0][1]['store'] is False
 assert saved[0][0]=='COMPLETED';assert saved[0][2]=='actual-fixture-model'

def test_unconfigured_request_is_saved_and_duplicate_does_not_resubmit(monkeypatch):
 from contextlib import contextmanager
 p=payload();stored={};sql_seen=[];moment=datetime.now(timezone.utc)
 class Cursor:
  def __init__(self,value=None):self.value=value
  def fetchone(self):return self.value
 class Conn:
  def execute(self,sql,args=()):
   sql_seen.append(sql)
   if 'count(*) AS n' in sql:return Cursor({'n':0})
   if sql.startswith('INSERT'):
    rid,actor,factor,prompt,status,evidence,assessment,model,error,configured=args
    stored.update(dict(request_id=rid,actor_id=actor,factor=factor,prompt=prompt,status=status,evidence=evidence.obj,assessment=assessment.obj,model=model,error_code=error,answer=None,created_at=moment,finished_at=moment))
    return Cursor()
   if sql.startswith(d.SELECT):return Cursor(stored or None)
   return Cursor()
 @contextmanager
 def conn(dsn,actor):assert actor==p['actor_id'];yield Conn()
 monkeypatch.setattr(d,'actor_connection',conn);monkeypatch.setattr(d.demo_control,'projection',lambda *args:runtime())
 monkeypatch.delenv('OPENAI_API_KEY',raising=False);monkeypatch.delenv('PREFLIGHT_AI_MODEL',raising=False)
 item,run=d.submit('dsn',p,False)
 assert not run;assert item['status']=='UNAVAILABLE';assert item['errorCode']=='AI_NOT_CONFIGURED';assert item['assessment']['status']=='NORMAL'
 again,run=d.submit('dsn',p,False);assert again==item and not run
 assert sum(s.startswith('INSERT') for s in sql_seen)==1
 with pytest.raises(d.SkillError,match='DIAGNOSTIC_ID_CONFLICT'):d.submit('dsn',p|{'prompt':'changed'},False)
 assert not any('INSERT INTO master_demo' in s or 'UPDATE master_demo' in s for s in sql_seen)

def test_per_actor_rate_limit_prevents_provider_request(monkeypatch):
 from contextlib import contextmanager
 class Cursor:
  def __init__(self,row=None):self.row=row
  def fetchone(self):return self.row
 class Conn:
  def execute(self,sql,args=()):
   assert not sql.startswith('INSERT')
   return Cursor({'n':6}) if 'count(*) AS n' in sql else Cursor()
 @contextmanager
 def conn(*args):yield Conn()
 monkeypatch.setattr(d,'actor_connection',conn)
 with pytest.raises(d.SkillError,match='DIAGNOSTIC_RATE_LIMIT'):d.submit('dsn',payload(),False)

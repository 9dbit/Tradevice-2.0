"""Untrusted skill packages cannot become code or bypass staging authorization."""
import base64,io,json,stat,zipfile
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from app.master_skills import parse_upload,SkillError,validate_request,registry,MAX_UPLOAD

def manifest(**kw):
    return dict(schema='tradevice.trading.skill.v1',name='Research Test',version='1.0',description='Offline test only',**kw)
def b64(raw):return base64.b64encode(raw).decode()
def archive(entries):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
        for name,value in entries:z.writestr(name,value)
    return stream.getvalue()
def test_json_and_zip_are_inert_and_documented():
    m=manifest(documentation='<script>never execute</script>')
    p=parse_upload('test.json',b64(json.dumps(m).encode()))
    assert p['manifest']['documentation']=='<script>never execute</script>'
    assert len(p['sha256'])==64 and p['kind']=='MANIFEST'
    p=parse_upload('test.zip',b64(archive([('pkg/SKILL.md','# Research\nText'),('pkg/example.py','raise RuntimeError("MUST NOT RUN")')])))
    assert p['kind']=='DOCUMENT' and p['manifest']['name']=='Research'
    assert p['manifest']['version']=='unversioned'
    p=parse_upload('test.zip',b64(archive([('SKILL.md','# Document'),('manifest.json',json.dumps(m))])))
    assert p['manifest']['name']=='Research Test' and p['manifest']['documentation']=='# Document'
@pytest.mark.parametrize('entries',[
 [('../SKILL.md','# X')],[('/SKILL.md','# X')],[('a\\SKILL.md','# X')],
 [('SKILL.md','# X'),('run.exe','no')],[('SKILL.md','# X'),('other/SKILL.md','# Y')],
 [('missing.md','# X')],[('SKILL.md','# X'),('skill.md','# X')],
 [('SKILL.md','# X'),('secret.txt','a\0b')],
 [('SKILL.md','x'*100000)],
 [('SKILL.md','# X')]+[(f'{i}.md','x') for i in range(65)],
])
def test_archive_rejects_unsafe_entries(entries):
    with pytest.raises(SkillError):parse_upload('x.zip',b64(archive(entries)))
def test_archive_rejects_symlink():
    link=zipfile.ZipInfo('SKILL.md');link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
    with pytest.raises(SkillError,match='UNSAFE'):parse_upload('x.zip',b64(archive([(link,'/outside')])) )
@pytest.mark.parametrize('name,raw', [('x.exe',b'anything'),('../x.json',b'{}'),('x.zip',b'not a zip'),('x.json',b'{"schema":1,"schema":2}'),('x.json',b'{"v":NaN}'),('x.json',b'[]'),('x.json',b'x'*(MAX_UPLOAD+1))])
def test_bad_formats_fail(name,raw):
    with pytest.raises(SkillError):parse_upload(name,b64(raw))
def test_manifest_cannot_request_broker_authority():
    with pytest.raises(SkillError):parse_upload('x.json',b64(json.dumps(manifest(broker_live_enabled=True)).encode()))
def test_strict_request_contract():
    actor=str(uuid4());uid=str(uuid4())
    assert validate_request(dict(actor_id=actor,action='SELECT',skillId=uid,expectedRevision=2))[1].hex==uid.replace('-','')
    for patch in [dict(expectedRevision=True),dict(expectedRevision=-1),dict(expectedRevision=2**53),dict(skillId='bad'),dict(actor_id=None),dict(action='EXECUTE'),dict(extra='run')]:
        with pytest.raises(SkillError):validate_request(dict(actor_id=actor,action='SELECT',skillId=uid,expectedRevision=2)|patch)
def test_dsn_is_pinned_before_any_connection():
    with pytest.raises(RuntimeError,match='STAGING_DSN'):registry('postgresql://other/project')
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
    with TestClient(create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))) as c:yield c
HEAD={'x-tradevice-master-secret':'a'*64}
def test_endpoint_auth_before_body(client):
    assert client.get('/internal/master/skills').status_code==401
    assert client.post('/internal/master/skills',content=b'x'*720000).status_code==401
    assert client.post('/internal/master/skills',content=b'x'*720000,headers=HEAD|{'content-type':'application/json'}).status_code==413
    assert client.post('/internal/master/skills',json=[],headers=HEAD).status_code==422
    assert client.post('/internal/master/skills',content='text',headers=HEAD).status_code==415
@pytest.mark.parametrize('env,project',[('local','scqzlcivherovlwqypeu'),('production','scqzlcivherovlwqypeu'),('staging','other')])
def test_no_other_environment(monkeypatch,env,project):
    monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
    with TestClient(create_app(Settings(environment=env,project_ref=project))) as c:
        assert c.get('/internal/master/skills',headers=HEAD).status_code==503
        assert c.post('/internal/master/skills',headers=HEAD,json={}).status_code==503

def test_endpoint_does_not_leak_database_errors(client,monkeypatch):
    import importlib,psycopg
    main=importlib.import_module('app.main')
    def fail(*a):raise psycopg.OperationalError('PRIVATE_PASSWORD')
    monkeypatch.setattr(main,'registry',fail)
    r=client.get('/internal/master/skills',headers=HEAD)
    assert r.status_code==503 and 'PRIVATE_PASSWORD' not in r.text
    def conflict(*a):raise SkillError('SKILL_REVISION_CONFLICT',409)
    monkeypatch.setattr(main,'registry',conflict)
    assert client.post('/internal/master/skills',headers=HEAD,json={}).status_code==409

# Unit checks of transaction decisions; database constraints are separately checked on staging.
def test_stale_selection_never_updates_or_inserts(monkeypatch):
    from unittest.mock import MagicMock
    import app.master_skills as module
    connection=MagicMock();connection.__enter__.return_value=connection
    connection.execute.return_value.fetchone.side_effect=[{'role':'tradevice_master_operator'},{'selected_skill_id':None,'revision':3},{'n':0}]
    monkeypatch.setattr(module.psycopg,'connect',lambda *a,**kw:connection)
    with pytest.raises(SkillError,match='REVISION_CONFLICT'):
        registry('postgresql://tradevice_master_operator:test@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require',dict(actor_id=str(uuid4()),action='SELECT',skillId=None,expectedRevision=2))
    statements=[call.args[0] for call in connection.execute.call_args_list]
    assert any('FOR UPDATE' in sql for sql in statements)
    assert not any(sql.startswith(('INSERT','UPDATE','DELETE')) for sql in statements)
    assert connection.__exit__.call_args.args[0] is SkillError

def test_selection_atomically_replaces_pointer_and_audits(monkeypatch):
    from unittest.mock import MagicMock
    import app.master_skills as module
    old,new,actor=uuid4(),uuid4(),uuid4()
    c=MagicMock();c.__enter__.return_value=c
    c.execute.return_value.fetchone.side_effect=[{'role':'tradevice_master_operator'},{'selected_skill_id':old,'revision':4},{'n':0},{'snapshot':{'observedMs':100000,'state':'OFF','checks':{'brokerFlat':True}}},{'ms':100000},None,{'kind':'BUILTIN','sha256':'bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee'}]
    monkeypatch.setattr(module.psycopg,'connect',lambda *a,**kw:c)
    monkeypatch.setattr(module,'catalog',lambda _:dict(selectedSkillId=str(new),revision=5,executionAuthorized=False))
    result=registry('postgresql://tradevice_master_operator:test@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require',dict(actor_id=str(actor),action='SELECT',skillId=str(new),expectedRevision=4))
    assert result['selectedSkillId']==str(new) and result['executionAuthorized'] is False
    updates=[call for call in c.execute.call_args_list if call.args[0].startswith('UPDATE')]
    assert len(updates)==1 and updates[0].args[1]==(new,actor)
    audit=[call for call in c.execute.call_args_list if call.args[0].startswith('INSERT')]
    assert len(audit)==1 and audit[0].args[1]==(actor,new,old,5)
    assert c.__exit__.call_args.args[0] is None

@pytest.mark.parametrize('runtime,code',[
 ({'observedMs':0,'state':'OFF','checks':{'brokerFlat':True}},'ENGINE_OFFLINE'),
 ({'observedMs':100000,'state':'RUNNING','checks':{'brokerFlat':True}},'STOP_AND_RECONCILE'),
 ({'observedMs':100000,'state':'READY','checks':{'brokerFlat':False}},'STOP_AND_RECONCILE'),
])
def test_selection_does_not_change_during_stale_or_exposed_engine(monkeypatch,runtime,code):
 from unittest.mock import MagicMock
 import app.master_skills as module
 c=MagicMock();c.__enter__.return_value=c
 c.execute.return_value.fetchone.side_effect=[{'role':'tradevice_master_operator'},{'selected_skill_id':None,'revision':0},{'n':0},{'snapshot':runtime},{'ms':100000}]
 monkeypatch.setattr(module.psycopg,'connect',lambda *a,**kw:c)
 with pytest.raises(SkillError,match=code):
  registry('postgresql://tradevice_master_operator:test@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require',dict(actor_id=str(uuid4()),action='SELECT',skillId=str(uuid4()),expectedRevision=0))
 assert not any(call.args[0].startswith(('UPDATE','INSERT')) for call in c.execute.call_args_list)

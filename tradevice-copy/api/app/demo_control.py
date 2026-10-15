"""Durable demo-only inbox. Uploaded packages are never executable code."""
import hashlib,hmac,json,re,time
from contextlib import contextmanager
from uuid import UUID
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .master_control import allowed_operator_dsn
from .master_skills import SkillError
from .demo_settings import SETTINGS_PROTOCOL,validate_settings

APPROVED_HASH='bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee'
CHECKS=('identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash')
STATES={'OFF','READY','STARTING','RUNNING','PAUSING','PAUSED','STOPPING','STOPPED','BLOCKED','RECOVERY_REQUIRED'}
BUSY={'STARTING','RUNNING','PAUSING','STOPPING','RECOVERY_REQUIRED'}

def uid(v):
    try:
        n=UUID(str(v))
        if not n.int:raise ValueError()
        return str(n)
    except (ValueError,TypeError,AttributeError):raise SkillError('SKILL_ENGINE_INVALID_ID') from None

@contextmanager
def connection(dsn):
    if not allowed_operator_dsn(dsn):raise RuntimeError('DEMO_STAGING_DSN_REQUIRED')
    with psycopg.connect(dsn,connect_timeout=5,options='-c statement_timeout=5000 -c lock_timeout=3000',row_factory=dict_row) as conn:
        if conn.execute('SELECT current_user AS role').fetchone()['role']!='tradevice_master_operator':raise RuntimeError('DEMO_OPERATOR_REQUIRED')
        yield conn

def fresh(s,now):
    return type(s.get('observedMs')) is int and 0<=now-s['observedMs']<=8000

def start_blockers(s,selection,now,news_clear):
    errors=[]
    if s.get('settingsProtocol')!=SETTINGS_PROTOCOL:errors.append('ENGINE_SETTINGS_UPGRADE_REQUIRED')
    if not fresh(s,now):errors.append('ENGINE_OFFLINE_OR_STALE')
    if s.get('state') not in {'READY','PAUSED','STOPPED'}:errors.append('ENGINE_NOT_READY')
    if not selection.get('selected_skill_id'):errors.append('SKILL_OFF')
    if (s.get('activeSkillId')!=str(selection.get('selected_skill_id')) or
        s.get('revision')!=selection.get('revision') or s.get('activeHash')!=APPROVED_HASH):errors.append('SKILL_ENGINE_ACK_MISMATCH')
    for key in CHECKS:
        if s.get('checks',{}).get(key) is not True:errors.append('PREFLIGHT_'+key.upper())
    if not news_clear:errors.append('NEWS_NOT_CLEAR')
    return errors

def locked(conn):
    # Every writer uses selection -> runtime lock order, including skill SELECT.
    selection=conn.execute('SELECT selected_skill_id,revision FROM master_skills.selection WHERE singleton FOR UPDATE').fetchone()
    state=conn.execute('SELECT snapshot,observed_ms,received_at,extract(epoch FROM clock_timestamp())*1000 AS ms FROM master_demo.runtime WHERE singleton FOR UPDATE').fetchone()
    now=int(state['ms'])
    return selection,state,now

PROJECTION_SQL="""
SELECT r.snapshot, s.selected_skill_id, s.revision,
       extract(epoch FROM clock_timestamp())*1000 AS ms,
       (SELECT kill_switch FROM master_control.worker_state
        WHERE master_id='tradevice-master-staging') AS kill_switch,
       EXISTS(SELECT 1 FROM master_demo.commands
              WHERE status IN ('PENDING','DISPATCHED','UNCERTAIN')) AS unconfirmed,
       COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
                 FROM (SELECT request_id,action,status,error_code,created_at
                       FROM master_demo.commands ORDER BY created_at DESC LIMIT 12) c),'[]'::jsonb) AS history
FROM master_demo.runtime r CROSS JOIN master_skills.selection s
WHERE r.singleton AND s.singleton
"""

def projection(conn,news_clear=False):
    # One consistent database snapshot avoids sequential network round trips
    # consuming the eight-second evidence budget on every dashboard poll.
    row=conn.execute(PROJECTION_SQL).fetchone()
    if not row:raise RuntimeError('DEMO_RUNTIME_UNAVAILABLE')
    s=row['snapshot'];now=int(row['ms']);online=fresh(s,now)
    blockers=start_blockers(s,row,now,news_clear)
    if row['kill_switch'] is not False:blockers.append('MANUAL_KILL_OR_SAFETY_UNAVAILABLE')
    if row['unconfirmed']:blockers.append('COMMAND_UNCONFIRMED')
    return dict(settingsProtocol=s.get('settingsProtocol') if online else None,online=online,observedMs=s.get('observedMs'),state=s.get('state') if online else 'OFFLINE',
        activeSkillId=s.get('activeSkillId') if online else None,activeHash=s.get('activeHash') if online else None,
        revision=s.get('revision') if online else None,checks=s.get('checks',{}) if online else {},
        blockers=list(dict.fromkeys(blockers+s.get('blockers',[]))),canStart=not blockers,
        commands=[dict(requestId=str(c['request_id']),action=c['action'],status=c['status'],errorCode=c['error_code']) for c in row['history']])

def read(dsn,news_clear=False):
    with connection(dsn) as conn:return projection(conn,news_clear)

def validate_command(p):
    if not isinstance(p,dict) or set(p)-{'settings'}!={'actor_id','requestId','action','targetCycles','confirmDemo','expectedRevision'}:raise SkillError('SKILL_ENGINE_COMMAND_INVALID')
    uid(p['actor_id']);uid(p['requestId'])
    if p['action'] not in {'START','PAUSE','STOP'}:raise SkillError('SKILL_ENGINE_COMMAND_INVALID')
    if type(p['expectedRevision']) is not int or not 0<=p['expectedRevision']<=2**53-1:raise SkillError('SKILL_REVISION_INVALID')
    if p['action']=='START':
        if p['confirmDemo'] is not True or type(p['targetCycles']) is not int or not 1<=p['targetCycles']<=10:raise SkillError('SKILL_DEMO_AUTHORIZATION_REQUIRED')
        try:validate_settings(p.get('settings'))
        except (ValueError,TypeError):raise SkillError('SKILL_SETTINGS_INVALID') from None
    elif p.get('settings') is not None or p['targetCycles'] is not None or p['confirmDemo'] is not False:raise SkillError('SKILL_ENGINE_COMMAND_INVALID')

def submit(dsn,p,news_clear):
    validate_command(p)
    p=dict(p,settings=p.get('settings'))
    with connection(dsn) as conn:
        sel,row,now=locked(conn)
        old=conn.execute('SELECT * FROM master_demo.commands WHERE request_id=%s',(p['requestId'],)).fetchone()
        if old:
            if (str(old['actor_id']),old['action'],old['target_cycles'],old['selection_revision'],old.get('settings'))!=(p['actor_id'],p['action'],p['targetCycles'],p['expectedRevision'],p['settings']):raise SkillError('SKILL_COMMAND_ID_CONFLICT',409)
            return dict(requestId=p['requestId'],status=old['status'])
        if p['expectedRevision']!=sel['revision']:raise SkillError('SKILL_REVISION_CONFLICT',409)
        if conn.execute("SELECT count(*) AS n FROM master_demo.commands WHERE created_at>now()-interval '1 minute'").fetchone()['n']>=20:raise SkillError('SKILL_RATE_LIMIT',429)
        s=row['snapshot']
        if p['action']=='START':
            blockers=start_blockers(s,sel,now,news_clear)
            safety=conn.execute("SELECT kill_switch FROM master_control.worker_state WHERE master_id='tradevice-master-staging'").fetchone()
            if not safety or safety['kill_switch'] is not False:blockers.append('MANUAL_KILL_OR_SAFETY_UNAVAILABLE')
            if conn.execute("SELECT 1 FROM master_demo.commands WHERE status IN ('PENDING','DISPATCHED','UNCERTAIN') LIMIT 1").fetchone():blockers.append('COMMAND_UNCONFIRMED')
            if blockers:raise SkillError('SKILL_START_'+blockers[0],409)
        elif not fresh(s,now):raise SkillError('SKILL_ENGINE_OFFLINE',409)
        conn.execute('''INSERT INTO master_demo.commands(request_id,actor_id,action,skill_id,skill_hash,selection_revision,target_cycles,settings)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',(p['requestId'],p['actor_id'],p['action'],sel['selected_skill_id'],APPROVED_HASH if sel['selected_skill_id'] else None,sel['revision'],p['targetCycles'],Jsonb(p['settings']) if p['settings'] is not None else None))
        return dict(requestId=p['requestId'],status='PENDING')

def validate_snapshot(p,now):
    if not isinstance(p,dict) or set(p)-{'news','settingsProtocol'}!={'observedMs','bootId','activeSkillId','activeHash','revision','state','checks','blockers','receipts'}:raise SkillError('SKILL_ENGINE_REPORT_INVALID')
    if 'settingsProtocol' in p and p['settingsProtocol'] not in (SETTINGS_PROTOCOL,'V51_CLOSE_DISTANCE_20261015'):raise SkillError('SKILL_SETTINGS_PROTOCOL_INVALID')
    from .bridge_calendar import validate_evidence
    try:validate_evidence(p.get('news'),now)
    except ValueError as exc:raise SkillError(str(exc)) from None
    if not fresh(p,now) or p['state'] not in STATES:raise SkillError('SKILL_ENGINE_REPORT_STALE')
    uid(p['bootId'])
    if p['activeSkillId'] is not None:uid(p['activeSkillId'])
    if p['activeHash'] not in (None,APPROVED_HASH):raise SkillError('SKILL_ENGINE_HASH_INVALID')
    if (p['activeSkillId'] is None)!=(p['activeHash'] is None):raise SkillError('SKILL_ENGINE_HASH_INVALID')
    if type(p['revision']) is not int or not 0<=p['revision']<=2**53-1:raise SkillError('SKILL_REVISION_INVALID')
    if not isinstance(p['checks'],dict) or set(p['checks'])!=set(CHECKS) or any(type(v) is not bool for v in p['checks'].values()):raise SkillError('SKILL_ENGINE_CHECKS_INVALID')
    if not isinstance(p['blockers'],list) or len(p['blockers'])>20 or any(not isinstance(v,str) or not re.fullmatch('[A-Z0-9_]{1,100}',v) for v in p['blockers']):raise SkillError('SKILL_ENGINE_REPORT_INVALID')
    if not isinstance(p['receipts'],list) or len(p['receipts'])>16:raise SkillError('SKILL_ENGINE_RECEIPT_INVALID')
    for r in p['receipts']:
        if not isinstance(r,dict) or set(r)!={'requestId','status','errorCode'} or r['status'] not in {'APPLIED','REJECTED','UNCERTAIN'}:raise SkillError('SKILL_ENGINE_RECEIPT_INVALID')
        uid(r['requestId'])
        if r['errorCode'] is not None and (not isinstance(r['errorCode'],str) or not re.fullmatch('[A-Z0-9_]{1,100}',r['errorCode'])):raise SkillError('SKILL_ENGINE_RECEIPT_INVALID')

def exchange(dsn,p):
    with connection(dsn) as conn:
        sel,row,now=locked(conn);validate_snapshot(p,now)
        if row.get('received_at') and now-int(row['received_at'].timestamp()*1000)<500:raise SkillError('SKILL_ENGINE_RATE_LIMIT',429)
        if p['observedMs']<=row['observed_ms']:raise SkillError('SKILL_ENGINE_REPORT_REPLAY',409)
        prior=row['snapshot']
        if fresh(prior,now) and prior.get('bootId')!=p['bootId']:raise SkillError('SKILL_ENGINE_LEASE_HELD',409)
        confirmed=[]
        for r in p['receipts']:
            c=conn.execute('SELECT status FROM master_demo.commands WHERE request_id=%s FOR UPDATE',(r['requestId'],)).fetchone()
            if c and c['status'] in ('DISPATCHED','UNCERTAIN'):
                conn.execute('UPDATE master_demo.commands SET status=%s,error_code=%s,processed_at=now() WHERE request_id=%s',(r['status'],r['errorCode'],r['requestId']))
                confirmed.append(r['requestId'])
            elif c and c['status']==r['status']:confirmed.append(r['requestId'])
        # Queue independent statements in the same transaction; preserve the
        # selection -> runtime lock order and all receipt/lease checks above.
        with conn.pipeline():
            conn.execute("UPDATE master_demo.commands SET status=CASE WHEN status='PENDING' THEN 'EXPIRED' ELSE 'UNCERTAIN' END,error_code='COMMAND_EXPIRED' WHERE status IN ('PENDING','DISPATCHED') AND expires_at<=now()")
            conn.execute('UPDATE master_demo.runtime SET snapshot=%s,observed_ms=%s,received_at=now() WHERE singleton',(Jsonb({k:v for k,v in p.items() if k!='receipts'}),p['observedMs']))
            pending=conn.execute("SELECT * FROM master_demo.commands WHERE status IN ('PENDING','DISPATCHED') AND expires_at>now() ORDER BY created_at LIMIT 16 FOR UPDATE")
            safety_query=conn.execute("SELECT kill_switch FROM master_control.worker_state WHERE master_id='tradevice-master-staging'")
            package_query=conn.execute('SELECT kind,sha256 FROM master_skills.packages WHERE id=%s',(sel['selected_skill_id'],)) if sel['selected_skill_id'] else None
        cmds=pending.fetchall()
        for c in cmds:conn.execute("UPDATE master_demo.commands SET status='DISPATCHED' WHERE request_id=%s AND status='PENDING'",(c['request_id'],))
        safety=safety_query.fetchone()
        package=package_query.fetchone() if package_query else None
        selected_hash=package['sha256'] if package and package['kind']=='BUILTIN' and package['sha256']==APPROVED_HASH else None
        return dict(serverMs=now,calendarEvidencePolicy='SCHEDULE_6H_V1',killSwitch=not safety or safety['kill_switch'] is not False,selection=dict(skillId=str(sel['selected_skill_id']) if sel['selected_skill_id'] else None,revision=sel['revision'],sha256=selected_hash),confirmed=confirmed,
            commands=[dict(requestId=str(c['request_id']),action=c['action'],targetCycles=c['target_cycles'],settings=c.get('settings'),skillId=str(c['skill_id']) if c['skill_id'] else None,sha256=c['skill_hash'],revision=c['selection_revision'],expiresMs=int(c['expires_at'].timestamp()*1000)) for c in cmds])

def signature(secret,stamp,body):
    return hmac.new(bytes.fromhex(secret),b'tradevice-demo-v1\n'+stamp.encode()+b'\n'+body,hashlib.sha256).hexdigest()

def authenticate(secret,stamp,sig,body,now):
    if not re.fullmatch('[a-f0-9]{64}',secret or ''):raise RuntimeError('DEMO_BRIDGE_NOT_CONFIGURED')
    if not re.fullmatch('[0-9]{13}',stamp or '') or abs(now-int(stamp))>10000 or not hmac.compare_digest(signature(secret,stamp,body),sig):raise SkillError('SKILL_ENGINE_AUTH_DENIED',401)

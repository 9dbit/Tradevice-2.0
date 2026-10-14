"""Bounded read-only PowerShell journal viewer feed; never accepts shell commands."""
import hashlib,hmac,json,re,threading

SCHEMA='tradevice.powershell.journal.v1'
SOURCE='TRADEVICEPC_POWERSHELL_JOURNAL_VIEWER'
MAX_BODY=32768
TTL=12000
EVENTS=set('ARC_NAMESPACE BATCH_STARTED BATCH_CYCLE_RESULT CYCLE_STARTED FIXED_INITIAL_LADDERS_VERIFIED BROKER_REQUEST_INTENT BROKER_REQUEST_RECEIPT BROKER_REQUEST_RESOLVED FLAT_LIFECYCLE_RECONCILED TERMINAL_EXIT_COMMITTED TP_GENERATION_BEGIN TP_GENERATION_SYNCED NEWS_ENTRY_SUSPENDED NEWS_PENDING_RETIRED ADAPTIVE_ARMED ADAPTIVE_AUTHORIZED ADAPTIVE_DEFERRED ADAPTIVE_FILLED RISK_EXIT_COMMITTED'.split())
BATCH=r'(?:v51_dashboard_[a-f0-9]{32}|v51_demo10_[0-9]{8}_[0-9]{6})'

def signature(secret,stamp,body):
 return hmac.new(bytes.fromhex(secret),b'tradevice-terminal-v1\n'+stamp.encode()+b'\n'+body,hashlib.sha256).hexdigest()

def authenticate(secret,stamp,sig,body,now):
 if not re.fullmatch('[0-9a-f]{64}',secret or ''):raise ValueError('NOT_CONFIGURED')
 if not re.fullmatch('[0-9]{13}',stamp or '') or abs(now-int(stamp))>10000 or not hmac.compare_digest(signature(secret,stamp,body),sig):raise ValueError('AUTH_DENIED')

def validate(p,now):
 if not isinstance(p,dict) or set(p)!={'schema','source','readOnly','observedMs','batchId','status','lines'}:raise ValueError('SCHEMA')
 if p['schema']!=SCHEMA or p['source']!=SOURCE or p['readOnly'] is not True:raise ValueError('SOURCE')
 if type(p['observedMs']) is not int or not 0<=now-p['observedMs']<=10000:raise ValueError('STALE')
 if p['batchId'] is not None and (not isinstance(p['batchId'],str) or not re.fullmatch(BATCH,p['batchId'])):raise ValueError('BATCH')
 if p['status'] not in ('LIVE','NO_EVENTS','UNAVAILABLE') or not isinstance(p['lines'],list) or len(p['lines'])>40:raise ValueError('LINES')
 if p['status']!='LIVE' and p['lines'] or p['status']=='LIVE' and (not p['lines'] or p['batchId'] is None):raise ValueError('STATUS')
 seen=set()
 for row in p['lines']:
  if not isinstance(row,dict) or set(row)!={'atMs','event','cycle','sequence'}:raise ValueError('LINE_FIELDS')
  if type(row['atMs']) is not int or not 0<=row['atMs']<=p['observedMs']:raise ValueError('LINE_TIME')
  if row['event'] not in EVENTS or type(row['sequence']) is not int or not 0<=row['sequence']<=10**9:raise ValueError('LINE_EVENT')
  if row['cycle'] is not None and (not isinstance(row['cycle'],str) or not re.fullmatch('[a-f0-9]{8}',row['cycle'])):raise ValueError('CYCLE')
  key=(row['cycle'],row['sequence'])
  if key in seen:raise ValueError('DUPLICATE')
  seen.add(key)
 return p

class TerminalBuffer:
 def __init__(self):self.lock=threading.Lock();self.packet=None;self.received=None
 def receive(self,body,now):
  if len(body)>MAX_BODY:raise ValueError('BODY')
  p=validate(json.loads(body),now)
  with self.lock:
   if self.packet and p['observedMs']<=self.packet['observedMs']:raise ValueError('REPLAY')
   if self.received is not None and now-self.received<1000:raise OverflowError('RATE_LIMIT')
   self.packet=p;self.received=now
 def projection(self,now):
  with self.lock:
   if self.packet is None:return None
   # Keep event timestamps; fresh reader does not imply a fresh trading event.
   return {**self.packet,'status':self.packet['status'] if 0<=now-self.packet['observedMs']<=TTL else 'STALE'}

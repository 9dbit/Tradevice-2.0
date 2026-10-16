"""Authenticated read-only history. Rebuilt from PC journals after API restart."""
import hashlib,hmac,json,re,math,threading
MAX_BODY=262144

def signature(secret,stamp,body):return hmac.new(bytes.fromhex(secret),b'tradevice-growth-v1\n'+stamp.encode()+b'\n'+body,hashlib.sha256).hexdigest()
def authenticate(secret,stamp,sig,body,now):
 if not re.fullmatch('[a-f0-9]{64}',secret or '') or not re.fullmatch('[0-9]{13}',stamp or '') or abs(now-int(stamp))>10000 or not hmac.compare_digest(signature(secret,stamp,body),sig):raise ValueError('AUTH')
def validate(p,now):
 if not isinstance(p,dict) or set(p)!={'schema','source','readOnly','observedMs','status','coverageStartMs','currency','rows'}:raise ValueError('SCHEMA')
 if p['schema']!='tradevice.growth.v1' or p['source']!='TRADEVICEPC_V51_COMPLETED_JOURNALS' or p['readOnly'] is not True or p['currency']!='USD':raise ValueError('SOURCE')
 if type(p['observedMs']) is not int or not 0<=now-p['observedMs']<=10000:raise ValueError('TIME')
 if p['status'] not in ('AVAILABLE','PARTIAL','UNAVAILABLE') or not isinstance(p['rows'],list) or len(p['rows'])>2000:raise ValueError('ROWS')
 if p['status']=='UNAVAILABLE':
  if p['rows'] or p['coverageStartMs'] is not None:raise ValueError('UNAVAILABLE')
 else:
  if type(p['coverageStartMs']) is not int or not 0<=p['coverageStartMs']<=p['observedMs']:raise ValueError('COVERAGE')
 seen=set();last=-1
 for row in p['rows']:
  if not isinstance(row,dict) or set(row)!={'cycleId','closedMs','netUsd'}:raise ValueError('ROW')
  if not isinstance(row['cycleId'],str) or not re.fullmatch('[a-f0-9]{8}',row['cycleId']) or row['cycleId'] in seen:raise ValueError('ID')
  if type(row['closedMs']) is not int or not p['coverageStartMs']<=row['closedMs']<=p['observedMs'] or row['closedMs']<last:raise ValueError('CLOSE_TIME')
  if type(row['netUsd']) not in (int,float) or not math.isfinite(row['netUsd']) or abs(row['netUsd'])>1e9:raise ValueError('NET')
  seen.add(row['cycleId']);last=row['closedMs']
 return p
class GrowthBuffer:
 def __init__(self):self.lock=threading.Lock();self.packet=None;self.received=None
 def receive(self,body,now):
  if len(body)>MAX_BODY:raise ValueError('BODY')
  p=validate(json.loads(body),now)
  with self.lock:
   if self.packet and p['observedMs']<=self.packet['observedMs']:raise ValueError('REPLAY')
   if self.received is not None and now-self.received<500:raise OverflowError('RATE')
   self.packet=p;self.received=now
  return p['observedMs']
 def projection(self,now):
  with self.lock:
   if self.packet is None:return None
   return {**self.packet,'stale':not 0<=now-self.packet['observedMs']<=180000}

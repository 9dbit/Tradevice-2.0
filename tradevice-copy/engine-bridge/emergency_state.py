"""Durable operator close intent. It never grants permission to open a trade."""
import json,os,time,uuid
from pathlib import Path
PROTOCOL='V51_EMERGENCY_CLOSE_20261016'
FILENAME='emergency_close.json'
class EmergencyHandoff(RuntimeError):pass
def read(root):
 p=Path(root)/'read_only'/FILENAME
 if not p.exists():return None
 try:
  if p.stat().st_size>4096:raise ValueError()
  value=json.loads(p.read_text())
  if value.get('protocol') not in (PROTOCOL,'V51_EMERGENCY_CLOSE_20261015') or not isinstance(value.get('requestId'),str):raise ValueError()
  uuid.UUID(value['requestId'])
  if set(value)!={'protocol','requestId','expiresMs','phase','observedMs','positionsRemaining','ordersRemaining'}:raise ValueError()
  if value['phase'] not in {'WAITING_ENGINE','CANCELLING_PENDING','CLOSING_POSITIONS','VERIFYING_FLAT','CONNECTION_UNAVAILABLE','RECONCILIATION_REQUIRED','COMPLETE'}:raise ValueError()
  if any(type(value[k]) is not int or value[k]<0 for k in ('expiresMs','observedMs')):raise ValueError()
  if any(value[k] is not None and (type(value[k]) is not int or value[k]<0) for k in ('positionsRemaining','ordersRemaining')):raise ValueError()
  if value['phase']=='COMPLETE' and (value['positionsRemaining']!=0 or value['ordersRemaining']!=0):raise ValueError()
  return value
 except Exception:raise ValueError('EMERGENCY_INTENT_INVALID') from None
def write(root,value):
 p=Path(root)/'read_only'/FILENAME;p.parent.mkdir(parents=True,exist_ok=True)
 temp=p.with_suffix('.tmp')
 with temp.open('w',encoding='utf-8') as f:
  json.dump(value,f,separators=(',',':'));f.flush();os.fsync(f.fileno())
 for attempt in range(10):
  try:os.replace(temp,p);break
  except PermissionError:
   if attempt==9:raise
   time.sleep(.01*(attempt+1))
def requested(root):
 value=read(root)
 return value is not None and value.get('phase')!='COMPLETE'
def begin(root,request_id,expires_ms):
 value=dict(protocol=PROTOCOL,requestId=str(uuid.UUID(request_id)),expiresMs=expires_ms,
  phase='WAITING_ENGINE',observedMs=int(time.time()*1000),positionsRemaining=None,ordersRemaining=None)
 write(root,value);return value
def update(root,phase,positions=None,orders=None):
 value=read(root)
 if value is None:raise ValueError('EMERGENCY_INTENT_MISSING')
 value.update(phase=phase,observedMs=int(time.time()*1000),positionsRemaining=positions,ordersRemaining=orders)
 write(root,value);return value

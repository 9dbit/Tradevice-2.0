"""Read-only PowerShell journal viewer. No MT5 imports, shell input or order calls.
Only structured allowlisted journal fields leave the PC; no raw console capture.
"""
import argparse,hashlib,hmac,json,re,sys,time,os
from datetime import datetime,timezone,timedelta
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError

ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
_client=None
ENDPOINT='https://copy-api-staging-4c33.up.railway.app/internal/master/terminal'
EVENTS=set('ARC_NAMESPACE BATCH_STARTED BATCH_CYCLE_RESULT CYCLE_STARTED FIXED_INITIAL_LADDERS_VERIFIED BROKER_REQUEST_INTENT BROKER_REQUEST_RECEIPT BROKER_REQUEST_RESOLVED FLAT_LIFECYCLE_RECONCILED TERMINAL_EXIT_COMMITTED TP_GENERATION_BEGIN TP_GENERATION_SYNCED NEWS_ENTRY_SUSPENDED NEWS_PENDING_RETIRED ADAPTIVE_ARMED ADAPTIVE_AUTHORIZED ADAPTIVE_DEFERRED ADAPTIVE_FILLED RISK_EXIT_COMMITTED'.split())
BATCH=r'(?:v51_dashboard_[a-f0-9]{32}|v51_demo10_[0-9]{8}_[0-9]{6})'

class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('REDIRECT_BLOCKED')

def capture(root,now):
 root=Path(root).resolve()
 out=dict(schema='tradevice.powershell.journal.v1',source='TRADEVICEPC_POWERSHELL_JOURNAL_VIEWER',readOnly=True,observedMs=now,batchId=None,status='UNAVAILABLE',lines=[])
 try:
  meta=root/'read_only/demo_batch.json'
  if meta.stat().st_size>65536:return out
  batch=json.loads(meta.read_text())['batch_id']
  if not re.fullmatch(BATCH,batch):return out
  base=(root/'logs/arc_v1'/batch).resolve()
  if not base.is_relative_to(root) or not base.is_dir():return out
  out['batchId']=batch
  files=[base/'arc_ownership.jsonl']+sorted(base.glob('cycle_[0-9][0-9]/arc_ownership.jsonl'))[-3:]
  rows={}
  for path in files:
   if not path.exists():continue
   if not path.resolve().is_relative_to(base):return out
   with path.open('rb') as f:
    size=f.seek(0,2);f.seek(max(0,size-65536));body=f.read(65536)
   lines=body.splitlines(keepends=True)
   if size>65536:lines=lines[1:]
   parsed=[]
   for line in lines:
    if not line.endswith(b'\n'):continue  # Do not read a partially appended event.
    try:
     e=json.loads(line)
     if isinstance(e,dict):parsed.append(e)
    except (ValueError,TypeError):continue
   # Receipt rows omit cycle_id. Recover their namespace only when this journal
   # has exactly one explicit cycle ID; never merge null IDs across cycle files.
   ids={e.get('cycle_id') for e in parsed if isinstance(e.get('cycle_id'),str) and re.fullmatch('[a-f0-9]{8}',e['cycle_id'])}
   context=next(iter(ids)) if len(ids)==1 and path.parent.name.startswith('cycle_') else None
   for e in parsed:
    try:
     event=e.get('event');cycle=e.get('cycle_id') or context;seq=e.get('sequence')
     if cycle is None and path.parent.name.startswith('cycle_'):continue
     if event not in EVENTS or type(seq) is not int or not 0<=seq<=10**9:continue
     if cycle is not None and (not isinstance(cycle,str) or not re.fullmatch('[a-f0-9]{8}',cycle)):continue
     t=datetime.fromisoformat(e['timestamp'].replace('Z','+00:00'))
     if t.tzinfo is None:continue
     stamp=int(t.timestamp()*1000)
     if not 0<=stamp<=now:continue
     rows[(cycle,seq)]=dict(atMs=stamp,event=event,cycle=cycle,sequence=seq)
    except (ValueError,TypeError,KeyError,AttributeError):continue
  if json.loads(meta.read_text()).get('batch_id')!=batch:return out
  out['lines']=sorted(rows.values(),key=lambda e:(e['atMs'],e['sequence']))[-40:]
  out['status']='LIVE' if out['lines'] else 'NO_EVENTS'
 except (OSError,ValueError,KeyError,TypeError):pass
 return out

def render(packet):
 def stamp(ms):return datetime.fromtimestamp(ms/1000,timezone(timedelta(hours=7))).strftime('%H:%M:%S')
 return '\n'.join(f"{stamp(e['atMs'])} WIB  {e['cycle'] or 'BATCH'}  {e['event']}  #{e['sequence']}" for e in packet['lines'])

def publish(packet,secret):
 raw=json.dumps(packet,separators=(',',':')).encode();stamp=str(packet['observedMs'])
 sig=hmac.new(bytes.fromhex(secret),b'tradevice-terminal-v1\n'+stamp.encode()+b'\n'+raw,hashlib.sha256).hexdigest()
 req=Request(ENDPOINT,raw,{'content-type':'application/json','x-tradevice-terminal-time':stamp,'x-tradevice-terminal-signature':sig})
 with (_client or build_opener(NoRedirect())).open(req,timeout=8) as response:
  ack=json.loads(response.read(1024))
  if response.status!=202 or ack.get('status')!='ACCEPTED_READ_ONLY' or ack.get('observedMs')!=packet['observedMs']:raise ValueError('ACK_INVALID')

def main():
 global _client
 p=argparse.ArgumentParser();p.add_argument('--publish',action='store_true');p.add_argument('--once',action='store_true');a=p.parse_args()
 if not ROOT.is_dir():raise RuntimeError('ISOLATED_CLONE_REQUIRED')
 secret=None
 if a.publish:
  # Reuse the restricted DPAPI loader, never capture or forward raw console data.
  sys.path.insert(0,str(ROOT));from v51_staging_readonly_forwarder import load_dpapi_secret,PersistentClient
  secret=load_dpapi_secret();_client=PersistentClient(endpoint=ENDPOINT)
 # Independent OS lock: no access to the engine's bridge/run locks.
 with (Path(__file__).parent/'viewer.lock').open('a+b') as lock:
  lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
  if os.name=='nt':
   import msvcrt
   msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
  last=None;failures=0
  while True:
   started=time.monotonic()
   packet=capture(ROOT,int(time.time()*1000));screen=render(packet)
   if screen!=last:
    print('TRADEVICEPC | PowerShell engine journal | READ ONLY',flush=True)
    print(packet['batchId'] or 'No journal source',flush=True);print(screen or packet['status'],flush=True);last=screen
   if secret:
    try:publish(packet,secret);failures=0
    except HTTPError as e:failures+=1;print('VIEWER_SYNC_HTTP_'+str(e.code),flush=True)
    except Exception:failures+=1;print('VIEWER_SYNC_UNAVAILABLE',flush=True)
   if a.once:return
   time.sleep(min(30,3*2**min(failures,3)) if failures else max(.05,1-(time.monotonic()-started)))
if __name__=='__main__':main()

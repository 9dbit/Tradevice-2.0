"""Read-only V5.1 completed-cycle history. Never imports or calls MT5."""
import hashlib,hmac,json,math,re,sys,time,os
from pathlib import Path
from datetime import datetime
from urllib.request import Request,build_opener,HTTPRedirectHandler
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
ENDPOINT='https://copy-api-staging-4c33.up.railway.app/internal/master/growth'
BATCH=re.compile(r'(?:v51_dashboard_[a-f0-9]{32}|v51_demo10_[0-9]{8}_[0-9]{6})')
MAX_ROWS=2000

def read(path,root,limit=262144):
 if not path.resolve().is_relative_to(root.resolve()) or path.stat().st_size>limit:raise ValueError('SOURCE_LIMIT')
 return json.loads(path.read_text(encoding='utf-8'))
def stamp(value):
 d=datetime.fromisoformat(value.replace('Z','+00:00'))
 if d.tzinfo is None:raise ValueError('TIMEZONE')
 return int(d.timestamp()*1000)
def capture(root,now):
 root=Path(root).resolve();base=root/'logs/arc_v1'
 out=dict(schema='tradevice.growth.v1',source='TRADEVICEPC_V51_COMPLETED_JOURNALS',readOnly=True,observedMs=now,status='UNAVAILABLE',coverageStartMs=None,currency='USD',rows=[])
 try:
  current=read(root/'read_only/demo_batch.json',root)['batch_id']
  if not BATCH.fullmatch(current):return out
  identity=read(base/current/'batch_manifest.json',root)['identity']
  if not isinstance(identity,list) or len(identity)!=4 or identity[1:3]!=['Exness-MT5Trial14','XAUUSDm']:return out
  dirs=sorted((p for p in base.iterdir() if p.is_dir() and BATCH.fullmatch(p.name)),key=lambda p:p.stat().st_mtime,reverse=True)
  partial=len(dirs)>200;rows={};starts=[]
  for folder in dirs[:200]:
   try:
    manifest=read(folder/'batch_manifest.json',root)
    if manifest.get('identity')!=identity:continue  # Never merge accounts or magic namespaces.
    start=stamp(manifest['started_at'])
    if not 0<=start<=now:raise ValueError('TIME')
    starts.append(start)
    for path in sorted(folder.glob('cycle_[0-9][0-9]/cycle_summary.json')):
     try:
      s=read(path,root,16384)
      if s.get('broker_flat_confirmed') is not True or not str(s.get('outcome','')).startswith('COMPLETE') or type(s.get('layers')) is not int or not 1<=s['layers']<=10:continue
      cid=s['cycle_id'];net=s['realized_pl_usd'];closed=stamp(s['end_time']);opened=stamp(s['start_time'])
      if not isinstance(cid,str) or not re.fullmatch('[a-f0-9]{8}',cid) or type(net) not in (int,float) or not math.isfinite(net) or abs(net)>1e9 or not start<=opened<=closed<=now:raise ValueError('ROW')
      row=dict(cycleId=cid,closedMs=closed,netUsd=round(net,8))
      if cid in rows and rows[cid]!=row:raise RuntimeError('CONFLICTING_CYCLE')
      rows[cid]=row
     except (OSError,ValueError,KeyError,TypeError,AttributeError):partial=True
   except (OSError,ValueError,KeyError,TypeError,AttributeError):partial=True
  if not starts:return out
  values=sorted(rows.values(),key=lambda r:(r['closedMs'],r['cycleId']))
  partial=partial or len(values)>MAX_ROWS
  out.update(status='PARTIAL' if partial else 'AVAILABLE',coverageStartMs=min(starts),rows=values[-MAX_ROWS:])
 except (OSError,ValueError,KeyError,TypeError,AttributeError,RuntimeError):pass
 return out
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('REDIRECT_BLOCKED')
def publish(p,secret):
 raw=json.dumps(p,separators=(',',':')).encode();ts=str(p['observedMs'])
 sig=hmac.new(bytes.fromhex(secret),b'tradevice-growth-v1\n'+ts.encode()+b'\n'+raw,hashlib.sha256).hexdigest()
 req=Request(ENDPOINT,raw,{'content-type':'application/json','x-tradevice-growth-time':ts,'x-tradevice-growth-signature':sig})
 with build_opener(NoRedirect()).open(req,timeout=10) as r:
  ack=json.loads(r.read(1024))
  if r.status!=202 or ack.get('observedMs')!=p['observedMs']:raise ValueError('ACK')
def main():
 sys.path.insert(0,str(ROOT));from v51_staging_readonly_forwarder import load_dpapi_secret
 key=load_dpapi_secret()
 with (Path(__file__).parent/'growth.lock').open('a+b') as lock:
  lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
  if os.name=='nt':
   import msvcrt
   msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
  while True:
   try:
    p=capture(ROOT,int(time.time()*1000));publish(p,key);print('GROWTH_SYNC_OK rows='+str(len(p['rows'])),flush=True)
   except Exception:print('GROWTH_SYNC_UNAVAILABLE',flush=True)
   time.sleep(60)
if __name__=='__main__':main()

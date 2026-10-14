"""Display-only bounded demo evidence. Counts are derived, never trusted inputs."""
import math,re
SCHEMA='tradevice.v51.demo.batch.v1'
STATUSES={'PREFLIGHT','BLOCKED','RUNNING','COMPLETED','SAFETY_STOP','SUSPENDED','STOPPED'}

def project_batch(raw,now):
    if raw is None:return None
    try:
        if raw.get('schema')!=SCHEMA or raw.get('read_only') is not True or type(raw.get('requested')) is not int or not 1<=raw['requested']<=10:raise ValueError()
        bid=raw.get('batch_id');at=raw.get('observed_ms');status=raw.get('status')
        if not isinstance(bid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',bid):raise ValueError()
        if type(at) is not int or at<0 or at>now+1000 or status not in STATUSES:raise ValueError()
        blockers=raw.get('blockers')
        if not isinstance(blockers,list) or len(blockers)>12 or any(not isinstance(x,str) or not re.fullmatch('[A-Z0-9_]{1,80}',x) for x in blockers):raise ValueError()
        rows=raw.get('cycles')
        if not isinstance(rows,list) or len(rows)>raw['requested']:raise ValueError()
        cycles=[];ids=set()
        for i,r in enumerate(rows,1):
            cid=r.get('cycle_id');outcome=r.get('outcome');flat=r.get('broker_flat')
            if r.get('number')!=i or not isinstance(cid,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,80}',cid) or cid in ids:raise ValueError()
            if type(flat) is not bool or not isinstance(outcome,str) or not re.fullmatch('[A-Z_]{1,48}',outcome):raise ValueError()
            layers=r.get('layers');peak=r.get('peak_lots');net=r.get('net_usd')
            if type(layers) is not int or not 0<=layers<=10:raise ValueError()
            if type(peak) not in (int,float) or not math.isfinite(peak) or not 0<=peak<=100:raise ValueError()
            if net is not None and (type(net) not in (int,float) or not math.isfinite(net) or abs(net)>1e9):raise ValueError()
            done=flat and outcome.startswith('COMPLETE') and layers>0
            if (outcome.startswith('COMPLETE') and not flat) or (done and net is None):raise ValueError()
            ids.add(cid)
            cycles.append(dict(number=i,cycle_id=cid,outcome=outcome,broker_flat=flat,layers=layers,
                peak_lots=peak,net_usd=net,completed=done))
        completed=[r for r in cycles if r['completed']]
        if status=='COMPLETED' and len(completed)!=raw['requested']:raise ValueError()
        return dict(schema=SCHEMA,read_only=True,batch_id=bid,observed_ms=at,status=status,
            fresh=0<=now-at<=15000,requested=raw['requested'],started=len(cycles),completed=len(completed),
            wins=sum(r['net_usd']>0 for r in completed),losses=sum(r['net_usd']<0 for r in completed),
            risk_exits=sum('RISK' in r['outcome'] for r in completed),
            unfinished=sum(not r['broker_flat'] for r in cycles),
            net_completed_usd=round(sum(r['net_usd'] for r in completed),8),blockers=blockers,cycles=cycles)
    except (ValueError,TypeError,AttributeError,KeyError):return None

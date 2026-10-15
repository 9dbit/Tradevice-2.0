"""Strict display projection for optional signed observer diagnostics; no execution authority."""
import math,re

def missing(reason='ENGINE_NOT_CONNECTED'):
    return dict(policy=None,status=reason,observedMs=None,cycleId=None,state=None,hardLossUsd=None,
        targetUsd=None,riskExitCommitted=None,brokerFlatReconciled=None,entrySuspended=None,
        pnl=None,decision=None,authorization='UNKNOWN',authorizationExpiresMs=None,
        orderDispatchAuthorized=False)

def number(v,low=-1e12,high=1e12):
    if type(v) not in (int,float) or not math.isfinite(v) or not low<=v<=high:raise ValueError()
    return v

def stamp(v):
    if type(v) is not int or v<0:raise ValueError()
    return v

def project_engine(raw,now):
    if raw is None:return missing()
    try:
        if (raw.get('schema')!='tradevice.v51.engine.diagnostics.v1' or raw.get('read_only') is not True
            or raw.get('order_dispatch_authorized') is not False):raise ValueError()
        if raw.get('status') in ('ENGINE_NOT_CONNECTED','ENGINE_REPORT_STALE','ENGINE_REPORT_INVALID'):
            return missing(raw['status'])
        if raw.get('status')!='ENGINE_REPORTED' or raw.get('source')!='V51_RUNNER_DIAGNOSTICS':raise ValueError()
        at=stamp(raw.get('observed_ms'))
        if not 0<=now-at<=8000:return missing('ENGINE_REPORT_STALE')
        cycle=raw.get('cycle_id')
        if cycle is not None and (not isinstance(cycle,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',cycle)):raise ValueError()
        state=raw.get('state')
        if not isinstance(state,str) or not re.fullmatch(r'[A-Z_]{1,48}',state):raise ValueError()
        policy=raw.get('policy','REVERSAL_RISK_V5')
        if policy not in ('REVERSAL_RISK_V5','CLOSE_DISTANCE_RISK_V51'):raise ValueError()
        loss=number(raw.get('hard_loss_usd'),-250,-120)
        if loss!=(-250 if policy=='CLOSE_DISTANCE_RISK_V51' else -120):raise ValueError()
        target=number(raw.get('target_usd'),.01,250)
        for k in ('risk_exit_committed','broker_flat_reconciled','entry_suspended'):
            if type(raw.get(k)) is not bool:raise ValueError()
        if raw['broker_flat_reconciled'] and not state.startswith('COMPLETE'):raise ValueError()
        auth=raw.get('authorization')
        if auth not in ('NONE','AUTHORIZED','EXPIRED','DEFERRED','FILLED','UNKNOWN'):raise ValueError()
        expiry=raw.get('authorization_expires_ms')
        if expiry is not None:stamp(expiry)
        if auth=='AUTHORIZED' and (expiry is None or now>=expiry):auth='EXPIRED'
        pnl=None;p=raw.get('pnl')
        if p is not None:
            pt=stamp(p.get('at_ms'));tick=stamp(p.get('tick_ms'))
            if p.get('cycle_id')!=cycle or not cycle or p.get('basis')!='ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED':raise ValueError()
            value=number(p.get('value'))
            if 0<=now-pt<=5000 and 0<=now-tick<=5000 and not state.startswith('COMPLETE'):
                pnl=dict(atMs=pt,tickMs=tick,value=value,basis=p['basis'])
        decision=None;d=raw.get('decision')
        if d is not None:
            close=stamp(d.get('candle_close_ms'))
            if type(d.get('layer')) is not int or not 6<=d['layer']<=10 or type(d.get('accepted')) is not bool:raise ValueError()
            if d.get('structural_reversal') is not None and type(d['structural_reversal']) is not bool:raise ValueError()
            values={k:number(d.get(k),0 if k!='distance_points' else -1e9) for k in ('distance_points','atr','body_atr','body_range')}
            reasons=d.get('reasons')
            if not isinstance(reasons,list) or not 1<=len(reasons)<=8 or any(not isinstance(r,str) or not re.fullmatch('[A-Z0-9_]{1,80}',r) for r in reasons):raise ValueError()
            if 0<=now-close<=120000:
                decision=dict(layer=d['layer'],candleCloseMs=close,accepted=d['accepted'],structuralReversal=d.get('structural_reversal'),reasons=reasons,**values)
        return dict(policy=policy,status='ENGINE_REPORTED',observedMs=at,cycleId=cycle,state=state,
            hardLossUsd=loss,targetUsd=target,riskExitCommitted=raw['risk_exit_committed'],
            brokerFlatReconciled=raw['broker_flat_reconciled'],entrySuspended=raw['entry_suspended'],
            pnl=pnl,decision=decision,authorization=auth,authorizationExpiresMs=expiry,
            orderDispatchAuthorized=False)
    except (ValueError,TypeError,AttributeError,KeyError):return missing('ENGINE_REPORT_INVALID')

def project_owned(raw,exposure,currency):
    if raw is None:return None
    try:
        if raw.get('basis')!='MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP' or raw.get('net_cycle_pnl_verified') is not False:raise ValueError()
        if raw.get('currency')!=currency or currency!='USD':raise ValueError()
        for k,e in [('positions','goldtrap_positions_count'),('pending','goldtrap_orders_count')]:
            if type(raw.get(k)) is not int or raw[k]!=exposure[e]:raise ValueError()
        value=number(raw.get('value'))
        if not raw['positions'] and value!=0:raise ValueError()
        return dict(value=value,currency=currency,positions=raw['positions'],pending=raw['pending'],
            basis=raw['basis'],netCyclePnlVerified=False)
    except (ValueError,TypeError,AttributeError,KeyError):return None

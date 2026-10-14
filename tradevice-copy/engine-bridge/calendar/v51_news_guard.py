"""Research admission policy. No IO or broker calls. All times UTC milliseconds.
Transport/source verification belongs to the caller, never to a payload flag.
"""
HOUR_MS=3_600_000
MAX_CALENDAR_AGE_MS=22_200_000  # 6h + 10m bounded refresh overlap; schedule age, not quote age.

def evaluate_calendar(calendar,now_ms,*,source_verified=False):
    def result(status,reason,until=None,ids=()):
        return dict(policy='AVOID_HIGH_IMPACT_60M_BEFORE_60M_AFTER',status=status,
            reason=reason,entries_allowed=status=='CLEAR',supervise_existing_basket=True,
            retire_pending_entries=status!='CLEAR',blackout_until_utc_ms=until,
            matching_event_ids=list(ids),before_minutes=60,after_minutes=60,
            order_dispatch_authorized=False)
    if type(now_ms) is not int or now_ms<0:return result('UNKNOWN','INVALID_CLOCK')
    if source_verified is not True:return result('UNKNOWN','CALENDAR_SOURCE_UNVERIFIED')
    if not isinstance(calendar,dict) or calendar.get('schema')!='tradevice.calendar.utc.v1':
        return result('UNKNOWN','CALENDAR_UNAVAILABLE')
    if calendar.get('time_basis')!='UTC' or calendar.get('complete') is not True:
        return result('UNKNOWN','CALENDAR_TIME_OR_COVERAGE_UNVERIFIED')
    stamp=calendar.get('observed_utc_ms');start=calendar.get('coverage_start_utc_ms');end=calendar.get('coverage_end_utc_ms')
    if any(type(v) is not int or v<0 for v in (stamp,start,end)):
        return result('UNKNOWN','CALENDAR_TIMESTAMP_INVALID')
    if not -1000<=now_ms-stamp<=MAX_CALENDAR_AGE_MS:
        return result('UNKNOWN','CALENDAR_STALE_OR_FUTURE')
    if start>now_ms-HOUR_MS or end<now_ms+HOUR_MS:
        return result('UNKNOWN','CALENDAR_COVERAGE_INCOMPLETE')
    events=calendar.get('events')
    if not isinstance(events,list) or len(events)>10000:return result('UNKNOWN','CALENDAR_EVENTS_INVALID')
    windows=[];seen=set()
    for event in events:
        if not isinstance(event,dict):return result('UNKNOWN','CALENDAR_EVENT_INVALID')
        eid=event.get('id');impact=event.get('impact')
        if not isinstance(eid,str) or not eid or eid in seen or impact not in ('HIGH','MODERATE','LOW','NONE'):
            return result('UNKNOWN','CALENDAR_EVENT_INVALID')
        seen.add(eid)
        if impact!='HIGH':continue
        when=event.get('scheduled_utc_ms')
        if type(when) is not int or when<0 or event.get('time_confirmed') is not True:
            return result('UNKNOWN','HIGH_IMPACT_TIME_UNCONFIRMED')
        if not start<=when<=end:return result('UNKNOWN','EVENT_OUTSIDE_DECLARED_COVERAGE')
        windows.append((when-HOUR_MS,when+HOUR_MS,eid))
    merged=[]
    for left,right,eid in sorted(windows):
        if merged and left<=merged[-1][1]:
            merged[-1][1]=max(merged[-1][1],right);merged[-1][2].append(eid)
        else:merged.append([left,right,[eid]])
    for left,right,ids in merged:
        if left<=now_ms<=right:return result('BLACKOUT','HIGH_IMPACT_NEWS_WINDOW',right,ids)
    return result('CLEAR','NO_HIGH_IMPACT_WINDOW')


def supervised_step(engine,decision):
    """Research-only adapter integration. Caller must supply a SIMULATED broker.
    No live/demo broker dispatch is permitted by this integration entry point.
    A blackout durably suspends this cycle; clearing the calendar never resumes it.
    """
    from v51_engine_replay import HistoricalBroker
    if type(engine.adapter.mt5) is not HistoricalBroker:
        raise TypeError('RESEARCH_SIMULATED_BROKER_REQUIRED')
    from goldtrap_arc.config import ArcSafetyError
    if decision.get('entries_allowed') is True and not engine.state.get('news_entry_suspended'):
        return engine.step()
    if engine.state['state'].startswith('COMPLETE'):return engine.state['state']
    if not engine.state.get('news_entry_suspended'):
        engine.state.update(news_entry_suspended=True,news_reason=decision.get('reason'),block_next_cycle=True)
        intent=engine.state.get('adaptive_intent')
        if intent and intent.get('status')=='AUTHORIZED':intent['status']='DEFERRED_NEWS'
        engine.save()
        engine.ledger.append('NEWS_ENTRY_SUSPENDED',cycle_id=engine.state.get('cycle_id'),reason=decision.get('reason'))
    engine.identity()
    cycle=engine.state.get('cycle_id')
    if cycle:engine.adapter.reconcile_unresolved(cycle)
    # Fresh broker state is required before any simulated cancellation or close.
    snap=engine.adapter.snapshot();positions,orders=engine.owned(snap,reduction=True)
    for order in orders:engine.adapter.cancel(order)
    snap=engine.adapter.snapshot();positions,orders=engine.owned(snap,reduction=True)
    if orders:raise ArcSafetyError('NEWS_PENDING_RETIREMENT_UNRECONCILED')
    if engine.state.get('risk_exit_committed'):engine.risk_exit();return engine.state['state']
    if engine.state.get('target_exit_committed'):engine.target_coordinator('news supervision');return engine.state['state']
    if not positions:
        if cycle:
            # Preserve the real engine's history reconciliation for baskets with fills.
            if engine._finalize_flat_history():return engine.state['state']
            engine.mark_complete('COMPLETE_NEWS_RETIRED')
            return engine.state['state']
        return 'NEWS_BLOCKED_BEFORE_START'
    engine.owned(snap)
    if engine.exact_total_pl(snap)<=engine.cfg.hard_basket_loss_usd:
        engine.risk_exit();return engine.state['state']
    if engine.target_coordinator('news supervision target'):return engine.state['state']
    engine.protect(engine.adapter.snapshot())
    if engine.state['state'].startswith('COMPLETE'):return engine.state['state']
    return 'NEWS_SUPERVISION_ONLY'

from app.engine_diagnostics import project_engine,project_owned
N=1791918000000

def report():
 return dict(schema='tradevice.v51.engine.diagnostics.v1',status='ENGINE_REPORTED',source='V51_RUNNER_DIAGNOSTICS',
 read_only=True,order_dispatch_authorized=False,observed_ms=N,cycle_id='fixture-cycle',state='ACTIVE',
 hard_loss_usd=-120,target_usd=3.5,risk_exit_committed=False,broker_flat_reconciled=False,entry_suspended=False,
 pnl=dict(cycle_id='fixture-cycle',at_ms=N,tick_ms=N-100,value=-41,basis='ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED'),
 decision=dict(layer=6,candle_close_ms=N-20000,distance_points=1800,atr=2,body_atr=.6,body_range=.7,
 accepted=False,structural_reversal=False,reasons=['STRUCTURAL_REVERSAL_NOT_CONFIRMED']),
 authorization='AUTHORIZED',authorization_expires_ms=N+1000)

def test_values_and_dispatch_lock():
 x=project_engine(report(),N);assert x['pnl']['value']==-41;assert x['orderDispatchAuthorized'] is False
 assert x['decision']['reasons']==['STRUCTURAL_REVERSAL_NOT_CONFIRMED']

def test_stale_engine_erases_metrics():
 x=project_engine(report(),N+8001);assert x['status']=='ENGINE_REPORT_STALE';assert x['pnl'] is None

def test_fresh_heartbeat_cannot_renew_valuation():
 r=report();r['observed_ms']=N+6000;x=project_engine(r,N+6000);assert x['pnl'] is None
 assert x['authorization']=='EXPIRED'

def test_expiry_boundary():
 assert project_engine(report(),N+1000)['authorization']=='EXPIRED'

def test_foreign_cycle_and_forgery():
 for key,value in [('hard_loss_usd',-200),('order_dispatch_authorized',True),('broker_flat_reconciled',True)]:
  r=report();r[key]=value;assert project_engine(r,N)['status']=='ENGINE_REPORT_INVALID'
 r=report();r['pnl']['cycle_id']='other';assert project_engine(r,N)['pnl'] is None

def test_nonfinite_and_bool_rejected():
 for v in [float('nan'),float('inf'),True]:
  r=report();r['pnl']['value']=v;assert project_engine(r,N)['status']=='ENGINE_REPORT_INVALID'

def test_future_clock_and_old_decision():
 assert project_engine(report(),N-1)['status']=='ENGINE_REPORT_STALE'
 r=report();r['decision']['candle_close_ms']=N-120001;assert project_engine(r,N)['decision'] is None

def test_missing_no_zero_defaults():
 assert project_engine(None,N)['pnl'] is None
 assert project_engine({},N)['hardLossUsd'] is None

def test_owned_profit_not_cycle_net():
 e=dict(goldtrap_positions_count=2,goldtrap_orders_count=0)
 r=dict(basis='MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP',net_cycle_pnl_verified=False,currency='USD',positions=2,pending=0,value=-12)
 x=project_owned(r,e,'USD');assert x['value']==-12;assert x['netCyclePnlVerified'] is False
 r['positions']=1;assert project_owned(r,e,'USD') is None

def test_engine_extension_passes_signed_observer_projection():
 from tests.test_observer_telemetry import fixture,NOW
 from app.observer_telemetry import parse_observer
 r=report();shift=NOW-N
 r['observed_ms']+=shift;r['pnl']['at_ms']+=shift;r['pnl']['tick_ms']+=shift
 r['decision']['candle_close_ms']+=shift;r['authorization_expires_ms']+=shift
 x=parse_observer(fixture(engine_diagnostics=r),NOW)
 assert x['engineDiagnostics']['status']=='ENGINE_REPORTED'
 assert x['trustedForTradeAdmission'] is False


def test_distance_policy_binds_reviewed_limit_and_variable_target():
 raw=report();raw.update(policy='CLOSE_DISTANCE_RISK_V51',hard_loss_usd=-250,target_usd=4.2)
 result=project_engine(raw,N)
 assert result['hardLossUsd']==-250 and result['targetUsd']==4.2
 assert result['policy']=='CLOSE_DISTANCE_RISK_V51'
 assert project_engine(raw|{'policy':'UNKNN'},N)['status']=='ENGINE_REPORT_INVALID'


def test_atr_points_projection_is_distinct_from_profit_usd():
 raw=report()|dict(policy='CLOSE_DISTANCE_RISK_V51',hard_loss_usd=-250,tp_basis='ATR_PRICE_DISTANCE',tp_distance_price=4.2,tp_distance_points=4200,target_usd=42,target_price=4104.2)
 x=project_engine(raw,N)
 assert x['tpBasis']=='ATR_PRICE_DISTANCE' and x['tpDistancePoints']==4200 and x['targetUsd']==42
 assert project_engine(raw|{'target_usd':None},N)['targetUsd'] is None
 assert project_engine(raw|{'tp_distance_points':42},N)['status']=='ENGINE_REPORT_INVALID'


def test_dynamic_atr_profit_usd_and_mode_specific_hard_loss():
 for mult,loss in [(1,-250),(2,-350)]:
  r=report()|dict(policy='CLOSE_DISTANCE_RISK_V51',hard_loss_usd=loss,tp_basis='ATR_CURRENT_USD',tp_distance_price=None,tp_distance_points=None,tp_atr_value=3.1,tp_multiplier=mult,tp_atr_candle_ms=N-1000,tp_atr_fresh=True,target_usd=3.1*mult)
  x=project_engine(r,N);assert x['status']=='ENGINE_REPORTED';assert x['targetUsd']==3.1*mult;assert x['tpAtrFresh'] is True
  r['target_usd']=30;assert project_engine(r,N)['status']=='ENGINE_REPORT_INVALID'

def test_heartbeat_does_not_renew_atr_candle():
 r=report()|dict(policy='CLOSE_DISTANCE_RISK_V51',hard_loss_usd=-250,tp_basis='ATR_CURRENT_USD',tp_atr_value=4,tp_multiplier=1,tp_atr_candle_ms=N-120001,tp_atr_fresh=True,target_usd=4)
 assert project_engine(r,N)['tpAtrFresh'] is False

def test_historical_configuration_retains_timestamp_but_never_authority():
 raw=report();out=project_engine(raw,N+3600000)
 assert out['observedMs']==N and out['status']=='ENGINE_REPORT_STALE'
 assert out['hardLossUsd']==-120 and out['targetUsd']==3.5
 assert out['pnl'] is None and out['decision'] is None and out['authorization']=='UNKNOWN'
 assert out['brokerFlatReconciled'] is False and out['orderDispatchAuthorized'] is False
 assert project_engine(raw,N+604800001)['targetUsd'] is None

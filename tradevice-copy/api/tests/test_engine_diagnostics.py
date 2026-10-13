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

import hashlib,hmac,json,unittest
from app.observer_telemetry import (
 ObserverBuffer,ObserverRejected,parse_observer,verify_hmac,disconnected_market)

NOW=1791883200123
SECRET="ab"*32

def fixture(**mutations):
 p={
   "schema":"tradevice.v51.mt5.readonly.v1","source":"TRADEVICEPC_MT5_READ_ONLY",
   "collected_utc_ms":NOW,"read_only":True,"trading_ready":False,
   "order_dispatch_authorized":False,
   "broker":{"name":"Exness","server":"Exness-MT5Trial14","symbol":"XAUUSDm",
             "trade_mode":"DEMO","account_last4":"9834"},
   "market":{"bid":4199.5,"ask":4199.74,"spread_points":240,
             "point":0.001,"tick_time_utc_ms":NOW-500,
             "last_closed_m1_utc_ms":NOW-30000,"bars_used":15,
             "atr14_closed_m1":1.5,"volatility_atr_pct":0.0358},
   "costs":{"commission_round_turn_usd_per_lot":None,"slippage_points":None,
            "status":"NOT_VERIFIED"},
   "calendar":{"status":"NOT_CONNECTED","high_impact_window":None},
   "exposure":{"positions_count":0,"orders_count":0,"goldtrap_positions_count":0,
               "goldtrap_orders_count":0,"foreign_exposure_present":False},
   "observer":{"source_proof":"LOCAL_ONLY_NOT_REMOTE_ATTESTED",
               "quote_fresh":True,"closed_m1_fresh":True}}
 for path,value in mutations.items():
   obj=p
   names=path.split(".")
   for name in names[:-1]:obj=obj[name]
   obj[names[-1]]=value
 sig=hashlib.sha256(json.dumps(p,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 p["integrity_sha256_not_authentication"]=sig
 return json.dumps(p,sort_keys=True,separators=(",",":")).encode()

class Tests(unittest.TestCase):
 def test_verified_observation_is_display_only(self):
  x=parse_observer(fixture(),NOW+700)
  self.assertEqual(x["status"],"OBSERVED_READ_ONLY")
  self.assertFalse(x["trustedForTradeAdmission"])
  self.assertIsNone(x["slippagePoints"])
  self.assertIsNone(x["commissionUsdPerLot"])
 def test_expired_cache_erases_market_values(self):
  b=ObserverBuffer();self.assertIsNone(b.market(NOW)["bid"])
  b.receive(fixture(),NOW+500);self.assertEqual(b.market(NOW+500)["status"],"OBSERVED_READ_ONLY")
  self.assertEqual(b.market(NOW+10000)["status"],"NOT_CONNECTED")
 def test_duplicate_replay_blocked(self):
  b=ObserverBuffer();b.receive(fixture(),NOW+100)
  with self.assertRaisesRegex(ObserverRejected,"DUPLICATE"):b.receive(fixture(),NOW+500)
 def test_hmac_valid_and_invalid(self):
  raw=fixture();stamp=str(NOW)
  sig=hmac.new(bytes.fromhex(SECRET),stamp.encode()+b"\n"+raw,hashlib.sha256).hexdigest()
  verify_hmac(SECRET,stamp,sig,raw,NOW+500)
  with self.assertRaises(ObserverRejected):verify_hmac(SECRET,stamp,"0"*64,raw,NOW+500)
  with self.assertRaises(ObserverRejected):verify_hmac(SECRET,stamp,sig,raw,NOW+12000)
 def test_other_account_and_real_mode_denied(self):
  for m in ({"broker.account_last4":"0000"},{"broker.trade_mode":"REAL"}):
   with self.assertRaisesRegex(ObserverRejected,"IDENTITY_INVALID"):
    parse_observer(fixture(**m),NOW+100)
 def test_market_stale_invalid(self):
  with self.assertRaisesRegex(ObserverRejected,"QUOTE_OR_M1_STALE"):
   parse_observer(fixture(**{"market.tick_time_utc_ms":NOW-15000}),NOW+100)
 def test_future_or_stale_observer_invalid(self):
  with self.assertRaisesRegex(ObserverRejected,"CAPTURE_STALE_OR_FUTURE"):
   parse_observer(fixture(),NOW+12000)
 def test_costs_and_calendar_never_forged(self):
  for m in ({"calendar.status":"VERIFIED"},{"costs.slippage_points":0}):
   with self.assertRaisesRegex(ObserverRejected,"UNVERIFIED_COSTS_OR_CALENDAR"):
    parse_observer(fixture(**m),NOW+100)
 def test_start_flag_forgery_denied(self):
  with self.assertRaisesRegex(ObserverRejected,"SAFETY_MISMATCH"):
   parse_observer(fixture(order_dispatch_authorized=True),NOW+100)
 def test_spread_inconsistency_denied(self):
  with self.assertRaisesRegex(ObserverRejected,"SPREAD_INCONSISTENT"):
   parse_observer(fixture(**{"market.spread_points":1}),NOW+100)

class HardeningTests(unittest.TestCase):
 def test_replay_a_b_a_cannot_refresh_feed(self):
  b=ObserverBuffer();a=fixture()
  b.receive(a,NOW)
  b.receive(fixture(collected_utc_ms=NOW+1100),NOW+1100)
  with self.assertRaisesRegex(ObserverRejected,'OUT_OF_ORDER'):
   b.receive(a,NOW+2200)
 def test_signed_high_frequency_sender_is_limited(self):
  from app.observer_telemetry import ObserverRateLimited
  b=ObserverBuffer();b.receive(fixture(),NOW)
  with self.assertRaises(ObserverRateLimited):
   b.receive(fixture(collected_utc_ms=NOW+100),NOW+100)
  self.assertEqual(b.market(NOW+100)['status'],'OBSERVED_READ_ONLY')
 def test_transit_delay_is_part_of_quote_age(self):
  with self.assertRaisesRegex(ObserverRejected,'QUOTE_OR_M1_STALE'):
   parse_observer(fixture(),NOW+5000)
 def test_origin_cannot_claim_stale_quote_is_fresh(self):
  with self.assertRaisesRegex(ObserverRejected,'QUOTE_OR_M1_STALE'):
   parse_observer(fixture(**{'market.tick_time_utc_ms':NOW-2001}),NOW)
 def test_ttl_uses_tick_time_not_arrival_time(self):
  b=ObserverBuffer();b.receive(fixture(),NOW+4000)
  self.assertEqual(b.market(NOW+8501)['status'],'NOT_CONNECTED')
 def test_account_metrics_never_default_to_zero(self):
  x=parse_observer(fixture(),NOW)
  self.assertIsNone(x['equity']);self.assertIsNone(x['freeMargin'])
 def test_account_currency_and_margin_projection(self):
  a={'currency':'USD','equity':1000.,'margin':0.,'free_margin':1000.,'margin_level_pct':None}
  x=parse_observer(fixture(account_metrics=a),NOW)
  self.assertEqual(x['equity'],1000);self.assertIsNone(x['marginLevelPct'])
  for bad in [float('nan'),True]:
   with self.assertRaises(ObserverRejected):
    parse_observer(fixture(account_metrics={**a,'margin':bad}),NOW)
 def test_foreign_exposure_cannot_be_hidden(self):
  with self.assertRaisesRegex(ObserverRejected,'EXPOSURE_INCONSISTENT'):
   parse_observer(fixture(**{'exposure.positions_count':1}),NOW)
 def test_closed_bar_proof_recalculates_atr(self):
  end=(NOW//60000)*60000
  bars=[[end-(15-i)*60000,4200.,4201.,4199.,4200.5] for i in range(15)]
  args={'market.closed_m1_ohlc':bars,'market.atr_method':'SMA_TRUE_RANGE_14',
        'market.last_closed_m1_utc_ms':end,'market.atr14_closed_m1':2.,
        'market.volatility_atr_pct':round(2*100/4200.5,6)}
  self.assertTrue(parse_observer(fixture(**args),NOW)['atrRecomputed'])
  with self.assertRaisesRegex(ObserverRejected,'ATR_PROOF_MISMATCH'):
   parse_observer(fixture(**{**args,'market.atr14_closed_m1':1.9}),NOW)
  bars[-1][0]+=60000
  with self.assertRaisesRegex(ObserverRejected,'ATR_PROOF_INVALID'):
   parse_observer(fixture(**args),NOW)

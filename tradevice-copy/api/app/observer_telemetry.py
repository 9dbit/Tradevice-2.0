"""Ephemeral, authenticated staging-only read-only MT5 market display feed.

Does not persist to Postgres and never alters run_state or trade admission.
Cache expiry and process restart both fail closed. No broker order functionality.
"""
from .demo_batch import project_batch
from .engine_diagnostics import project_engine, project_owned, missing
import hashlib
import hmac
import json
import math
import re
import threading
from datetime import datetime, timezone

SCHEMA="tradevice.v51.mt5.readonly.v1"
EXPECTED_SERVER="Exness-MT5Trial14"
EXPECTED_SYMBOL="XAUUSDm"
EXPECTED_SUFFIX="9834"
SOURCE="TRADEVICEPC_MT5_READ_ONLY"
FEED_TTL_MS=9000
BODY_MAX_BYTES=8192
SIGNATURE_WINDOW_MS=10000
MIN_RECEIVE_INTERVAL_MS=1000

class ObserverRateLimited(ValueError):
    pass

class ObserverRejected(ValueError):
    pass

def _number(v, key, low=None, high=None):
    if type(v) not in (int, float) or not math.isfinite(v):
        raise ObserverRejected("INVALID_"+key)
    if (low is not None and v < low) or (high is not None and v > high):
        raise ObserverRejected("RANGE_"+key)
    return float(v)

def _integer(v,key):
    if type(v) is not int or v < 0:
        raise ObserverRejected("INVALID_"+key)
    return v

def _utc(ms):
    return datetime.fromtimestamp(ms/1000, timezone.utc).isoformat().replace("+00:00","Z")

def verify_hmac(secret, timestamp, signature, body, server_ms):
    if not re.fullmatch(r"[0-9a-f]{64}",secret or ""):
        raise ObserverRejected("OBSERVER_SECRET_NOT_CONFIGURED")
    if not re.fullmatch(r"[0-9]{13}",timestamp or "") or not re.fullmatch(r"[0-9a-f]{64}",signature or ""):
        raise ObserverRejected("OBSERVER_HMAC_HEADER_INVALID")
    if abs(server_ms-int(timestamp)) > SIGNATURE_WINDOW_MS:
        raise ObserverRejected("OBSERVER_SIGNATURE_EXPIRED")
    expected=hmac.new(bytes.fromhex(secret),timestamp.encode()+b"\n"+body,hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,signature):
        raise ObserverRejected("OBSERVER_SIGNATURE_INVALID")

def parse_observer(raw, server_ms):
    if len(raw)>BODY_MAX_BYTES:
        raise ObserverRejected("OBSERVER_BODY_TOO_LARGE")
    try:
        packet=json.loads(raw)
    except (UnicodeError,ValueError,TypeError):
        raise ObserverRejected("OBSERVER_JSON_INVALID") from None
    if not isinstance(packet,dict):
        raise ObserverRejected("OBSERVER_NOT_OBJECT")
    if packet.get("schema")!=SCHEMA or packet.get("source")!=SOURCE:
        raise ObserverRejected("OBSERVER_SCHEMA_UNEXPECTED")
    if packet.get("read_only") is not True or packet.get("trading_ready") is not False or packet.get("order_dispatch_authorized") is not False:
        raise ObserverRejected("OBSERVER_EXECUTION_SAFETY_MISMATCH")
    digest=packet.get("integrity_sha256_not_authentication")
    if not isinstance(digest,str) or not re.fullmatch(r"[0-9a-f]{64}",digest):
        raise ObserverRejected("OBSERVER_INTEGRITY_MISSING")
    body=dict(packet)
    body.pop("integrity_sha256_not_authentication")
    actual=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    if not hmac.compare_digest(digest,actual):
        raise ObserverRejected("OBSERVER_INTEGRITY_INVALID")
    br=packet.get("broker")
    market=packet.get("market")
    costs=packet.get("costs")
    calendar=packet.get("calendar")
    exposure=packet.get("exposure")
    observer=packet.get("observer")
    for name,o in (("broker",br),("market",market),("costs",costs),("calendar",calendar),("exposure",exposure),("observer",observer)):
        if not isinstance(o,dict):
            raise ObserverRejected("OBSERVER_SECTION_MISSING_"+name)
    if br.get("server")!=EXPECTED_SERVER or br.get("symbol")!=EXPECTED_SYMBOL or br.get("trade_mode")!="DEMO" or br.get("account_last4")!=EXPECTED_SUFFIX:
        raise ObserverRejected("OBSERVER_DEMO_IDENTITY_INVALID")
    if costs.get("commission_round_turn_usd_per_lot") is not None or costs.get("slippage_points") is not None or calendar.get("status")!="NOT_CONNECTED":
        raise ObserverRejected("OBSERVER_UNVERIFIED_COSTS_OR_CALENDAR")
    if observer.get("source_proof")!="LOCAL_ONLY_NOT_REMOTE_ATTESTED":
        raise ObserverRejected("OBSERVER_LOCAL_SOURCE_FLAG_INVALID")
    collected=_integer(packet.get("collected_utc_ms"),"COLLECTED")
    ticktime=_integer(market.get("tick_time_utc_ms"),"TICK")
    lastclosed=_integer(market.get("last_closed_m1_utc_ms"),"BAR")
    if not 0 <= server_ms-collected <= SIGNATURE_WINDOW_MS:
        raise ObserverRejected("OBSERVER_CAPTURE_STALE_OR_FUTURE")
    if not 0 <= collected-ticktime <= 2000 or not 0 <= server_ms-ticktime <= 5000 or not 0 <= server_ms-lastclosed <= 90000:
        raise ObserverRejected("OBSERVER_QUOTE_OR_M1_STALE")
    if market.get("bars_used")!=15 or type(market.get("bars_used")) is not int:
        raise ObserverRejected("OBSERVER_M1_PROOF_INCOMPLETE")
    bid=_number(market.get("bid"),"BID",low=1)
    ask=_number(market.get("ask"),"ASK",low=1)
    point=_number(market.get("point"),"POINT",low=0.000001,high=10)
    atr=_number(market.get("atr14_closed_m1"),"ATR",low=0.000001,high=1000)
    spread=_number(market.get("spread_points"),"SPREAD",low=0,high=200000)
    vol=_number(market.get("volatility_atr_pct"),"VOLATILITY",low=0,high=100)
    if ask<bid or abs((ask-bid)/point-spread)>0.55:
        raise ObserverRejected("OBSERVER_BID_ASK_SPREAD_INCONSISTENT")
    if observer.get("quote_fresh") is not True or observer.get("closed_m1_fresh") is not True:
        raise ObserverRejected("OBSERVER_NOT_FRESH_AT_ORIGIN")
    for k in ("positions_count","orders_count","goldtrap_positions_count","goldtrap_orders_count"):
        _integer(exposure.get(k),"EXPOSURE_"+k)
    if exposure["goldtrap_positions_count"]>exposure["positions_count"] or exposure["goldtrap_orders_count"]>exposure["orders_count"]:
        raise ObserverRejected("OBSERVER_EXPOSURE_INCONSISTENT")
    foreign=(exposure["goldtrap_positions_count"]!=exposure["positions_count"] or
             exposure["goldtrap_orders_count"]!=exposure["orders_count"])
    if exposure.get("foreign_exposure_present") is not foreign:
        raise ObserverRejected("OBSERVER_EXPOSURE_INCONSISTENT")
    # Optional extension: older senders remain display-only with unknown metrics.
    account=packet.get("account_metrics",{})
    caps=packet.get("broker_capabilities",{})
    if not isinstance(account,dict) or not isinstance(caps,dict):
        raise ObserverRejected("OBSERVER_ACCOUNT_OR_CAPABILITIES_INVALID")
    def optional(obj,key,low=None):
        return None if obj.get(key) is None else _number(obj[key],key,low=low)
    currency=account.get("currency")
    if currency is not None and (not isinstance(currency,str) or not re.fullmatch(r"[A-Z]{3,8}",currency)):
        raise ObserverRejected("OBSERVER_CURRENCY_INVALID")
    equity=optional(account,"equity")
    margin=optional(account,"margin",0)
    free=optional(account,"free_margin")
    level=optional(account,"margin_level_pct",0)
    if margin==0 and level is not None:
        raise ObserverRejected("OBSERVER_ZERO_MARGIN_LEVEL_INVALID")
    capabilities={key:optional(caps,key,0) for key in (
        "volume_min","volume_max","volume_step","trade_stops_level",
        "trade_freeze_level","trade_mode","filling_mode","order_mode")}
    proof=market.get("closed_m1_ohlc")
    atr_verified=False
    if proof is not None:
        if not isinstance(proof,list) or len(proof)!=15 or market.get("atr_method")!="SMA_TRUE_RANGE_14":
            raise ObserverRejected("OBSERVER_ATR_PROOF_INVALID")
        bars=[]
        for row in proof:
            if not isinstance(row,list) or len(row)!=5:
                raise ObserverRejected("OBSERVER_ATR_PROOF_INVALID")
            t=_integer(row[0],"BAR_TIME")
            o,h,l,c=[_number(v,"OHLC",low=0.000001) for v in row[1:]]
            if t%60000 or h<max(o,c) or l>min(o,c) or h<=l or (bars and t-bars[-1][0]!=60000):
                raise ObserverRejected("OBSERVER_ATR_PROOF_INVALID")
            bars.append((t,o,h,l,c))
        recomputed=sum(max(b[2]-b[3],abs(b[2]-a[4]),abs(b[3]-a[4])) for a,b in zip(bars,bars[1:]))/14
        if bars[-1][0]+60000!=lastclosed or abs(recomputed-atr)>0.000001 or abs(recomputed*100/bars[-1][4]-vol)>0.000001:
            raise ObserverRejected("OBSERVER_ATR_PROOF_MISMATCH")
        atr_verified=True
    # Return only a minimal, bounded, non-execution display projection.
    return {
        "demoBatch":project_batch(packet.get("demo_batch"),server_ms),
        "engineDiagnostics":project_engine(packet.get("engine_diagnostics"),server_ms),
        "ownedPositionPnl":project_owned(packet.get("owned_position_pnl"),exposure,currency),
        "status":"OBSERVED_READ_ONLY","source":"SIGNED_MT5_STAGING_READ_ONLY",
        "brokerName":str(br.get("name") or "Exness")[:70],
        "accountMode":"DEMO","symbol":EXPECTED_SYMBOL,
        "observedAt":_utc(ticktime),"bid":round(bid,6),"ask":round(ask,6),
        "pointSize":point,"spreadPoints":round(spread,3),
        "commissionUsdPerLot":None,"slippagePoints":None,
        "volatilityPct":round(vol,6),"volatilityWindow":"ATR14 / last M1 close",
        "atr14":round(atr,6),"atrTimeframe":"M1",
        "atrRecomputed":atr_verified,"accountCurrency":currency,
        "equity":equity,"margin":margin,"freeMargin":free,"marginLevelPct":level,
        "positionsCount":exposure["positions_count"],"pendingOrdersCount":exposure["orders_count"],
        "foreignExposure":foreign,"brokerCapabilities":capabilities,
        "executionAdapter":"INTERNAL_PAPER_ONLY",
        "trustedForTradeAdmission":False
    }

def disconnected_market():
    return {
        "demoBatch":None,"engineDiagnostics":missing(),"ownedPositionPnl":None,
        "status":"NOT_CONNECTED","source":"NONE","brokerName":None,
        "accountMode":None,"symbol":None,"observedAt":None,"bid":None,"ask":None,
        "pointSize":None,"spreadPoints":None,"commissionUsdPerLot":None,
        "slippagePoints":None,"volatilityPct":None,"volatilityWindow":None,
        "atr14":None,"atrTimeframe":None,"executionAdapter":"INTERNAL_PAPER_ONLY",
        "trustedForTradeAdmission":False,
        "atrRecomputed":False,"accountCurrency":None,"equity":None,
        "margin":None,"freeMargin":None,"marginLevelPct":None,
        "positionsCount":None,"pendingOrdersCount":None,"foreignExposure":None,
        "brokerCapabilities":None,
    }

class ObserverBuffer:
    def __init__(self):
        self._lock=threading.Lock()
        self._market=None
        self._batch=None
        self._received_ms=0
        self._payload_digest=None
        self._collected_ms=-1
        self._tick_ms=0

    def receive(self, raw, now_ms):
        projected=parse_observer(raw,now_ms)
        digest=hashlib.sha256(raw).hexdigest()
        with self._lock:
            if self._payload_digest==digest:
                raise ObserverRejected("OBSERVER_DUPLICATE_PACKET")
            collected=json.loads(raw)["collected_utc_ms"]
            if collected<=self._collected_ms:
                raise ObserverRejected("OBSERVER_OUT_OF_ORDER_PACKET")
            if self._market is not None and now_ms-self._received_ms<MIN_RECEIVE_INTERVAL_MS:
                raise ObserverRateLimited("OBSERVER_RATE_LIMITED")
            candidate=projected.get("demoBatch")
            if candidate is not None:
                if self._batch is None or candidate['observed_ms']>=self._batch['observed_ms']:
                    self._batch=candidate
                else:
                    projected['demoBatch']=None
            self._market=projected
            self._received_ms=now_ms
            self._payload_digest=digest
            self._collected_ms=collected
            self._tick_ms=int(datetime.fromisoformat(projected["observedAt"].replace("Z","+00:00")).timestamp()*1000)

        return projected.get("demoBatch")

    def batch(self,now_ms):
        # Closed results are historical evidence, independent of executable quote TTL.
        # The durable PC journal replays this bounded projection after API restart.
        with self._lock:
            return project_batch(self._batch,now_ms)

    def market(self,now_ms):
        with self._lock:
            if (self._market is None or now_ms-self._tick_ms>FEED_TTL_MS
                  or now_ms<self._received_ms-1000):
                return disconnected_market()
            return dict(self._market)

"""V5.1 MT5 demo read-only snapshot. No trading engine import or network transfer."""
import hashlib
import json
import math
import os
import tempfile
import time
from pathlib import Path
from v51_recovery_display import read_diagnostics
from v51_batch_direction import read_batch
from v51_market_preflight import evaluate

OUTPUT = Path(r"D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013\read_only\mt5_snapshot.json")
TERMINAL = r"C:\Program Files\MetaTrader 5\terminal64.exe"
EXPECTED_SERVER = "Exness-MT5Trial14"
SYMBOL = "XAUUSDm"
MAGIC = 8802001
SCHEMA = "tradevice.v51.mt5.readonly.v1"

def finite(v, label):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
        raise ValueError("INVALID_" + label)
    return float(v)

def optional_number(obj, key, low=None):
    value = getattr(obj, key, None)
    if value is None:
        return None
    value = finite(value, key.upper())
    if low is not None and value < low:
        raise ValueError("INVALID_" + key.upper())
    return value

def owned_pnl(positions, count, pending, currency):
    try:
        value=sum(finite(getattr(p,"profit",None),"POSITION_PROFIT")+
                  finite(getattr(p,"swap",None),"POSITION_SWAP")
                  for p in positions if int(p.magic)==MAGIC and p.symbol==SYMBOL)
    except (ValueError,TypeError,AttributeError):
        return None  # Optional valuation must not suppress a valid market snapshot.
    return dict(basis="MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP",currency=currency,
                value=value,positions=count,pending=pending,net_cycle_pnl_verified=False)

def capture(api, now, clock=None):
    if not api.initialize(path=TERMINAL, timeout=5000):
        raise ValueError("TERMINAL_CONNECTION_FAILED")
    try:
        a, terminal = api.account_info(), api.terminal_info()
        if a is None or terminal is None:
            raise ValueError("ACCOUNT_OR_TERMINAL_MISSING")
        if str(a.server) != EXPECTED_SERVER or a.trade_mode != api.ACCOUNT_TRADE_MODE_DEMO:
            raise ValueError("EXPECTED_DEMO_ACCOUNT_MISMATCH")
        if str(a.login)[-4:] != "9834":
            raise ValueError("EXPECTED_DEMO_ACCOUNT_FINGERPRINT_MISMATCH")
        if not terminal.connected:
            raise ValueError("TERMINAL_DISCONNECTED")
        si, tick = api.symbol_info(SYMBOL), api.symbol_info_tick(SYMBOL)
        if si is None or tick is None:
            raise ValueError("SYMBOL_OR_TICK_MISSING")
        point = finite(si.point, "POINT")
        tick_size = finite(si.trade_tick_size, "TICK_SIZE")
        tick_value = finite(si.trade_tick_value, "TICK_VALUE")
        bid, ask = finite(tick.bid, "BID"), finite(tick.ask, "ASK")
        if min(point, tick_size, tick_value, bid) <= 0 or ask < bid:
            raise ValueError("INVALID_BROKER_QUOTE_OR_SPEC")
        tms = int(tick.time_msc)
        age = now - tms
        if age < -1000:
            raise ValueError("CLOCK_OR_TICK_FUTURE")
        raw = api.copy_rates_from_pos(SYMBOL, api.TIMEFRAME_M1, 1, 32)
        if raw is None or len(raw) < 15:
            raise ValueError("INSUFFICIENT_CLOSED_M1")
        bars = []
        for r in raw:
            t = int(r["time"])*1000
            o,h,l,c = [finite(r[k], k.upper()) for k in ("open", "high", "low", "close")]
            if t % 60000 or l > min(o,c) or h < max(o,c) or h <= l:
                raise ValueError("INVALID_M1_OHLC")
            bars.append((t,o,h,l,c))
        bars = sorted(bars)[-15:]
        if any(b[0]-a[0]!=60000 for a,b in zip(bars,bars[1:])):
            raise ValueError("GAPPED_OR_DUPLICATE_M1")
        close_ms=bars[-1][0]+60000
        if close_ms>now:
            raise ValueError("FORMING_M1_NOT_ALLOWED")
        true_ranges=[]
        for i in range(1,15):
            _,_,hi,lo,cl=bars[i]
            prev=bars[i-1][4]
            true_ranges.append(max(hi-lo,abs(hi-prev),abs(lo-prev)))
        atr=sum(true_ranges)/14.
        if atr<=0:
            raise ValueError("ATR14_UNAVAILABLE")
        pos,orders=api.positions_get(),api.orders_get()
        if pos is None or orders is None:
            raise ValueError("EXPOSURE_READ_FAILED")
        owned_pos=sum(int(p.magic)==MAGIC and p.symbol==SYMBOL for p in pos)
        owned_ord=sum(int(o.magic)==MAGIC and o.symbol==SYMBOL for o in orders)
        # Display-only regime evidence remains available while a basket is active.
        # Failure of this optional indicator never suppresses P/L or close telemetry.
        regime=None
        try:
            regime_now=(clock() if clock else now)/1000
            _,_,regime=evaluate(api.copy_rates_from_pos(SYMBOL,api.TIMEFRAME_M1,0,1600),
                api.copy_rates_from_pos(SYMBOL,api.TIMEFRAME_M5,0,300),regime_now,point)
        except Exception:pass
        # Measure freshness after all blocking reads, not before initialize().
        completed = clock() if clock else now
        if completed < now or completed-now > 5000:
            raise ValueError("CAPTURE_CLOCK_OR_DURATION_INVALID")
        age = completed-tms
        account = {
            "currency":str(getattr(a,"currency",""))[:8] or None,
            "equity":optional_number(a,"equity"),
            "margin":optional_number(a,"margin",0),
            "free_margin":optional_number(a,"margin_free"),
            "margin_level_pct":optional_number(a,"margin_level",0),
        }
        if account["margin"] == 0:
            account["margin_level_pct"] = None
        capabilities = {key:optional_number(si,key,0) for key in (
            "volume_min","volume_max","volume_step","trade_stops_level",
            "trade_freeze_level","trade_mode","filling_mode","order_mode")}
        result={
          "schema":SCHEMA,"source":"TRADEVICEPC_MT5_READ_ONLY",
          "collected_utc_ms":completed,"read_only":True,
          "capture_duration_ms":completed-now,"market_regime":regime,
          "account_metrics":account,"broker_capabilities":capabilities,
          "engine_diagnostics":read_diagnostics(completed),
          "demo_batch":read_batch(),
          "owned_position_pnl":owned_pnl(pos,owned_pos,owned_ord,account["currency"]),
          "broker":{"name":str(getattr(a,"company","Exness"))[:64],
                    "server":str(a.server),"symbol":SYMBOL,"trade_mode":"DEMO",
                    "account_last4":str(a.login)[-4:]},
          "market":{"bid":bid,"ask":ask,
                    "spread_points":round((ask-bid)/point,3),
                    "point":point,"tick_size":tick_size,"tick_value_per_lot":tick_value,
                    "tick_time_utc_ms":tms,"quote_age_ms":age,
                    "atr14_closed_m1":round(atr,6),
                    "volatility_atr_pct":round(atr*100/bars[-1][4],6),
                    "last_closed_m1_utc_ms":close_ms,
                    "closed_m1_age_ms":completed-close_ms,"bars_used":15,
                    "atr_method":"SMA_TRUE_RANGE_14",
                    "closed_m1_ohlc":[list(b) for b in bars]},
          "exposure":{"positions_count":len(pos),"orders_count":len(orders),
                      "goldtrap_positions_count":owned_pos,
                      "goldtrap_orders_count":owned_ord,
                      "foreign_exposure_present":owned_pos!=len(pos) or owned_ord!=len(orders)},
          "costs":{"commission_round_turn_usd_per_lot":None,
                   "slippage_points":None,"status":"NOT_VERIFIED"},
          "calendar":{"status":"NOT_CONNECTED","high_impact_window":None},
          "observer":{"source_proof":"LOCAL_ONLY_NOT_REMOTE_ATTESTED",
                      "quote_fresh":0<=age<=2000,
                      "closed_m1_fresh":0<=completed-close_ms<=90000},
          "trading_ready":False,"order_dispatch_authorized":False}
        result["status"]="LOCAL_FRESH_NOT_ATTESTED" if (
            result["observer"]["quote_fresh"] and result["observer"]["closed_m1_fresh"]
        ) else "LOCAL_STALE_OR_INCOMPLETE"
        body=json.dumps(result,sort_keys=True,separators=(",",":")).encode("utf-8")
        result["integrity_sha256_not_authentication"]=hashlib.sha256(body).hexdigest()
        return result
    finally:
        api.shutdown()

def main():
    now=time.time_ns()//1000000
    try:
        import MetaTrader5 as mt5
        result=capture(mt5,now,clock=lambda:time.time_ns()//1000000)
    except ValueError as e:
        result={"schema":SCHEMA,"collected_utc_ms":now,"status":str(e)[:80],
                "read_only":True,"trading_ready":False,"order_dispatch_authorized":False}
    except Exception:
        result={"schema":SCHEMA,"collected_utc_ms":now,"status":"OBSERVER_EXCEPTION",
                "read_only":True,"trading_ready":False,"order_dispatch_authorized":False}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix="v51_observer_",suffix=".json",dir=str(OUTPUT.parent))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(result,f,sort_keys=True,indent=2)
            f.write("\n")
        os.replace(tmp,OUTPUT)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    print("OBSERVER_STATUS="+str(result["status"]))
    print("READ_ONLY=True")
    print("TRADING_READY=False")
    print("SNAPSHOT_PATH="+str(OUTPUT))
    return 0 if str(result["status"]).startswith("LOCAL_") else 2

if __name__=="__main__":
    raise SystemExit(main())

"""Read-only historical ATR/ADX admission replay for the V5.1 research clone.

Replays the EXACT reviewed v51_market_preflight.evaluate() gate as of each
journaled entry time, and samples five-minute market windows for proxy checks.
Does not reconstruct trades, send orders or alter journals. Output contains
redacted summaries, not account credentials or broker ticket IDs.
"""
import argparse
import bisect
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

UTC = timezone.utc
POLICY_HASH = "050a974e7047246d321114058a77d1d0ea57147383cff944627f0ecc8e1fb392"
LOSS_CYCLE = "18c3ac11"
SOURCE_BATCH = "v51_dashboard_7f8c70b59072425bb2243404f7a79989"


def utc(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC).timestamp()


def load_gate(root):
    target = root / "v51_market_preflight.py"
    if hashlib.sha256(target.read_bytes()).hexdigest() != POLICY_HASH:
        raise ValueError("REPLAY_POLICY_FINGERPRINT_MISMATCH")
    sys.path.insert(0, str(root))
    from v51_market_preflight import evaluate
    return evaluate


def find_cycles(root, start, end):
    records = []
    for batch in sorted((root / "logs" / "arc_v1").glob("v51_dashboard_*/batch_manifest.json")):
        manifest = json.loads(batch.read_text(encoding="utf-8"))
        for slot in manifest.get("slots", []):
            result = slot.get("result") or {}
            stamp = result.get("start_time")
            if not stamp:
                continue
            when = utc(stamp)
            if not start <= when < end:
                continue
            if result.get("broker_flat_confirmed") is not True or result.get("realized_pl_usd") is None:
                continue
            records.append({
                "batch": batch.parent.name, "cycle": result.get("cycle_id"),
                "number": result.get("cycle_number"), "when": when,
                "timeUtc": stamp, "side": result.get("side"), "layers": result.get("layers"),
                "peakLots": result.get("peak_exposure_lots"),
                "pnlUsd": float(result["realized_pl_usd"]), "outcome": result.get("outcome"),
                "endedUtc": result.get("end_time"),
            })
    return sorted(records, key=lambda x: (x["when"], x["cycle"] or ""))


def rates_from_mt5(mt5, symbol, timeframe, start, end):
    rows = mt5.copy_rates_range(symbol, timeframe, datetime.fromtimestamp(start, UTC),
                               datetime.fromtimestamp(end, UTC))
    if rows is None:
        raise RuntimeError("HISTORICAL_MARKET_DATA_UNAVAILABLE")
    bars = [{k: int(r[k]) if k == "time" else float(r[k])
             for k in ("time", "open", "high", "low", "close")} for r in rows]
    if len(bars) < 1600 if timeframe == mt5.TIMEFRAME_M1 else len(bars) < 300:
        raise RuntimeError("HISTORICAL_DATA_TOO_SHORT")
    if any(a["time"] >= b["time"] for a, b in zip(bars, bars[1:])):
        raise ValueError("HISTORICAL_DATA_NOT_SORTED")
    return bars


def gate_as_of(evaluate, m1, m5, times1, times5, now, point):
    # Includes the forming bar, like MT5 copy_rates_from_pos, but the audited
    # evaluator itself discards every candle whose closing time is > now.
    a = bisect.bisect_right(times1, math.floor(now))
    b = bisect.bisect_right(times5, math.floor(now))
    try:
        checks, reasons, detail = evaluate(m1[max(0, a - 1600):a],
                                           m5[max(0, b - 300):b], now, point)
        return {"atr": bool(checks["atr"]), "adx": bool(checks["adx"]),
                "passes": bool(all(checks.values())), "reason": reasons,
                "atrPrice": round(detail["atrM1"], 5),
                "atrWindow": [round(detail["minAtr"], 5), round(detail["maxAtr"], 5)],
                "adxM1Max3": round(detail["adxM1Max3"], 3),
                "adxM5Max3": round(detail["adxM5Max3"], 3),
                "evidenceClosedMs": [detail["m1ClosedMs"], detail["m5ClosedMs"]]}
    except (ValueError, TypeError, IndexError, ZeroDivisionError) as exc:
        return {"passes": False, "atr": None, "adx": None, "reason": [str(exc)[:90]],
                "insufficientOrStale": True}


def future_range(m1, times, now, minutes):
    left = bisect.bisect_left(times, int(now // 60) * 60)
    right = bisect.bisect_left(times, int(now // 60) * 60 + minutes * 60)
    segment = m1[left:right]
    if len(segment) != minutes or any(a["time"] + 60 != b["time"] for a, b in zip(segment, segment[1:])):
        return None
    return round(max(b["high"] for b in segment) - min(b["low"] for b in segment), 5)


def groups(cycles):
    out = {}
    for label, set_ in (("all_recorded", cycles),
                        ("gate_pass", [c for c in cycles if c["gate"]["passes"]]),
                        ("gate_block", [c for c in cycles if not c["gate"]["passes"]]),
                        ("gate_data_valid", [c for c in cycles if not c["gate"].get("insufficientOrStale")])):
        if not set_:
            out[label] = {"n": 0}
            continue
        pnls = [x["pnlUsd"] for x in set_]
        out[label] = {"n": len(set_), "wins": sum(x > 0 for x in pnls),
                      "losses": sum(x < 0 for x in pnls), "netUsd": round(sum(pnls), 2),
                      "meanUsd": round(sum(pnls) / len(pnls), 2),
                      "minUsd": round(min(pnls), 2),
                      "maxPeakLots": max(x["peakLots"] for x in set_)}
    return out


def market_windows(evaluate, m1, m5, times1, times5, point, start, end, interval=5):
    count = Counter()
    ranges = {"gate_pass": [], "gate_block": []}
    bars = 0
    for when in range((int(start) + 299) // 300 * 300 + 15, int(end) - 900, interval * 60):
        outcome = gate_as_of(evaluate, m1, m5, times1, times5, when, point)
        if outcome.get("insufficientOrStale"):
            count["unavailable"] += 1
            continue
        bars += 1
        key = "gate_pass" if outcome["passes"] else "gate_block"
        count[key] += 1
        if not outcome["atr"]:
            count["atr_block"] += 1
        if not outcome["adx"]:
            count["adx_block"] += 1
        width = future_range(m1, times1, when, 15)
        if width is not None:
            ranges[key].append(width)
    return {"samples5m": bars, "gates": dict(count),
            "future15mPriceRangeProxy": {
                key: {"n": len(v), "mean": round(sum(v) / len(v), 5) if v else None,
                      "median": round(sorted(v)[len(v) // 2], 5) if v else None}
                for key, v in ranges.items()},
            "note": "Future range is a volatility proxy, NOT realized strategy PnL or a fill simulation."}


def incident_deals(mt5, start, end):
    first = datetime.fromtimestamp(start, UTC)
    last = datetime.fromtimestamp(end, UTC)
    deals = mt5.history_deals_get(first, last)
    if deals is None:
        return {"status": "BROKER_HISTORY_UNAVAILABLE"}
    owned = []
    prefix = "GT_ARC_V1:" + LOSS_CYCLE + ":"
    for deal in deals:
        if int(getattr(deal, "magic", -1)) == 8802001 and str(getattr(deal, "comment", "")).startswith(prefix) and int(getattr(deal, "entry", -1)) == 0:
            owned.append(deal)
    ids = {int(d.position_id) for d in owned}
    related = [d for d in deals if int(getattr(d, "position_id", -1)) in ids]
    entries = [{"timeUtc": datetime.fromtimestamp(d.time_msc / 1000, UTC).isoformat(),
                "layer": str(d.comment)[-3:], "lots": round(float(d.volume), 2),
                "price": round(float(d.price), 3)} for d in sorted(owned, key=lambda d: d.time_msc)]
    fees = sum(float(d.commission) + float(d.fee) + float(d.swap) for d in related)
    profit = sum(float(d.profit) + float(d.commission) + float(d.fee) + float(d.swap) for d in related)
    return {"status": "AVAILABLE", "entryCount": len(owned),
            "closedDealCount": len(related) - len(owned),
            "volumeEntryTotalLots": round(sum(float(d.volume) for d in owned), 2),
            "totalPnLIncludingCostsUsd": round(profit, 2),
            "costsUsd": round(fees, 2), "entries": entries}


def execute(root, mt5, start, end):
    evaluate = load_gate(root)
    if not mt5.initialize():
        raise RuntimeError("MT5_READONLY_INITIALIZATION_FAILED")
    try:
        account = mt5.account_info()
        symbol = mt5.symbol_info("XAUUSDm")
        if (not account or account.login != 416429834 or account.server != "Exness-MT5Trial14"
                or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO
                or not symbol or symbol.name != "XAUUSDm"):
            raise RuntimeError("PINNED_DEMO_IDENTITY_MISMATCH")
        m1 = rates_from_mt5(mt5, "XAUUSDm", mt5.TIMEFRAME_M1, start, end)
        m5 = rates_from_mt5(mt5, "XAUUSDm", mt5.TIMEFRAME_M5, start, end)
        times1 = [int(x["time"]) for x in m1]
        times5 = [int(x["time"]) for x in m5]
        events = find_cycles(root, start, end)
        for e in events:
            e["gate"] = gate_as_of(evaluate, m1, m5, times1, times5, e["when"], float(symbol.point))
        source = next((x for x in events if x["cycle"] == LOSS_CYCLE and x["batch"] == SOURCE_BATCH), None)
        if source is None:
            raise RuntimeError("PINNED_L5_JOURNAL_NOT_FOUND")
        deals = incident_deals(mt5, source["when"] - 60, utc(source["endedUtc"]) + 60)
        windows = market_windows(evaluate, m1, m5, times1, times5, float(symbol.point), start, end)
        summary = {
            "policy": "V51_RANGE_PREFLIGHT_20261016", "policySha256": POLICY_HASH,
            "source": "local broker M1/M5 + immutable cycle_summary.json; no broker writes",
            "periodUtc": {"start": datetime.fromtimestamp(start, UTC).isoformat(),
                          "end": datetime.fromtimestamp(end, UTC).isoformat()},
            "bars": {"m1": len(m1), "m5": len(m5),
                     "m1From": datetime.fromtimestamp(times1[0], UTC).isoformat(),
                     "m1To": datetime.fromtimestamp(times1[-1], UTC).isoformat()},
            "cohorts": groups(events),
            "cycles": [{k:v for k,v in e.items() if k not in ("when", "endedUtc")}
                       for e in events],
            "lossL5": {"cycle": LOSS_CYCLE, "gate": source["gate"],
                       "reportedPnL": source["pnlUsd"], "peakLots": source["peakLots"],
                       "brokerDeals": deals},
            "sampledMarket": windows,
            "method": ["Only bars closed at observation time enter ATR/ADX calculations.",
                       "Recorded cycle PnL is observational; a filtered historical selection is not a new-execution PnL backtest.",
                       "No tick-level bid/ask, spreads, news window replays or limit fill emulation.",
                       "One trading-week window; no out-of-sample or regime robustness claim."]
        }
        return summary
    finally:
        mt5.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--start", default="2026-10-12T00:00:00+00:00")
    parser.add_argument("--end", default="2026-10-17T00:00:00+00:00")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    if out.exists():
        raise ValueError("REPORT_ALREADY_EXISTS")
    import MetaTrader5 as mt5
    result = execute(Path(args.root), mt5, utc(args.start), utc(args.end))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(out), "counts": result["cohorts"],
                      "lossL5": result["lossL5"], "sampledMarket": result["sampledMarket"],
                      "bars": result["bars"]}, default=str))


if __name__ == "__main__":
    main()

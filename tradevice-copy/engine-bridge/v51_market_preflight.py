"""Read-only, closed-candle entry gate. Never supervises an existing basket.

ATR uses the engine's SMA(TR,14) on completed M1 candles. An absolute,
inclusive 0.00-1.80 price-unit band replaces the rolling P20-P60 filter.
ADX uses Wilder smoothing on M1 and M5. Research policy, not a guarantee.
"""
import math
import time

POLICY = 'V51_FIXED_ATR_0_1_8_20261019'
PERIOD = 14
LOOKBACK = 1440
ATR_MIN = 0.0
ATR_MAX = 1.8
ADX_LIMIT = 20.0
STABLE_BARS = 3


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lo = math.floor(position)
    hi = math.ceil(position)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


def closed_bars(raw, seconds, now, minimum):
    if raw is None:
        raise ValueError('MARKET_DATA_UNAVAILABLE')
    bars = []
    previous = None
    for row in raw:
        stamp = int(row['time'])
        if previous is not None and stamp <= previous:
            raise ValueError('MARKET_DATA_INVALID')
        previous = stamp
        if stamp % seconds:
            raise ValueError('MARKET_DATA_INVALID')
        # Position zero may be the still-forming candle. Never use it.
        if stamp + seconds > now:
            continue
        o, h, l, c = (float(row[k]) for k in ('open', 'high', 'low', 'close'))
        if not all(math.isfinite(v) and v > 0 for v in (o, h, l, c)) or not l <= min(o, c) <= max(o, c) <= h:
            raise ValueError('MARKET_DATA_INVALID')
        bars.append(dict(time=stamp, open=o, high=h, low=l, close=c))
    if len(bars) < minimum:
        raise ValueError('MARKET_HISTORY_INSUFFICIENT')
    # Require the most recently completed slot; a missing boundary candle blocks
    # until the broker publishes it. A fresh quote cannot refresh an old bar.
    if bars[-1]['time'] + seconds != int(now // seconds) * seconds:
        raise ValueError('MARKET_DATA_STALE')
    recent = bars[-(2 * PERIOD + STABLE_BARS + 1):]
    if any(b['time'] - a['time'] != seconds for a, b in zip(recent, recent[1:])):
        raise ValueError('MARKET_DATA_GAP')
    return bars


def indicators(bars):
    size = len(bars)
    tr, plus, minus = [0.] * size, [0.] * size, [0.] * size
    atr, adx = [None] * size, [None] * size
    for i in range(1, size):
        b, p = bars[i], bars[i - 1]
        tr[i] = max(b['high'] - b['low'], abs(b['high'] - p['close']), abs(b['low'] - p['close']))
        up, down = b['high'] - p['high'], p['low'] - b['low']
        plus[i] = up if up > down and up > 0 else 0.
        minus[i] = down if down > up and down > 0 else 0.
        if i >= PERIOD:
            atr[i] = sum(tr[i - PERIOD + 1:i + 1]) / PERIOD
    smoothed = [sum(v[1:PERIOD + 1]) / PERIOD for v in (tr, plus, minus)]
    dx = []
    for i in range(PERIOD, size):
        if i > PERIOD:
            smoothed = [(old * (PERIOD - 1) + values[i]) / PERIOD for old, values in zip(smoothed, (tr, plus, minus))]
        denominator = smoothed[1] + smoothed[2]
        dx.append(100. * abs(smoothed[1] - smoothed[2]) / denominator if denominator else 0.)
        if len(dx) == PERIOD:
            adx[i] = sum(dx) / PERIOD
        elif len(dx) > PERIOD:
            adx[i] = (adx[i - 1] * (PERIOD - 1) + dx[-1]) / PERIOD
    return atr, adx


def evaluate(m1, m5, now, point):
    if not math.isfinite(now) or not math.isfinite(point) or point <= 0:
        raise ValueError('MARKET_DATA_INVALID')
    one = closed_bars(m1, 60, now, LOOKBACK + PERIOD + 1)
    five = closed_bars(m5, 300, now, 200)
    atr, adx1 = indicators(one)
    _, adx5 = indicators(five)
    # Preserve historical depth, closed-candle and stale/gap checks even
    # though the admission band is now fixed rather than percentile-ranked.
    low, high = ATR_MIN, ATR_MAX
    value = atr[-1]
    atr_ok = value is not None and math.isfinite(value) and low <= value <= high
    adx_ok = max(adx1[-STABLE_BARS:]) < ADX_LIMIT and max(adx5[-STABLE_BARS:]) < ADX_LIMIT
    reasons = ([] if atr_ok else ['ATR_OUTSIDE_RANGE']) + ([] if adx_ok else ['ADX_TREND_NOT_RANGING'])
    evidence = dict(policy=POLICY, observedMs=int(now * 1000), atrMethod='SMA_TR_14', adxMethod='WILDER_14',
        atrM1=value, atrPoints=value / point, minAtr=low, maxAtr=high,
        adxM1=adx1[-1], adxM5=adx5[-1], adxM1Max3=max(adx1[-STABLE_BARS:]), adxM5Max3=max(adx5[-STABLE_BARS:]),
        adxLimit=ADX_LIMIT, stableBars=STABLE_BARS, lookbackBars=LOOKBACK,
        m1ClosedMs=(one[-1]['time'] + 60) * 1000, m5ClosedMs=(five[-1]['time'] + 300) * 1000,
        atrPassed=atr_ok, adxPassed=adx_ok)
    return {'atr': atr_ok, 'adx': adx_ok}, reasons, evidence


def inspect_market(adapter, clock=time.time):
    """Only reads rates/symbol metadata; adapter lifecycle belongs to the caller."""
    try:
        mt5 = adapter.mt5
        _, _, symbol = adapter.identity()
        m1 = mt5.copy_rates_from_pos(symbol.name, mt5.TIMEFRAME_M1, 0, 1600)
        m5 = mt5.copy_rates_from_pos(symbol.name, mt5.TIMEFRAME_M5, 0, 300)
        return evaluate(m1, m5, clock(), float(symbol.point))
    except Exception as exc:
        known = {'MARKET_DATA_UNAVAILABLE', 'MARKET_DATA_INVALID', 'MARKET_HISTORY_INSUFFICIENT', 'MARKET_DATA_STALE', 'MARKET_DATA_GAP'}
        reason = str(exc) if isinstance(exc, ValueError) and str(exc) in known else 'MARKET_DATA_UNAVAILABLE'
        return {'atr': False, 'adx': False}, [reason], None


def require_market(adapter):
    from goldtrap_arc.config import ArcSafetyError
    checks, reasons, evidence = inspect_market(adapter)
    if not all(checks.values()):
        raise ArcSafetyError(reasons[0])
    return evidence

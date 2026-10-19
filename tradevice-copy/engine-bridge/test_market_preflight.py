import math
import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
from v51_market_preflight import evaluate, indicators, inspect_market, require_market, percentile

NOW = 1800000000  # aligned to M1/M5

def bars(count, seconds, trend=False):
    out=[]
    for i in range(count):
        c=4000+i*.3 if trend else 4000+(.2 if i%2 else -.2)
        out.append(dict(time=NOW-(count-i)*seconds,open=c,high=c+.5,low=c-.5,close=c))
    return out

class MarketPreflight(unittest.TestCase):
    def test_range_passes_and_trend_fails(self):
        checks,reasons,e=evaluate(bars(1600,60),bars(300,300),NOW,.001)
        self.assertTrue(all(checks.values()));self.assertEqual(reasons,[])
        self.assertEqual(e['atrM1'],1.);self.assertEqual(e['atrPoints'],1000.)
        checks,reasons,e=evaluate(bars(1600,60,True),bars(300,300,True),NOW,.001)
        self.assertFalse(checks['adx']);self.assertIn('ADX_TREND_NOT_RANGING',reasons)
        self.assertAlmostEqual(e['adxM1'],100.)
    def test_atr_is_engine_sma_and_fixed_0_to_1_8_band(self):
        one=bars(1600,60);one[-1]['high']+=14
        atr,_=indicators(one)
        self.assertEqual(atr[-1],2.)
        checks,_,e=evaluate(one,bars(300,300),NOW,.001)
        self.assertFalse(checks['atr']);self.assertEqual(e['minAtr'],0.);self.assertEqual(e['maxAtr'],1.8)
        self.assertEqual(e['policy'],'V51_FIXED_ATR_0_1_8_20261019')
        self.assertIn('ATR_OUTSIDE_RANGE',evaluate(one,bars(300,300),NOW,.001)[1])
    def test_fixed_boundaries_and_screen_shown_0_96(self):
        for value,expected in [(0.,True),(.96,True),(1.8,True),(1.80001,False),(2.,False)]:
            with self.subTest(atr=value), patch('v51_market_preflight.indicators',side_effect=[
                ([value]*1600,[10.]*1600),([value]*300,[10.]*300)]):
                checks,_,e=evaluate(bars(1600,60),bars(300,300),NOW,.001)
                self.assertEqual(checks['atr'],expected)
                self.assertEqual((e['minAtr'],e['maxAtr']),(0.,1.8))
    def test_prior_percentile_is_not_used_for_admission(self):
        with patch('v51_market_preflight.percentile',side_effect=AssertionError('historical band must not be used')):
            checks,_,e=evaluate(bars(1600,60),bars(300,300),NOW,.001)
            self.assertTrue(checks['atr'])
            self.assertEqual(e['lookbackBars'],1440)  # retained closed-candle history requirement
    def test_forming_candle_cannot_change_decision(self):
        one,five=bars(1600,60),bars(300,300)
        expected=evaluate(one,five,NOW+25,.001)
        unfinished=dict(time=NOW,open=4000,high=5000,low=3000,close=4500)
        self.assertEqual(evaluate(one+[unfinished],five+[unfinished],NOW+25,.001),expected)
    def test_adx_requires_three_completed_bars_on_both_timeframes(self):
        one,five=bars(1600,60),bars(300,300)
        # Isolate the gate from smoothing: latest values low, preceding one high.
        with patch('v51_market_preflight.indicators',side_effect=[([1.]*1600,[10.]*1597+[21.,10.,10.]),([1.]*300,[10.]*300)]):
            self.assertFalse(evaluate(one,five,NOW,.001)[0]['adx'])
        with patch('v51_market_preflight.indicators',side_effect=[([1.]*1600,[10.]*1600),([1.]*300,[10.]*297+[20.,10.,10.])]):
            self.assertFalse(evaluate(one,five,NOW,.001)[0]['adx'])
    def test_missing_stale_gap_duplicate_and_nonfinite_fail_closed(self):
        good=bars(1600,60)
        bads=[None,good[:100],good[:-1],good[:-10]+good[-9:],good+[good[-1]],good[:-1]+[dict(good[-1],high=math.nan)]]
        for bad in bads:
            with self.subTest(kind=str(bad)[:20]):
                mt5=NS(TIMEFRAME_M1=1,TIMEFRAME_M5=5,copy_rates_from_pos=Mock(side_effect=[bad,bars(300,300)]))
                a=NS(mt5=mt5,identity=lambda:(None,None,NS(name='XAUUSDm',point=.001)))
                checks,reasons,e=inspect_market(a,clock=lambda:NOW)
                self.assertEqual(checks,{'atr':False,'adx':False});self.assertIsNone(e)
                self.assertTrue(reasons[0].startswith('MARKET_'))
    def test_only_read_methods_are_needed(self):
        mt5=NS(TIMEFRAME_M1=1,TIMEFRAME_M5=5,copy_rates_from_pos=Mock(side_effect=[bars(1600,60),bars(300,300)]))
        a=NS(mt5=mt5,identity=lambda:(None,None,NS(name='XAUUSDm',point=.001)))
        self.assertTrue(all(inspect_market(a,clock=lambda:NOW)[0].values()))
    def test_actual_gate_raises_before_entry(self):
        with patch('v51_market_preflight.inspect_market',return_value=({'atr':True,'adx':False},['ADX_TREND_NOT_RANGING'],{})):
            with self.assertRaisesRegex(Exception,'ADX_TREND_NOT_RANGING'):require_market(Mock())

if __name__=='__main__':unittest.main()

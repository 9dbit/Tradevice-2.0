"""Bind validated command settings to a fresh cycle before any order exists."""
from decimal import Decimal,ROUND_HALF_UP
from time import time
from demo_settings import validate_settings
from goldtrap_arc.config import execution_config,ArcSafetyError
from goldtrap_arc.rules import atr_at
from goldtrap_arc.mt5_adapter import validate_closed_m1

def configure_adapter(adapter,settings):
 settings=validate_settings(settings);mode=settings['tpMode'];atr=None;candle=None
 if mode.startswith('ATR_'):
  bars=adapter.recent_closed_bars(adapter.cfg.atr_period+1)
  validate_closed_m1(bars,time())
  atr=atr_at(bars,len(bars)-1,adapter.cfg.atr_period)
  if not atr or atr<=0:raise ArcSafetyError('SETTINGS_ATR_UNAVAILABLE')
  candle=bars[-1].time
  target=float((Decimal(str(atr))*(1 if mode=='ATR_1' else 2)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
 else:target=3.5 if mode=='FIXED_3_5' else settings['customTpUsd']
 adapter.cfg=execution_config(settings['baseLot'],target,settings=settings,atr=atr,candle_time=candle)
 return adapter.cfg

"""Strict, shared command settings; no broker or network operations."""
import math
from decimal import Decimal
SETTINGS_PROTOCOL='V51_CLOSE_DISTANCE_20261015'
TP_MODES={'FIXED_3_5','ATR_1','ATR_2','CUSTOM'}
def default_settings():return dict(protocol=SETTINGS_PROTOCOL,baseLot=.01,tpMode='FIXED_3_5',customTpUsd=None)
def validate_settings(raw):
 if not isinstance(raw,dict) or set(raw)!={'protocol','baseLot','tpMode','customTpUsd'}:raise ValueError('SETTINGS_INVALID')
 if raw['protocol']!=SETTINGS_PROTOCOL or not isinstance(raw['tpMode'],str) or raw['tpMode'] not in TP_MODES:raise ValueError('SETTINGS_PROTOCOL_INVALID')
 lot=raw['baseLot'];custom=raw['customTpUsd']
 if type(lot) not in (int,float) or not math.isfinite(lot) or Decimal(str(lot)) not in [Decimal(i)/100 for i in range(1,11)]:raise ValueError('BASE_LOT_INVALID')
 if raw['tpMode']=='CUSTOM':
  if type(custom) not in (int,float) or not math.isfinite(custom) or not .01<=custom<=250 or Decimal(str(custom))*100!=(Decimal(str(custom))*100).to_integral_value():raise ValueError('CUSTOM_TP_INVALID')
 elif custom is not None:raise ValueError('CUSTOM_TP_UNEXPECTED')
 return dict(protocol=SETTINGS_PROTOCOL,baseLot=float(lot),tpMode=raw['tpMode'],customTpUsd=float(custom) if custom is not None else None)

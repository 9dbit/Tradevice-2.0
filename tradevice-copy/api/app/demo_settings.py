"""Strict, shared command settings; no broker or network operations."""
import math
from decimal import Decimal
SETTINGS_PROTOCOL='V51_DYNAMIC_ATR_USD_20261015'
TP_MODES={'FIXED_3_5','ATR_1','ATR_2','CUSTOM','POINTS'}
def default_settings():return dict(protocol=SETTINGS_PROTOCOL,baseLot=.01,tpMode='FIXED_3_5',customTpUsd=None)
def validate_settings(raw):
 if not isinstance(raw,dict) or set(raw)!=({'protocol','baseLot','tpMode','customTpUsd','tpPoints'} if raw.get('tpMode')=='POINTS' else {'protocol','baseLot','tpMode','customTpUsd'}):raise ValueError('SETTINGS_INVALID')
 if raw['protocol']!=SETTINGS_PROTOCOL or not isinstance(raw['tpMode'],str) or raw['tpMode'] not in TP_MODES:raise ValueError('SETTINGS_PROTOCOL_INVALID')
 lot=raw['baseLot'];custom=raw['customTpUsd']
 if type(lot) not in (int,float) or not math.isfinite(lot) or Decimal(str(lot)) not in [Decimal(i)/100 for i in range(1,11)]:raise ValueError('BASE_LOT_INVALID')
 if raw['tpMode']=='CUSTOM':
  if type(custom) not in (int,float) or not math.isfinite(custom) or not .01<=custom<=250 or Decimal(str(custom))*100!=(Decimal(str(custom))*100).to_integral_value():raise ValueError('CUSTOM_TP_INVALID')
 elif custom is not None:raise ValueError('CUSTOM_TP_UNEXPECTED')
 if raw['tpMode']=='POINTS' and (type(raw['tpPoints']) is not int or not 1<=raw['tpPoints']<=100000):raise ValueError('TP_POINTS_INVALID')
 return dict(protocol=SETTINGS_PROTOCOL,baseLot=float(lot),tpMode=raw['tpMode'],customTpUsd=float(custom) if custom is not None else None,**({'tpPoints':raw['tpPoints']} if raw['tpMode']=='POINTS' else {}))

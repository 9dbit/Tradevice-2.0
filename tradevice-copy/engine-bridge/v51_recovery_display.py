"""Read-only historical engine configuration; timestamps are never renewed."""
import json
from pathlib import Path
PATH=Path(__file__).resolve().parent/'read_only/engine_diagnostics.json'
def read_diagnostics(now,path=PATH):
 try:
  if path.stat().st_size>4096:raise ValueError()
  d=json.loads(path.read_text(encoding='utf-8'))
  if (d.get('schema')!='tradevice.v51.engine.diagnostics.v1' or d.get('status')!='ENGINE_REPORTED'
   or d.get('read_only') is not True or d.get('order_dispatch_authorized') is not False
   or type(d.get('observed_ms')) is not int or not 0<=now-d['observed_ms']<=604800000):raise ValueError()
  return d # The API independently validates fields and marks old reports stale.
 except (OSError,ValueError,TypeError,AttributeError):
  return dict(schema='tradevice.v51.engine.diagnostics.v1',status='ENGINE_NOT_CONNECTED',read_only=True,order_dispatch_authorized=False)

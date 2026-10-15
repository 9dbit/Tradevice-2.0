"""Read-only cycle direction projection; never alters journals or freshness."""
import json,re
from pathlib import Path
from v51_batch_telemetry import read_batch as base_read_batch
ROOT=Path(__file__).resolve().parent

def enrich(batch,root=ROOT):
 if not isinstance(batch,dict):return batch
 bid=batch.get('batch_id','')
 if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',bid):return batch
 batch={**batch,'cycles':[dict(row) for row in batch.get('cycles',[])]}
 for row in batch['cycles']:
  row['side']=None
  n=row.get('number')
  if type(n) is not int or not 1<=n<=10:continue
  path=root/'logs'/'arc_v1'/bid/f'cycle_{n:02d}'/'arc_state.json'
  try:
   if path.stat().st_size>256000:continue
   state=json.loads(path.read_text(encoding='utf-8-sig'))
   if state.get('cycle_id')==row.get('cycle_id') and state.get('active_side') in ('BUY','SELL'):
    row['side']=state['active_side']
  except (OSError,ValueError,AttributeError):pass
 return batch

def read_batch():return enrich(base_read_batch())

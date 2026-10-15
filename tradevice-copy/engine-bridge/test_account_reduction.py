"""Synthetic account-wide reductions: no MT5 dependency or real order calls."""
from types import SimpleNamespace as N
import pytest
from goldtrap_arc.persistence import ArcLedger
from v51_account_close import AccountReducer

class Broker:
 TRADE_ACTION_REMOVE=8;TRADE_ACTION_DEAL=1
 def __init__(self):
  self.positions=[N(ticket=1,identifier=1,symbol='XAUUSDm',type=0,volume=.01),N(ticket=2,identifier=2,symbol='EURUSD',type=1,volume=.02)]
  self.orders=[N(ticket=3,symbol='XAUUSDm',type=4,magic=8802001,comment='GT_ARC_V1:test:B01'),N(ticket=4,symbol='EURUSD',type=5,magic=0,comment='manual')]
  self.history={};self.deals={};self.sent=[];self.mode=None;self.freeze=1
 def positions_get(self):return tuple(self.positions)
 def orders_get(self):return tuple(self.orders)
 def history_orders_get(self,ticket):return self.history.get(ticket,[])
 def history_deals_get(self,position):return self.deals.get(position,[])
 def symbol_info(self,s):return N(filling_mode=3,trade_exemode=2)
 def symbol_info_tick(self,s):return N(bid=4000.,ask=4000.2,time_msc=1000000)
 def order_check(self,r):return N(retcode=0)
 def order_send(self,r):
  self.sent.append(dict(r))
  if self.mode=='unknown':return None
  if self.mode=='freeze' and self.freeze:self.freeze-=1;return N(retcode=10029)
  if r['action']==8:
   item=next(x for x in self.orders if x.ticket==r['order']);self.orders.remove(item)
   filled=self.mode=='fill';self.history[item.ticket]=[N(ticket=item.ticket,symbol=item.symbol,state=4 if filled else 2)]
   if filled:self.positions.append(N(ticket=item.ticket,identifier=item.ticket,symbol=item.symbol,type=0,volume=.01))
   return N(retcode=10029 if filled else 10009)
  assert 'position' in r and 'order' not in r
  item=next(x for x in self.positions if x.ticket==r['position'])
  if self.mode=='partial':item.volume/=2;return N(retcode=10010)
  self.positions.remove(item)
  if self.mode!='missing_history':self.deals[item.ticket]=[N(type=item.type,entry=0,symbol=item.symbol,volume=item.volume),N(type=1-item.type,entry=1,symbol=item.symbol,volume=item.volume)]
  return N(retcode=10009)

def runner(tmp_path):
 b=Broker();l=ArcLedger(tmp_path/'journal');l.initialize();r=AccountReducer(b,lambda:None,l,1060000,clock=lambda:1000,sleep=lambda _:None);return b,r

def test_closes_manual_and_other_symbols_and_verifies_twice(tmp_path):
 b,r=runner(tmp_path);events=[];out=r.reduce(True,lambda *x:events.append(x))
 assert out['broker_flat'] and not b.positions and not b.orders
 assert [x['action'] for x in b.sent]==[8,8,1,1]
 assert all('position' in x for x in b.sent if x['action']==1)
 assert [x[0] for x in events][-2:]==['VERIFYING_FLAT']*2

def test_pause_stop_retires_only_owned_pending_without_closing(tmp_path):
 b,r=runner(tmp_path);out=r.reduce(False,lambda *x:None)
 assert out['pending_retired'] and not out['broker_flat']
 assert len(b.positions)==2 and [o.ticket for o in b.orders]==[4] and len(b.sent)==1

def test_frozen_explicit_reject_rechecks_then_retries(tmp_path):
 b,r=runner(tmp_path);b.mode='freeze';r.reduce(True,lambda *x:None)
 assert len(b.sent)==5 and not b.positions and not b.orders

def test_cancel_fills_despite_rejected_cancel_closes_new_position(tmp_path):
 b,r=runner(tmp_path);b.mode='fill';out=r.reduce(True,lambda *x:None)
 assert out['broker_flat'] and out['position_ids']==[1,2,3,4]

@pytest.mark.parametrize('mode',['unknown','partial','missing_history'])
def test_uncertain_partial_or_missing_proof_never_resends(tmp_path,mode):
 b,r=runner(tmp_path);b.orders=[];b.mode=mode
 with pytest.raises(ValueError,match='UNCONFIRMED'):r.reduce(True,lambda *x:None)
 assert len(b.sent)==1
 with pytest.raises(ValueError):r.reduce(True,lambda *x:None)
 assert len(b.sent)==1

def test_identity_failure_or_expiry_prevents_writes(tmp_path):
 b,r=runner(tmp_path)
 def invalid():raise ValueError('identity')
 r.identity=invalid
 with pytest.raises(ValueError,match='identity'):r.reduce(True,lambda *x:None)
 assert not b.sent
 r.identity=lambda:None;r.expires_ms=0
 with pytest.raises(ValueError,match='EXPIRED'):r.reduce(True,lambda *x:None)
 assert not b.sent

def test_expiry_during_order_check_prevents_dispatch(tmp_path):
 b,r=runner(tmp_path)
 def check(req):r.expires_ms=0;return N(retcode=0)
 b.order_check=check
 with pytest.raises(ValueError,match='EXPIRED'):r.reduce(True,lambda *x:None)
 assert not b.sent

def test_restart_resolves_terminal_effect_without_duplicate_write(tmp_path):
 b,r=runner(tmp_path);b.orders=[];b.mode='unknown'
 with pytest.raises(ValueError):r.reduce(True,lambda *x:None)
 b.mode=None;request=b.sent[0];b.order_send(request);b.sent.clear()
 r.reduce(True,lambda *x:None)
 assert len(b.sent)==1 and b.sent[0]['position']==2

def test_frozen_cancel_proof_is_exact_and_original_journals_unchanged(tmp_path,monkeypatch):
 import json,hashlib
 import v51_emergency_close as old
 from v51_account_close import original_cancel_proofs,proves_cancel_reconciliation
 p=tmp_path/'cycle';p.mkdir();state=p/'arc_state.json';state.write_text(json.dumps({'cycle_id':'abc','state':'SAFETY_PAUSED'}));before=state.read_bytes()
 intent=dict(request_id='r',operation='CANCEL',target_ticket=10,expected_comment='GT_ARC_V1:abc:B01',expected_volume=.01)
 receipts=[dict(classification='DEFINITIVE_REJECT',retcode=10029)]
 ledger=N(rows=[],tail='hash',unresolved_requests=lambda:[intent],receipts=lambda rid:receipts)
 monkeypatch.setattr(old,'catalog',lambda root:{'abc':(p,ledger,{'state':'SAFETY_PAUSED'})})
 monkeypatch.setattr(old,'history_proof',lambda adapter,cid:dict(positions_closed=1,net_usd=1,history_tickets=[1,2]))
 order=N(ticket=10,symbol='XAUUSDm',magic=8802001,comment=intent['expected_comment'],volume_initial=.01,state=4)
 adapter=N(mt5=N(history_orders_get=lambda **k:[order]),cfg=N(symbol='XAUUSDm',magic=8802001))
 proofs=original_cancel_proofs(tmp_path,adapter);assert 'abc' in proofs and state.read_bytes()==before
 receipts[0]['retcode']=10013;assert original_cancel_proofs(tmp_path,adapter)=={};receipts[0]['retcode']=10029
 rid='11111111-1111-4111-8111-111111111111';path=tmp_path/'read_only';path.mkdir()
 (path/('account_reduction_proof_'+rid+'.json')).write_text(json.dumps(dict(request_id=rid,broker_flat=True,prior_cancel_proofs=proofs)))
 journal=ArcLedger(path/'account_reduction_journal');journal.initialize()
 assert not proves_cancel_reconciliation(tmp_path,state,ledger)
 journal.append('ACCOUNT_REDUCTION_COMPLETE',request_id=rid,broker_flat=True)
 assert proves_cancel_reconciliation(tmp_path,state,ledger)
 state.write_text('{}');assert not proves_cancel_reconciliation(tmp_path,state,ledger)
 state.write_bytes(before);ledger.tail='changed';assert not proves_cancel_reconciliation(tmp_path,state,ledger)

def test_guard_expiry_after_durable_intent_records_no_dispatch(tmp_path):
 b,r=runner(tmp_path);append=r.ledger.append
 def record(event,**fields):
  out=append(event,**fields)
  if event=='ACCOUNT_REDUCTION_INTENT':r.expires_ms=0
  return out
 r.ledger.append=record
 with pytest.raises(ValueError,match='EXPIRED'):r.reduce(True,lambda *x:None)
 assert not b.sent and r.ledger.rows[-1]['proof']=='NOT_DISPATCHED_GUARD'

def test_connection_gap_after_dispatch_never_replays_uncertain_request(tmp_path):
 b,r=runner(tmp_path);b.orders=[];b.mode='unknown';positions=b.positions_get;gap=[True]
 def read_positions():
  if b.sent and gap[0]:gap[0]=False;return None
  return positions()
 b.positions_get=read_positions
 with pytest.raises(ValueError,match='PRIOR_REQUEST_UNCONFIRMED'):r.reduce(True,lambda *x:None)
 assert len(b.sent)==1

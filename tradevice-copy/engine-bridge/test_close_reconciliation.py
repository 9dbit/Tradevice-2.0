"""Synthetic history proof tests: broker mutation methods deliberately unavailable."""
import hashlib,json,uuid
from types import SimpleNamespace as N
import pytest
from goldtrap_arc.persistence import ArcLedger
from v51_account_close import filled_order_ownership
from v51_close_reconciliation import prove_closed_run,stored_cancel_proof

def ownership():
 intent=dict(target_ticket=10,expected_comment='GT_ARC_V1:abc:B01',expected_volume=.01,side='BUY')
 placement=dict(event='BROKER_REQUEST_INTENT',operation='FIXED_PENDING',cycle_id='abc',request_id='p',expected_comment=intent['expected_comment'],expected_volume=.01,side='BUY',request=dict(symbol='XAUUSDm',magic=8802001,comment=intent['expected_comment']))
 receipt=dict(classification='ACCEPTED',retcode=10009,raw_result=dict(order=10))
 resolved=dict(event='BROKER_REQUEST_RESOLVED',request_id='p',resolution='EFFECT_PROVEN',proof=dict(ticket=10))
 ledger=N(rows=[placement,resolved],receipts=lambda rid:[receipt])
 deal=N(order=10,position_id=10,symbol='XAUUSDm',magic=8802001,comment=intent['expected_comment'],entry=0,type=0,volume=.01)
 life=dict(entry_deals=[deal],all_closed=True)
 adapter=N(cfg=N(symbol='XAUUSDm',magic=8802001),cycle_lifecycle=lambda cid:life)
 order=N(state=4,magic=0,comment='')
 return adapter,ledger,intent,order,deal,receipt,life

def test_missing_order_metadata_requires_exact_accepted_placement_and_closed_owned_deals():
 a,l,i,o,d,r,life=ownership();assert filled_order_ownership(a,'abc',l,i,o)
 for field,value in [('order',11),('magic',0),('comment','foreign'),('entry',1),('type',1),('volume',.02),('position_id',0)]:
  old=getattr(d,field);setattr(d,field,value);assert not filled_order_ownership(a,'abc',l,i,o);setattr(d,field,old)
 life['all_closed']=False;assert not filled_order_ownership(a,'abc',l,i,o);life['all_closed']=True
 r['raw_result']['order']=11;assert not filled_order_ownership(a,'abc',l,i,o);r['raw_result']['order']=10
 l.rows.pop();assert not filled_order_ownership(a,'abc',l,i,o)

@pytest.mark.parametrize('field,value',[('state',2),('magic',77),('comment','another-owner')])
def test_fallback_never_overrides_conflicting_metadata(field,value):
 a,l,i,o,*_=ownership();setattr(o,field,value);assert not filled_order_ownership(a,'abc',l,i,o)

def fixture(tmp_path,monkeypatch):
 import emergency_state,v51_account_close
 rid=str(uuid.uuid4());run=str(uuid.uuid4());directory=tmp_path/'read_only';directory.mkdir()
 latch=dict(requestId=rid,phase='COMPLETE')
 monkeypatch.setattr(emergency_state,'read',lambda root:dict(latch))
 prior=dict(request_id=rid,scope='ALL_DEMO_ACCOUNT',broker_flat=True,positions_remaining=0,orders_remaining=0,new_cycle_started=False)
 (directory/('account_reduction_proof_'+rid+'.json')).write_text(json.dumps(prior))
 journal=ArcLedger(directory/'account_reduction_journal');journal.initialize();journal.append('ACCOUNT_REDUCTION_COMPLETE',request_id=rid,broker_flat=True)
 folder=tmp_path/'logs/arc_v1'/('v51_dashboard_'+run.replace('-',''));folder.mkdir(parents=True)
 (folder/'batch_manifest.json').write_text(json.dumps(dict(status='SAFETY_STOP',slots=[dict(cycle_id='abc',result=dict(broker_flat_confirmed=False))])))
 ArcLedger(folder).initialize()
 proofs={'abc':dict(history=dict(positions_closed=1,net_usd=1,history_tickets=[1,2]))}
 monkeypatch.setattr(v51_account_close,'original_cancel_proofs',lambda root,adapter:proofs.copy())
 book={'positions':[],'orders':[]};calls=[]
 adapter=N(guard_identity=lambda:calls.append('identity'),mt5=N(positions_get=lambda:book['positions'],orders_get=lambda:book['orders']))
 def reconcile(adapter,**kwargs):calls.append(('prior',kwargs))
 args=(tmp_path,run,rid,adapter,lambda:calls.append('fingerprint'),reconcile)
 return args,book,calls,latch,journal,folder,proofs

def test_proof_checks_flat_twice_and_prior_journals_without_sending(tmp_path,monkeypatch):
 args,book,calls,*_=fixture(tmp_path,monkeypatch);out=prove_closed_run(*args)
 assert out['broker_flat'] and out['orders_sent']==0 and out['new_cycle_started'] is False
 assert calls.count('identity')==3 and calls.count('fingerprint')==2
 assert [x for x in calls if isinstance(x,tuple)][0][1]['write'] is False

@pytest.mark.parametrize('field,value',[('positions',[object()]),('orders',[object()]),('positions',None),('orders',None)])
def test_nonflat_or_unavailable_book_blocks(tmp_path,monkeypatch,field,value):
 args,book,*_=fixture(tmp_path,monkeypatch);book[field]=value
 with pytest.raises(ValueError,match='BROKER_NOT_FLAT'):prove_closed_run(*args)

def test_unsettled_account_request_blocks(tmp_path,monkeypatch):
 args,_,_,_,journal,*_=fixture(tmp_path,monkeypatch);journal.append('ACCOUNT_REDUCTION_INTENT',operation_id='unsettled')
 with pytest.raises(ValueError,match='ACCOUNT_UNSETTLED'):prove_closed_run(*args)

def test_missing_history_or_changed_journal_blocks(tmp_path,monkeypatch):
 args,_,_,_,_,folder,proofs=fixture(tmp_path,monkeypatch);proofs.clear()
 with pytest.raises(ValueError,match='HISTORY_MISSING'):prove_closed_run(*args)
 proofs['abc']={}
 def change(adapter,**kwargs):(folder/'mutation.json').write_text('{}')
 with pytest.raises(ValueError,match='EVIDENCE_CHANGED'):prove_closed_run(*args[:-1],change)

def test_audit_sidecar_requires_digest_and_unchanged_state_and_ledger(tmp_path):
 directory=tmp_path/'read_only';directory.mkdir();state=tmp_path/'arc_state.json';state.write_text('{"cycle_id":"abc"}')
 ledger=N(tail='tail',unresolved_requests=lambda:[{'request_id':'cancel'}])
 p=dict(close_request_id='close',broker_flat=True,orders_sent=0,prior_cancel_proofs={'abc':dict(request_ids=['cancel'],state_sha256=hashlib.sha256(state.read_bytes()).hexdigest(),ledger_tail='tail')})
 raw=json.dumps(p).encode();digest=hashlib.sha256(raw).hexdigest();path=directory/('close_reconciliation_'+digest+'.json');path.write_bytes(raw)
 audit=ArcLedger(directory/'close_reconciliation_journal');audit.initialize()
 assert not stored_cancel_proof(tmp_path,state,ledger)
 audit.append('CLOSE_RECONCILIATION_COMPLETE',close_request_id='close',proof_sha256=digest)
 assert stored_cancel_proof(tmp_path,state,ledger)
 path.write_bytes(raw+b' ');assert not stored_cancel_proof(tmp_path,state,ledger);path.write_bytes(raw)
 ledger.tail='changed';assert not stored_cancel_proof(tmp_path,state,ledger)

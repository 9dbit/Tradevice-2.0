"""Bounded reuse, role validation, and no implicit command replay."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import pytest
from app import demo_pool as p

@pytest.fixture
def pool(monkeypatch):
 p.close_pool();created=[]
 class Pool:
  def __init__(self,dsn,**kwargs):self.options=kwargs;self.calls=0;self.closed=False;created.append(self)
  def open(self):pass
  def close(self):self.closed=True
  @contextmanager
  def connection(self):self.calls+=1;yield self
 monkeypatch.setattr(p,'ConnectionPool',Pool)
 monkeypatch.setattr(p,'allowed_operator_dsn',lambda d:d=='fixture')
 yield created
 p.close_pool()

def test_threads_reuse_bounded_pool_without_reauthenticating(pool):
 with ThreadPoolExecutor(max_workers=8) as workers:results=list(workers.map(lambda _:p.get_pool('fixture'),range(20)))
 assert len(pool)==1 and all(r is pool[0] for r in results)
 assert pool[0].options['max_size']==4 and pool[0].options['max_waiting']==8
 assert pool[0].options['timeout']==3 and pool[0].options['configure'] is p.configure

def test_invalid_destination_never_opens_connection(pool):
 with pytest.raises(RuntimeError,match='DSN_REQUIRED'):p.get_pool('production')
 assert not pool

def test_transaction_failure_is_never_replayed(pool):
 with pytest.raises(ValueError,match='uncertain'):
  with p.connection('fixture'):raise ValueError('uncertain')
 assert pool[0].calls==1

def test_role_is_proven_on_each_new_connection():
 class Conn:
  def __init__(self,role):self.role=role;self.ended=False
  @contextmanager
  def transaction(self):
   try:yield
   finally:self.ended=True
  def execute(self,q):return self
  def fetchone(self):return {'role':self.role}
 good=Conn('tradevice_master_operator');p.configure(good);assert good.ended
 bad=Conn('postgres')
 with pytest.raises(RuntimeError,match='OPERATOR_REQUIRED'):p.configure(bad)
 assert bad.ended

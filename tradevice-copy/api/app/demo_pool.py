"""Bounded connections for the staging demo lane; never retry a transaction."""
import atexit,threading
from contextlib import contextmanager
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .master_control import allowed_operator_dsn

_lock=threading.Lock()
_pool=None
_dsn=None

def configure(conn):
    # Check identity once per authenticated physical connection, not once per
    # heartbeat. No caller in this private lane changes the session role.
    with conn.transaction():
        if conn.execute('SELECT current_user AS role').fetchone()['role']!='tradevice_master_operator':
            raise RuntimeError('DEMO_OPERATOR_REQUIRED')

def get_pool(dsn):
    global _pool,_dsn
    if not allowed_operator_dsn(dsn):raise RuntimeError('DEMO_STAGING_DSN_REQUIRED')
    with _lock:
        if _pool is None or _dsn!=dsn:
            old=_pool
            _pool=ConnectionPool(dsn,min_size=2,max_size=4,max_waiting=8,timeout=3,
                max_idle=60,max_lifetime=600,open=False,name='staging-demo',configure=configure,
                kwargs=dict(connect_timeout=5,options='-c statement_timeout=5000 -c lock_timeout=3000',row_factory=dict_row))
            _dsn=dsn;_pool.open()
            if old:old.close()
        return _pool

@contextmanager
def connection(dsn):
    # Pool context commits on success, rolls back on error and replaces broken
    # connections. A lost command response is reconciled by request ID, never
    # retried here. Read and exchange retain their real evidence timestamps.
    with get_pool(dsn).connection() as conn:yield conn

@atexit.register
def close_pool():
    global _pool,_dsn
    with _lock:
        if _pool:_pool.close()
        _pool=None;_dsn=None

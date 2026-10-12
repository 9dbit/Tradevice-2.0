"""OFFLINE paper-only master supervisor. No broker network, HTTP or live trades."""
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import json
import logging
import sqlite3
from threading import Event, RLock
import time
from typing import Callable
from uuid import UUID

from paper_broker import PaperBroker

log = logging.getLogger(__name__)


def require_decimal(value, name):
    if not isinstance(value, Decimal) or not value.is_finite() or value <= 0:
        raise ValueError(name + " must be finite and positive")
    return value


@dataclass(frozen=True)
class Policy:
    max_quote_age_s: int = 8
    max_spread_bps: Decimal = Decimal("25")
    max_jump_bps: Decimal = Decimal("350")
    recovery_ticks: int = 3
    recovery_cooldown_s: int = 5
    max_risk_pct: Decimal = Decimal("0.25")
    max_open_per_account: int = 3
    max_attempts: int = 3
    retry_base_s: int = 2

    def __post_init__(self):
        for field in ("max_quote_age_s", "recovery_ticks", "max_open_per_account", "max_attempts", "retry_base_s"):
            if type(getattr(self, field)) is not int or getattr(self, field) <= 0:
                raise ValueError("invalid policy " + field)
        if type(self.recovery_cooldown_s) is not int or self.recovery_cooldown_s < 0:
            raise ValueError("invalid cooldown")
        for field in ("max_spread_bps", "max_jump_bps", "max_risk_pct"):
            require_decimal(getattr(self, field), field)
        if self.max_risk_pct > 1:
            raise ValueError("risk fraction too large")


@dataclass(frozen=True)
class Quote:
    source: str
    sequence: int
    timestamp: float
    bid: Decimal
    ask: Decimal


@dataclass(frozen=True)
class Signal:
    account_id: str
    key: str
    symbol: str
    side: str
    quantity: Decimal
    entry: Decimal
    stop_loss: Decimal
    take_profit: Decimal
    equity_usd: Decimal
    expires_at: int


class ContinuityEngine:
    """One pinned master identity, durable inbox and fail-closed risk guards."""

    def __init__(self, master_id: str, broker: PaperBroker, journal_path=":memory:",
                 policy=None, clock=None, allow_standby=False):
        if not isinstance(master_id, str) or not 1 <= len(master_id) <= 80:
            raise ValueError("invalid master id")
        self.master_id = master_id
        self.broker = broker
        self.policy = policy or Policy()
        self.clock = clock or time.time
        self.allow_standby = allow_standby
        self.lock = RLock()
        self.db = sqlite3.connect(journal_path, isolation_level=None, check_same_thread=False, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA busy_timeout=8000")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS master_state(
            master_id TEXT PRIMARY KEY, mode TEXT NOT NULL, heartbeat REAL NOT NULL,
            healthy INTEGER NOT NULL, last_bad REAL NOT NULL,
            seq_primary INTEGER NOT NULL, seq_standby INTEGER NOT NULL,
            mid TEXT, active_source TEXT NOT NULL, hard_stop INTEGER NOT NULL,
            cycles INTEGER NOT NULL, anomalies INTEGER NOT NULL, reason TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS signal_inbox(
            master_id TEXT NOT NULL, request_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            retry_at REAL NOT NULL DEFAULT 0, order_id TEXT, error TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(master_id,request_key)
          );
          CREATE TABLE IF NOT EXISTS cycle_events(
            id INTEGER PRIMARY KEY AUTOINCREMENT, master_id TEXT NOT NULL,
            at REAL NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL
          );
        """)
        self.db.execute("""INSERT OR IGNORE INTO master_state VALUES
             (?, 'DEGRADED', 0, 0, 0, -1, -1, NULL, 'primary', 0, 0, 0, 'AWAITING_QUOTE')""",
             (self.master_id,))

    def close(self):
        self.db.close()

    def _event(self, when, category, note):
        self.db.execute("INSERT INTO cycle_events(master_id,at,category,note) VALUES(?,?,?,?)",
                        (self.master_id,when,category,str(note)[:140]))

    def snapshot(self):
        row=self.db.execute("SELECT * FROM master_state WHERE master_id=?",(self.master_id,)).fetchone()
        statuses=self.db.execute("SELECT status,count(*) n FROM signal_inbox WHERE master_id=? GROUP BY status",
                                 (self.master_id,)).fetchall()
        return dict(mode=row["mode"], heartbeat=row["heartbeat"], healthy=row["healthy"],
                    cycles=row["cycles"], anomalies=row["anomalies"], reason=row["reason"],
                    hard_stop=bool(row["hard_stop"]), active_source=row["active_source"],
                    signals={x["status"]:x["n"] for x in statuses})

    def kill_switch(self, engaged: bool):
        if type(engaged) is not bool:
            raise ValueError("operator boolean required")
        with self.lock:
            now=self.clock()
            self.db.execute("""UPDATE master_state SET hard_stop=?, mode=?,healthy=0,last_bad=?,reason=?
                WHERE master_id=?""",
                (int(engaged),"HALTED" if engaged else "DEGRADED",now,
                 "MANUAL_KILL" if engaged else "MANUAL_RELEASE_REVALIDATION",self.master_id))
            self._event(now,"KILL_SWITCH","ENGAGED" if engaged else "RELEASED_REQUIRES_RECOVERY")

    def enqueue(self, signal: Signal):
        """Trusted offline ingress ONLY; never connect untrusted member requests."""
        if not isinstance(signal, Signal):
            raise ValueError("signal required")
        account=str(UUID(signal.account_id))
        if signal.symbol!="XAUUSD" or signal.side not in ("BUY","SELL"):
            raise ValueError("symbol/side not supported")
        if not isinstance(signal.key,str) or not 1<=len(signal.key.strip())<=128:
            raise ValueError("invalid key")
        for k in ("quantity","entry","stop_loss","take_profit","equity_usd"):
            require_decimal(getattr(signal,k),k)
        if signal.quantity>1 or signal.quantity%Decimal(".01"):
            raise ValueError("invalid lot step")
        if not ((signal.side=="BUY" and signal.stop_loss<signal.entry<signal.take_profit) or
                (signal.side=="SELL" and signal.take_profit<signal.entry<signal.stop_loss)):
            raise ValueError("invalid SL/TP")
        # Explicit XAUUSD paper contract assumption: 100 oz per lot.
        loss=abs(signal.entry-signal.stop_loss)*signal.quantity*Decimal("100")
        if loss>signal.equity_usd*self.policy.max_risk_pct/100:
            raise ValueError("risk cap exceeded")
        if type(signal.expires_at) is not int or not self.clock()<signal.expires_at<=self.clock()+3600:
            raise ValueError("invalid TTL")
        data=dict(account_id=account,key=signal.key,symbol=signal.symbol,side=signal.side,
                  quantity=str(signal.quantity),entry=str(signal.entry),stop_loss=str(signal.stop_loss),
                  take_profit=str(signal.take_profit),equity_usd=str(signal.equity_usd),
                  expires_at=signal.expires_at)
        payload=json.dumps(data,sort_keys=True)
        fingerprint=hashlib.sha256(payload.encode()).hexdigest()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                row=self.db.execute("""SELECT fingerprint,status FROM signal_inbox
                     WHERE master_id=? AND request_key=?""",(self.master_id,signal.key)).fetchone()
                if row:
                    if row["fingerprint"]!=fingerprint:
                        raise ValueError("conflicting idempotent replay")
                    result=row["status"]
                else:
                    self.db.execute("""INSERT INTO signal_inbox
                          (master_id,request_key,fingerprint,payload,status)
                          VALUES (?,?,?,?, 'QUEUED')""",
                          (self.master_id,signal.key,fingerprint,payload))
                    self._event(self.clock(),"QUEUED",signal.key)
                    result="QUEUED"
                self.db.execute("COMMIT")
                return result
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def _quality(self, quote, now, state):
        if quote is None:
            return "MISSING_QUOTE",None
        if not isinstance(quote,Quote):
            return "INVALID_QUOTE",None
        if quote.source not in (("primary","standby") if self.allow_standby else ("primary",)):
            return "UNAPPROVED_SOURCE",None
        if type(quote.sequence) is not int or quote.sequence < 0:
            return "BAD_SEQUENCE",None
        if not isinstance(quote.timestamp,(float,int)) or type(quote.timestamp) is bool:
            return "BAD_TIMESTAMP",None
        if quote.timestamp>now+1 or now-quote.timestamp>self.policy.max_quote_age_s:
            return "STALE_OR_FUTURE",None
        col="seq_primary" if quote.source=="primary" else "seq_standby"
        if quote.sequence<=state[col]:
            return "OUT_OF_ORDER",None
        if quote.source=="standby" and state["mode"]=="ACTIVE" and state["active_source"]=="primary":
            return "SOURCE_CHANGE_REVALIDATION",None
        try:
            require_decimal(quote.bid,"bid")
            require_decimal(quote.ask,"ask")
            if quote.ask<quote.bid:
                return "CROSSED_QUOTE",None
            mid=(quote.bid+quote.ask)/2
            if ((quote.ask-quote.bid)/mid)*Decimal("10000")>self.policy.max_spread_bps:
                return "WIDE_SPREAD",None
            if state["mid"] is not None:
                if abs(mid-Decimal(state["mid"]))/Decimal(state["mid"])*Decimal("10000")>self.policy.max_jump_bps:
                    return "PRICE_GAP",None
        except (ValueError,ArithmeticError):
            return "INVALID_QUOTE",None
        return "OK",mid

    def _expire(self,now):
        for row in self.db.execute("""SELECT request_key,payload FROM signal_inbox
                WHERE master_id=? AND status IN ('QUEUED','RETRY')""",
                (self.master_id,)).fetchall():
            if json.loads(row["payload"])["expires_at"]<=now:
                self.db.execute("""UPDATE signal_inbox SET status='EXPIRED',error='SIGNAL_TTL'
                    WHERE master_id=? AND request_key=?""",(self.master_id,row["request_key"]))
                self._event(now,"EXPIRED",row["request_key"])

    def _drain(self,now):
        self._expire(now)
        items=self.db.execute("""SELECT * FROM signal_inbox WHERE master_id=?
              AND status IN ('QUEUED','RETRY') AND retry_at<=? ORDER BY rowid LIMIT 25""",
              (self.master_id,now)).fetchall()
        for row in items:
            data=json.loads(row["payload"])
            count=self.db.execute("""SELECT count(*) FROM signal_inbox
                WHERE master_id=? AND status='ACCEPTED_SIMULATED'
                AND json_extract(payload,'$.account_id')=?""",
                (self.master_id,data["account_id"])).fetchone()[0]
            if count>=self.policy.max_open_per_account:
                self._event(now,"EXPOSURE_GUARD","ACCOUNT_CAP")
                continue
            try:
                stable_key=hashlib.sha256((self.master_id+":"+data["key"]).encode()).hexdigest()
                order=self.broker.place(account_id=data["account_id"],key=stable_key,
                    symbol=data["symbol"],side=data["side"],quantity=Decimal(data["quantity"]),
                    entry=Decimal(data["entry"]),stop_loss=Decimal(data["stop_loss"]),
                    take_profit=Decimal(data["take_profit"]),expires_at=data["expires_at"])
                if order.execution_mode!="paper" or order.status!="ACCEPTED_SIMULATED":
                    raise ValueError("unexpected paper order")
                self.db.execute("""UPDATE signal_inbox SET status='ACCEPTED_SIMULATED',
                    order_id=?,error='' WHERE master_id=? AND request_key=?""",
                    (order.id,self.master_id,data["key"]))
                self._event(now,"PAPER_ACK",data["key"])
            except (OSError,sqlite3.Error):
                attempt=row["attempts"]+1
                status="DEAD_LETTER" if attempt>=self.policy.max_attempts else "RETRY"
                self.db.execute("""UPDATE signal_inbox SET status=?,attempts=?,retry_at=?,error=?
                   WHERE master_id=? AND request_key=?""",
                   (status,attempt,now+min(300,self.policy.retry_base_s*2**(attempt-1)),
                    "PAPER_STORAGE_UNAVAILABLE",self.master_id,data["key"]))
                self._event(now,"BROKER_RETRY",status)
                self.db.execute("""UPDATE master_state SET mode='DEGRADED',healthy=0,
                    last_bad=?,reason='BROKER_UNAVAILABLE' WHERE master_id=?""",(now,self.master_id))
                break
            except ValueError:
                self.db.execute("""UPDATE signal_inbox SET status='REJECTED',
                   error='PAPER_ORDER_REJECTED' WHERE master_id=? AND request_key=?""",
                   (self.master_id,data["key"]))
                self._event(now,"REJECTED",data["key"])

    def cycle(self, quote=None):
        with self.lock:
            now=self.clock()
            state=self.db.execute("SELECT * FROM master_state WHERE master_id=?",
                                  (self.master_id,)).fetchone()
            reason,mid=self._quality(quote,now,state)
            hard=bool(state["hard_stop"])
            if hard:
                mode,good,reason="HALTED",0,"MANUAL_KILL"
            elif reason!="OK":
                mode,good="DEGRADED",0
            else:
                good=state["healthy"]+1
                mode=("ACTIVE" if good>=self.policy.recovery_ticks
                      and now-state["last_bad"]>=self.policy.recovery_cooldown_s else "RECOVERING")
                reason="READY" if mode=="ACTIVE" else "REVALIDATING"
            self.db.execute("""UPDATE master_state SET mode=?,heartbeat=?,healthy=?,last_bad=?,
                cycles=cycles+1,anomalies=anomalies+?,reason=? WHERE master_id=?""",
                (mode,now,good,now if hard or mid is None else state["last_bad"],
                 int(reason not in ("READY","REVALIDATING")),reason,self.master_id))
            if isinstance(quote,Quote) and quote.source in ("primary","standby") and type(quote.sequence) is int and quote.sequence>=0:
                col="seq_primary" if quote.source=="primary" else "seq_standby"
                if quote.sequence>state[col]:
                    self.db.execute("UPDATE master_state SET "+col+"=? WHERE master_id=?",
                                    (quote.sequence,self.master_id))
            if mid is not None and not hard:
                self.db.execute("UPDATE master_state SET mid=?,active_source=? WHERE master_id=?",
                                (str(mid),quote.source,self.master_id))
            if mode!=state["mode"] or reason not in ("READY","REVALIDATING"):
                self._event(now,"MASTER",mode+":"+reason)
            if mode=="ACTIVE":
                self._drain(now)
            else:
                self._expire(now)
            return self.snapshot()

    def events(self, limit=100):
        if type(limit) is not int or not 1<=limit<=500:
            raise ValueError("invalid limit")
        return [dict(x) for x in self.db.execute("""SELECT at,category,note
            FROM cycle_events WHERE master_id=? ORDER BY id DESC LIMIT ?""",
            (self.master_id,limit)).fetchall()]


def supervise(engine: ContinuityEngine, quote_provider: Callable, stop: Event, interval_s=1.0):
    """Opt-in foreground loop: provider failures pause orders, not heartbeats."""
    if not .1<=interval_s<=60:
        raise ValueError("invalid interval")
    while not stop.is_set():
        try:
            try:
                quote=quote_provider()
            except Exception as exc:
                log.warning("feed exception %s",type(exc).__name__)
                quote=None
            engine.cycle(quote)
        except Exception as exc:
            log.exception("durable cycle failed closed: %s",type(exc).__name__)
        stop.wait(interval_s)

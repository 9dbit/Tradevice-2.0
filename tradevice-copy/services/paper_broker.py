"""Local paper-order journal. Never connects to a broker or invents fills.

A file path survives process restarts. :memory: is intended only for tests.
This is a single-host simulator, not the distributed production execution store.
"""
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_DOWN
import hashlib
import json
import sqlite3
from threading import RLock
import time
from uuid import UUID, uuid4


def positive(value: Decimal, name: str) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite() or value <= 0:
        raise ValueError(f"{name} must be a finite positive Decimal")
    return value


def size_for_risk(*, equity: Decimal, risk_pct: Decimal, entry: Decimal,
                  stop_loss: Decimal, tick_size: Decimal, tick_value: Decimal,
                  lot_step: Decimal = Decimal('0.01'), min_lot: Decimal = Decimal('0.01'),
                  max_lot: Decimal = Decimal('1')) -> Decimal:
    """tick_value must already be converted to the account currency per lot.
    Costs, margin, portfolio exposure and quote freshness require separate gates.
    """
    for key, value in locals().copy().items():
        positive(value, key)
    if risk_pct > 1 or entry == stop_loss or min_lot > max_lot:
        raise ValueError('Invalid risk or contract limits')
    loss_per_lot = abs(entry - stop_loss) / tick_size * tick_value
    raw = min(equity * risk_pct / 100 / loss_per_lot, max_lot)
    volume = (raw / lot_step).to_integral_value(rounding=ROUND_DOWN) * lot_step
    return volume if volume >= min_lot else Decimal('0')


@dataclass(frozen=True)
class PaperOrder:
    id: str
    account_id: str
    symbol: str
    side: str
    quantity: str
    entry: str
    stop_loss: str
    take_profit: str
    expires_at: int
    status: str = 'ACCEPTED_SIMULATED'
    execution_mode: str = 'paper'


class PaperBroker:
    def __init__(self, database: str = ':memory:'):
        self._lock = RLock()
        self._db = sqlite3.connect(database, check_same_thread=False, timeout=10, isolation_level=None)
        self._db.execute('CREATE TABLE IF NOT EXISTS paper_orders (account_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id, request_key))')

    def close(self) -> None:
        self._db.close()

    def place(self, *, account_id: str, key: str, symbol: str, side: str,
              quantity: Decimal, entry: Decimal, stop_loss: Decimal,
              take_profit: Decimal, expires_at: int) -> PaperOrder:
        account_id = str(UUID(account_id))
        if not isinstance(key, str) or not 1 <= len(key.strip()) <= 128:
            raise ValueError('Invalid request key')
        if symbol != 'XAUUSD' or side not in ('BUY', 'SELL'):
            raise ValueError('Unsupported instrument or side')
        for label, value in [('quantity', quantity), ('entry', entry), ('stop_loss', stop_loss), ('take_profit', take_profit)]:
            positive(value, label)
        if quantity > 1 or quantity % Decimal('0.01'):
            raise ValueError('Invalid quantity or step')
        if not ((side == 'BUY' and stop_loss < entry < take_profit) or
                (side == 'SELL' and take_profit < entry < stop_loss)):
            raise ValueError('Invalid protective-order geometry')
        if type(expires_at) is not int:
            raise ValueError('Expiry must be integer epoch seconds')
        payload = dict(account_id=account_id, symbol=symbol, side=side,
                       quantity=str(quantity.normalize()), entry=str(entry.normalize()),
                       stop_loss=str(stop_loss.normalize()), take_profit=str(take_profit.normalize()),
                       expires_at=expires_at)
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self._lock:
            self._db.execute('BEGIN IMMEDIATE')
            try:
                previous = self._db.execute('SELECT fingerprint,payload FROM paper_orders WHERE account_id=? AND request_key=?', (account_id, key)).fetchone()
                if previous:
                    if previous[0] != fingerprint:
                        raise ValueError('Idempotency key reused with a different payload')
                    order = PaperOrder(**json.loads(previous[1]))
                else:
                    if not time.time() < expires_at <= time.time() + 3600:
                        raise ValueError('Expired or excessively long signal lifetime')
                    order = PaperOrder(id=str(uuid4()), **payload)
                    self._db.execute('INSERT INTO paper_orders VALUES (?,?,?,?)', (account_id, key, fingerprint, json.dumps(asdict(order))))
                self._db.execute('COMMIT')
                return order
            except Exception:
                self._db.execute('ROLLBACK')
                raise

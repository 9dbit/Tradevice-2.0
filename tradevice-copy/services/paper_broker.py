from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

@dataclass(frozen=True)
class PaperFill:
    id: str
    symbol: str
    side: str
    quantity: Decimal
    execution_mode: str = "paper"

class PaperBroker:
    """Memory-only simulation; no external broker connectivity."""
    def __init__(self):
        self._orders: dict[str, PaperFill] = {}

    def place(self, *, key: str, symbol: str, side: str, quantity: Decimal) -> PaperFill:
        if not key or symbol != "XAUUSD" or side not in ("BUY", "SELL"):
            raise ValueError("Invalid paper order")
        if quantity <= 0 or quantity > Decimal("1"):
            raise ValueError("Volume outside paper limits")
        if key not in self._orders:
            self._orders[key] = PaperFill(str(uuid4()), symbol, side, quantity)
        return self._orders[key]

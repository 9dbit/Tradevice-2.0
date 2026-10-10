from decimal import Decimal
import pytest
from paper_broker import PaperBroker

def test_idempotent_paper_order():
    broker = PaperBroker()
    a = broker.place(key="s1:a1", symbol="XAUUSD", side="BUY", quantity=Decimal("0.01"))
    b = broker.place(key="s1:a1", symbol="XAUUSD", side="BUY", quantity=Decimal("0.01"))
    assert a.id == b.id
    assert a.execution_mode == "paper"

def test_reject_invalid_volume():
    with pytest.raises(ValueError):
        PaperBroker().place(key="a", symbol="XAUUSD", side="BUY", quantity=Decimal("2"))

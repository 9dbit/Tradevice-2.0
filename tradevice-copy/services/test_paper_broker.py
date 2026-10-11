from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from decimal import Decimal as D
import time
import pytest
from paper_broker import PaperBroker, size_for_risk

A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
def args(**patch):
    return dict(account_id=A, key='signal-1', symbol='XAUUSD', side='BUY', quantity=D('.01'),
                entry=D('4000'), stop_loss=D('3990'), take_profit=D('4020'), expires_at=int(time.time())+60) | patch

@pytest.fixture
def broker():
    b = PaperBroker()
    yield b
    b.close()

def test_no_fabricated_fill(broker):
    result = asdict(broker.place(**args()))
    assert result['status'] == 'ACCEPTED_SIMULATED'
    assert result['execution_mode'] == 'paper'
    assert 'fill_price' not in result

def test_deduplication(broker):
    p = args()
    assert broker.place(**p).id == broker.place(**p).id

def test_conflicting_replay(broker):
    p = args()
    broker.place(**p)
    with pytest.raises(ValueError, match='different payload'):
        broker.place(**(p | dict(quantity=D('.02'))))

def test_accounts_have_separate_idempotency_keys(broker):
    p = args()
    assert broker.place(**p).id != broker.place(**(p | dict(account_id=B))).id

def test_restart_persistence(tmp_path):
    file = str(tmp_path / 'paper.sqlite')
    p = args()
    b = PaperBroker(file)
    first = b.place(**p)
    b.close()
    b = PaperBroker(file)
    assert b.place(**p) == first
    b.close()

def test_concurrent_deduplication(broker):
    p = args()
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(lambda _: broker.place(**p).id, range(32)))
    assert len(set(ids)) == 1

@pytest.mark.parametrize('patch', [dict(quantity=D('0')),dict(quantity=D('-1')),dict(quantity=D('NaN')),
    dict(quantity=D('Infinity')),dict(quantity=D('1.01')),dict(quantity=D('.001')),dict(quantity=.01),
    dict(entry=D('0')),dict(stop_loss=D('0')),dict(stop_loss=D('4001')),dict(take_profit=D('3999')),
    dict(side='HOLD'),dict(symbol='EURUSD'),dict(key=''),dict(key=' '),dict(key='x'*129),
    dict(account_id='not-a-uuid'),dict(expires_at=0),dict(expires_at=True),dict(expires_at=9999999999)])
def test_invalid_orders_are_rejected(broker, patch):
    with pytest.raises(ValueError):
        broker.place(**args(**patch))

def test_sell_geometry(broker):
    assert broker.place(**args(side='SELL',stop_loss=D('4010'),take_profit=D('3980'))).side == 'SELL'

def test_size_rounds_down():
    volume = size_for_risk(equity=D('1000'), risk_pct=D('.25'), entry=D('4000'), stop_loss=D('3997'), tick_size=D('.01'), tick_value=D('1'))
    assert volume == 0

def test_risk_budget():
    volume = size_for_risk(equity=D('5000'),risk_pct=D('.25'),entry=D('4000'),stop_loss=D('3997'),tick_size=D('.01'),tick_value=D('1'))
    assert volume == D('.04')
    assert volume * D('300') <= D('12.5')

@pytest.mark.parametrize('risk',[D('0'),D('-1'),D('1.01'),D('NaN'),D('Infinity')])
def test_invalid_risk(risk):
    with pytest.raises(ValueError):
        size_for_risk(equity=D('1000'),risk_pct=risk,entry=D('4000'),stop_loss=D('3990'),tick_size=D('.01'),tick_value=D('1'))

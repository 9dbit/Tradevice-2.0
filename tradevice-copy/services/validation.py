"""Phase 4 synthetic-only replay. Never infer returns from missing prices."""
from dataclasses import dataclass
from decimal import Decimal
import json
from pathlib import Path


def finite(value,name,positive=False):
    if not isinstance(value,Decimal) or not value.is_finite() or (positive and value<=0):
        raise ValueError("invalid "+name)
    return value


@dataclass(frozen=True)
class SimulatedExit:
    key: str
    side: str
    entry: Decimal
    exit: Decimal
    lots: Decimal
    fees_usd: Decimal = Decimal("0")
    contract_oz_per_lot: Decimal = Decimal("100")
    provenance: str = "synthetic"

    def pnl(self):
        if self.provenance!="synthetic" or self.side not in ("BUY","SELL") or not self.key:
            raise ValueError("labelled synthetic exit required")
        for k in ("entry","exit","lots","contract_oz_per_lot"):
            finite(getattr(self,k),k,True)
        finite(self.fees_usd,"fees")
        if self.fees_usd<0:
            raise ValueError("negative fees")
        direction=Decimal(1) if self.side=="BUY" else Decimal(-1)
        return (self.exit-self.entry)*direction*self.lots*self.contract_oz_per_lot-self.fees_usd


def evaluate(trades,initial_equity=Decimal("1000"),continuity_cycles=0,degraded_cycles=0):
    finite(initial_equity,"initial_equity",True)
    if type(continuity_cycles) is not int or type(degraded_cycles) is not int or not 0<=degraded_cycles<=continuity_cycles:
        raise ValueError("invalid cycle counters")
    equity=peak=initial_equity
    worst_dd=profits=loss_total=Decimal(0)
    wins=losses=flats=streak=longest=0
    seen=set()
    for trade in trades:
        if not isinstance(trade,SimulatedExit) or trade.key in seen:
            raise ValueError("duplicate or invalid exit")
        seen.add(trade.key)
        pnl=trade.pnl()
        equity+=pnl
        if equity<=0:
            raise ValueError("insolvent replay")
        peak=max(peak,equity)
        worst_dd=max(worst_dd,(peak-equity)/peak*100)
        if pnl>0:
            wins+=1
            profits+=pnl
            streak=0
        elif pnl<0:
            losses+=1
            loss_total-=pnl
            streak+=1
            longest=max(longest,streak)
        else:
            flats+=1
            streak=0
    f=lambda v: str(v.quantize(Decimal(".0001")))
    n=len(seen)
    return {
        "provenance":"SYNTHETIC_REPLAY_ONLY","sample_size":n,
        "wins":wins,"losses":losses,"breakeven":flats,
        "win_rate_pct":f(Decimal(wins)*100/n) if n else None,
        "profit_factor":f(profits/loss_total) if loss_total else None,
        "net_pnl_usd":f(equity-initial_equity),
        "gross_profit_usd":f(profits),"gross_loss_usd":f(loss_total),
        "max_drawdown_pct":f(worst_dd),
        "final_equity_usd":f(equity),"longest_loss_streak":longest,
        "continuity_cycles":continuity_cycles,"degraded_cycles":degraded_cycles,
        "healthy_cycle_pct":f(Decimal(continuity_cycles-degraded_cycles)*100/continuity_cycles) if continuity_cycles else None,
        "slippage":"NOT_MEASURED","win_probability":"NOT_ESTIMATED",
        "live_decision":"NOT_AUTHORIZED",
    }


def replay_file(path):
    obj=json.loads(Path(path).read_text(encoding="utf8"))
    if obj.get("provenance")!="synthetic" or not isinstance(obj.get("trades"),list):
        raise ValueError("replay requires synthetic provenance")
    trs=[SimulatedExit(key=t["key"],side=t["side"],entry=Decimal(str(t["entry"])),
         exit=Decimal(str(t["exit"])),lots=Decimal(str(t["lots"])),
         fees_usd=Decimal(str(t.get("fees_usd","0")))) for t in obj["trades"]]
    return evaluate(trs,initial_equity=Decimal(str(obj.get("initial_equity","1000"))),
       continuity_cycles=int(obj.get("continuity_cycles",0)),
       degraded_cycles=int(obj.get("degraded_cycles",0)))


if __name__=="__main__":
    import argparse
    p=argparse.ArgumentParser(description="Offline labelled synthetic paper replay")
    p.add_argument("scenario")
    print(json.dumps(replay_file(p.parse_args().scenario),sort_keys=True,indent=2))

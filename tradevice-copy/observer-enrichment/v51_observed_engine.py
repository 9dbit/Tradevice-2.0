"""Optional runner instrumentation. Observes existing calculations without broker reads."""
import time
from goldtrap_arc.execution import ArcExecutionEngine
from v51_engine_diagnostics import make_report,write_diagnostics

class ObservedArcExecutionEngine(ArcExecutionEngine):
    def __init__(self,*args,diagnostic_sink=write_diagnostics,diagnostic_clock=None,**kwargs):
        super().__init__(*args,**kwargs)
        self._diagnostic_sink=diagnostic_sink
        self._diagnostic_clock=diagnostic_clock or (lambda:int(time.time()*1000))
        self._diagnostic_pnl=None
        self._diagnostic_last=-10000
        self.diagnostic_write_failed=False

    def total_pl(self,snap):
        value=super().total_pl(snap)
        self._diagnostic_pnl=dict(cycle_id=self.state.get('cycle_id'),
            at_ms=self._diagnostic_clock(),tick_ms=int(snap.tick.time_msc),value=value,
            basis='ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED')
        return value

    def exact_total_pl(self,snap):
        value=super().exact_total_pl(snap)
        self._diagnostic_pnl=dict(cycle_id=self.state.get('cycle_id'),
            at_ms=self._diagnostic_clock(),tick_ms=int(snap.tick.time_msc),value=value,
            basis='ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED')
        return value

    def step(self):
        self._diagnostic_pnl=None
        try:return super().step()
        finally:
            now=self._diagnostic_clock()
            if now-self._diagnostic_last>=250 or str(self.state.get('state','')).startswith('COMPLETE'):
                self._diagnostic_last=now
                try:
                    self._diagnostic_sink(make_report(self,now,self._diagnostic_pnl))
                    self.diagnostic_write_failed=False
                except Exception:
                    # Diagnostic failures must never interrupt basket supervision.
                    # The previous report expires; errors never change trading state.
                    self.diagnostic_write_failed=True

"""Version-pinned, reviewable patch for the private local V5.1 adapter.

Only applies to the isolated clone. Never uploads the original engine source.
"""
import hashlib

EXPECTED_SHA256 = "a5c426d59d8b7773457e6b4b4ae7b7e9e483b90ea49daad25a709da8722dc1ae"
ANCHOR = "class ResearchBatchAdapter(BatchAdapter):\n def validate_adaptive(self,cycle,side,layer,lot):"
REPLACEMENT = """class ResearchBatchAdapter(BatchAdapter):
 def _write(self,request,**kwargs):
  # Entry-only gross booked exposure guard. Existing pending BUY/SELL and
  # all positions are counted before every new broker order request.
  # Never deny CLOSE, CANCEL, or TP synchronization under this limit.
  if kwargs.get('operation') in ('TRAP_PENDING','FIXED_PENDING','ADAPTIVE_MARKET','MARKET_ENTRY'):
   from v51_exposure_policy import check_dispatch,ResearchRiskBlocked
   try:
    snap=self.guard_book(kwargs.get('cycle_id'),fresh=True)
    check_dispatch(snap.positions,snap.orders,request.get('volume'))
   except ResearchRiskBlocked as exc:
    raise ArcSafetyError(str(exc)) from None
  return super()._write(request,**kwargs)

 def validate_adaptive(self,cycle,side,layer,lot):"""


def digest(value):
    return hashlib.sha256(value).hexdigest()


def patch_adapter(source):
    if type(source) is not bytes or digest(source) != EXPECTED_SHA256:
        raise ValueError("ADAPTER_UNPINNED_SOURCE")
    text = source.decode("utf-8")
    if text.count(ANCHOR) != 1:
        raise ValueError("ADAPTER_EXPECTED_ENTRY_HOOK_MISSING")
    result = text.replace(ANCHOR, REPLACEMENT).encode("utf-8")
    compile(result, "v51_batch_research.py", "exec")
    if result == source or result.count(b"EXPOSURE_DISPATCH_CAP_EXCEEDED") != 0:
        # The error is emitted by the policy module, not hardcoded here.
        raise ValueError("ADAPTER_PATCH_UNEXPECTED")
    return result

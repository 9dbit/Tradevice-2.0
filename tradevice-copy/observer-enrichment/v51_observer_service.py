"""Persistent staging DEMO read-only telemetry. No broker order methods."""
import ctypes
from pathlib import Path
import time
import urllib.error
from goldtrap_arc.persistence import atomic_json

ROOT=Path(__file__).resolve().parent
STATUS=ROOT/"read_only"/"observer_connection_status.json"
STOP=ROOT/"read_only"/"observer_connection.stop"

def write_status(output):
    # Unique temp file plus bounded Windows sharing-violation retries.
    atomic_json(STATUS, output)

def observer_loop(api, secret, *, sender, status_writer=write_status,
                  stop_requested=lambda:STOP.exists(), sleeper=time.sleep,
                  now_ms=lambda:time.time_ns()//1000000, monotonic=time.monotonic):
    accepted=failures=consecutive=status_write_failures=0
    last_accepted=batch_ack=None
    while not stop_requested():
        started=monotonic()
        status="UNKNOWN"
        error=None
        try:
            result=sender(api,secret=secret)
            status=result["status"]
            accepted+=1
            consecutive=0
            last_accepted=now_ms()
            batch_ack=result.get('demo_batch_ack')
        except urllib.error.HTTPError as exc:
            error="HTTP_"+str(exc.code)
        except ValueError as exc:
            error=str(exc)[:100]
        except Exception as exc:
            error=type(exc).__name__
        if error:
            failures+=1
            consecutive+=1
        output=dict(status=status,error=error,observed_utc_ms=now_ms(),
                    last_accepted_utc_ms=last_accepted,accepted=accepted,failed=failures,
                    demo_batch_ack=batch_ack,status_write_failures=status_write_failures,
                    cycle_duration_ms=round((monotonic()-started)*1000),target_interval_ms=500,
                    read_only=True,trading_ready=False,order_dispatch_authorized=False)
        try:
            status_writer(output)
        except OSError:
            # A busy/missing/unwritable status file must not kill the publisher.
            # The previous status naturally expires; retry on the next bounded poll.
            status_write_failures+=1
        delay=min(60,4*2**min(consecutive,4)) if consecutive else max(.01,.5-(monotonic()-started))
        while delay>0 and not stop_requested():
            step=min(delay,.25);sleeper(step);delay-=step

def run():
    # OS releases this lock on process exit/crash; concurrent tasks cannot publish.
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p]
    kernel.CreateMutexW.restype=ctypes.c_void_p
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.CreateMutexW(None,False,"Local\\TradeviceV51ReadOnlyObserver")
    if not handle:raise RuntimeError("OBSERVER_MUTEX_FAILED")
    if ctypes.get_last_error()==183:
        kernel.CloseHandle(handle)
        return
    try:
        import MetaTrader5 as mt5
        from v51_staging_readonly_forwarder import send_once,load_dpapi_secret,PersistentClient
        secret=load_dpapi_secret()
        client=PersistentClient()
        try:observer_loop(mt5,secret,sender=lambda api,secret:send_once(api,client=client,secret=secret))
        finally:client.close()
    finally:
        kernel.CloseHandle(handle)

if __name__=="__main__":run()

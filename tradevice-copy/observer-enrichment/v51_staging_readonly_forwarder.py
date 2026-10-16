"""Bounded staging-only one-way MT5 read-only HMAC forwarder.

No order API, no database, no unbounded scheduling, no arbitrary URL argument.
Read a dedicated secret from current-user Windows DPAPI encrypted storage.
"""
import argparse
import http.client
import hashlib
import hmac
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from v51_mt5_readonly_snapshot import capture

ENDPOINT="https://copy-api-staging-4c33.up.railway.app/internal/master/observer"
SECRET_FILE=pathlib.Path(r"D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013\read_only\observer_secret.dpapi")
EXPECTED_SCHEMA="tradevice.v51.mt5.readonly.v1"

class PersistentClient:
    """Pinned HTTPS connection; no redirects, no replay after an ambiguous failure."""
    def __init__(self,factory=http.client.HTTPSConnection,endpoint=ENDPOINT):
        allowed={ENDPOINT,ENDPOINT.rsplit("/",1)[0]+"/growth",ENDPOINT.rsplit("/",1)[0]+"/terminal"}
        if endpoint not in allowed:raise ValueError("OBSERVER_ENDPOINT_INVALID")
        self.endpoint=endpoint;self.path="/internal/master/"+endpoint.rsplit("/",1)[-1]
        self.factory=factory;self.connection=None
    def close(self):
        if self.connection:self.connection.close()
        self.connection=None
    def open(self,request,timeout=7):
        if request.full_url!=self.endpoint:raise ValueError('OBSERVER_ENDPOINT_INVALID')
        try:
            if self.connection is None:self.connection=self.factory('copy-api-staging-4c33.up.railway.app',timeout=timeout)
            self.connection.request('POST',self.path,request.data,dict(request.header_items()))
            response=self.connection.getresponse()
            if response.status!=202:
                code=response.status;self.close();raise ValueError('OBSERVER_API_STATUS_'+str(code))
            return response
        except Exception:
            self.close();raise

class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("OBSERVER_REDIRECT_BLOCKED")

def load_dpapi_secret():
    # Secrets never appear in command-line arguments, files in cleartext or logs.
    # PowerShell returns the current user's DPAPI-decrypted secret to this process
    # through its in-memory stdout pipe.
    cmd=(
      "$ErrorActionPreference='Stop';"
      "$s=(Get-Content -LiteralPath '"+str(SECRET_FILE)+"' -Raw).Trim() "
      "| ConvertTo-SecureString;"
      "$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);"
      "try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}"
      "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"
    )
    r=subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",cmd],
      capture_output=True,text=True,timeout=12,check=True)
    secret=r.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{64}",secret):
        raise RuntimeError("STAGING_OBSERVER_SECRET_UNAVAILABLE")
    return secret

def prepare_payload(packet):
    if (packet.get("schema")!=EXPECTED_SCHEMA or
        packet.get("status")!="LOCAL_FRESH_NOT_ATTESTED" or
        packet.get("read_only") is not True or
        packet.get("trading_ready") is not False or
        packet.get("order_dispatch_authorized") is not False):
        raise ValueError("OBSERVER_OR_MARKET_NOT_READONLY_FRESH")
    broker=packet.get("broker",{})
    if (broker.get("server")!="Exness-MT5Trial14" or
        broker.get("trade_mode")!="DEMO" or
        broker.get("account_last4")!="9834" or
        broker.get("symbol")!="XAUUSDm"):
        raise ValueError("OBSERVER_DEMO_IDENTITY_MISMATCH")
    m=packet.get("market",{})
    if not (0<=m.get("quote_age_ms",9999999)<=2000 and
            0<=m.get("closed_m1_age_ms",9999999)<=90000):
        raise ValueError("OBSERVER_QUOTE_STALE")
    raw=json.dumps(packet,sort_keys=True,separators=(",",":")).encode("utf-8")
    if len(raw)>8192:
        raise ValueError("OBSERVER_BODY_TOO_LARGE")
    return raw

def signature(secret, timestamp, body):
    if not re.fullmatch(r"[0-9a-f]{64}",secret):
        raise ValueError("SIGNING_SECRET_INVALID")
    return hmac.new(bytes.fromhex(secret),str(timestamp).encode("ascii")+b"\n"+body,
                    hashlib.sha256).hexdigest()

def send_once(api, client=None,secret=None):
    now_ms=time.time_ns()//1000000
    packet=capture(api,now_ms,clock=lambda:time.time_ns()//1000000)
    body=prepare_payload(packet)
    if secret is None:secret=load_dpapi_secret()
    sent_ms=time.time_ns()//1000000
    if sent_ms-int(packet["collected_utc_ms"])>8000:
        raise ValueError("SNAPSHOT_EXPIRED_BEFORE_FORWARD")
    req=urllib.request.Request(ENDPOINT,data=body,method="POST",headers={
      "Content-Type":"application/json","User-Agent":"Tradevice-V51-ReadOnly",
      "x-tradevice-observer-time":str(sent_ms),
      "x-tradevice-observer-signature":signature(secret,sent_ms,body),
    })
    opener=client if client is not None else urllib.request.build_opener(NoRedirects())
    with opener.open(req,timeout=7) as response:
        answer=response.read(4097)
        if len(answer)>4096:raise ValueError("OBSERVER_RESPONSE_TOO_LARGE")
        if response.status!=202:
            raise ValueError("OBSERVER_API_STATUS_"+str(response.status))
    result=json.loads(answer)
    if result.get("status")!="ACCEPTED_READ_ONLY" or result.get("tradingReady") is not False:
        raise ValueError("OBSERVER_API_UNEXPECTED_RESPONSE")
    ack=result.get("demoBatchAck")
    batch=packet.get("demo_batch")
    if batch is not None:
        if (not isinstance(ack,dict) or ack.get("batch_id")!=batch.get("batch_id")
            or ack.get("observed_ms")!=batch.get("observed_ms")
            or type(ack.get("completed")) is not int or not 0<=ack["completed"]<=10):
            raise ValueError("BATCH_TELEMETRY_NOT_ACKNOWLEDGED")
    return {"status":"ACCEPTED_READ_ONLY","quote_age_ms":packet["market"]["quote_age_ms"],"demo_batch_ack":ack}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--samples",type=int,default=1)
    parser.add_argument("--interval-seconds",type=int,default=1)
    a=parser.parse_args()
    if not (1<=a.samples<=30 and 1<=a.interval_seconds<=10):
        parser.error("1..30 samples, 1..10 interval-seconds only")
    import MetaTrader5 as mt5
    success=0
    for i in range(a.samples):
        try:
            result=send_once(mt5)
            success+=1
            print("READONLY_UPLOADED="+str(i+1)+" QUOTE_AGE_MS="+str(result["quote_age_ms"]),flush=True)
        except (ValueError,RuntimeError,urllib.error.HTTPError,urllib.error.URLError) as e:
            # Never dump private data, body or secret from an exception.
            print("READONLY_UPLOAD_SKIPPED="+type(e).__name__,flush=True)
        except Exception:
            print("READONLY_UPLOAD_EXCEPTION_REDACTED",flush=True)
        if i+1<a.samples:time.sleep(a.interval_seconds)
    print("SUMMARY_SAMPLES="+str(a.samples)+" ACCEPTED="+str(success)+" REJECTED_OR_STALE="+str(a.samples-success),flush=True)
    print("TRADING_READY=False ORDER_DISPATCH=False",flush=True)
    return 0 if success else 2

if __name__=="__main__":
    raise SystemExit(main())

#property strict
#property version   "1.22"
#property description "Tradevice 2.0 observer bridge. Sends market snapshots only; no order execution."

input string ApiBase = "https://tradevice-api-production.up.railway.app";
input string ApiKey = "";
input string CanonicalSymbol = "XAUUSD";
input string TradeSymbol = ""; // Blank = auto-detect broker symbol from chart, e.g. XAUUSDm
input int M1Bars = 60;
input int M5Bars = 36;
input int M15Bars = 16;
input int RequestTimeoutMs = 5000;
input int RetrySeconds = 10;

static datetime lastM1Bar = 0;
static datetime lastRetryAttempt = 0;
static string resolvedSymbol = "";
static bool snapshotChannelReady = false;

string IsoUtc(datetime t)
{
   MqlDateTime d;
   TimeToStruct(t, d);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", d.year, d.mon, d.day, d.hour, d.min, d.sec);
}

bool TrySymbol(string symbol)
{
   if(StringLen(symbol) == 0) return false;
   if(!SymbolSelect(symbol, true)) return false;
   resolvedSymbol = symbol;
   return true;
}

bool ResolveBrokerSymbol()
{
   if(StringFind(_Symbol, CanonicalSymbol) >= 0 && TrySymbol(_Symbol)) return true;
   if(StringLen(TradeSymbol) > 0 && TrySymbol(TradeSymbol)) return true;
   if(TrySymbol(CanonicalSymbol)) return true;

   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string candidate = SymbolName(i, false);
      if(StringFind(candidate, CanonicalSymbol) >= 0 && TrySymbol(candidate)) return true;
   }

   return false;
}

string RatesJson(string symbol, ENUM_TIMEFRAMES timeframe, int count)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(symbol, timeframe, 1, count, rates);
   if(copied <= 0) return "[]";

   string out = "[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) out += ",";
      out += StringFormat(
         "{\"timestamp\":\"%s\",\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"tick_volume\":%I64d}",
         IsoUtc(rates[i].time),
         rates[i].open,
         rates[i].high,
         rates[i].low,
         rates[i].close,
         (long)rates[i].tick_volume
      );
   }
   out += "]";
   return out;
}

bool SendSnapshot()
{
   if(StringLen(resolvedSymbol) == 0)
   {
      Print("Tradevice: broker symbol is not resolved.");
      return false;
   }

   MqlTick tick;
   if(!SymbolInfoTick(resolvedSymbol, tick))
   {
      Print("Tradevice: SymbolInfoTick failed for broker symbol ", resolvedSymbol);
      return false;
   }

   double point = SymbolInfoDouble(resolvedSymbol, SYMBOL_POINT);
   double spreadPoints = point > 0 ? (tick.ask - tick.bid) / point : 0;

   string m1 = RatesJson(resolvedSymbol, PERIOD_M1, M1Bars);
   string m5 = RatesJson(resolvedSymbol, PERIOD_M5, M5Bars);
   string m15 = RatesJson(resolvedSymbol, PERIOD_M15, M15Bars);

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"M1\",\"timestamp\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"spread_points\":%.2f,\"candles\":%s,\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"margin_free\":%.2f,\"positions_total\":%d,\"orders_total\":%d},\"features\":{\"bridge_version\":\"1.22\",\"broker_symbol\":\"%s\",\"terminal_build\":%d,\"terminal_connected\":%s,\"point_size\":%.8f,\"m5_candles\":%s,\"m15_candles\":%s}}",
      CanonicalSymbol,
      IsoUtc(TimeGMT()),
      tick.bid,
      tick.ask,
      spreadPoints,
      m1,
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      PositionsTotal(),
      OrdersTotal(),
      resolvedSymbol,
      (int)TerminalInfoInteger(TERMINAL_BUILD),
      TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false",
      point,
      m5,
      m15
   );

   char data[];
   char result[];
   string resultHeaders;
   StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(data) > 0) ArrayResize(data, ArraySize(data) - 1);

   string headers = "Content-Type: application/json\r\n";
   if(StringLen(ApiKey) > 0)
      headers += "Authorization: Bearer " + ApiKey + "\r\n";
   else
      Print("Tradevice warning: ApiKey is blank. Protected Railway endpoint will reject the snapshot.");

   string url = ApiBase + "/api/v1/market/snapshots";
   ResetLastError();
   int status = WebRequest("POST", url, headers, RequestTimeoutMs, data, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4014)
      {
         Print("Tradevice WebRequest blocked by MT5 (error 4014). Add exactly this URL to Tools > Options > Expert Advisors > Allow WebRequest: ", ApiBase);
      }
      else
      {
         Print("Tradevice WebRequest failed. MT5 error=", err, " url=", ApiBase);
      }
      return false;
   }

   string body = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("Tradevice HTTP error status=", status, " body=", body);
      return false;
   }

   Print("Tradevice snapshot accepted: broker=", resolvedSymbol, " canonical=", CanonicalSymbol, " response=", body);
   return true;
}

int OnInit()
{
   if(!ResolveBrokerSymbol())
   {
      Print("Tradevice: cannot resolve broker symbol for ", CanonicalSymbol, ". Attach Observer to the broker's gold M1 chart or set TradeSymbol manually.");
      return INIT_FAILED;
   }

   EventSetTimer(1);
   lastM1Bar = iTime(resolvedSymbol, PERIOD_M1, 0);
   Print("Tradevice Observer v1.22 started. Broker symbol=", resolvedSymbol, ", canonical=", CanonicalSymbol, ". Execution is disabled by design.");

   lastRetryAttempt = TimeCurrent();
   snapshotChannelReady = SendSnapshot();
   if(!snapshotChannelReady)
      Print("Tradevice: initial snapshot failed. Will retry every ", RetrySeconds, " seconds until the bridge is connected.");
   else
      Print("Tradevice: bridge CONNECTED. Future snapshots will be sent on each new M1 bar.");

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   datetime now = TimeCurrent();

   if(!snapshotChannelReady)
   {
      int retry = MathMax(2, RetrySeconds);
      if((now - lastRetryAttempt) >= retry)
      {
         lastRetryAttempt = now;
         snapshotChannelReady = SendSnapshot();
         if(snapshotChannelReady)
         {
            lastM1Bar = iTime(resolvedSymbol, PERIOD_M1, 0);
            Print("Tradevice: bridge CONNECTED after retry.");
         }
      }
      return;
   }

   datetime currentM1Bar = iTime(resolvedSymbol, PERIOD_M1, 0);
   if(currentM1Bar <= 0 || currentM1Bar == lastM1Bar) return;

   lastM1Bar = currentM1Bar;
   if(!SendSnapshot())
   {
      snapshotChannelReady = false;
      lastRetryAttempt = now;
      Print("Tradevice: bridge became unavailable. Retry mode enabled.");
   }
}

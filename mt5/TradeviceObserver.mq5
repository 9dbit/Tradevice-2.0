#property strict
#property version   "0.10"
#property description "Tradevice 2.0 observer bridge. Sends market snapshots only; no order execution."

input string ApiBase = "https://tradevice-api-production.up.railway.app";
input string ApiKey = "";
input string TradeSymbol = "XAUUSD";
input int M1Bars = 60;
input int M5Bars = 36;
input int M15Bars = 16;
input int RequestTimeoutMs = 5000;

static datetime lastM1Bar = 0;

string IsoUtc(datetime t)
{
   MqlDateTime d;
   TimeToStruct(t, d);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", d.year, d.mon, d.day, d.hour, d.min, d.sec);
}

string RatesJson(string symbol, ENUM_TIMEFRAMES timeframe, int count)
{
   MqlRates rates[];
   int copied = CopyRates(symbol, timeframe, 1, count, rates);
   if(copied <= 0) return "[]";

   string out = "[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) out += ",";
      out += StringFormat(
         "{\"timestamp\":\"%I64d\",\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"tick_volume\":%I64d}",
         (long)rates[i].time,
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
   MqlTick tick;
   if(!SymbolInfoTick(TradeSymbol, tick))
   {
      Print("Tradevice: SymbolInfoTick failed for ", TradeSymbol);
      return false;
   }

   double point = SymbolInfoDouble(TradeSymbol, SYMBOL_POINT);
   double spreadPoints = point > 0 ? (tick.ask - tick.bid) / point : 0;

   string m1 = RatesJson(TradeSymbol, PERIOD_M1, M1Bars);
   string m5 = RatesJson(TradeSymbol, PERIOD_M5, M5Bars);
   string m15 = RatesJson(TradeSymbol, PERIOD_M15, M15Bars);

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"M1\",\"timestamp\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"spread_points\":%.2f,\"candles\":%s,\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"margin_free\":%.2f},\"features\":{\"point_size\":%.8f,\"m5_candles\":%s,\"m15_candles\":%s}}",
      TradeSymbol,
      IsoUtc(TimeGMT()),
      tick.bid,
      tick.ask,
      spreadPoints,
      m1,
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
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

   string url = ApiBase + "/api/v1/market/snapshots";
   ResetLastError();
   int status = WebRequest("POST", url, headers, RequestTimeoutMs, data, result, resultHeaders);

   if(status == -1)
   {
      Print("Tradevice WebRequest failed. MT5 error=", GetLastError(), ". Add ApiBase to Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }

   string body = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("Tradevice HTTP error status=", status, " body=", body);
      return false;
   }

   Print("Tradevice snapshot accepted: ", body);
   return true;
}

int OnInit()
{
   if(!SymbolSelect(TradeSymbol, true))
   {
      Print("Tradevice: cannot select symbol ", TradeSymbol);
      return INIT_FAILED;
   }

   EventSetTimer(1);
   lastM1Bar = iTime(TradeSymbol, PERIOD_M1, 0);
   Print("Tradevice Observer started for ", TradeSymbol, ". Execution is disabled by design.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   datetime currentM1Bar = iTime(TradeSymbol, PERIOD_M1, 0);
   if(currentM1Bar <= 0 || currentM1Bar == lastM1Bar) return;

   lastM1Bar = currentM1Bar;
   SendSnapshot();
}

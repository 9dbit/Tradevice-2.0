#property strict
#property version   "2.00"
#property description "Tradevice 2.0 read-only observer. Market M1 + broker account sync; no order execution."

input string ApiBase = "https://tradevice-api-production.up.railway.app";
input string ApiKey = "";
input string CanonicalSymbol = "XAUUSD";
input string TradeSymbol = ""; // Blank = auto-detect broker symbol from chart, e.g. XAUUSDm
input int M1Bars = 60;
input int M5Bars = 36;
input int M15Bars = 16;
input int RequestTimeoutMs = 5000;
input int RetrySeconds = 10;
input int BrokerSyncSeconds = 3;
input int HistorySyncSeconds = 30;
input int HistoryDays = 35;
input int MaxHistoryDeals = 500;

static datetime lastM1Bar = 0;
static datetime lastRetryAttempt = 0;
static datetime lastBrokerSync = 0;
static datetime lastHistorySync = 0;
static string resolvedSymbol = "";
static bool snapshotChannelReady = false;

string IsoUtc(datetime t)
{
   MqlDateTime d;
   TimeToStruct(t, d);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", d.year, d.mon, d.day, d.hour, d.min, d.sec);
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

bool IsTradeviceSymbol(string symbol)
{
   if(symbol == resolvedSymbol) return true;
   return StringFind(symbol, CanonicalSymbol) >= 0;
}

string PositionTypeName(long type)
{
   if(type == POSITION_TYPE_BUY) return "BUY";
   if(type == POSITION_TYPE_SELL) return "SELL";
   return IntegerToString((int)type);
}

string OrderTypeName(long type)
{
   switch((ENUM_ORDER_TYPE)type)
   {
      case ORDER_TYPE_BUY: return "BUY";
      case ORDER_TYPE_SELL: return "SELL";
      case ORDER_TYPE_BUY_LIMIT: return "BUY_LIMIT";
      case ORDER_TYPE_SELL_LIMIT: return "SELL_LIMIT";
      case ORDER_TYPE_BUY_STOP: return "BUY_STOP";
      case ORDER_TYPE_SELL_STOP: return "SELL_STOP";
      case ORDER_TYPE_BUY_STOP_LIMIT: return "BUY_STOP_LIMIT";
      case ORDER_TYPE_SELL_STOP_LIMIT: return "SELL_STOP_LIMIT";
      case ORDER_TYPE_CLOSE_BY: return "CLOSE_BY";
   }
   return IntegerToString((int)type);
}

string OrderStateName(long state)
{
   switch((ENUM_ORDER_STATE)state)
   {
      case ORDER_STATE_STARTED: return "STARTED";
      case ORDER_STATE_PLACED: return "PLACED";
      case ORDER_STATE_CANCELED: return "CANCELED";
      case ORDER_STATE_PARTIAL: return "PARTIAL";
      case ORDER_STATE_FILLED: return "FILLED";
      case ORDER_STATE_REJECTED: return "REJECTED";
      case ORDER_STATE_EXPIRED: return "EXPIRED";
      case ORDER_STATE_REQUEST_ADD: return "REQUEST_ADD";
      case ORDER_STATE_REQUEST_MODIFY: return "REQUEST_MODIFY";
      case ORDER_STATE_REQUEST_CANCEL: return "REQUEST_CANCEL";
   }
   return IntegerToString((int)state);
}

string DealTypeName(long type)
{
   switch((ENUM_DEAL_TYPE)type)
   {
      case DEAL_TYPE_BUY: return "BUY";
      case DEAL_TYPE_SELL: return "SELL";
      case DEAL_TYPE_BALANCE: return "BALANCE";
      case DEAL_TYPE_CREDIT: return "CREDIT";
      case DEAL_TYPE_CHARGE: return "CHARGE";
      case DEAL_TYPE_CORRECTION: return "CORRECTION";
      case DEAL_TYPE_BONUS: return "BONUS";
      case DEAL_TYPE_COMMISSION: return "COMMISSION";
      case DEAL_TYPE_COMMISSION_DAILY: return "COMMISSION_DAILY";
      case DEAL_TYPE_COMMISSION_MONTHLY: return "COMMISSION_MONTHLY";
      case DEAL_TYPE_COMMISSION_AGENT_DAILY: return "COMMISSION_AGENT_DAILY";
      case DEAL_TYPE_COMMISSION_AGENT_MONTHLY: return "COMMISSION_AGENT_MONTHLY";
      case DEAL_TYPE_INTEREST: return "INTEREST";
      case DEAL_TYPE_BUY_CANCELED: return "BUY_CANCELED";
      case DEAL_TYPE_SELL_CANCELED: return "SELL_CANCELED";
      case DEAL_DIVIDEND: return "DIVIDEND";
      case DEAL_DIVIDEND_FRANKED: return "DIVIDEND_FRANKED";
      case DEAL_TAX: return "TAX";
   }
   return IntegerToString((int)type);
}

string DealEntryName(long entry)
{
   switch((ENUM_DEAL_ENTRY)entry)
   {
      case DEAL_ENTRY_IN: return "IN";
      case DEAL_ENTRY_OUT: return "OUT";
      case DEAL_ENTRY_INOUT: return "INOUT";
      case DEAL_ENTRY_OUT_BY: return "OUT_BY";
   }
   return IntegerToString((int)entry);
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
         IsoUtc(rates[i].time), rates[i].open, rates[i].high, rates[i].low, rates[i].close, (long)rates[i].tick_volume
      );
   }
   out += "]";
   return out;
}

string PositionsJson()
{
   string out = "[";
   int added = 0;
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      if(!IsTradeviceSymbol(symbol)) continue;
      if(added++ > 0) out += ",";
      out += StringFormat(
         "{\"ticket\":\"%I64u\",\"identifier\":\"%I64d\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"price_open\":%.8f,\"price_current\":%.8f,\"stop_loss\":%.8f,\"take_profit\":%.8f,\"profit\":%.2f,\"swap\":%.2f,\"time_msc\":%I64d,\"magic\":%I64d}",
         ticket,
         (long)PositionGetInteger(POSITION_IDENTIFIER),
         JsonEscape(symbol),
         PositionTypeName(PositionGetInteger(POSITION_TYPE)),
         PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN), PositionGetDouble(POSITION_PRICE_CURRENT),
         PositionGetDouble(POSITION_SL), PositionGetDouble(POSITION_TP), PositionGetDouble(POSITION_PROFIT), PositionGetDouble(POSITION_SWAP),
         (long)PositionGetInteger(POSITION_TIME_MSC), (long)PositionGetInteger(POSITION_MAGIC)
      );
   }
   out += "]";
   return out;
}

string OrdersJson()
{
   string out = "[";
   int added = 0;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      string symbol = OrderGetString(ORDER_SYMBOL);
      if(!IsTradeviceSymbol(symbol)) continue;
      if(added++ > 0) out += ",";
      out += StringFormat(
         "{\"ticket\":\"%I64u\",\"position_id\":\"%I64d\",\"symbol\":\"%s\",\"type\":\"%s\",\"state\":\"%s\",\"volume_initial\":%.8f,\"volume_current\":%.8f,\"price_open\":%.8f,\"price_current\":%.8f,\"stop_loss\":%.8f,\"take_profit\":%.8f,\"time_setup_msc\":%I64d,\"expiration\":%I64d,\"magic\":%I64d}",
         ticket, (long)OrderGetInteger(ORDER_POSITION_ID), JsonEscape(symbol),
         OrderTypeName(OrderGetInteger(ORDER_TYPE)), OrderStateName(OrderGetInteger(ORDER_STATE)),
         OrderGetDouble(ORDER_VOLUME_INITIAL), OrderGetDouble(ORDER_VOLUME_CURRENT), OrderGetDouble(ORDER_PRICE_OPEN), OrderGetDouble(ORDER_PRICE_CURRENT),
         OrderGetDouble(ORDER_SL), OrderGetDouble(ORDER_TP), (long)OrderGetInteger(ORDER_TIME_SETUP_MSC),
         (long)OrderGetInteger(ORDER_TIME_EXPIRATION), (long)OrderGetInteger(ORDER_MAGIC)
      );
   }
   out += "]";
   return out;
}

string DealsJson()
{
   datetime to = TimeCurrent();
   datetime from = to - (datetime)(MathMax(1, HistoryDays) * 86400);
   if(!HistorySelect(from, to)) return "[]";

   int total = (int)HistoryDealsTotal();
   int limit = MathMax(1, MaxHistoryDeals);
   string out = "[";
   int added = 0;
   for(int i = total - 1; i >= 0 && added < limit; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      if(!IsTradeviceSymbol(symbol)) continue;
      if(added++ > 0) out += ",";
      out += StringFormat(
         "{\"ticket\":\"%I64u\",\"order_id\":\"%I64d\",\"position_id\":\"%I64d\",\"symbol\":\"%s\",\"type\":\"%s\",\"entry\":\"%s\",\"volume\":%.8f,\"price\":%.8f,\"commission\":%.2f,\"swap\":%.2f,\"profit\":%.2f,\"fee\":%.2f,\"time_msc\":%I64d,\"magic\":%I64d}",
         ticket, (long)HistoryDealGetInteger(ticket, DEAL_ORDER), (long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID),
         JsonEscape(symbol), DealTypeName(HistoryDealGetInteger(ticket, DEAL_TYPE)), DealEntryName(HistoryDealGetInteger(ticket, DEAL_ENTRY)),
         HistoryDealGetDouble(ticket, DEAL_VOLUME), HistoryDealGetDouble(ticket, DEAL_PRICE), HistoryDealGetDouble(ticket, DEAL_COMMISSION),
         HistoryDealGetDouble(ticket, DEAL_SWAP), HistoryDealGetDouble(ticket, DEAL_PROFIT), HistoryDealGetDouble(ticket, DEAL_FEE),
         (long)HistoryDealGetInteger(ticket, DEAL_TIME_MSC), (long)HistoryDealGetInteger(ticket, DEAL_MAGIC)
      );
   }
   out += "]";
   return out;
}

bool PostJson(string endpoint, string payload, string &body)
{
   char data[];
   char result[];
   string resultHeaders;
   StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(data) > 0) ArrayResize(data, ArraySize(data) - 1);

   string headers = "Content-Type: application/json\r\n";
   if(StringLen(ApiKey) > 0) headers += "Authorization: Bearer " + ApiKey + "\r\n";
   else Print("Tradevice warning: ApiKey is blank. Protected Railway endpoint will reject sync.");

   ResetLastError();
   int status = WebRequest("POST", ApiBase + endpoint, headers, RequestTimeoutMs, data, result, resultHeaders);
   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4014) Print("Tradevice WebRequest blocked. Allow this URL in MT5: ", ApiBase);
      else Print("Tradevice WebRequest failed. MT5 error=", err, " endpoint=", endpoint);
      return false;
   }

   body = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("Tradevice HTTP error status=", status, " endpoint=", endpoint, " body=", body);
      return false;
   }
   return true;
}

bool SendBrokerState(bool includeHistory)
{
   string historyPart = includeHistory ? ",\"history_deals\":" + DealsJson() : "";
   string payload = StringFormat(
      "{\"timestamp\":\"%s\",\"bridge_version\":\"2.00\",\"broker_symbol\":\"%s\",\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"profit\":%.2f,\"credit\":%.2f,\"margin\":%.2f,\"margin_free\":%.2f,\"margin_level\":%.4f,\"currency\":\"%s\",\"leverage\":%I64d,\"trade_mode\":%d,\"positions_total\":%d,\"orders_total\":%d},\"positions\":%s,\"orders\":%s%s,\"features\":{\"terminal_build\":%d,\"terminal_connected\":%s}}",
      IsoUtc(TimeGMT()), JsonEscape(resolvedSymbol),
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY), AccountInfoDouble(ACCOUNT_PROFIT), AccountInfoDouble(ACCOUNT_CREDIT),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE), AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), (long)AccountInfoInteger(ACCOUNT_LEVERAGE), (int)AccountInfoInteger(ACCOUNT_TRADE_MODE),
      PositionsTotal(), OrdersTotal(), PositionsJson(), OrdersJson(), historyPart,
      (int)TerminalInfoInteger(TERMINAL_BUILD), TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false"
   );
   string body = "";
   bool ok = PostJson("/api/v1/broker/sync", payload, body);
   if(ok && includeHistory) Print("Tradevice broker sync accepted with HistoryDeals. response=", body);
   return ok;
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
   int digits = (int)SymbolInfoInteger(resolvedSymbol, SYMBOL_DIGITS);
   double contractSize = SymbolInfoDouble(resolvedSymbol, SYMBOL_TRADE_CONTRACT_SIZE);
   double tickSize = SymbolInfoDouble(resolvedSymbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(resolvedSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickValueProfit = SymbolInfoDouble(resolvedSymbol, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   double tickValueLoss = SymbolInfoDouble(resolvedSymbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double volumeMin = SymbolInfoDouble(resolvedSymbol, SYMBOL_VOLUME_MIN);
   double volumeMax = SymbolInfoDouble(resolvedSymbol, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(resolvedSymbol, SYMBOL_VOLUME_STEP);

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"M1\",\"timestamp\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"spread_points\":%.2f,\"candles\":%s,\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"margin_free\":%.2f,\"positions_total\":%d,\"orders_total\":%d},\"features\":{\"bridge_version\":\"2.00\",\"broker_symbol\":\"%s\",\"terminal_build\":%d,\"terminal_connected\":%s,\"point_size\":%.8f,\"digits\":%d,\"contract_size\":%.8f,\"tick_size\":%.8f,\"tick_value\":%.8f,\"tick_value_profit\":%.8f,\"tick_value_loss\":%.8f,\"volume_min\":%.8f,\"volume_max\":%.8f,\"volume_step\":%.8f,\"m5_candles\":%s,\"m15_candles\":%s}}",
      CanonicalSymbol, IsoUtc(TimeGMT()), tick.bid, tick.ask, spreadPoints,
      RatesJson(resolvedSymbol, PERIOD_M1, M1Bars),
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY), AccountInfoDouble(ACCOUNT_MARGIN_FREE), PositionsTotal(), OrdersTotal(),
      resolvedSymbol, (int)TerminalInfoInteger(TERMINAL_BUILD), TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false",
      point, digits, contractSize, tickSize, tickValue, tickValueProfit, tickValueLoss, volumeMin, volumeMax, volumeStep,
      RatesJson(resolvedSymbol, PERIOD_M5, M5Bars), RatesJson(resolvedSymbol, PERIOD_M15, M15Bars)
   );

   string body = "";
   bool ok = PostJson("/api/v1/market/snapshots", payload, body);
   if(ok) Print("Tradevice market snapshot accepted: broker=", resolvedSymbol, " response=", body);
   return ok;
}

int OnInit()
{
   if(!ResolveBrokerSymbol())
   {
      Print("Tradevice: cannot resolve broker symbol for ", CanonicalSymbol, ". Attach Observer to broker gold M1 chart or set TradeSymbol manually.");
      return INIT_FAILED;
   }

   EventSetTimer(1);
   lastM1Bar = iTime(resolvedSymbol, PERIOD_M1, 0);
   Print("Tradevice Observer v2.00 started. Broker symbol=", resolvedSymbol, ", canonical=", CanonicalSymbol, ". READ ONLY: execution disabled by design.");

   datetime now = TimeCurrent();
   lastRetryAttempt = now;
   lastBrokerSync = now;
   lastHistorySync = now;
   snapshotChannelReady = SendSnapshot();
   SendBrokerState(true);
   if(!snapshotChannelReady) Print("Tradevice: initial market snapshot failed. Retry mode enabled.");
   else Print("Tradevice: market bridge CONNECTED. AI snapshots remain closed-M1 only.");

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   datetime now = TimeCurrent();

   int brokerEvery = MathMax(1, BrokerSyncSeconds);
   if((now - lastBrokerSync) >= brokerEvery)
   {
      bool includeHistory = (now - lastHistorySync) >= MathMax(10, HistorySyncSeconds);
      lastBrokerSync = now;
      if(SendBrokerState(includeHistory) && includeHistory) lastHistorySync = now;
   }

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
            Print("Tradevice: market bridge CONNECTED after retry.");
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
      Print("Tradevice: market bridge unavailable. Retry mode enabled; broker sync continues independently.");
   }
}

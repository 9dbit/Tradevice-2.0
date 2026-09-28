#property strict
#property version "0.10"
#property description "Tradevice DEMO ONLY pending executor. Real/contest accounts are refused."

input string ApiBase="https://tradevice-api-production.up.railway.app";
input string ApiKey="";
input string ClientId="mt5-demo-1";
input bool EnableDemoOrders=false;
input double MaxRiskPercent=1.0;
input double MaxDailyDrawdownPercent=3.0;
const ulong Magic=9282080;
string stateFile,lockName,token="",status="UNKNOWN",reason="",invalidOp="";
ulong ticket=0;
datetime expiresAt=0,lastHeartbeat=0;
double invalidPrice=0;

string Esc(string value) {
   StringReplace(value,"\\","\\\\"); StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r"," "); StringReplace(value,"\n"," "); return value;
}
bool DemoAccount() { return AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO; }
bool CanTrade() {
   return DemoAccount() && TerminalInfoInteger(TERMINAL_CONNECTED) && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      && MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}
bool PendingType(long type) { return type==ORDER_TYPE_BUY_LIMIT || type==ORDER_TYPE_SELL_LIMIT || type==ORDER_TYPE_BUY_STOP || type==ORDER_TYPE_SELL_STOP; }
bool SaveState() {
   int f=FileOpen(stateFile,FILE_WRITE|FILE_CSV|FILE_ANSI,'\t');
   if(f==INVALID_HANDLE) { Print("Cannot persist executor state; blocking dispatch."); return false; }
   uint written=FileWrite(f,token,(string)ticket,status,reason,(long)expiresAt,invalidOp,DoubleToString(invalidPrice,8));
   FileFlush(f); FileClose(f); return written>0;
}
void LoadState() {
   if(!FileIsExist(stateFile)) return;
   int f=FileOpen(stateFile,FILE_READ|FILE_CSV|FILE_ANSI,'\t');
   if(f==INVALID_HANDLE) return;
   token=FileReadString(f); ticket=(ulong)StringToInteger(FileReadString(f)); status=FileReadString(f);
   reason=FileReadString(f); expiresAt=(datetime)StringToInteger(FileReadString(f)); invalidOp=FileReadString(f);
   invalidPrice=StringToDouble(FileReadString(f)); FileClose(f);
}
bool SelectedOwnOrder() {
   return OrderGetInteger(ORDER_MAGIC)==(long)Magic && OrderGetString(ORDER_SYMBOL)==_Symbol
      && StringFind(OrderGetString(ORDER_COMMENT),"tv2:")==0 && PendingType(OrderGetInteger(ORDER_TYPE));
}
void ResolveTicket() {
   if(token=="" || ticket!=0) return;
   string comment="tv2:"+token;
   for(int i=OrdersTotal()-1;i>=0;i--) {
      ulong t=OrderGetTicket(i);
      if(t>0 && SelectedOwnOrder() && OrderGetString(ORDER_COMMENT)==comment) { ticket=t; SaveState(); return; }
   }
   if(!HistorySelect(TimeCurrent()-172800,TimeCurrent()+60)) return;
   for(int i=HistoryOrdersTotal()-1;i>=0;i--) {
      ulong t=HistoryOrderGetTicket(i);
      if(t>0 && HistoryOrderGetInteger(t,ORDER_MAGIC)==(long)Magic && HistoryOrderGetString(t,ORDER_SYMBOL)==_Symbol
         && HistoryOrderGetString(t,ORDER_COMMENT)==comment) { ticket=t; SaveState(); return; }
   }
}
string CurrentStatus(double &pnl) {
   pnl=0; ResolveTicket();
   if(token=="") return "UNKNOWN";
   if(ticket==0) return status; // Ambiguous dispatch never gets retried.
   if(OrderSelect(ticket)) {
      if(!SelectedOwnOrder() || OrderGetString(ORDER_COMMENT)!="tv2:"+token) return "UNKNOWN";
      return "PENDING";
   }
   if(!HistoryOrderSelect(ticket)) return "UNKNOWN";
   if(HistoryOrderGetInteger(ticket,ORDER_MAGIC)!=(long)Magic || HistoryOrderGetString(ticket,ORDER_SYMBOL)!=_Symbol) return "UNKNOWN";
   long orderState=HistoryOrderGetInteger(ticket,ORDER_STATE);
   if(orderState==ORDER_STATE_CANCELED) return "CANCELLED";
   if(orderState==ORDER_STATE_EXPIRED) return "EXPIRED";
   if(orderState==ORDER_STATE_REJECTED) return "REJECTED";
   if(orderState!=ORDER_STATE_FILLED) return "UNKNOWN";
   long positionId=HistoryOrderGetInteger(ticket,ORDER_POSITION_ID);
   if(positionId<=0) return "UNKNOWN";
   for(int i=PositionsTotal()-1;i>=0;i--) {
      if(PositionGetTicket(i)>0 && PositionGetInteger(POSITION_IDENTIFIER)==positionId) {
         pnl=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP); return "FILLED";
      }
   }
   if(!HistorySelectByPosition(positionId)) return "UNKNOWN";
   bool hasExit=false;
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong d=HistoryDealGetTicket(i);
      if(d==0) continue;
      long entry=HistoryDealGetInteger(d,DEAL_ENTRY);
      if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) hasExit=true;
      pnl+=HistoryDealGetDouble(d,DEAL_PROFIT)+HistoryDealGetDouble(d,DEAL_SWAP)+HistoryDealGetDouble(d,DEAL_COMMISSION)+HistoryDealGetDouble(d,DEAL_FEE);
   }
   return hasExit ? "CLOSED" : "UNKNOWN";
}
void DeleteTicket(ulong t,string why) {
   if(!CanTrade() || !OrderSelect(t) || !SelectedOwnOrder()) return;
   MqlTradeRequest request={}; MqlTradeResult result={};
   request.action=TRADE_ACTION_REMOVE; request.order=t; request.symbol=_Symbol; request.magic=Magic;
   bool sent=OrderSend(request,result);
   // A fill racing the delete is NOT followed by a position-close request.
   if(sent && result.retcode==TRADE_RETCODE_DONE) { reason=why; SaveState(); Print("Pending removed: ",t," ",why); }
   else Print("Pending delete not confirmed: ",t," retcode=",result.retcode," ",result.comment);
}
void CancelOwned(string why) {
   for(int i=OrdersTotal()-1;i>=0;i--) { ulong t=OrderGetTicket(i); if(t>0 && SelectedOwnOrder()) DeleteTicket(t,why); }
}
bool DailyLimitReached() {
   MqlDateTime dt; TimeToStruct(TimeGMT(),dt);
   string key=StringFormat("TV2.day.%I64d.%04d%02d%02d",AccountInfoInteger(ACCOUNT_LOGIN),dt.year,dt.mon,dt.day);
   if(!GlobalVariableCheck(key)) { GlobalVariableSet(key,AccountInfoDouble(ACCOUNT_EQUITY)); GlobalVariablesFlush(); }
   double baseline=GlobalVariableGet(key),equity=AccountInfoDouble(ACCOUNT_EQUITY);
   return baseline<=0 || equity<=0 || (baseline-equity)/baseline*100.0>=MaxDailyDrawdownPercent;
}
void LocalGuards() {
   if(!DemoAccount()) return;
   if(!EnableDemoOrders) { CancelOwned("LOCAL_DISABLED"); return; }
   if(DailyLimitReached()) { CancelOwned("DAILY_DRAWDOWN_LIMIT"); return; }
   if(lastHeartbeat==0 || TimeGMT()-lastHeartbeat>60) { CancelOwned("SERVER_HEARTBEAT_LOST"); return; }
   if(ticket==0 || !OrderSelect(ticket) || !SelectedOwnOrder()) return;
   if(TimeGMT()>=expiresAt) { DeleteTicket(ticket,"EXPIRED"); return; }
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   long type=OrderGetInteger(ORDER_TYPE);
   double px=(type==ORDER_TYPE_SELL_LIMIT || type==ORDER_TYPE_SELL_STOP) ? tick.ask : tick.bid;
   if((invalidOp=="ABOVE" && px>=invalidPrice) || (invalidOp=="BELOW" && px<=invalidPrice)) DeleteTicket(ticket,"SCENARIO_INVALIDATED");
}
void Reject(string why) { status="REJECTED"; reason=why; SaveState(); Print("Demo pending rejected: ",why); }
void Place(string &fields[]) {
   if(!DemoAccount() || !EnableDemoOrders || !CanTrade()) return;
   if(fields[2]==token) return; // Durable at-most-once dispatch.
   double oldPnl=0; string oldState=CurrentStatus(oldPnl);
   if(token!="" && (oldState=="PENDING" || oldState=="FILLED" || oldState=="UNKNOWN")) return;
   token=fields[2]; ticket=0; status="UNKNOWN"; reason="DISPATCH_RESERVED";
   expiresAt=(datetime)StringToInteger(fields[9]); invalidOp=fields[10]; invalidPrice=StringToDouble(fields[11]);
   if(!SaveState()) return; // Persist BEFORE calling the broker.
   if(fields[3]!=_Symbol || OrdersTotal()!=0 || PositionsTotal()!=0) { Reject("SYMBOL_OR_EXPOSURE_MISMATCH"); return; }
   if(DailyLimitReached()) { Reject("DAILY_DRAWDOWN_LIMIT"); return; }
   ENUM_ORDER_TYPE type;
   if(fields[4]=="BUY_LIMIT") type=ORDER_TYPE_BUY_LIMIT;
   else if(fields[4]=="SELL_LIMIT") type=ORDER_TYPE_SELL_LIMIT;
   else if(fields[4]=="BUY_STOP") type=ORDER_TYPE_BUY_STOP;
   else if(fields[4]=="SELL_STOP") type=ORDER_TYPE_SELL_STOP;
   else { Reject("INVALID_TYPE"); return; }
   double entry=StringToDouble(fields[5]),sl=StringToDouble(fields[6]),tp=StringToDouble(fields[7]),lot=StringToDouble(fields[8]);
   bool buy=type==ORDER_TYPE_BUY_LIMIT || type==ORDER_TYPE_BUY_STOP;
   if(entry<=0 || sl<=0 || tp<=0 || MathAbs(lot-0.01)>0.000001 || !(buy ? sl<entry && entry<tp : tp<entry && entry<sl)) { Reject("INVALID_GEOMETRY"); return; }
   if(!(buy ? invalidOp=="BELOW" && invalidPrice<entry && invalidPrice>=sl : invalidOp=="ABOVE" && invalidPrice>entry && invalidPrice<=sl)) { Reject("INVALID_SCENARIO_GUARD"); return; }
   if(MathAbs(tp-entry)/MathAbs(entry-sl)<1.5) { Reject("REWARD_RISK_TOO_LOW"); return; }
   long ttl=(long)(expiresAt-TimeGMT());
   long expirationModes=SymbolInfoInteger(_Symbol,SYMBOL_EXPIRATION_MODE);
   if(ttl<30 || ttl>600 || (expirationModes & SYMBOL_EXPIRATION_SPECIFIED)==0) { Reject("NATIVE_EXPIRY_REQUIRED"); return; }
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT),step=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   MqlTick tick; if(point<=0 || step<=0 || !SymbolInfoTick(_Symbol,tick) || tick.ask<tick.bid || TimeCurrent()-tick.time>10) { Reject("STALE_QUOTE"); return; }
   if((tick.ask-tick.bid)/point>300.0) { Reject("SPREAD_TOO_WIDE"); return; }
   if((type==ORDER_TYPE_BUY_LIMIT && entry>=tick.ask) || (type==ORDER_TYPE_BUY_STOP && entry<=tick.ask)
      || (type==ORDER_TYPE_SELL_LIMIT && entry<=tick.bid) || (type==ORDER_TYPE_SELL_STOP && entry>=tick.bid)) { Reject("PRICE_ALREADY_PASSED"); return; }
   double px=buy ? tick.bid : tick.ask;
   if((invalidOp=="ABOVE" && px>=invalidPrice) || (invalidOp=="BELOW" && px<=invalidPrice)) { Reject("SCENARIO_INVALIDATED"); return; }
   // Refuse off-tick prices instead of silently moving the plan's prices.
   if(MathAbs(entry/step-MathRound(entry/step))>0.00001 || MathAbs(sl/step-MathRound(sl/step))>0.00001 || MathAbs(tp/step-MathRound(tp/step))>0.00001) { Reject("OFF_TICK_PRICE"); return; }
   double profit=0;
   if(!OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL,_Symbol,lot,entry,sl,profit) || profit>=0 || AccountInfoDouble(ACCOUNT_EQUITY)<=0
      || MathAbs(profit)>AccountInfoDouble(ACCOUNT_EQUITY)*MaxRiskPercent/100.0) { Reject("RISK_LIMIT"); return; }
   MqlTradeRequest request={}; MqlTradeCheckResult check={}; MqlTradeResult result={};
   request.action=TRADE_ACTION_PENDING; request.magic=Magic; request.symbol=_Symbol; request.volume=lot;
   request.type=type; request.price=entry; request.sl=sl; request.tp=tp; request.type_filling=ORDER_FILLING_RETURN;
   request.type_time=ORDER_TIME_SPECIFIED; request.expiration=(datetime)(TimeCurrent()+ttl); request.comment="tv2:"+token;
   if(!OrderCheck(request,check) || (check.retcode!=0 && check.retcode!=TRADE_RETCODE_DONE)) { Reject("BROKER_CHECK_"+(string)check.retcode); return; }
   bool sent=OrderSend(request,result);
   if(sent && (result.retcode==TRADE_RETCODE_PLACED || result.retcode==TRADE_RETCODE_DONE) && result.order>0) {
      ticket=result.order; status="PENDING"; reason="BROKER_CONFIRMED"; SaveState(); Print("Demo pending placed: ",ticket," plan=",token);
   } else {
      status="UNKNOWN"; reason="BROKER_RESULT_"+(string)result.retcode; SaveState();
      Print("Ambiguous dispatch; no retry. Reconcile ticket/history. retcode=",result.retcode," ",result.comment);
   }
}
void Poll() {
   if(!DemoAccount()) return;
   LoadState(); LocalGuards();
   double pnl=0; string current=CurrentStatus(pnl);
   if(token!="" && current!=status) { status=current; SaveState(); }
   string report="null";
   if(token!="") report=StringFormat("{\"token\":\"%s\",\"ticket\":\"%I64u\",\"status\":\"%s\",\"reason\":\"%s\",\"pnl_usd\":%s}",token,ticket,status,Esc(reason),(status=="CLOSED" || status=="FILLED") ? DoubleToString(pnl,2) : "null");
   string nonce=(string)GetTickCount64();
   string body=StringFormat("{\"client_id\":\"%s\",\"nonce\":\"%s\",\"account_mode\":\"DEMO\",\"account_login\":\"%I64d\",\"account_server\":\"%s\",\"armed\":%s,\"orders_total\":%d,\"positions_total\":%d,\"report\":%s}",Esc(ClientId),nonce,AccountInfoInteger(ACCOUNT_LOGIN),Esc(AccountInfoString(ACCOUNT_SERVER)),EnableDemoOrders ? "true" : "false",OrdersTotal(),PositionsTotal(),report);
   char data[],result[]; StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8); ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nAuthorization: Bearer "+ApiKey+"\r\n",responseHeaders;
   int code=WebRequest("POST",ApiBase+"/api/v1/demo/poll",headers,3000,data,result,responseHeaders);
   if(code!=200) { Print("Demo poll failed HTTP=",code," MT5=",GetLastError()); return; }
   string fields[]; string response=CharArrayToString(result,0,-1,CP_UTF8);
   if(StringSplit(response,'|',fields)!=15 || fields[0]!="TV2" || fields[14]!=nonce) return;
   if(MathAbs((double)(TimeGMT()-(datetime)StringToInteger(fields[13])))>15.0) return;
   if(fields[1]!="HOLD" && fields[1]!="PLACE" && fields[1]!="CANCEL") return;
   lastHeartbeat=TimeGMT();
   if(fields[1]=="CANCEL" && fields[2]==token && ticket>0) DeleteTicket(ticket,fields[12]);
   else if(fields[1]=="PLACE") Place(fields);
   Comment("Tradevice DEMO executor\n",EnableDemoOrders ? "Demo armed" : "Demo disabled"," | ",fields[12],"\n",status," ticket ",ticket);
}
int OnInit() {
   if(!DemoAccount()) { Print("Tradevice executor refuses real and contest accounts."); return INIT_FAILED; }
   if(StringFind(_Symbol,"XAUUSD")!=0 || StringFind(ApiBase,"https://")!=0 || ApiKey=="" || MaxRiskPercent<=0 || MaxRiskPercent>1.0 || MaxDailyDrawdownPercent<=0 || MaxDailyDrawdownPercent>3.0) return INIT_PARAMETERS_INCORRECT;
   string server=AccountInfoString(ACCOUNT_SERVER); StringReplace(server,"/","_"); StringReplace(server,"\\","_"); StringReplace(server,":","_");
   stateFile=StringFormat("TradeviceDemo_%I64d_%s_%I64u.csv",AccountInfoInteger(ACCOUNT_LOGIN),server,Magic);
   lockName=StringFormat("TV2.lock.%I64d.%I64u",AccountInfoInteger(ACCOUNT_LOGIN),Magic);
   GlobalVariableTemp(lockName); LoadState(); EventSetTimer(2);
   Print("Tradevice Demo Executor v0.10. Real accounts blocked. Place enabled=",EnableDemoOrders);
   return INIT_SUCCEEDED;
}
void OnTimer() {
   if(!DemoAccount() || !GlobalVariableSetOnCondition(lockName,1.0,0.0)) return;
   Poll(); GlobalVariableSet(lockName,0.0);
}
void OnDeinit(const int why) { EventKillTimer(); Comment(""); /* Native broker expiry remains attached. */ }

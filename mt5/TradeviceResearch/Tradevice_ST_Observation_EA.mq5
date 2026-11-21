//+------------------------------------------------------------------+
//| Tradevice_ST_Observation_EA.mq5                                   |
//| M1 Research-only Supertrend recorder. NO TRADE OPERATIONS.        |
//| Consumes Tradevice_ST_TV_Observer; no OrderSend/CTrade/WebRequest|
//+------------------------------------------------------------------+
#property strict
#property version "1.00"
#property description "OBSERVER ONLY: M1 Supertrend flip and intrabar line-break capture, numeric feature snapshots, forward observations."
#property description "Absolutely no trading, broker order API or remote network calls."

enum ST_SOURCE_OBS { OBS_CLOSE=0, OBS_HL2=1, OBS_HLC3=2, OBS_OHLC4=3 };
input group "Research-only signal"
input ENUM_TIMEFRAMES InpSignalTF=PERIOD_M1;
input int InpSTATRPeriod=10;
input double InpSTFactor=3.0;
input ST_SOURCE_OBS InpSTSource=OBS_HL2;
input bool InpSTUseWilderATR=true;
input bool InpCaptureClosedFlips=true;
input bool InpCaptureIntrabarBreaks=true;
input group "Measurement and local storage"
input int InpADXPeriod=14;
input int InpATRPeriod=14;
input int InpEMAPeriod=50;
input int InpRSIPeriod=14;
input int InpVolumeLookback=20;
input string InpStorageFolder="TradeviceST";
input int InpScreenshotWidth=1280;
input int InpScreenshotHeight=720;
input int InpTimerIntervalSeconds=5;
input bool InpShowChartPanel=true;

int hST=INVALID_HANDLE,hADX=INVALID_HANDLE,hATR=INVALID_HANDLE;
int hEMA=INVALID_HANDLE,hRSI=INVALID_HANDLE,hBands=INVALID_HANDLE,hH4ST=INVALID_HANDLE;
datetime g_lastClosed=0,g_lastIntrabarBarBuy=0,g_lastIntrabarBarSell=0;
double g_prevBid=0,g_prevAsk=0;
int g_events=0;
string g_lastEvent="NONE",g_prefix="TVSTOBS_";
struct PendingRecord {string id;datetime bar_time;int direction;double reference;double atr;int horizon;};
PendingRecord g_pending[];

string SideName(const int dir){return dir>0?"BUY":"SELL";}
string JsonEscape(string s)
{
   StringReplace(s,"\\","\\\\"); StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r","\\r"); StringReplace(s,"\n","\\n");
   return s;
}
string Num(double n,int precision=6)
{
   if(!MathIsValidNumber(n) || n==EMPTY_VALUE) return "null";
   return DoubleToString(n,precision);
}
double BufferAt(int handle,int buffer,int shift)
{
   double a[];
   if(handle==INVALID_HANDLE || CopyBuffer(handle,buffer,shift,1,a)!=1) return EMPTY_VALUE;
   return a[0];
}
string IntegerTime(datetime t){return IntegerToString((long)t);}
string EventPath(){return InpStorageFolder+"\\events.jsonl";}
string StatePath(){return InpStorageFolder+"\\pending.csv";}
bool AppendLine(string text)
{
   int f=FileOpen(EventPath(),FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(f==INVALID_HANDLE){Print("Tradevice observer append failed: ",GetLastError());return false;}
   FileSeek(f,0,SEEK_END);
   FileWriteString(f,text+"\r\n");
   FileFlush(f); FileClose(f);
   return true;
}
bool SaveOne(string relative,string data)
{
   int f=FileOpen(InpStorageFolder+"\\"+relative,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(f==INVALID_HANDLE){Print("Tradevice observer file failed: ",relative," ",GetLastError());return false;}
   FileWriteString(f,data+"\r\n"); FileFlush(f); FileClose(f); return true;
}
bool ExistsOne(string relative){return FileIsExist(InpStorageFolder+"\\"+relative);}
void SavePending()
{
   int f=FileOpen(StatePath(),FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,';');
   if(f==INVALID_HANDLE){Print("Cannot persist pending observations: ",GetLastError());return;}
   for(int i=0;i<ArraySize(g_pending);i++)
      FileWrite(f,g_pending[i].id,IntegerTime(g_pending[i].bar_time),
                IntegerToString(g_pending[i].direction),Num(g_pending[i].reference,8),
                Num(g_pending[i].atr,8),IntegerToString(g_pending[i].horizon));
   FileFlush(f);FileClose(f);
}
void LoadPending()
{
   if(!FileIsExist(StatePath()))return;
   int f=FileOpen(StatePath(),FILE_READ|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,';');
   if(f==INVALID_HANDLE)return;
   while(!FileIsEnding(f))
   {
      PendingRecord p;
      p.id=FileReadString(f);
      if(p.id=="")break;
      p.bar_time=(datetime)StringToInteger(FileReadString(f));
      p.direction=(int)StringToInteger(FileReadString(f));
      p.reference=StringToDouble(FileReadString(f));
      p.atr=StringToDouble(FileReadString(f));
      p.horizon=(int)StringToInteger(FileReadString(f));
      if(p.bar_time<=0 || p.direction==0)continue;
      int n=ArraySize(g_pending);ArrayResize(g_pending,n+1);g_pending[n]=p;
   }
   FileClose(f);
}
void TrackPending(string id,datetime barTime,int dir,double price,double atr)
{
   PendingRecord p;
   p.id=id;p.bar_time=barTime;p.direction=dir;p.reference=price;
   p.atr=atr;p.horizon=0;
   int n=ArraySize(g_pending);ArrayResize(g_pending,n+1);g_pending[n]=p;
   SavePending();
}
double MeanVolume(int fromShift,int count)
{
   if(count<1)return 0;
   double total=0;
   for(int k=fromShift;k<fromShift+count;k++)
      total+=(double)iVolume(_Symbol,InpSignalTF,k);
   return total/count;
}
string FeatureJson(int shift,int direction,double reference,double stLine)
{
   double atr=BufferAt(hATR,0,shift);
   double adx=BufferAt(hADX,0,shift);
   double plus=BufferAt(hADX,1,shift);
   double minus=BufferAt(hADX,2,shift);
   double ema=BufferAt(hEMA,0,shift);
   double rsi=BufferAt(hRSI,0,shift);
   double bbHigh=BufferAt(hBands,1,shift);
   double bbLow=BufferAt(hBands,2,shift);
   double h4Trend=BufferAt(hH4ST,4,1);
   double op=iOpen(_Symbol,InpSignalTF,shift);
   double cl=iClose(_Symbol,InpSignalTF,shift);
   double hi=iHigh(_Symbol,InpSignalTF,shift);
   double lo=iLow(_Symbol,InpSignalTF,shift);
   double vol=(double)iVolume(_Symbol,InpSignalTF,shift);
   double meanVol=MeanVolume(shift+1,InpVolumeLookback);
   double pt=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   double bbWidth=(bbHigh!=EMPTY_VALUE && bbLow!=EMPTY_VALUE)?bbHigh-bbLow:EMPTY_VALUE;
   MqlTick tick;ZeroMemory(tick);SymbolInfoTick(_Symbol,tick);
   double spread=(pt>0 && tick.ask>tick.bid)?(tick.ask-tick.bid)/pt:EMPTY_VALUE;
   double range=hi-lo;
   double body=MathAbs(cl-op);
   double uw=hi-MathMax(op,cl);
   double lw=MathMin(op,cl)-lo;
   double k=(atr>0 && atr!=EMPTY_VALUE)?1.0/atr:0;
   string s="{";
   s+="\"st_line\":"+Num(stLine,8)+",\"st_direction\":"+IntegerToString(direction);
   s+=",\"st_atr\":"+Num(BufferAt(hST,5,shift),8);
   s+=",\"adx14\":"+Num(adx)+",\"di_plus\":"+Num(plus)+",\"di_minus\":"+Num(minus);
   s+=",\"atr14\":"+Num(atr,8)+",\"atr_points\":"+Num(pt>0?atr/pt:EMPTY_VALUE,2);
   s+=",\"ema50\":"+Num(ema,8)+",\"ema_distance_atr\":"+Num(k>0?(cl-ema)*k:EMPTY_VALUE,5);
   s+=",\"rsi14\":"+Num(rsi);
   s+=",\"bb_width\":"+Num(bbWidth,8)+",\"bb_width_atr\":"+Num(k>0?bbWidth*k:EMPTY_VALUE,4);
   s+=",\"tick_volume\":"+Num(vol,0)+",\"volume_mean20\":"+Num(meanVol,2);
   s+=",\"volume_ratio\":"+Num(meanVol>0?vol/meanVol:EMPTY_VALUE,4);
   s+=",\"open\":"+Num(op,8)+",\"high\":"+Num(hi,8)+",\"low\":"+Num(lo,8)+",\"close\":"+Num(cl,8);
   s+=",\"candle_range_atr\":"+Num(k>0?range*k:EMPTY_VALUE,4);
   s+=",\"body_atr\":"+Num(k>0?body*k:EMPTY_VALUE,4);
   s+=",\"upper_wick_atr\":"+Num(k>0?uw*k:EMPTY_VALUE,4);
   s+=",\"lower_wick_atr\":"+Num(k>0?lw*k:EMPTY_VALUE,4);
   s+=",\"spread_points\":"+Num(spread,2)+",\"spread_atr\":"+Num(k>0?spread*pt*k:EMPTY_VALUE,5);
   s+=",\"distance_to_st_points\":"+Num(pt>0?MathAbs(reference-stLine)/pt:EMPTY_VALUE,2);
   s+=",\"h4_st_direction\":"+Num(h4Trend,0);
   s+=",\"live_bid\":"+Num(tick.bid,8)+",\"live_ask\":"+Num(tick.ask,8);
   s+=",\"tick_time_msc\":"+IntegerToString(tick.time_msc);
   s+=",\"forming_bar_tick_volume\":"+IntegerToString(iVolume(_Symbol,InpSignalTF,0));
   s+=",\"point_size\":"+Num(pt,8)+",\"broker_digits\":"+IntegerToString(_Digits);
   s+=",\"reference_price\":"+Num(reference,8);
   s+=",\"features_bar_shift\":"+IntegerToString(shift);
   s+="}";
   return s;
}
void EnsureLabel(string key,int x,int y,int width,int font,color colorValue)
{
   string name=g_prefix+key;
   if(ObjectFind(0,name)<0)
      ObjectCreate(0,name,OBJ_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,font);
   ObjectSetInteger(0,name,OBJPROP_COLOR,colorValue);
   ObjectSetString(0,name,OBJPROP_FONT,"Consolas");
   ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
}
void PanelLine(string id,string value,int y,color tint=clrSilver)
{
   EnsureLabel(id,18,y,500,10,tint);
   ObjectSetString(0,g_prefix+id,OBJPROP_TEXT,value);
}
void RefreshPanel()
{
   if(!InpShowChartPanel)return;
   double dir=BufferAt(hST,4,1);
   double adx=BufferAt(hADX,0,1), atr=BufferAt(hATR,0,1);
   double plus=BufferAt(hADX,1,1),minus=BufferAt(hADX,2,1);
   double rsi=BufferAt(hRSI,0,1);
   double vol=MeanVolume(2,InpVolumeLookback);
   double ratio=vol>0?(double)iVolume(_Symbol,InpSignalTF,1)/vol:0;
   MqlTick t;ZeroMemory(t);SymbolInfoTick(_Symbol,t);
   double pt=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   PanelLine("title","TRADEVICE  |  SUPERTREND RESEARCH OBSERVER",18,clrAqua);
   PanelLine("safe","RECORD ONLY  /  NO TRADING FUNCTIONS",37,clrLime);
   PanelLine("trend",EnumToString(InpSignalTF)+" ST: "+(dir>0?"BULL":dir<0?"BEAR":"WAIT")+"  ATR"+IntegerToString(InpSTATRPeriod)+" x "+DoubleToString(InpSTFactor,2),60);
   PanelLine("adx","ADX: "+Num(adx,1)+"   +DI: "+Num(plus,1)+"   -DI: "+Num(minus,1),78);
   PanelLine("atr","ATR14: "+Num(atr,3)+"   Spread: "+Num(pt>0?(t.ask-t.bid)/pt:0,1)+" points",96);
   PanelLine("other","RSI: "+Num(rsi,1)+"   Relative volume: "+Num(ratio,2)+"x",114);
   PanelLine("count","Events this run: "+IntegerToString(g_events)+"    Pending outcomes: "+IntegerToString(ArraySize(g_pending)),132);
   PanelLine("last","Last: "+g_lastEvent,150);
}
void CaptureEvent(string eventType,int direction,datetime signalBar,double refPrice,double stLine,int featureShift)
{
   if(signalBar<=0 || refPrice<=0 || direction==0)return;
   string id=_Symbol+"_"+IntegerTime(signalBar)+"_"+eventType+"_"+SideName(direction);
   string fname="events\\"+id+".json";
   if(ExistsOne(fname))return; // deterministic, survives reattaches
   double atr=BufferAt(hATR,0,featureShift);
   RefreshPanel();ChartRedraw(0);
   string suffix=eventType=="CONFIRMED_FLIP"?"f":"b";
   string shot=InpStorageFolder+"\\shots\\s_"+IntegerTime(signalBar)+"_"+suffix+"_"+(direction>0?"b":"s")+".png";
   // ChartScreenShot writes to terminal MQL5/Files, not Common Files.
   bool shotOK=ChartScreenShot(0,shot,InpScreenshotWidth,InpScreenshotHeight,ALIGN_RIGHT);
   string json="{\"schema_version\":1,\"record_type\":\"SIGNAL\"";
   json+=",\"event_id\":\""+JsonEscape(id)+"\",\"signal_type\":\""+eventType+"\"";
   json+=",\"symbol\":\""+JsonEscape(_Symbol)+"\",\"timeframe\":\""+EnumToString(InpSignalTF)+"\"";
   json+=",\"direction\":\""+SideName(direction)+"\",\"bar_open_epoch\":"+IntegerTime(signalBar);
   json+=",\"observed_utc\":\""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\"";
   json+=",\"bar_server_time\":\""+TimeToString(signalBar,TIME_DATE|TIME_SECONDS)+"\"";
   json+=",\"snapshot_file\":\""+JsonEscape(shotOK?shot:"")+"\",\"snapshot_requested\":"+(shotOK?"true":"false");
   json+=",\"price_reference\":\""+(eventType=="CONFIRMED_FLIP"?"BAR_CLOSE_BID":"LIVE_BID_OR_ASK")+"\"";
   json+=",\"features\":"+FeatureJson(featureShift,direction,refPrice,stLine);
   json+=",\"research_only\":true}";
   if(!SaveOne(fname,json))return;
   AppendLine(json);
   TrackPending(id,signalBar,direction,refPrice,atr);
   g_events++;g_lastEvent=eventType+" "+SideName(direction)+" "+TimeToString(signalBar,TIME_DATE|TIME_MINUTES);
   Print("Tradevice ST observer saved: ",id," screenshot_requested=",shotOK);
}
void EvaluatePending()
{
   bool changed=false;
   int checkpoints[3]={1,3,6};
   for(int i=ArraySize(g_pending)-1;i>=0;i--)
   {
      PendingRecord p=g_pending[i];
      int shift=iBarShift(_Symbol,InpSignalTF,p.bar_time,true);
      if(shift<1)continue;
      int forwardBars=shift-1;
      for(int k=0;k<3;k++)
      {
         int horizon=checkpoints[k];
         if(horizon<=p.horizon || forwardBars<horizon)continue;
         int priceShift=shift-horizon;
         if(priceShift<1)continue; // never use unfinished current bar
         double finalClose=iClose(_Symbol,InpSignalTF,priceShift);
         double maxHigh=-DBL_MAX,minLow=DBL_MAX;
         for(int j=shift-1;j>=priceShift;j--)
         {
            maxHigh=MathMax(maxHigh,iHigh(_Symbol,InpSignalTF,j));
            minLow=MathMin(minLow,iLow(_Symbol,InpSignalTF,j));
         }
         double pt=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
         double sign=(double)p.direction;
         double fwd=pt>0?(finalClose-p.reference)*sign/pt:EMPTY_VALUE;
         double mfe=pt>0?(sign>0?maxHigh-p.reference:p.reference-minLow)/pt:EMPTY_VALUE;
         double mae=pt>0?(sign>0?p.reference-minLow:maxHigh-p.reference)/pt:EMPTY_VALUE;
         double endTrend=BufferAt(hST,4,priceShift);
         bool trendHeld=(endTrend==(double)p.direction);
         bool favorable=(p.atr>0 && p.atr!=EMPTY_VALUE && mfe*pt>=p.atr && fwd>0);
         string json="{\"schema_version\":1,\"record_type\":\"OUTCOME\"";
         json+=",\"event_id\":\""+JsonEscape(p.id)+"\",\"horizon_bars\":"+IntegerToString(horizon);
         json+=",\"measured_utc\":\""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\"";
         json+=",\"forward_close\":"+Num(finalClose,8)+",\"forward_points\":"+Num(fwd,2);
         json+=",\"mfe_points\":"+Num(mfe,2)+",\"mae_points\":"+Num(mae,2);
         json+=",\"st_trend_held\":"+(trendHeld?"true":"false");
         json+=",\"favorable_1atr_observed\":"+(favorable?"true":"false");
         json+=",\"note\":\"OHLC excursions are unordered; no hypothetical fills or realized profit\"}";
         if(SaveOne("outcomes\\"+p.id+"_h"+IntegerToString(horizon)+".json",json))
         {
            AppendLine(json);
            g_pending[i].horizon=horizon;changed=true;
         }
      }
      if(g_pending[i].horizon>=6)
      {
         for(int j=i;j<ArraySize(g_pending)-1;j++)g_pending[j]=g_pending[j+1];
         ArrayResize(g_pending,ArraySize(g_pending)-1);changed=true;
      }
   }
   if(changed)SavePending();
}
int OnInit()
{
   if(_Period!=InpSignalTF)
   {
      Print("Attach observer to the configured timeframe chart of the observed symbol.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpSTATRPeriod<1 || InpSTFactor<=0 || InpVolumeLookback<1 || InpScreenshotWidth<320 || InpScreenshotHeight<240)
      return INIT_PARAMETERS_INCORRECT;
   hST=iCustom(_Symbol,InpSignalTF,"TradeviceResearch\\Tradevice_ST_TV_Observer",
               InpSTATRPeriod,InpSTSource,InpSTFactor,InpSTUseWilderATR,true,false,true);
   hH4ST=iCustom(_Symbol,PERIOD_H4,"TradeviceResearch\\Tradevice_ST_TV_Observer",
                 InpSTATRPeriod,InpSTSource,InpSTFactor,InpSTUseWilderATR,false,false,true);
   hADX=iADX(_Symbol,InpSignalTF,InpADXPeriod);
   hATR=iATR(_Symbol,InpSignalTF,InpATRPeriod);
   hEMA=iMA(_Symbol,InpSignalTF,InpEMAPeriod,0,MODE_EMA,PRICE_CLOSE);
   hRSI=iRSI(_Symbol,InpSignalTF,InpRSIPeriod,PRICE_CLOSE);
   hBands=iBands(_Symbol,InpSignalTF,20,0,2.0,PRICE_CLOSE);
   if(hST==INVALID_HANDLE || hH4ST==INVALID_HANDLE || hADX==INVALID_HANDLE ||
      hATR==INVALID_HANDLE || hEMA==INVALID_HANDLE || hRSI==INVALID_HANDLE || hBands==INVALID_HANDLE)
   {
      Print("Observer indicator handle failed ",GetLastError());
      return INIT_FAILED;
   }
   FolderCreate(InpStorageFolder);
   FolderCreate(InpStorageFolder+"\\shots");
   FolderCreate(InpStorageFolder+"\\events");
   FolderCreate(InpStorageFolder+"\\outcomes");
   LoadPending();
   g_lastClosed=iTime(_Symbol,InpSignalTF,1); // no retroactive "live" events
   bool visible=false;
   int total=ChartIndicatorsTotal(0,0);
   for(int n=0;n<total;n++)
      if(StringFind(ChartIndicatorName(0,0,n),"Supertrend TV Logic")>=0)visible=true;
   if(!visible && !ChartIndicatorAdd(0,0,hST))
      Print("ST plot could not be added automatically. Attach indicator manually; error ",GetLastError());
   EventSetTimer(MathMax(1,InpTimerIntervalSeconds));
   RefreshPanel();
   Print("Tradevice ST OBSERVER ONLY started; NO TRADE OPERATIONS; data folder=",TerminalInfoString(TERMINAL_DATA_PATH));
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason)
{
   EventKillTimer();SavePending();
   for(int i=ObjectsTotal(0,0,-1)-1;i>=0;i--)
   {
      string name=ObjectName(0,i,0,-1);
      if(StringFind(name,g_prefix)==0)ObjectDelete(0,name);
   }
   if(hST!=INVALID_HANDLE)IndicatorRelease(hST);
   if(hH4ST!=INVALID_HANDLE)IndicatorRelease(hH4ST);
   if(hADX!=INVALID_HANDLE)IndicatorRelease(hADX);
   if(hATR!=INVALID_HANDLE)IndicatorRelease(hATR);
   if(hEMA!=INVALID_HANDLE)IndicatorRelease(hEMA);
   if(hRSI!=INVALID_HANDLE)IndicatorRelease(hRSI);
   if(hBands!=INVALID_HANDLE)IndicatorRelease(hBands);
}
void OnTick()
{
   if(!InpCaptureIntrabarBreaks || hST==INVALID_HANDLE)return;
   datetime bar=iTime(_Symbol,InpSignalTF,0);
   if(bar<=0)return;
   double dir=BufferAt(hST,4,1);
   double stLine=dir>0?BufferAt(hST,0,1):BufferAt(hST,1,1);
   MqlTick tick;ZeroMemory(tick);
   if(!SymbolInfoTick(_Symbol,tick))return;
   if(stLine==EMPTY_VALUE || stLine<=0)return;
   if(g_prevBid>0 && dir>0 && tick.bid<stLine && g_prevBid>=stLine && g_lastIntrabarBarSell!=bar)
   {
      CaptureEvent("INTRABAR_BREAK",-1,bar,tick.bid,stLine,1);
      g_lastIntrabarBarSell=bar;
   }
   if(g_prevAsk>0 && dir<0 && tick.ask>stLine && g_prevAsk<=stLine && g_lastIntrabarBarBuy!=bar)
   {
      CaptureEvent("INTRABAR_BREAK",1,bar,tick.ask,stLine,1);
      g_lastIntrabarBarBuy=bar;
   }
   g_prevBid=tick.bid;g_prevAsk=tick.ask;
}
void OnTimer()
{
   if(hST==INVALID_HANDLE)return;
   datetime bar=iTime(_Symbol,InpSignalTF,1);
   if(bar>0 && g_lastClosed>0 && bar!=g_lastClosed)
   {
      g_lastClosed=bar;
      if(InpCaptureClosedFlips)
      {
         double d1=BufferAt(hST,4,1),d2=BufferAt(hST,4,2);
         if(d1!=EMPTY_VALUE && d2!=EMPTY_VALUE && (d1==1 || d1==-1) && d1!=d2)
         {
            double line=d1>0?BufferAt(hST,0,1):BufferAt(hST,1,1);
            CaptureEvent("CONFIRMED_FLIP",(int)d1,bar,iClose(_Symbol,InpSignalTF,1),line,1);
         }
      }
      EvaluatePending();
   }
   RefreshPanel();
}
//+------------------------------------------------------------------+

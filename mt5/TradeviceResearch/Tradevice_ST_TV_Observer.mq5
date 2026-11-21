//+------------------------------------------------------------------+
//|                                             Supertrend_TV_Logic.mq5|
//|  TradingView Pine v4 Supertrend logic converted to MT5            |
//|  Logic source: Supertrend ATR Period / Multiplier / changeATR     |
//+------------------------------------------------------------------+
#property copyright "Converted by ChatGPT"
#property version   "1.10"
#property indicator_chart_window
#property indicator_plots   6
#property indicator_buffers 10

//--- Plot 1: Up trend line
#property indicator_label1  "Up Trend"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrLime
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2

//--- Plot 2: Down trend line
#property indicator_label2  "Down Trend"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrRed
#property indicator_style2  STYLE_SOLID
#property indicator_width2  2

//--- Plot 3: Buy signal
#property indicator_label3  "Buy"
#property indicator_type3   DRAW_ARROW
#property indicator_color3  clrLime
#property indicator_width3  2

//--- Plot 4: Sell signal
#property indicator_label4  "Sell"
#property indicator_type4   DRAW_ARROW
#property indicator_color4  clrRed
#property indicator_width4  2

//--- Extra buffers for the observer EA: non-drawing, CopyBuffer-readable.
#property indicator_label5 "Direction"
#property indicator_type5 DRAW_NONE
#property indicator_label6 "ST ATR"
#property indicator_type6 DRAW_NONE

//--- Source selector, default follows Pine script src=hl2
enum ENUM_ST_SOURCE
{
   ST_SRC_CLOSE = 0,
   ST_SRC_HL2   = 1,
   ST_SRC_HLC3  = 2,
   ST_SRC_OHLC4 = 3
};

input int            InpATRPeriod       = 10;       // ATR Period
input ENUM_ST_SOURCE InpSource          = ST_SRC_HL2;// Source
input double         InpMultiplier      = 3.0;      // ATR Multiplier
input bool           InpChangeATRMethod = true;     // Change ATR Calculation Method? true=Wilder/RMA, false=SMA(TR)
input bool           InpShowSignals     = true;     // Show Buy/Sell Signals?
input bool           InpAlerts          = false;    // Research-only: no popup alerts by default
input bool           InpAlertOnClosedBar= true;     // Alert on closed bar only?

//--- Visible buffers
double UpPlot[];
double DownPlot[];
double BuyArrow[];
double SellArrow[];

//--- Calculation buffers
double TrendBuffer[];
double AtrBuffer[];
double TrBuffer[];
double UpFinal[];
double DownFinal[];
double SourceBuffer[];

//--- alert memory
datetime g_lastBuyAlertTime  = 0;
datetime g_lastSellAlertTime = 0;
datetime g_lastChangeAlertTime = 0;

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
double GetSourceValue(const int i,
                      const double &open[],
                      const double &high[],
                      const double &low[],
                      const double &close[])
{
   switch(InpSource)
   {
      case ST_SRC_CLOSE: return close[i];
      case ST_SRC_HLC3:  return (high[i] + low[i] + close[i]) / 3.0;
      case ST_SRC_OHLC4: return (open[i] + high[i] + low[i] + close[i]) / 4.0;
      case ST_SRC_HL2:
      default:           return (high[i] + low[i]) / 2.0;
   }
}

//+------------------------------------------------------------------+
//| Initialization                                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpATRPeriod <= 0)
   {
      Print("ATR Period must be greater than 0");
      return INIT_PARAMETERS_INCORRECT;
   }

   SetIndexBuffer(0, UpPlot,       INDICATOR_DATA);
   SetIndexBuffer(1, DownPlot,     INDICATOR_DATA);
   SetIndexBuffer(2, BuyArrow,     INDICATOR_DATA);
   SetIndexBuffer(3, SellArrow,    INDICATOR_DATA);

   SetIndexBuffer(4, TrendBuffer,  INDICATOR_DATA);
   SetIndexBuffer(5, AtrBuffer,    INDICATOR_DATA);
   SetIndexBuffer(6, TrBuffer,     INDICATOR_CALCULATIONS);
   SetIndexBuffer(7, UpFinal,      INDICATOR_CALCULATIONS);
   SetIndexBuffer(8, DownFinal,    INDICATOR_CALCULATIONS);
   SetIndexBuffer(9, SourceBuffer, INDICATOR_CALCULATIONS);

   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(2, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(3, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(4, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(5, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   // Wingdings arrows: 233 up arrow, 234 down arrow
   PlotIndexSetInteger(2, PLOT_ARROW, 233);
   PlotIndexSetInteger(3, PLOT_ARROW, 234);

   IndicatorSetString(INDICATOR_SHORTNAME, "Supertrend TV Logic (" + IntegerToString(InpATRPeriod) + ", " + DoubleToString(InpMultiplier, 1) + ")");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Main calculation                                                 |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   // Explicitly select chronological ordering; MQL5 input-array orientation is not guaranteed.
   ArraySetAsSeries(time, false);
   ArraySetAsSeries(open, false);
   ArraySetAsSeries(high, false);
   ArraySetAsSeries(low, false);
   ArraySetAsSeries(close, false);
   if(rates_total < InpATRPeriod + 3)
      return 0;

   // Recalculate only the unfinished bar (and its predecessor on new bars).
   // Full history is recalculated automatically when MT5 resets prev_calculated.
   const int from = (prev_calculated > 1 ? prev_calculated - 1 : 0);
   for(int i = from; i < rates_total; i++)
   {
      UpPlot[i]    = EMPTY_VALUE;
      DownPlot[i]  = EMPTY_VALUE;
      BuyArrow[i]  = EMPTY_VALUE;
      SellArrow[i] = EMPTY_VALUE;

      SourceBuffer[i] = GetSourceValue(i, open, high, low, close);

      if(i == 0)
         TrBuffer[i] = high[i] - low[i];
      else
      {
         double tr1 = high[i] - low[i];
         double tr2 = MathAbs(high[i] - close[i - 1]);
         double tr3 = MathAbs(low[i]  - close[i - 1]);
         TrBuffer[i] = MathMax(tr1, MathMax(tr2, tr3));
      }

      // ATR calculation:
      // changeATR=true  -> TradingView atr(), which is Wilder/RMA of TR.
      // changeATR=false -> SMA(TR, Periods), matching atr2=sma(tr, Periods).
      if(InpChangeATRMethod)
      {
         if(InpATRPeriod == 1)
            AtrBuffer[i] = TrBuffer[i];
         else if(i == 0)
            AtrBuffer[i] = TrBuffer[i];
         else if(i < InpATRPeriod)
         {
            double sum = 0.0;
            for(int k = 0; k <= i; k++)
               sum += TrBuffer[k];
            AtrBuffer[i] = sum / (double)(i + 1);
         }
         else if(i == InpATRPeriod)
         {
            double sum = 0.0;
            for(int k = i - InpATRPeriod + 1; k <= i; k++)
               sum += TrBuffer[k];
            AtrBuffer[i] = sum / (double)InpATRPeriod;
         }
         else
            AtrBuffer[i] = ((AtrBuffer[i - 1] * (InpATRPeriod - 1)) + TrBuffer[i]) / (double)InpATRPeriod;
      }
      else
      {
         double sum = 0.0;
         int count = 0;
         int from = MathMax(0, i - InpATRPeriod + 1);
         for(int k = from; k <= i; k++)
         {
            sum += TrBuffer[k];
            count++;
         }
         AtrBuffer[i] = sum / (double)count;
      }

      double basicUp = SourceBuffer[i] - (InpMultiplier * AtrBuffer[i]);
      double basicDn = SourceBuffer[i] + (InpMultiplier * AtrBuffer[i]);

      if(i == 0)
      {
         UpFinal[i]     = basicUp;
         DownFinal[i]   = basicDn;
         TrendBuffer[i] = 1.0;
      }
      else
      {
         double up1 = UpFinal[i - 1];
         double dn1 = DownFinal[i - 1];

         // Pine:
         // up := close[1] > up1 ? max(up,up1) : up
         // dn := close[1] < dn1 ? min(dn,dn1) : dn
         UpFinal[i]   = (close[i - 1] > up1) ? MathMax(basicUp, up1) : basicUp;
         DownFinal[i] = (close[i - 1] < dn1) ? MathMin(basicDn, dn1) : basicDn;

         double prevTrend = TrendBuffer[i - 1];
         double trend = prevTrend;

         // Pine:
         // trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
         if(prevTrend == -1.0 && close[i] > dn1)
            trend = 1.0;
         else if(prevTrend == 1.0 && close[i] < up1)
            trend = -1.0;

         TrendBuffer[i] = trend;
      }

      bool buySignal  = (i > 0 && TrendBuffer[i] == 1.0  && TrendBuffer[i - 1] == -1.0);
      bool sellSignal = (i > 0 && TrendBuffer[i] == -1.0 && TrendBuffer[i - 1] == 1.0);

      if(TrendBuffer[i] == 1.0)
         UpPlot[i] = UpFinal[i];
      else
         DownPlot[i] = DownFinal[i];

      if(InpShowSignals)
      {
         if(buySignal)
            BuyArrow[i] = UpFinal[i];
         if(sellSignal)
            SellArrow[i] = DownFinal[i];
      }
   }

   // Alerts
   if(InpAlerts)
   {
      int alertIndex = InpAlertOnClosedBar ? rates_total - 2 : rates_total - 1;
      if(alertIndex > 0)
      {
         bool buySignalNow  = (TrendBuffer[alertIndex] == 1.0  && TrendBuffer[alertIndex - 1] == -1.0);
         bool sellSignalNow = (TrendBuffer[alertIndex] == -1.0 && TrendBuffer[alertIndex - 1] == 1.0);
         bool changeNow     = (TrendBuffer[alertIndex] != TrendBuffer[alertIndex - 1]);

         if(buySignalNow && time[alertIndex] != g_lastBuyAlertTime)
         {
            g_lastBuyAlertTime = time[alertIndex];
            Alert(_Symbol, " ", EnumToString(_Period), ": SuperTrend Buy!");
         }
         if(sellSignalNow && time[alertIndex] != g_lastSellAlertTime)
         {
            g_lastSellAlertTime = time[alertIndex];
            Alert(_Symbol, " ", EnumToString(_Period), ": SuperTrend Sell!");
         }
         if(changeNow && time[alertIndex] != g_lastChangeAlertTime)
         {
            g_lastChangeAlertTime = time[alertIndex];
            Print(_Symbol, " ", EnumToString(_Period), ": SuperTrend has changed direction!");
         }
      }
   }

   return rates_total;
}
//+------------------------------------------------------------------+

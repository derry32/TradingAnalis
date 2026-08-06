//+------------------------------------------------------------------+
//|                                          AurumAI_Executor.mq5    |
//|                                 Copyright 2026, Aurum AI Quant   |
//|                                            https://aurum-ai.io   |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "4.10"
#property description "Aurum AI Multi-Layer Scalper v4.10 (Sprint 1: Core Protection & Smart Exit Framework)"

// ZERO #include directives - pure native MQL5 only

//--- Inputs: API & Polling
input string InpApiUrl       = "http://43.156.79.235:3002";      // Backend URL
input string InpApiToken     = "aurum_secret_bridge_token_2026"; // Secret Token
input int    InpTimerSeconds = 1;                                 // Polling Interval (sec)

//--- Inputs: Scalper Layers
input int    InpNumMarket    = 3;     // Market Order Layers
input int    InpNumLimit     = 2;     // Limit Order Layers
input double InpMinLot       = 0.03;  // Lot Confidence < 70%
input double InpMidLot       = 0.05;  // Lot Confidence 70-79%
input double InpMaxLot       = 0.09;  // Lot Confidence >= 80%
input int    InpStepPoints   = 35;    // Step between limit layers (pts)
input int    InpMaxPositions = 15;    // Max simultaneous positions

//--- Inputs: Risk & Basic Guards
input ulong  InpMagic        = 778899; // Magic Number
input int    InpMaxSpread    = 400;    // Max Spread pts
input ulong  InpSlippage     = 30;     // Slippage pts
input bool   InpDemoOnly     = true;   // Demo Guard

//=== Inputs: Smart & Rapid Scalp Exit Framework ===
input double InpBEMultiplier      = 0.8;  // BE Trigger: MIN(0.8R, ATR * mult)
input double InpPartialR          = 1.0;  // Partial TP Trigger (x R)
input double InpTrailingStartR    = 0.8;  // Trailing Start (x R)
input double InpTrailingATR2R     = 1.5;  // Trailing Gap @ >= 0.8R (x ATR)
input double InpTrailingATR3R     = 1.2;  // Trailing Gap @ >= 1.5R (x ATR)
input double InpTrailingATR4R     = 1.0;  // Trailing Gap @ >= 2.5R (x ATR)

//--- Dynamic Time Stop
input double InpTimeStopMinR      = 0.4;  // Min Profit R to avoid Time Stop
input double InpTSAtrSmall        = 1.5;  // ATR small threshold
input double InpTSAtrLarge        = 5.0;  // ATR large threshold
input int    InpTSMinsSmall       = 8;    // Time Stop if ATR small (min)
input int    InpTSMinsNormal      = 15;   // Time Stop if ATR normal (min)
input int    InpTSMinsLarge       = 20;   // Time Stop if ATR large (min)

//--- Daily Risk Guard
input double InpDailyMaxLossPct   = 3.0;  // Max Daily Loss % before lockdown

//--- State globals
string   g_lastId            = "";
string   g_activeId          = "";
string   g_activeDir         = "";
double   g_signalOpenPx      = 0.0;
double   g_signalSL          = 0.0;
double   g_tp1               = 0.0;
double   g_tp2               = 0.0;
double   g_initialR          = 0.0;
double   g_signalConf        = 70.0;
datetime g_signalOpenTime    = 0;
bool     g_beDone            = false;
bool     g_partialDone       = false;
double   g_lastTrailingSL    = 0.0;
double   g_peakProfitDist    = 0.0;
int      g_atrHandle         = INVALID_HANDLE;
bool     g_ready             = false;

//--- Daily Guard Globals
int      g_currentDay        = -1;
double   g_dailyStartBalance = 0.0;
bool     g_dailyGuardBlocked = false;

//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetFilling()
{
   uint m = (uint)SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((m & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   if((m & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
double GetATR(ENUM_TIMEFRAMES tf = PERIOD_M5)
{
   if(g_atrHandle == INVALID_HANDLE)
      g_atrHandle = iATR(_Symbol, tf, 14);
   double atr[1];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(g_atrHandle, 0, 0, 1, atr) > 0)
      return atr[0];
   return 2.0; // safe default for Gold
}

//+------------------------------------------------------------------+
ulong NativeSend(ENUM_ORDER_TYPE type, double price, double sl, double tp,
                 double lots, string comment)
{
   MqlTradeRequest req;
   MqlTradeResult  res;
   ZeroMemory(req);
   ZeroMemory(res);

   bool pending = (type == ORDER_TYPE_BUY_LIMIT  || type == ORDER_TYPE_SELL_LIMIT ||
                   type == ORDER_TYPE_BUY_STOP   || type == ORDER_TYPE_SELL_STOP);

   req.action       = pending ? TRADE_ACTION_PENDING : TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = lots;
   req.type         = type;
   req.price        = price;
   req.sl           = sl;
   req.tp           = tp;
   req.deviation    = InpSlippage;
   req.type_filling = GetFilling();
   req.type_time    = ORDER_TIME_GTC;
   req.magic        = InpMagic;
   req.comment      = comment;

   if(!OrderSend(req, res))
   {
      PrintFormat("[OrderSend FAIL] type=%d err=%d retcode=%d", (int)type, GetLastError(), res.retcode);
      return 0;
   }
   if(res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED)
      return (res.order > 0) ? res.order : res.deal;

   PrintFormat("[OrderSend NON-DONE] retcode=%d %s", res.retcode, res.comment);
   return 0;
}

//+------------------------------------------------------------------+
int CountPositions()
{
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         n++;
   }
   return n;
}

//+------------------------------------------------------------------+
void CloseAllPositions(string reason)
{
   Print("[CLOSE ALL] " + reason);
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
      {
         MqlTradeRequest req;
         MqlTradeResult  res;
         ZeroMemory(req);
         ZeroMemory(res);
         req.action   = TRADE_ACTION_DEAL;
         req.symbol   = _Symbol;
         req.position = t;
         req.volume   = PositionGetDouble(POSITION_VOLUME);
         int pType    = (int)PositionGetInteger(POSITION_TYPE);
         req.type     = (pType == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
         req.price    = (req.type == ORDER_TYPE_SELL)
                        ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                        : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         req.deviation    = InpSlippage;
         req.type_filling = GetFilling();
         req.magic        = InpMagic;
         if(!OrderSend(req, res))
            PrintFormat("[Close FAIL] ticket=%I64u err=%d", t, GetLastError());
      }
   }
   for(int i = OrdersTotal()-1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 &&
         OrderGetString(ORDER_SYMBOL) == _Symbol &&
         (ulong)OrderGetInteger(ORDER_MAGIC) == InpMagic)
      {
         MqlTradeRequest req;
         MqlTradeResult  res;
         ZeroMemory(req);
         ZeroMemory(res);
         req.action = TRADE_ACTION_REMOVE;
         req.order  = t;
         if(!OrderSend(req, res))
            PrintFormat("[RemoveOrder FAIL] ticket=%I64u err=%d", t, GetLastError());
      }
   }
}

//+------------------------------------------------------------------+
double GetCurrentProfitDistance()
{
   if(g_activeDir == "" || g_signalOpenPx <= 0.0) return 0.0;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   if(g_activeDir == "BUY")
      return (bid - g_signalOpenPx);
   else if(g_activeDir == "SELL")
      return (g_signalOpenPx - ask);

   return 0.0;
}

//+------------------------------------------------------------------+
// Task 2.0: Momentum Reversal & Peak Profit Protection Exit
//+------------------------------------------------------------------+
void CheckMomentumReversalExit()
{
   if(g_activeId == "" || CountPositions() == 0) return;

   double profitDist = GetCurrentProfitDistance();
   double atr        = GetATR(PERIOD_M5);

   if(profitDist > g_peakProfitDist)
      g_peakProfitDist = profitDist;

   // 1. Peak Profit Protection: If trade reached at least +1.0 ($1.00 / 10 pips) and drops by >= 45% of peak
   double minLockProfit = MathMax(1.0, atr * 0.8);
   if(g_peakProfitDist >= minLockProfit)
   {
      double dropDist = g_peakProfitDist - profitDist;
      if(dropDist >= (g_peakProfitDist * 0.45) && profitDist > 0.0)
      {
         PrintFormat("[PEAK PROFIT LOCK] Signal %s | Peak was +%.2f, dropped to +%.2f (-%.2f drop) -> Securing profit at market!",
                     g_activeId, g_peakProfitDist, profitDist, dropDist);
         CloseAllPositions("Peak Profit Lock (Secured +" + DoubleToString(profitDist, 2) + ")");
         g_activeId = "";
         return;
      }
   }

   // 2. Early Invalidation on Strong Opposing M5 Candle
   if(g_initialR > 0.0 && profitDist < (-0.3 * g_initialR))
   {
      MqlRates rates[];
      ArraySetAsSeries(rates, true);
      if(CopyRates(_Symbol, PERIOD_M5, 0, 2, rates) >= 2)
      {
         bool isOpposingCandle = false;
         if(g_activeDir == "BUY"  && rates[0].close < rates[0].open && (rates[0].open - rates[0].close) > atr * 0.8)
            isOpposingCandle = true;
         if(g_activeDir == "SELL" && rates[0].close > rates[0].open && (rates[0].close - rates[0].open) > atr * 0.8)
            isOpposingCandle = true;

         if(isOpposingCandle)
         {
            PrintFormat("[EARLY INVALIDATION CUT] Signal %s | Strong opposing candle detected while floating %.2f loss -> Cutloss to prevent full SL!",
                        g_activeId, profitDist);
            CloseAllPositions("Early Invalidation Cut (" + DoubleToString(profitDist, 2) + ")");
            g_activeId = "";
            return;
         }
      }
   }
}

//+------------------------------------------------------------------+
// Task 2.1: Rapid Adaptive Break Even (BE + Spread Buffer)
//+------------------------------------------------------------------+
void CheckAdaptiveBreakEven()
{
   if(g_beDone || g_activeId == "" || g_initialR <= 0.0) return;

   double profitDist = GetCurrentProfitDistance();
   double atr        = GetATR(PERIOD_M5);
   double trigger    = MathMax(1.0, MathMin(0.8 * g_initialR, atr * InpBEMultiplier));

   if(profitDist >= trigger)
   {
      double pt     = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      long   spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      double buffer = MathMax(0.20, (double)spread * pt);
      double newSL  = (g_activeDir == "BUY") ? (g_signalOpenPx + buffer) : (g_signalOpenPx - buffer);

      int count = 0;
      for(int i = PositionsTotal()-1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 &&
            PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         {
            double curSL = PositionGetDouble(POSITION_SL);
            double curTP = PositionGetDouble(POSITION_TP);

            bool needMod = false;
            if(g_activeDir == "BUY"  && (curSL < newSL || curSL == 0.0)) needMod = true;
            if(g_activeDir == "SELL" && (curSL > newSL || curSL == 0.0)) needMod = true;

            if(needMod)
            {
               MqlTradeRequest req;
               MqlTradeResult  res;
               ZeroMemory(req);
               ZeroMemory(res);
               req.action   = TRADE_ACTION_SLTP;
               req.symbol   = _Symbol;
               req.position = t;
               req.sl       = NormalizeDouble(newSL, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
               req.tp       = curTP;
               if(OrderSend(req, res)) count++;
            }
         }
      }

      g_beDone = true;
      PrintFormat("[BE] Signal %s | SL moved to %.2f (profit=%.2f >= trigger=%.2f)",
                  g_activeId, newSL, profitDist, trigger);
   }
}

//+------------------------------------------------------------------+
// Task 2.2: Fast Dynamic Partial TP (50% lot at +1.0R / +15-20 pips)
//+------------------------------------------------------------------+
void CheckDynamicPartialTP()
{
   if(g_partialDone || g_activeId == "" || g_initialR <= 0.0) return;

   double profitDist = GetCurrentProfitDistance();
   double trigger    = MathMax(1.2, InpPartialR * g_initialR);

   if(profitDist >= trigger)
   {
      int open = CountPositions();
      if(open <= 1) { g_partialDone = true; return; }

      double closeRatio = 0.50;
      if(g_signalConf >= 85.0)      closeRatio = 0.35;
      else if(g_signalConf >= 75.0) closeRatio = 0.50;
      else                          closeRatio = 0.65;

      int toClose = MathMax(1, (int)MathRound((double)open * closeRatio));
      if(toClose >= open) toClose = open - 1;

      int closed = 0;
      for(int i = PositionsTotal()-1; i >= 0 && closed < toClose; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 &&
            PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         {
            MqlTradeRequest req;
            MqlTradeResult  res;
            ZeroMemory(req);
            ZeroMemory(res);
            req.action   = TRADE_ACTION_DEAL;
            req.symbol   = _Symbol;
            req.position = t;
            req.volume   = PositionGetDouble(POSITION_VOLUME);
            int pt       = (int)PositionGetInteger(POSITION_TYPE);
            req.type     = (pt == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
            req.price    = (req.type == ORDER_TYPE_SELL)
                           ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                           : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            req.deviation    = InpSlippage;
            req.type_filling = GetFilling();
            req.magic        = InpMagic;
            if(OrderSend(req, res)) closed++;
         }
      }

      g_partialDone = true;
      PrintFormat("[PARTIAL_TP] Signal %s | Conf=%.1f%% -> Closed %d/%d positions at profit %.2f (>= %.1fR)",
                  g_activeId, g_signalConf, closed, open, profitDist, InpPartialR);
   }
}

//+------------------------------------------------------------------+
// Task 3.1: Tiered ATR Trailing Stop (Fast Scalp Trailing)
//+------------------------------------------------------------------+
void CheckTieredTrailingStop()
{
   if(g_activeId == "" || g_initialR <= 0.0) return;

   double profitDist = GetCurrentProfitDistance();
   double rProfit    = profitDist / g_initialR;

   if(rProfit < InpTrailingStartR && profitDist < 1.5) return;

   double mult = InpTrailingATR2R;
   if(rProfit >= 2.5)      mult = InpTrailingATR4R; // 1.0x ATR
   else if(rProfit >= 1.5) mult = InpTrailingATR3R; // 1.2x ATR
   else                    mult = InpTrailingATR2R; // 1.5x ATR

   double atr   = GetATR(PERIOD_M5);
   double gap   = atr * mult;
   double bid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask   = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double pt    = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    dig   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   double candSL = (g_activeDir == "BUY") ? (bid - gap) : (ask + gap);
   candSL = NormalizeDouble(candSL, dig);

   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
      {
         double curSL = PositionGetDouble(POSITION_SL);
         double curTP = PositionGetDouble(POSITION_TP);

         bool shouldUpdate = false;
         if(g_activeDir == "BUY"  && candSL > (curSL + 2.0 * pt)) shouldUpdate = true;
         if(g_activeDir == "SELL" && (candSL < (curSL - 2.0 * pt) || curSL == 0.0)) shouldUpdate = true;

         if(shouldUpdate)
         {
            MqlTradeRequest req;
            MqlTradeResult  res;
            ZeroMemory(req);
            ZeroMemory(res);
            req.action   = TRADE_ACTION_SLTP;
            req.symbol   = _Symbol;
            req.position = t;
            req.sl       = candSL;
            req.tp       = curTP;
            if(OrderSend(req, res))
            {
               g_lastTrailingSL = candSL;
               PrintFormat("[TRAILING-%.1fR] Signal %s | SL moved to %.2f (gap=%.2f, ATR*%.1f)",
                           rProfit, g_activeId, candSL, gap, mult);
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
// Task 4.1: Dynamic Time Stop (Fast Scalp Timeout)
//+------------------------------------------------------------------+
void CheckDynamicTimeStop()
{
   if(g_activeId == "" || g_signalOpenTime == 0 || CountPositions() == 0) return;

   int elapsedMins = (int)((TimeCurrent() - g_signalOpenTime) / 60);
   double atr      = GetATR(PERIOD_M5);
   int maxMins     = InpTSMinsNormal;

   if(atr < InpTSAtrSmall)      maxMins = InpTSMinsSmall;  // 8 min
   else if(atr > InpTSAtrLarge) maxMins = InpTSMinsLarge;  // 20 min

   double profitDist = GetCurrentProfitDistance();
   double minProfitR = InpTimeStopMinR * g_initialR;

   if(elapsedMins >= maxMins && profitDist < minProfitR)
   {
      PrintFormat("[TIME_STOP] Signal %s | Open %dm >= max %dm, profit=%.2f < threshold=%.2f -> Closing all positions",
                  g_activeId, elapsedMins, maxMins, profitDist, minProfitR);
      CloseAllPositions("Time Stop (" + IntegerToString(elapsedMins) + "m timeout)");
      g_activeId = "";
      g_signalOpenTime = 0;
   }
}

//+------------------------------------------------------------------+
// Task 4.2: Daily Risk Guard
//+------------------------------------------------------------------+
void CheckDailyRiskGuard()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);

   if(dt.day != g_currentDay)
   {
      g_currentDay        = dt.day;
      g_dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      g_dailyGuardBlocked = false;
      PrintFormat("[DAILY_GUARD] New Day %d/08/2026. Starting Balance: %.2f IDR/USD. Daily Guard Reset OK.",
                  dt.day, g_dailyStartBalance);
   }

   double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_dailyStartBalance > 0.0)
   {
      double lossPct = (g_dailyStartBalance - currentEquity) / g_dailyStartBalance * 100.0;
      if(lossPct >= InpDailyMaxLossPct && !g_dailyGuardBlocked)
      {
         g_dailyGuardBlocked = true;
         PrintFormat("[DAILY_GUARD TRIGGERED] Current Drawdown: %.2f%% >= Max Allowed: %.2f%%. New entries LOCKED for today!",
                     lossPct, InpDailyMaxLossPct);
      }
   }
}

//+------------------------------------------------------------------+
string JStr(string json, string key)
{
   string s = "\"" + key + "\":\"";
   int p = StringFind(json, s);
   if(p < 0)
   {
      s = "\"" + key + "\":";
      p = StringFind(json, s);
      if(p < 0) return "";
      p += StringLen(s);
      int e1 = StringFind(json, ",", p);
      int e2 = StringFind(json, "}", p);
      int e  = (e1 < 0) ? e2 : (e2 < 0) ? e1 : MathMin(e1, e2);
      if(e < 0) return "";
      string v = StringSubstr(json, p, e - p);
      StringTrimLeft(v);
      StringTrimRight(v);
      StringReplace(v, "\"", "");
      return v;
   }
   p += StringLen(s);
   int e = StringFind(json, "\"", p);
   return (e < 0) ? "" : StringSubstr(json, p, e - p);
}

//+------------------------------------------------------------------+
double JDbl(string json, string key)
{
   string s = "\"" + key + "\":";
   int p = StringFind(json, s);
   if(p < 0) return 0.0;
   p += StringLen(s);
   int e1 = StringFind(json, ",", p);
   int e2 = StringFind(json, "}", p);
   int e  = (e1 < 0) ? e2 : (e2 < 0) ? e1 : MathMin(e1, e2);
   if(e < 0) return 0.0;
   string v = StringSubstr(json, p, e - p);
   StringTrimLeft(v);
   StringTrimRight(v);
   StringReplace(v, "\"", "");
   return StringToDouble(v);
}

//+------------------------------------------------------------------+
string HttpGet(string url)
{
   char   req[], res[];
   string hdrs;
   ArrayResize(req, 0);
   int code = WebRequest("GET", url, "", 3000, req, res, hdrs);
   if(code == 200)
      return CharArrayToString(res);
   if(GetLastError() == 4014)
      Print("[ERROR] Add '" + InpApiUrl + "' to Tools->Options->Expert Advisors->Allow WebRequest");
   return "";
}

//+------------------------------------------------------------------+
void SendAck(string id, ulong ticket, double px, string status, long spread)
{
   string body = "{\"token\":\"" + InpApiToken + "\","
                 + "\"signalId\":\"" + id + "\","
                 + "\"ticket\":" + IntegerToString((long)ticket) + ","
                 + "\"executedPrice\":" + DoubleToString(px, 2) + ","
                 + "\"status\":\"" + status + "\","
                 + "\"spreadPips\":" + IntegerToString((int)(spread/10)) + "}";
   char req[], res[];
   string hdrs;
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", InpApiUrl + "/api/mt5/signals/ack",
              "Content-Type: application/json\r\n", 3000, req, res, hdrs);
}

//+------------------------------------------------------------------+
double LotByConf(double c)
{
   if(c >= 80.0) return InpMaxLot;
   if(c >= 70.0) return InpMidLot;
   return InpMinLot;
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpDemoOnly &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Alert("[SAFETY] Demo-only guard - EA stopped on REAL account!");
      return INIT_FAILED;
   }

   g_atrHandle = iATR(_Symbol, PERIOD_M5, 14);

   EventSetTimer(InpTimerSeconds);

   Print("=================================================");
   Print("[Aurum AI] v4.10 (Sprint 1: Rapid Scalp Protection) Started!");
   Print("Connecting to: " + InpApiUrl);
   Print("Magic Number : " + IntegerToString(InpMagic));
   Print("Layers Plan  : " + IntegerToString(InpNumMarket) + " Market + " + IntegerToString(InpNumLimit) + " Limit");
   Print("Lot Sizing   : Dynamic (<70%:" + DoubleToString(InpMinLot,2) + " | 70-79%:" + DoubleToString(InpMidLot,2) + " | >=80%:" + DoubleToString(InpMaxLot,2) + ")");
   Print("Smart Exit   : Early BE [MIN(0.8R, ATR*0.8)] | Dynamic Partial TP | Rapid Trailing Stop");
   Print("Time Stop    : Dynamic (" + IntegerToString(InpTSMinsSmall) + "m / " + IntegerToString(InpTSMinsNormal) + "m / " + IntegerToString(InpTSMinsLarge) + "m by ATR)");
   Print("Daily Guard  : " + DoubleToString(InpDailyMaxLossPct, 1) + "% Max Drawdown Lockdown");
   Print("=================================================");

   string r = HttpGet(InpApiUrl + "/api/mt5/status");
   if(r != "") Print("[Server Status] " + r);

   g_ready = true;
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_atrHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_atrHandle);
      g_atrHandle = INVALID_HANDLE;
   }
   Print("[Aurum AI] Deinitialized.");
}

//+------------------------------------------------------------------+
// Task 5.1: High-Frequency Exit & Risk Management on each tick
//+------------------------------------------------------------------+
void OnTick()
{
   if(!g_ready) return;

   if(CountPositions() > 0)
   {
      CheckMomentumReversalExit();
      CheckAdaptiveBreakEven();
      CheckDynamicPartialTP();
      CheckTieredTrailingStop();
   }
   else
   {
      if(g_activeId != "" && OrdersTotal() == 0)
      {
         g_activeId       = "";
         g_signalOpenTime = 0;
         g_beDone         = false;
         g_partialDone    = false;
         g_peakProfitDist = 0.0;
      }
   }
}

//+------------------------------------------------------------------+
// Task 5.2: Low-Frequency Polling & Periodic Checks on timer (1 sec)
//+------------------------------------------------------------------+
void OnTimer()
{
   if(!g_ready) return;

   CheckDailyRiskGuard();

   if(CountPositions() > 0)
   {
      CheckDynamicTimeStop();
   }

   string json = HttpGet(InpApiUrl + "/api/mt5/signals/latest?token=" + InpApiToken);
   if(json == "") return;

   // Check remote reset from Telegram / Web
   if(JStr(json, "resetGuard") == "true")
   {
      g_dailyGuardBlocked = false;
      g_dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      Print("[REMOTE RESET] Daily Guard unlocked via Telegram / Web!");
   }

   if(JStr(json, "status") != "ACTIVE_SIGNAL") return;

   string id = JStr(json, "id");
   if(id == "" || id == g_lastId) return;

   if(g_dailyGuardBlocked)
   {
      PrintFormat("[DAILY_GUARD BLOCKED] Skipping signal %s due to daily loss limit reached.", id);
      return;
   }

   if(CountPositions() >= InpMaxPositions)
   {
      Print("[CAP] max positions reached - skipping " + id);
      return;
   }

   string  dir    = JStr(json, "type");
   double  sl     = JDbl(json, "stopLoss");
   double  tp1    = JDbl(json, "takeProfit1");
   double  tp2    = JDbl(json, "takeProfit2");
   double  conf   = JDbl(json, "confidence");
   string  mode   = JStr(json, "executionMode");

   if(conf <= 0.0) conf = 70.0;
   if(mode == "") mode = (conf >= 75.0) ? "HALF" : "BASKET";

   double targetTP = (mode == "HALF") ? tp2 : tp1;
   double lot      = LotByConf(conf);

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > InpMaxSpread)
   {
      Print("[SPREAD] " + IntegerToString((int)spread) + " pts too high - skip " + id);
      return;
   }

   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double pt   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double step = InpStepPoints * pt;
   if(step <= 0.0) step = 0.35;

   ulong firstTicket = 0;
   int   opened      = 0;
   double execPrice  = (dir == "BUY") ? ask : bid;

   PrintFormat("[SIGNAL] %s dir=%s conf=%.1f mode=%s lot=%.2f tp=%.2f sl=%.2f",
               id, dir, conf, mode, lot, targetTP, sl);

   // Market layers
   for(int m = 1; m <= InpNumMarket; m++)
   {
      ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      double          px = (dir == "BUY") ? ask : bid;
      ulong t = NativeSend(ot, px, sl, targetTP, lot,
                           "Aurum Mkt#" + IntegerToString(m) + " " + id);
      if(t > 0)
      {
         opened++;
         if(firstTicket == 0) firstTicket = t;
         PrintFormat("[MKT#%d] ticket=%I64u px=%.2f lot=%.2f", m, t, px, lot);
      }
   }

   // Limit layers
   for(int l = 1; l <= InpNumLimit; l++)
   {
      ulong  t  = 0;
      string cm = "Aurum Lmt#" + IntegerToString(l) + " " + id;
      if(dir == "BUY")
      {
         double lp = ask - (step * l);
         t = NativeSend(ORDER_TYPE_BUY_LIMIT, lp, sl, targetTP, lot, cm);
         if(t > 0) { opened++; PrintFormat("[BUY_LMT#%d] ticket=%I64u px=%.2f", l, t, lp); }
      }
      else
      {
         double lp = bid + (step * l);
         t = NativeSend(ORDER_TYPE_SELL_LIMIT, lp, sl, targetTP, lot, cm);
         if(t > 0) { opened++; PrintFormat("[SELL_LMT#%d] ticket=%I64u px=%.2f", l, t, lp); }
      }
   }

   if(opened > 0)
   {
      g_lastId         = id;
      g_activeId       = id;
      g_activeDir      = dir;
      g_signalOpenPx   = execPrice;
      g_signalSL       = sl;
      g_tp1            = tp1;
      g_tp2            = tp2;
      g_initialR       = MathAbs(execPrice - sl);
      g_signalConf     = conf;
      g_signalOpenTime = TimeCurrent();
      g_beDone         = false;
      g_partialDone    = false;
      g_peakProfitDist = 0.0;

      SendAck(id, firstTicket, execPrice, "OPENED", spread);
      PrintFormat("[DONE] Signal %s | mode=%s | %d layers | 1R=%.2f | lot=%.2f",
                  id, mode, opened, g_initialR, lot);
   }
}
//+------------------------------------------------------------------+

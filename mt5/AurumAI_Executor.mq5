//+------------------------------------------------------------------+
//|                                          AurumAI_Executor.mq5    |
//|                                 Copyright 2026, Aurum AI Quant   |
//|                                            https://aurum-ai.io   |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "4.20"
#property description "Aurum AI Ultra-Fast 5-Layer Burst Scalper v4.20"

//--- Inputs: API & High-Speed Polling
input string InpApiUrl             = "http://43.156.79.235:3002";      // Backend URL
input string InpApiToken           = "aurum_secret_bridge_token_2026"; // Secret Token
input int    InpTimerSeconds       = 1;                                 // Polling Interval (sec)

//=== Inputs: Multi-Layer Burst Scalping ===
input int    InpMultiLayerCount    = 5;     // Number of Burst Layers (5 Layers)
input double InpMicroTPMin         = 8.0;   // Base Micro TP (pips: 8.0 = $0.80 Gold)
input double InpMicroTPStep        = 1.0;   // TP Step per layer (pips)
input double InpDynamicMicroSL     = 10.0;  // Tight Micro SL (pips: 10.0 = $1.00 Gold)
input double InpMinLot             = 0.02;  // Lot per layer for Conf < 75%
input double InpMidLot             = 0.03;  // Lot per layer for Conf 75-84%
input double InpMaxLot             = 0.05;  // Lot per layer for Conf >= 85%
input int    InpMaxPositions       = 25;    // Max simultaneous open positions

//=== Inputs: Anti-Chasing & Signal TTL Guard ===
input int    InpSignalTTLSec       = 30;    // Signal TTL (sec) - Discard stale signals
input double InpMaxChasingPips     = 15.0;  // Max price chasing deviation (pips: 15.0 = $1.50)
input bool   InpAutoPullbackLimit  = true;  // Auto-convert to Limit Pullback if price chased

//=== Inputs: Risk & Basic Guards ===
input ulong  InpMagicNumber        = 778899; // Magic Number
input int    InpMaxSpreadPoints    = 400;    // Max Spread pts (40 pips)
input ulong  InpSlippage           = 30;     // Slippage pts
input bool   InpDemoOnlyGuard      = true;   // Demo Guard

//=== Inputs: Smart Trailing & Break-Even ===
input double InpBEMultiplier       = 0.6;    // BE Trigger at +6.0 pips profit
input double InpTrailingStartPips  = 8.0;    // Trailing Start at +8.0 pips profit
input double InpTrailingGapPips    = 5.0;    // Trailing Gap (5.0 pips)
input int    InpMaxHoldMinutes     = 5;      // Max Hold Time for Scalp (minutes)

//--- State globals
string   g_lastProcessedId   = "";
string   g_activeSignalId    = "";
string   g_activeDir         = "";
double   g_signalOpenPx      = 0.0;
datetime g_signalOpenTime    = 0;
bool     g_beDone            = false;
bool     g_isInitialized     = false;

//+------------------------------------------------------------------+
//| Helper: Get Symbol Filling Mode                                 |
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetSymbolFillingType(string symbol)
{
   uint fillingMode = (uint)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((fillingMode & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   if((fillingMode & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
//| Simple JSON String Extractor                                     |
//+------------------------------------------------------------------+
string GetJsonString(string json, string key)
{
   string searchKey = "\"" + key + "\":\"";
   int startPos = StringFind(json, searchKey);
   if(startPos >= 0)
   {
      startPos += StringLen(searchKey);
      int endPos = StringFind(json, "\"", startPos);
      if(endPos > startPos)
         return StringSubstr(json, startPos, endPos - startPos);
   }

   searchKey = "\"" + key + "\":";
   startPos = StringFind(json, searchKey);
   if(startPos >= 0)
   {
      startPos += StringLen(searchKey);
      int endPosComma = StringFind(json, ",", startPos);
      int endPosBrace = StringFind(json, "}", startPos);
      int endPos = -1;
      if(endPosComma >= 0 && endPosBrace >= 0) endPos = MathMin(endPosComma, endPosBrace);
      else if(endPosComma >= 0) endPos = endPosComma;
      else endPos = endPosBrace;
      
      if(endPos > startPos)
      {
         string val = StringSubstr(json, startPos, endPos - startPos);
         StringTrimLeft(val);
         StringTrimRight(val);
         StringReplace(val, "\"", "");
         return val;
      }
   }
   return "";
}

//+------------------------------------------------------------------+
//| Simple JSON Double Extractor                                     |
//+------------------------------------------------------------------+
double GetJsonDouble(string json, string key)
{
   string val = GetJsonString(json, key);
   if(val != "") return StringToDouble(val);
   return 0.0;
}

//+------------------------------------------------------------------+
//| HTTP GET Request via WebRequest                                  |
//+------------------------------------------------------------------+
string SendGetRequest(string url)
{
   char serverResult[];
   string serverHeaders;
   char dummyData[];
   ArrayResize(dummyData, 0);
   int res = WebRequest("GET", url, "", 3000, dummyData, serverResult, serverHeaders);
   if(res == 200)
      return CharArrayToString(serverResult);
   if(GetLastError() == 4014)
      Print("[ERR 4014] URL belum diizinkan! Masukkan '", InpApiUrl, "' ke Tools -> Options -> Expert Advisors -> Allow WebRequest");
   return "";
}

//+------------------------------------------------------------------+
//| HTTP POST Acknowledge Signal Execution                           |
//+------------------------------------------------------------------+
void SendAck(string signalId, ulong ticket, double price, string status, long spread)
{
   string url = InpApiUrl + "/api/mt5/signals/ack";
   string payload = StringFormat("{\"token\":\"%s\",\"signalId\":\"%s\",\"ticket\":%s,\"executedPrice\":%.2f,\"status\":\"%s\",\"spreadPips\":%d}",
                                 InpApiToken, signalId, IntegerToString((long)ticket), price, status, (int)(spread / 10));
   char postData[];
   StringToCharArray(payload, postData);
   char serverResult[];
   string serverHeaders;
   string headers = "Content-Type: application/json\r\n";
   WebRequest("POST", url, headers, 3000, postData, serverResult, serverHeaders);
}

//+------------------------------------------------------------------+
//| Execute Order Send using Pure Native MQL5 API                    |
//+------------------------------------------------------------------+
ulong ExecuteNativeTrade(ENUM_ORDER_TYPE orderType, double price, double sl, double tp, double lot, string comment)
{
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   bool isPending = (orderType == ORDER_TYPE_BUY_LIMIT  || orderType == ORDER_TYPE_SELL_LIMIT ||
                     orderType == ORDER_TYPE_BUY_STOP   || orderType == ORDER_TYPE_SELL_STOP);

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   request.action       = isPending ? TRADE_ACTION_PENDING : TRADE_ACTION_DEAL;
   request.symbol       = _Symbol;
   request.volume       = lot;
   request.type         = orderType;
   request.price        = NormalizeDouble(price, digits);
   request.sl           = (sl > 0.0) ? NormalizeDouble(sl, digits) : 0.0;
   request.tp           = (tp > 0.0) ? NormalizeDouble(tp, digits) : 0.0;
   request.deviation    = InpSlippage;
   request.type_filling = GetSymbolFillingType(_Symbol);
   request.type_time    = ORDER_TIME_GTC;
   request.magic        = InpMagicNumber;
   request.comment      = comment;

   if(!OrderSend(request, result))
   {
      PrintFormat("[OrderSend FAIL] Code: %d | Retcode: %d (%s)", GetLastError(), result.retcode, result.comment);
      return 0;
   }

   if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED)
   {
      return (result.order > 0) ? result.order : result.deal;
   }

   PrintFormat("[OrderSend NON-DONE] Retcode: %d (%s)", result.retcode, result.comment);
   return 0;
}

//+------------------------------------------------------------------+
//| Count Open Positions for this Magic                              |
//+------------------------------------------------------------------+
int CountPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0)
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
            count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Close All Positions for this Magic                               |
//+------------------------------------------------------------------+
void CloseAllPositions(string reason)
{
   Print("[CLOSE ALL] " + reason);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0)
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         {
            MqlTradeRequest request;
            MqlTradeResult  result;
            ZeroMemory(request);
            ZeroMemory(result);

            request.action   = TRADE_ACTION_DEAL;
            request.symbol   = _Symbol;
            request.position = t;
            request.volume   = PositionGetDouble(POSITION_VOLUME);
            int posType      = (int)PositionGetInteger(POSITION_TYPE);
            request.type     = (posType == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
            request.price    = (request.type == ORDER_TYPE_SELL)
                               ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                               : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            request.deviation    = InpSlippage;
            request.type_filling = GetSymbolFillingType(_Symbol);
            request.magic        = InpMagicNumber;
            if(!OrderSend(request, result))
            {
               Print("[ClosePosition FAIL] ticket=" + IntegerToString((long)t));
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Calculate Dynamic Lot by Confidence                             |
//+------------------------------------------------------------------+
double LotByConf(double conf)
{
   if(conf >= 85.0) return InpMaxLot;
   if(conf >= 75.0) return InpMidLot;
   return InpMinLot;
}

//+------------------------------------------------------------------+
//| Check Break-Even & Trailing Stops                                |
//+------------------------------------------------------------------+
void CheckSmartExits()
{
   if(g_activeSignalId == "" || g_signalOpenPx == 0.0 || CountPositions() == 0) return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double profitDist = (g_activeDir == "BUY") ? (bid - g_signalOpenPx) : (g_signalOpenPx - ask);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   // 1. Adaptive Break-Even Trigger (+6.0 pips = $0.60)
   double beTrigger = InpBEMultiplier * 1.0;
   if(!g_beDone && profitDist >= beTrigger)
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         {
            double curSL = PositionGetDouble(POSITION_SL);
            double curTP = PositionGetDouble(POSITION_TP);
            bool needBE = false;
            if(g_activeDir == "BUY" && curSL < g_signalOpenPx) needBE = true;
            if(g_activeDir == "SELL" && (curSL > g_signalOpenPx || curSL == 0.0)) needBE = true;
            if(needBE)
            {
               MqlTradeRequest req;
               MqlTradeResult  res;
               ZeroMemory(req);
               ZeroMemory(res);
               req.action   = TRADE_ACTION_SLTP;
               req.symbol   = _Symbol;
               req.position = t;
               req.sl       = NormalizeDouble(g_signalOpenPx, digits);
               req.tp       = curTP;
               if(!OrderSend(req, res))
                  Print("[BE] OrderSend failed err=", GetLastError());
            }
         }
      }
      g_beDone = true;
      PrintFormat("[BE TRIGGERED] SL moved to Entry %.2f (Profit=%.2f >= %.2f)", g_signalOpenPx, profitDist, beTrigger);
   }

   // 2. Trailing Stop
   double trailStart = InpTrailingStartPips * 0.1; // +8.0 pips = $0.80
   double trailGap   = InpTrailingGapPips * 0.1;   // 5.0 pips = $0.50
   if(profitDist >= trailStart)
   {
      double candSL = (g_activeDir == "BUY") ? (bid - trailGap) : (ask + trailGap);
      candSL = NormalizeDouble(candSL, digits);

      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         {
            double curSL = PositionGetDouble(POSITION_SL);
            double curTP = PositionGetDouble(POSITION_TP);
            bool shouldUpdate = false;
            if(g_activeDir == "BUY" && candSL > (curSL + 0.02)) shouldUpdate = true;
            if(g_activeDir == "SELL" && (candSL < (curSL - 0.02) || curSL == 0.0)) shouldUpdate = true;

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
               if(!OrderSend(req, res))
                  Print("[TRAIL] OrderSend failed err=", GetLastError());
            }
         }
      }
   }

   // 3. Time Stop (Max 5 minutes)
   int elapsedMins = (int)((TimeCurrent() - g_signalOpenTime) / 60);
   if(elapsedMins >= InpMaxHoldMinutes)
   {
      CloseAllPositions("Time Stop Exceeded (" + IntegerToString(InpMaxHoldMinutes) + " mins)");
   }
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpDemoOnlyGuard)
   {
      if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
      {
         Alert("[SECURITY WARNING] EA di-lock dalam Mode DEMO ONLY!");
         return INIT_FAILED;
      }
   }

   EventSetTimer(InpTimerSeconds);
   
   Print("=================================================");
   Print("[Aurum AI] MT5 Autonomous Burst Scalper v4.20 Started!");
   Print("Connecting to: ", InpApiUrl);
   Print("Magic Number  : ", IntegerToString((long)InpMagicNumber));
   Print("Burst Layers  : ", IntegerToString(InpMultiLayerCount), " Layers @ Micro TP ", DoubleToString(InpMicroTPMin,1), "-", DoubleToString(InpMicroTPMin + 4,1), " pips");
   Print("Anti-Chasing  : Max ", DoubleToString(InpMaxChasingPips,1), " pips deviation");
   Print("Signal TTL    : ", IntegerToString(InpSignalTTLSec), " sec guard");
   Print("=================================================");

   string statusResponse = SendGetRequest(InpApiUrl + "/api/mt5/status");
   if(statusResponse != "")
   {
      Print("[Server Status] Connected OK: ", statusResponse);
   }

   g_isInitialized = true;
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[Aurum AI] MT5 Executor Deinitialized.");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!g_isInitialized) return;
   CheckSmartExits();
}

//+------------------------------------------------------------------+
//| Expert timer function (Autonomous Polling Loop)                  |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(!g_isInitialized) return;

   CheckSmartExits();

   string url = InpApiUrl + "/api/mt5/signals/latest?token=" + InpApiToken;
   string json = SendGetRequest(url);
   if(json == "") return;

   if(GetJsonString(json, "status") != "ACTIVE_SIGNAL") return;

   string signalId = GetJsonString(json, "id");
   if(signalId == "" || signalId == g_lastProcessedId) return;

   if(CountPositions() >= InpMaxPositions)
   {
      Print("[CAP] Max positions reached - skipping ", signalId);
      return;
   }

   string dir    = GetJsonString(json, "type");
   double idealP = GetJsonDouble(json, "price");
   double sl     = GetJsonDouble(json, "stopLoss");
   double conf   = GetJsonDouble(json, "confidence");
   if(conf <= 0.0) conf = 70.0;
   
   Print("JSON RECEIVED: ", json);

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double livePrice = (dir == "BUY") ? ask : bid;

   // Anti-Chasing Check
   double priceDiffPips = MathAbs(livePrice - idealP) * 10.0;
   bool isChasing = (priceDiffPips > InpMaxChasingPips);
   double pullbackLimit = GetJsonDouble(json, "pullbackLimitPrice");
   if(pullbackLimit <= 0.0)
   {
      pullbackLimit = (dir == "BUY") ? (livePrice - 1.20) : (livePrice + 1.20);
   }

   long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(currentSpread > InpMaxSpreadPoints)
   {
      PrintFormat("[SPREAD] Spread %d pts > %d pts - skipping %s",
                  currentSpread, InpMaxSpreadPoints, signalId);
      return;
   }

   double recommendedLot = GetJsonDouble(json, "recommendedLot");
   double lot = (recommendedLot > 0.0) ? recommendedLot : LotByConf(conf);
   
   int layerCount = (int)GetJsonDouble(json, "layerCount");
   if(layerCount <= 0 || layerCount > InpMultiLayerCount) layerCount = InpMultiLayerCount;

   int opened = 0;
   ulong firstTicket = 0;

   PrintFormat("[BURST SIGNAL] %s %s Conf=%.1f%% | Ideal=%.2f Live=%.2f Diff=%.1fpips | Chasing=%s",
               signalId, dir, conf, idealP, livePrice, priceDiffPips, isChasing ? "YES" : "NO");

   if(!isChasing)
   {
      for(int layer = 1; layer <= layerCount; layer++)
      {
         string prefix = "layer" + IntegerToString(layer) + "_";
         double dynamicTpPx = GetJsonDouble(json, prefix + "tpPrice");
         double dynamicSlPx = GetJsonDouble(json, prefix + "slPrice");
         double dynamicTpPips = GetJsonDouble(json, prefix + "tpPips");
         double dynamicSlPips = GetJsonDouble(json, prefix + "slPips");
         
         double tpPips  = (dynamicTpPips > 0.0) ? dynamicTpPips : (InpMicroTPMin + (layer - 1) * InpMicroTPStep);
         double slPips  = (dynamicSlPips > 0.0) ? dynamicSlPips : InpDynamicMicroSL;
         
         double tpPrice = (dynamicTpPips > 0.0) ? ((dir == "BUY") ? (livePrice + tpPips * 0.1) : (livePrice - tpPips * 0.1)) : ((dynamicTpPx > 0.0) ? dynamicTpPx : ((dir == "BUY") ? (livePrice + tpPips * 0.1) : (livePrice - tpPips * 0.1)));
         double slPrice = (dynamicSlPips > 0.0) ? ((dir == "BUY") ? (livePrice - slPips * 0.1) : (livePrice + slPips * 0.1)) : ((dynamicSlPx > 0.0) ? dynamicSlPx : ((sl > 0.0) ? sl : ((dir == "BUY") ? (livePrice - InpDynamicMicroSL * 0.1) : (livePrice + InpDynamicMicroSL * 0.1))));

         ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         string comment = "Aurum-L" + IntegerToString(layer) + " " + signalId;

         ulong t = ExecuteNativeTrade(ot, livePrice, slPrice, tpPrice, lot, comment);
         if(t > 0)
         {
            opened++;
            if(firstTicket == 0) firstTicket = t;
            PrintFormat("[BURST_MKT #%d] Ticket #%s | Px=%.2f | TP=%.2f (+%.1fp) | SL=%.2f",
                        layer, IntegerToString((long)t), livePrice, tpPrice, tpPips, slPrice);
         }
      }
   }
   else if(InpAutoPullbackLimit)
   {
      PrintFormat("[ANTI-CHASING] Price chased %.1fp -> Stacking %d Limit Orders @ %.2f",
                  priceDiffPips, layerCount, pullbackLimit);

      for(int layer = 1; layer <= layerCount; layer++)
      {
         double offset  = (layer - 1) * 0.20;
         double limitPx = (dir == "BUY") ? (pullbackLimit - offset) : (pullbackLimit + offset);
         
         string prefix = "layer" + IntegerToString(layer) + "_";
         double dynamicTpPx = GetJsonDouble(json, prefix + "tpPrice");
         double dynamicSlPx = GetJsonDouble(json, prefix + "slPrice");
         double dynamicTpPips = GetJsonDouble(json, prefix + "tpPips");
         double dynamicSlPips = GetJsonDouble(json, prefix + "slPips");
         
         double tpPips  = (dynamicTpPips > 0.0) ? dynamicTpPips : (InpMicroTPMin + (layer - 1) * InpMicroTPStep);
         double slPips  = (dynamicSlPips > 0.0) ? dynamicSlPips : InpDynamicMicroSL;
         
         double tpPrice = (dynamicTpPips > 0.0) ? ((dir == "BUY") ? (limitPx + tpPips * 0.1) : (limitPx - tpPips * 0.1)) : ((dynamicTpPx > 0.0) ? dynamicTpPx : ((dir == "BUY") ? (limitPx + tpPips * 0.1) : (limitPx - tpPips * 0.1)));
         double slPrice = (dynamicSlPips > 0.0) ? ((dir == "BUY") ? (limitPx - slPips * 0.1) : (limitPx + slPips * 0.1)) : ((dynamicSlPx > 0.0) ? dynamicSlPx : ((sl > 0.0) ? sl : ((dir == "BUY") ? (limitPx - InpDynamicMicroSL * 0.1) : (limitPx + InpDynamicMicroSL * 0.1))));

         ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
         string comment = "Aurum-Lmt" + IntegerToString(layer) + " " + signalId;

         ulong t = ExecuteNativeTrade(ot, limitPx, slPrice, tpPrice, lot, comment);
         if(t > 0)
         {
            opened++;
            if(firstTicket == 0) firstTicket = t;
            PrintFormat("[BURST_LMT #%d] Ticket #%s | LimitPx=%.2f | TP=%.2f (+%.1fp) | SL=%.2f",
                        layer, IntegerToString((long)t), limitPx, tpPrice, tpPips, slPrice);
         }
      }
   }

   if(opened > 0)
   {
      g_lastProcessedId = signalId;
      g_activeSignalId  = signalId;
      g_activeDir       = dir;
      g_signalOpenPx    = livePrice;
      g_signalOpenTime  = TimeCurrent();
      g_beDone          = false;

      SendAck(signalId, firstTicket, livePrice, "OPENED", currentSpread);
      PrintFormat("[BURST COMPLETE] %s | %d Layers Opened | Target Potential: ~50 Pips",
                  signalId, opened);
   }
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//|                                          AurumAI_Executor.mq5    |
//|                                 Copyright 2026, Aurum AI Quant   |
//|                                            https://aurum-ai.io   |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "5.00"
#property description "AurumAI Basket Engine v5.0 — Phase 1 Baseline (1 Position Init)"

//--- Inputs: API & High-Speed Polling
input string InpApiUrl             = "http://43.156.79.235:3002";      // Backend URL
input string InpApiToken           = "aurum_secret_bridge_token_2026"; // Secret Token
input int    InpTimerSeconds       = 1;                                 // Polling Interval (sec)

//=== Inputs: Basket Engine v2 ===
input double InpBasketLot          = 0.01;  // Base lot per position (fixed, no martingale)
input int    InpMaxPositions       = 3;     // Max positions per basket (Phase 1: 1 effective)
input double InpDailyLossLimitIDR  = 5000000.0; // Daily Loss Limit (IDR/Cent)

//=== Inputs: Anti-Chasing & Signal TTL Guard ===
input int    InpSignalTTLSec       = 30;    // Signal TTL (sec) - Discard stale signals
input double InpMaxChasingPips     = 15.0;  // Max price chasing deviation (pips)
input bool   InpAutoPullbackLimit  = true;  // Auto-use limit order if price chased

//=== Inputs: Risk & Basic Guards ===
input ulong  InpMagicNumber        = 778899; // Magic Number
input int    InpMaxSpreadPoints    = 400;    // Max Spread pts
input ulong  InpSlippage           = 30;     // Slippage pts
input bool   InpDemoOnlyGuard      = true;   // Demo Guard

//=== Inputs: Smart Trailing & Break-Even ===
input double InpBEMultiplier       = 0.8;    // BE Trigger at 0.8R profit
input double InpBEOffsetR          = 0.05;   // BE Buffer (0.05R offset)
input double InpTrailingStartR     = 1.2;    // Trailing Start at 1.2R profit
input double InpTrailingGapR       = 0.5;    // Trailing Gap (0.5R)
input int    InpPendingExpireMinutes  = 5;   // Max Wait Time for Limit Orders (minutes)
input int    InpPositionExpireMinutes = 0;   // 0 = Disable hard expiration, use Intelligent Time Stop

//--- State globals
string   g_lastProcessedId   = "";
string   g_activeSignalId    = "";
string   g_activeDir         = "";
int      g_lastProcessedUpdateIndex = -1;
double   g_signalOpenPx      = 0.0;
double   g_initialSL         = 0.0;
datetime g_signalOpenTime    = 0;
bool     g_beDone            = false;


struct TradeStat {
   ulong ticket;
   string signalId;
   double fillPrice;
   datetime openTime;
   double maxPrice;
   double minPrice;
   datetime maxTime;
   datetime minTime;
};
TradeStat g_tradeStats[];

struct ClosedSignal {
   string signalId;
   ulong ticket;
   double profit;
   double closePrice;
   double mfePips;
   double maePips;
   int timeToMfeSec;
   int timeToMaeSec;
};
ClosedSignal g_closeQueue[];

ulong g_reportedPositions[];  // Track position IDs already reported

void QueueCloseAck(string signalId, ulong ticket, double profit, double closePrice, double mfePips=0.0, double maePips=0.0, int mfeSec=0, int maeSec=0)
{
   // Deduplicate: skip if already queued/reported
   for(int i=0; i<ArraySize(g_reportedPositions); i++)
      if(g_reportedPositions[i] == ticket) return;
   
   int sz = ArraySize(g_reportedPositions);
   ArrayResize(g_reportedPositions, sz + 1);
   g_reportedPositions[sz] = ticket;
   
   int size = ArraySize(g_closeQueue);
   ArrayResize(g_closeQueue, size + 1);
   g_closeQueue[size].signalId = signalId;
   g_closeQueue[size].ticket = ticket;
   g_closeQueue[size].profit = profit;
   g_closeQueue[size].closePrice = closePrice;
   g_closeQueue[size].mfePips = mfePips;
   g_closeQueue[size].maePips = maePips;
   g_closeQueue[size].timeToMfeSec = mfeSec;
   g_closeQueue[size].timeToMaeSec = maeSec;
}

//+------------------------------------------------------------------+
//| History polling: detect ALL closed positions reliably             |
//+------------------------------------------------------------------+
void CheckAndReportClosedPositions()
{
   // Scan history for last 10 minutes
   datetime since = TimeCurrent() - 600;
   if(!HistorySelect(since, TimeCurrent())) return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      // Only our magic number
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      if(magic != InpMagicNumber) continue;

      // Only closing deals
      long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) continue;

      ulong posId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);

      // Skip if already reported
      bool alreadyDone = false;
      for(int j = 0; j < ArraySize(g_reportedPositions); j++)
         if(g_reportedPositions[j] == posId) { alreadyDone = true; break; }
      if(alreadyDone) continue;

      double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);

      // Get signalId from the OPENING deal's comment (closing deals have empty comments)
      string signalId = g_activeSignalId; // fallback
      
      // Find opening deal of this position to read original comment
      for(int k = 0; k < total; k++)
      {
         ulong openDeal = HistoryDealGetTicket(k);
         if(openDeal == 0) continue;
         if((ulong)HistoryDealGetInteger(openDeal, DEAL_POSITION_ID) != posId) continue;
         if(HistoryDealGetInteger(openDeal, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         
         string openComment = HistoryDealGetString(openDeal, DEAL_COMMENT);
         
         // 1. Try to match EA's format: "AurumBasket-#1 XAU-2026..."
         int prefixPos = StringFind(openComment, "Aurum");
         if(prefixPos >= 0)
         {
            int spacePos = StringFind(openComment, " ", prefixPos);
            if(spacePos > 0)
            {
               string extracted = StringSubstr(openComment, spacePos + 1);
               StringTrimLeft(extracted);
               StringTrimRight(extracted);
               
               int nextSpace = StringFind(extracted, " ");
               if(nextSpace > 0) signalId = StringSubstr(extracted, 0, nextSpace);
               else signalId = extracted;
            }
         }
         // 2. Try to match manual input like "AURUM-123456" or "XAU-20260806"
         else
         {
            int aurumPos = StringFind(openComment, "AURUM-");
            int xauPos = StringFind(openComment, "XAU-");
            
            int startPos = -1;
            if (aurumPos >= 0) startPos = aurumPos;
            else if (xauPos >= 0) startPos = xauPos;
            
            if (startPos >= 0)
            {
               string extracted = StringSubstr(openComment, startPos);
               int nextSpace = StringFind(extracted, " ");
               if(nextSpace > 0) signalId = StringSubstr(extracted, 0, nextSpace);
               else signalId = extracted;
            }
         }
         break;
      }

      if(signalId != "")
      {
         PrintFormat("[POLL CLOSE] PosID #%d | Profit: %.2f | Price: %.2f | Signal: %s",
                     posId, profit, closePrice, signalId);
         QueueCloseAck(signalId, posId, profit, closePrice);
      }
   }
}

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
   int res = WebRequest("GET", url, "", 15000, dummyData, serverResult, serverHeaders);
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
   string payload = StringFormat("{\"token\":\"%s\",\"signalId\":\"%s\",\"ticket\":%s,\"executedPrice\":%s,\"status\":\"%s\",\"spreadPips\":%d}",
                                 InpApiToken, signalId, IntegerToString((long)ticket), DoubleToString(price, 2), status, (int)(spread / 10));
   char postData[];
   StringToCharArray(payload, postData, 0, StringLen(payload));
   char serverResult[];
   string serverHeaders;
   string headers = "Content-Type: application/json\r\n";
   WebRequest("POST", url, headers, 15000, postData, serverResult, serverHeaders);
}

//+------------------------------------------------------------------+
//| HTTP POST Acknowledge Signal Close                               |
//+------------------------------------------------------------------+
bool SendCloseAck(string signalId, ulong ticket, double profit, double closePrice, double mfePips=0.0, double maePips=0.0, int mfeSec=0, int maeSec=0)
{
   string url = InpApiUrl + "/api/mt5/signals/close";
   string payload = StringFormat("{\"token\":\"%s\",\"signalId\":\"%s\",\"ticket\":%s,\"profit\":%s,\"closePrice\":%s,\"mfePips\":%.1f,\"maePips\":%.1f,\"timeToMfeSec\":%d,\"timeToMaeSec\":%d}",
                                 InpApiToken, signalId, IntegerToString((long)ticket), DoubleToString(profit, 2), DoubleToString(closePrice, 2),
                                 mfePips, maePips, mfeSec, maeSec);
   char postData[];
   StringToCharArray(payload, postData, 0, StringLen(payload));
   char serverResult[];
   string serverHeaders;
   string headers = "Content-Type: application/json\r\n";
   int res = WebRequest("POST", url, headers, 15000, postData, serverResult, serverHeaders);
   
   if(res == 200 || res == 201) return true;
   
   PrintFormat("[WEBHOOK ERR] SendCloseAck failed (Code: %d) for ticket %s. Retrying later...", res, IntegerToString((long)ticket));
   return false;
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
//| Count Pending Orders for this Magic                              |
//+------------------------------------------------------------------+
int CountPendingOrders()
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0)
      {
         if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
            (ulong)OrderGetInteger(ORDER_MAGIC) == InpMagicNumber)
            count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Close a Single Position by Ticket                                |
//+------------------------------------------------------------------+
bool ClosePositionByTicket(ulong ticket)
{
   if(PositionSelectByTicket(ticket))
   {
      MqlTradeRequest request;
      MqlTradeResult  result;
      ZeroMemory(request);
      ZeroMemory(result);

      request.action   = TRADE_ACTION_DEAL;
      request.symbol   = _Symbol;
      request.position = ticket;
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
         Print("[ClosePosition FAIL] ticket=", ticket, " err=", GetLastError());
         return false;
      }
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Cancel a Single Pending Order by Ticket                          |
//+------------------------------------------------------------------+
bool CancelOrderByTicket(ulong ticket)
{
   if(OrderSelect(ticket))
   {
      MqlTradeRequest request;
      MqlTradeResult  result;
      ZeroMemory(request);
      ZeroMemory(result);

      request.action = TRADE_ACTION_REMOVE;
      request.order  = ticket;
      
      if(!OrderSend(request, result))
      {
         Print("[CancelOrder FAIL] ticket=", ticket, " err=", GetLastError());
         return false;
      }
      return true;
   }
   return false;
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
            ClosePositionByTicket(t);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Calculate Dynamic Lot by Confidence                             |
//+------------------------------------------------------------------+
double LotByConf(double conf)
{
   // Basket Engine v2: fixed lot, no confidence-based sizing
   return InpBasketLot;
}


//+------------------------------------------------------------------+
//| Check Break-Even & Trailing Stops                                |
//+------------------------------------------------------------------+
void CheckSmartExits()
{
   int posCount = CountPositions();
   int orderCount = CountPendingOrders();
   
   if(posCount == 0 && orderCount == 0) return;

   int limitPendingSeconds = InpPendingExpireMinutes * 60;
   int limitPositionSeconds = InpPositionExpireMinutes * 60;
   
   // 1. Time Stop for Pending Orders
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && (ulong)OrderGetInteger(ORDER_MAGIC) == InpMagicNumber)
      {
         datetime orderTime = (datetime)OrderGetInteger(ORDER_TIME_SETUP);
         if((TimeCurrent() - orderTime) >= limitPendingSeconds)
         {
            PrintFormat("[TIME STOP] Canceling expired pending order #%d (Age: %d sec)", t, (TimeCurrent() - orderTime));
            CancelOrderByTicket(t);
         }
      }
   }

   // 2. Intelligent Time Stop for Active Positions
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         datetime posTime = (datetime)PositionGetInteger(POSITION_TIME);
         int ageSeconds = (int)(TimeCurrent() - posTime);
         
         if(limitPositionSeconds > 0 && ageSeconds >= limitPositionSeconds)
         {
            PrintFormat("[TIME STOP] Closing expired position #%d (Age: %d sec)", t, ageSeconds);
            ClosePositionByTicket(t);
         }
         else if(limitPositionSeconds == 0 && ageSeconds >= 1800) // Intelligent Time Stop (30m)
         {
            double currPx = PositionGetDouble(POSITION_PRICE_CURRENT);
            double openPx = PositionGetDouble(POSITION_PRICE_OPEN);
            double posProfit = (g_activeDir == "BUY") ? (currPx - openPx) : (openPx - currPx);
            
            double R = MathAbs(g_signalOpenPx - g_initialSL);
            if(R <= 0.10) R = 2.0; // fallback $2.00
            
            if(posProfit < (0.3 * R))
            {
               PrintFormat("[INTELLIGENT TIME STOP] Stagnant position #%d closed (Age: %d sec, Profit: %.2f < 0.3R)", t, ageSeconds, posProfit);
               ClosePositionByTicket(t);
            }
         }
      }
   }

   // If no positions left, we don't need BE/Trailing
   if(CountPositions() == 0) return;

   if(g_activeSignalId == "" || g_signalOpenPx == 0.0) return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double profitDist = (g_activeDir == "BUY") ? (bid - g_signalOpenPx) : (g_signalOpenPx - ask);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   double R = MathAbs(g_signalOpenPx - g_initialSL);
   if (R <= 0.10) R = 2.0; // fallback $2.00 (200 pts)

   // Adaptive Break-Even Trigger based on R
   double beTrigger = InpBEMultiplier * R;
   double beOffset = InpBEOffsetR * R;
   
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
            double candSL = g_signalOpenPx;
            if(g_activeDir == "BUY" && curSL < g_signalOpenPx) {
               needBE = true;
               candSL = g_signalOpenPx + beOffset;
            }
            if(g_activeDir == "SELL" && (curSL > g_signalOpenPx || curSL == 0.0)) {
               needBE = true;
               candSL = g_signalOpenPx - beOffset;
            }
            if(needBE)
            {
               MqlTradeRequest req;
               MqlTradeResult  res;
               ZeroMemory(req);
               ZeroMemory(res);
               req.action   = TRADE_ACTION_SLTP;
               req.symbol   = _Symbol;
               req.position = t;
               req.sl       = NormalizeDouble(candSL, digits);
               req.tp       = curTP;
               if(!OrderSend(req, res))
                  Print("[BE] OrderSend failed err=", GetLastError());
            }
         }
      }
      g_beDone = true;
      PrintFormat("[BE TRIGGERED] SL moved to BE Offset %.2f (Profit=%.2f >= %.2f)", (g_activeDir == "BUY" ? g_signalOpenPx + beOffset : g_signalOpenPx - beOffset), profitDist, beTrigger);
   }

   // Trailing Stop based on R
   double trailStart = InpTrailingStartR * R;
   double trailGap   = InpTrailingGapR * R;
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
   Print("[AurumAI] Basket Engine v5.0 Started!");
   Print("Connecting to: ", InpApiUrl);
   Print("Magic Number  : ", IntegerToString((long)InpMagicNumber));
   Print("Basket Lot    : ", DoubleToString(InpBasketLot, 2), " lot per position");
   Print("Max Positions : ", IntegerToString(InpMaxPositions), " (Phase 1: 1 position)");
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
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   // Track MFE/MAE for open positions
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         bool found = false;
         for(int j = 0; j < ArraySize(g_tradeStats); j++) {
            if(g_tradeStats[j].ticket == t) {
               found = true;
               if(bid > g_tradeStats[j].maxPrice) { g_tradeStats[j].maxPrice = bid; g_tradeStats[j].maxTime = TimeCurrent(); }
               if(ask < g_tradeStats[j].minPrice) { g_tradeStats[j].minPrice = ask; g_tradeStats[j].minTime = TimeCurrent(); }
               break;
            }
         }
         if(!found) {
            int sz = ArraySize(g_tradeStats);
            ArrayResize(g_tradeStats, sz + 1);
            g_tradeStats[sz].ticket = t;
            g_tradeStats[sz].signalId = PositionGetString(POSITION_COMMENT); // Actually we need to parse it, but for now we rely on history
            g_tradeStats[sz].fillPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            g_tradeStats[sz].openTime = (datetime)PositionGetInteger(POSITION_TIME);
            g_tradeStats[sz].maxPrice = bid;
            g_tradeStats[sz].minPrice = ask;
            g_tradeStats[sz].maxTime = TimeCurrent();
            g_tradeStats[sz].minTime = TimeCurrent();
         }
      }
   }

   if(!g_isInitialized) return;
   CheckSmartExits();
}

//+------------------------------------------------------------------+
//| Expert timer function (Autonomous Polling Loop)                  |
//+------------------------------------------------------------------+
// Calculate total realized loss today from MT5 deal history
double GetTodayRealizedLoss()
{
   double totalLoss = 0.0;
   datetime dayStart = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   if(!HistorySelect(dayStart, TimeCurrent())) return 0.0;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagicNumber) continue;
      if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      double p = HistoryDealGetDouble(deal, DEAL_PROFIT);
      if(p < 0) totalLoss += MathAbs(p);
   }
   return totalLoss;
}

void OnTimer()
{
   if(!g_isInitialized) return;

   // === DAILY LOSS CIRCUIT BREAKER ===
   if(InpDailyLossLimitIDR > 0)
   {
      double todayLoss = GetTodayRealizedLoss();
      if(todayLoss >= InpDailyLossLimitIDR)
      {
         static bool g_lossLimitPrinted = false;
         if(!g_lossLimitPrinted)
         {
            PrintFormat("[CIRCUIT BREAKER] Daily Loss %.0f >= Limit %.0f. EA locked for today.", todayLoss, InpDailyLossLimitIDR);
            g_lossLimitPrinted = true;
         }
         return;
      }
   }

   // 1. Poll MT5 history to detect ALL closed positions reliably (replaces OnTradeTransaction)
   CheckAndReportClosedPositions();

   // 2. Process queued close webhooks (with retry)
   if (ArraySize(g_closeQueue) > 0)
   {
      int newSize = 0;
      for (int i=0; i<ArraySize(g_closeQueue); i++)
      {
         bool success = SendCloseAck(g_closeQueue[i].signalId, g_closeQueue[i].ticket, g_closeQueue[i].profit, g_closeQueue[i].closePrice,
                                     g_closeQueue[i].mfePips, g_closeQueue[i].maePips, g_closeQueue[i].timeToMfeSec, g_closeQueue[i].timeToMaeSec);
         
         if(!success)
         {
            // Keep in queue for retry
            g_closeQueue[newSize] = g_closeQueue[i];
            newSize++;
         }
      }
      ArrayResize(g_closeQueue, newSize);
   }

   CheckSmartExits();

   MqlTick tick;
   SymbolInfoTick(_Symbol, tick);
   string url = InpApiUrl + "/api/mt5/signals/latest?token=" + InpApiToken
              + "&symbol=" + _Symbol
              + "&bid=" + DoubleToString(tick.bid, _Digits)
              + "&ask=" + DoubleToString(tick.ask, _Digits)
              + "&time=" + IntegerToString(tick.time_msc);
   string json = SendGetRequest(url);
   if(json == "") return;

   if(GetJsonString(json, "status") != "ACTIVE_SIGNAL") return;

   string signalId = GetJsonString(json, "id");
   if(signalId == "") return;

   string action = GetJsonString(json, "action");
   if(action == "") action = "INIT";
   int updateIndex = (int)GetJsonDouble(json, "updateIndex");

   if(action == "INIT")
   {
      if(signalId == g_lastProcessedId) return;

      if(CountPositions() >= InpMaxPositions)
      {
         Print("[CAP] Max positions reached - skipping ", signalId);
         return;
      }

      g_lastProcessedUpdateIndex = updateIndex;
      ExecuteBasketInit(json, signalId);
   }
   else if(action == "BASKET_ADD")
   {
      if(signalId != g_activeSignalId) return; // Ignore ADD for unknown basket
      if(updateIndex <= g_lastProcessedUpdateIndex) return; // Duplicates / Already processed

      g_lastProcessedUpdateIndex = updateIndex;
      ExecuteBasketAdd(json, signalId);
   }
}

//+------------------------------------------------------------------+
//| ExecuteBasketInit — Phase 1 Basket Engine                        |
//| Opens EXACTLY 1 position. No burst. No multiple layers.          |
//| Basket TP = basketTarget from backend (structural S/R)           |
//| Basket SL = basketInvalidation from backend (structural level)   |
//+------------------------------------------------------------------+
void ExecuteBasketInit(string json, string signalId)
{
   // Guard: no new basket if one is already active
   if(CountPositions() >= 1)
   {
      Print("[BASKET] Position already open - skipping new basket ", signalId);
      return;
   }

   string dir        = GetJsonString(json, "type");
   double idealP     = GetJsonDouble(json, "price");
   double sl         = GetJsonDouble(json, "stopLoss");
   double basketTP   = GetJsonDouble(json, "basketTarget");      // Structural target from backend
   double basketInv  = GetJsonDouble(json, "basketInvalidation"); // Structural invalidation level

   // Fallback if basketTarget not present (old signal format)
   if(basketTP <= 0.0) basketTP = GetJsonDouble(json, "takeProfit2");
   if(basketInv <= 0.0) basketInv = sl;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double livePrice = (dir == "BUY") ? ask : bid;

   // Anti-Chasing Check
   double priceDiffPips = MathAbs(livePrice - idealP) * 10.0;
   bool isChasing = (priceDiffPips > InpMaxChasingPips);

   long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(currentSpread > InpMaxSpreadPoints)
   {
      PrintFormat("[BASKET] Spread %d pts > %d pts - skipping %s", currentSpread, InpMaxSpreadPoints, signalId);
      return;
   }

   // --- LIVE PRICE SAFETY GUARD ---
   // Prevent instant SL/TP hit if backend absolute price is stale
   double minStopDist = 1.50; // $1.50 or 15 pips
   double minTpDist = 2.00;   // $2.00 or 20 pips
   if (dir == "BUY") 
   {
      if (basketInv >= livePrice - minStopDist) basketInv = livePrice - minStopDist;
      if (basketTP <= livePrice + minTpDist) basketTP = livePrice + minTpDist;
   } 
   else 
   {
      if (basketInv <= livePrice + minStopDist) basketInv = livePrice + minStopDist;
      if (basketTP >= livePrice - minTpDist) basketTP = livePrice - minTpDist;
   }
   // -------------------------------

   PrintFormat("[BASKET_INIT] %s %s | Ideal=%.2f Live=%.2f Diff=%.1fpips | TP=%.2f SL=%.2f | Chasing=%s",
               signalId, dir, idealP, livePrice, priceDiffPips, basketTP, basketInv, isChasing ? "YES" : "NO");

   ulong ticket = 0;

   if(!isChasing)
   {
      // Market order — 1 position only
      ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      string comment = "AurumBasket-#1 " + signalId;
      ticket = ExecuteNativeTrade(ot, livePrice, basketInv, basketTP, InpBasketLot, comment);
      if(ticket > 0)
         PrintFormat("[BASKET_INIT] Opened #1 | Ticket=%s | Px=%.2f | TP=%.2f | SL=%.2f",
                     IntegerToString((long)ticket), livePrice, basketTP, basketInv);
   }
   else if(InpAutoPullbackLimit)
   {
      // Limit order at pullback zone if chasing
      double limitPx = (dir == "BUY") ? (livePrice - 1.20) : (livePrice + 1.20);
      ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
      string comment = "AurumBasket-Lmt#1 " + signalId;
      ticket = ExecuteNativeTrade(ot, limitPx, basketInv, basketTP, InpBasketLot, comment);
      if(ticket > 0)
         PrintFormat("[BASKET_INIT] Limit placed #1 | Ticket=%s | LimitPx=%.2f | TP=%.2f | SL=%.2f",
                     IntegerToString((long)ticket), limitPx, basketTP, basketInv);
   }

   if(ticket > 0)
   {
      g_lastProcessedId = signalId;
      g_activeSignalId  = signalId;
      g_activeDir       = dir;
      g_signalOpenPx    = livePrice;
      g_initialSL       = basketInv;
      g_signalOpenTime  = TimeCurrent();
      g_beDone          = false;

      SendAck(signalId, ticket, livePrice, "BASKET_INIT", currentSpread);
      PrintFormat("[BASKET_INIT COMPLETE] %s | 1 Position Opened | BasketTP=%.2f | BasketSL=%.2f",
                  signalId, basketTP, basketInv);
   }
   else
   {
      PrintFormat("[BASKET_INIT FAILED] %s — ExecuteNativeTrade returned 0", signalId);
   }
}

//+------------------------------------------------------------------+
//| ExecuteBasketAdd — Phase 2 Basket Engine                         |
//| Opens ADD position and updates ALL TP/SL of the basket           |
//+------------------------------------------------------------------+
void ExecuteBasketAdd(string json, string signalId)
{
   int currentLayers = CountPositions();
   if(currentLayers >= 3)
   {
      Print("[BASKET_ADD_REJECTED] Max basket layers (3) reached.");
      return;
   }

   string dir        = GetJsonString(json, "type");
   double idealP     = GetJsonDouble(json, "price");
   double basketTP   = GetJsonDouble(json, "basketTarget");
   double basketInv  = GetJsonDouble(json, "basketInvalidation");

   if (dir != g_activeDir) 
   {
      Print("[BASKET_ADD_REJECTED] Direction mismatch.");
      return;
   }

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double livePrice = (dir == "BUY") ? ask : bid;

   // --- LIVE PRICE SAFETY GUARD ---
   double minStopDist = 1.50; 
   double minTpDist = 2.00;   
   if (dir == "BUY") 
   {
      if (basketInv >= livePrice - minStopDist) basketInv = livePrice - minStopDist;
      if (basketTP <= livePrice + minTpDist) basketTP = livePrice + minTpDist;
   } 
   else 
   {
      if (basketInv <= livePrice + minStopDist) basketInv = livePrice + minStopDist;
      if (basketTP >= livePrice - minTpDist) basketTP = livePrice - minTpDist;
   }
   // -------------------------------

   ENUM_ORDER_TYPE ot = (dir == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   string comment = "AurumBasket-ADD " + signalId;
   ulong ticket = ExecuteNativeTrade(ot, livePrice, basketInv, basketTP, InpBasketLot, comment);
   
   if(ticket > 0)
   {
      PrintFormat("[BASKET_ADD SUCCESS] %s | Ticket=%s | Px=%.2f | NewTP=%.2f | NewSL=%.2f",
                  signalId, IntegerToString((long)ticket), livePrice, basketTP, basketInv);
      
      UpdateBasketTPSL(basketTP, basketInv);
   }
   else
   {
      PrintFormat("[BASKET_ADD FAILED] %s — ExecuteNativeTrade returned 0", signalId);
   }
}

//+------------------------------------------------------------------+
//| UpdateBasketTPSL — Modify TP/SL for all open positions in basket |
//+------------------------------------------------------------------+
void UpdateBasketTPSL(double newTP, double newSL)
{
   MqlTradeRequest request;
   MqlTradeResult  result;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong posTicket = PositionGetTicket(i);
      if(posTicket > 0)
      {
         string sym = PositionGetString(POSITION_SYMBOL);
         long magic = PositionGetInteger(POSITION_MAGIC);

         if(sym == _Symbol && magic == InpMagicNumber)
         {
            double currentTP = PositionGetDouble(POSITION_TP);
            double currentSL = PositionGetDouble(POSITION_SL);
            
            // Normalize floats
            newTP = NormalizeDouble(newTP, _Digits);
            newSL = NormalizeDouble(newSL, _Digits);
            currentTP = NormalizeDouble(currentTP, _Digits);
            currentSL = NormalizeDouble(currentSL, _Digits);

            if(currentTP != newTP || currentSL != newSL)
            {
               ZeroMemory(request);
               ZeroMemory(result);
               
               request.action = TRADE_ACTION_SLTP;
               request.position = posTicket;
               request.symbol = _Symbol;
               request.sl = newSL;
               request.tp = newTP;
               
               if(!OrderSend(request, result))
               {
                  PrintFormat("[UpdateBasketTPSL] Failed to modify ticket %s. Err: %d", IntegerToString((long)posTicket), result.retcode);
               }
               else
               {
                  PrintFormat("[UpdateBasketTPSL] Modified ticket %s to TP=%.2f SL=%.2f", IntegerToString((long)posTicket), newTP, newSL);
               }
            }
         }
      }
   }
}

//+------------------------------------------------------------------+// OnTradeTransaction removed - replaced by CheckAndReportClosedPositions() polling
// in OnTimer which is more reliable for basket close scenarios
//+------------------------------------------------------------------+

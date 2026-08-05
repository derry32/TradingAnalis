//+------------------------------------------------------------------+
//|                                           AurumAI_Executor.mq5   |
//|                                  Copyright 2026, Aurum AI Quant  |
//|                                             https://aurum-ai.io  |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "3.00"
#property description "Aurum AI Autonomous Multi-Layer Scalper Engine for MetaTrader 5"
#property description "Executes 3 Market + 2 Limit layers with Dynamic Lot Sizing, Basket TP, and Half-Secured BEP Scaling."

//--- Input Parameters
input group "=== [ API Connection Settings ] ==="
input string   InpApiUrl             = "http://43.156.79.235:3002";     // Server Backend Base URL
input string   InpApiToken           = "aurum_secret_bridge_token_2026"; // Secret Bridge Token
input int      InpTimerSeconds       = 1;                               // Polling Interval (Seconds)

input group "=== [ Multi-Layer Scalper Configuration ] ==="
input int      InpNumMarketLayers    = 3;                               // Number of Market Orders per Signal (Default: 3)
input int      InpNumLimitLayers     = 2;                               // Number of Limit Orders per Signal (Default: 2)
input double   InpMinLot             = 0.03;                            // Lot Size for Confidence < 70% (Defense)
input double   InpMidLot             = 0.05;                            // Lot Size for Confidence 70% - 79% (Standard)
input double   InpMaxLot             = 0.09;                            // Lot Size for Confidence >= 80% (High Conviction)
input int      InpLayerStepPoints    = 35;                              // Step between Limit Layers (Points, 35 = 3.5 pips)
input int      InpMaxOpenPositions   = 15;                              // Max Simultaneous Open Positions (Account Safety Cap)

input group "=== [ Risk, Exit & Execution Guard ] ==="
input ulong    InpMagicNumber        = 778899;                          // Magic Number (Order ID Isolation)
input int      InpMaxSpreadPoints    = 400;                             // Max Spread (Points, 400 = 40 pips on Gold)
input ulong    InpSlippage           = 30;                              // Max Slippage (Points)
input bool     InpDemoOnlyGuard      = true;                            // Demo Account Only Guard (Safety)
input bool     InpEnableBasketTP     = true;                            // Enable Basket Close (<70% Confidence)
input bool     InpEnableHalfSecured  = true;                            // Enable Half-Secured & BEP Trailing (>=75% Confidence)

//--- Global Tracking Variables
string         g_lastProcessedId     = "";
bool           g_isInitialized       = false;
string         g_activeSignalId      = "";
double         g_activeConfidence    = 0.0;
string         g_activeMode          = "";
double         g_activeTP1           = 0.0;
double         g_activeTP2           = 0.0;
bool           g_isHalfSecuredDone   = false;

//+------------------------------------------------------------------+
//| Auto-detect broker filling type (FOK, IOC, RETURN)              |
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetSymbolFillingType(string symbol)
{
   uint filling = (uint)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((filling & SYMBOL_FILLING_IOC) != 0)
      return ORDER_FILLING_IOC;
   if((filling & SYMBOL_FILLING_FOK) != 0)
      return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
//| Simple JSON parser helper for strings                            |
//+------------------------------------------------------------------+
string GetJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos == -1)
   {
      search = "\"" + key + "\":";
      pos = StringFind(json, search);
      if(pos == -1) return "";
      pos += StringLen(search);
      int endPos = StringFind(json, ",", pos);
      if(endPos == -1) endPos = StringFind(json, "}", pos);
      if(endPos == -1) return "";
      string val = StringSubstr(json, pos, endPos - pos);
      StringTrimLeft(val);
      StringTrimRight(val);
      StringReplace(val, "\"", "");
      return val;
   }
   pos += StringLen(search);
   int endPos = StringFind(json, "\"", pos);
   if(endPos == -1) return "";
   return StringSubstr(json, pos, endPos - pos);
}

//+------------------------------------------------------------------+
//| Simple JSON parser helper for numbers                            |
//+------------------------------------------------------------------+
double GetJsonDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos == -1) return 0.0;
   pos += StringLen(search);
   int endPos = StringFind(json, ",", pos);
   if(endPos == -1) endPos = StringFind(json, "}", pos);
   if(endPos == -1) return 0.0;
   string val = StringSubstr(json, pos, endPos - pos);
   StringTrimLeft(val);
   StringTrimRight(val);
   StringReplace(val, "\"", "");
   return StringToDouble(val);
}

//+------------------------------------------------------------------+
//| Send HTTP GET Request to Aurum AI Backend                        |
//+------------------------------------------------------------------+
string SendGetRequest(string url)
{
   char serverResult[];
   string serverHeaders;
   string emptyData = "";
   char postData[];
   StringToCharArray(emptyData, postData);
   
   int res = WebRequest("GET", url, "", 3000, postData, serverResult, serverHeaders);
   if(res == 200)
   {
      return CharArrayToString(serverResult);
   }
   else if(res == -1)
   {
      int err = GetLastError();
      if(err == 4014)
      {
         Print("❌ [Aurum AI Error] WebRequest URL belum diizinkan! Masukkan '", InpApiUrl, "' ke Tools -> Options -> Expert Advisors -> Allow WebRequest");
      }
      else
      {
         Print("⚠️ [Aurum AI WebRequest Error] Code: ", err);
      }
   }
   return "";
}

//+------------------------------------------------------------------+
//| Send HTTP POST Acknowledgment to Backend                         |
//+------------------------------------------------------------------+
void SendAck(string signalId, ulong ticket, double price, string status, long spread)
{
   string url = InpApiUrl + "/api/mt5/signals/ack";
   string payload = StringFormat("{\"token\":\"%s\",\"signalId\":\"%s\",\"ticket\":%I64u,\"executedPrice\":%.2f,\"status\":\"%s\",\"spreadPips\":%d}",
                                 InpApiToken, signalId, ticket, price, status, (int)(spread / 10));
   
   char postData[];
   StringToCharArray(payload, postData, 0, StringLen(payload));
   char serverResult[];
   string serverHeaders;
   string headers = "Content-Type: application/json\r\n";
   
   int res = WebRequest("POST", url, headers, 3000, postData, serverResult, serverHeaders);
   if(res == 200)
   {
      Print("✅ [Aurum AI ACK Sent] Signal ", signalId, " confirmed with Ticket #", ticket);
   }
}

//+------------------------------------------------------------------+
//| Determine Dynamic Lot Size by Confidence Score                  |
//+------------------------------------------------------------------+
double GetLotSizeByConfidence(double confidence)
{
   if(confidence >= 80.0) return InpMaxLot; // 0.09 lot
   if(confidence >= 70.0) return InpMidLot; // 0.05 lot
   return InpMinLot;                        // 0.03 lot
}

//+------------------------------------------------------------------+
//| Count Current Open Positions by Magic Number                     |
//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Execute Order Send using Pure Native MQL5 API                    |
//+------------------------------------------------------------------+
bool ExecuteNativeTradeWithLot(ENUM_ORDER_TYPE orderType, double lot, double price, double sl, double tp, string comment, ulong &outTicket)
{
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action       = (orderType == ORDER_TYPE_BUY || orderType == ORDER_TYPE_SELL) ? TRADE_ACTION_DEAL : TRADE_ACTION_PENDING;
   request.symbol       = _Symbol;
   request.volume       = lot;
   request.type         = orderType;
   request.price        = price;
   request.sl           = sl;
   request.tp           = tp;
   request.deviation    = InpSlippage;
   request.type_filling = GetSymbolFillingType(_Symbol);
   request.type_time    = ORDER_TIME_GTC;
   request.magic        = InpMagicNumber;
   request.comment      = comment;

   if(!OrderSend(request, result))
   {
      PrintFormat("❌ [OrderSend Failed] Code: %d | Retcode: %d (%s)", GetLastError(), result.retcode, result.comment);
      return false;
   }

   if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED)
   {
      outTicket = (result.order > 0) ? result.order : result.deal;
      return true;
   }

   PrintFormat("⚠️ [OrderSend Non-Done Retcode] Retcode: %d (%s)", result.retcode, result.comment);
   return false;
}

//+------------------------------------------------------------------+
//| Close a Single Open Position                                     |
//+------------------------------------------------------------------+
bool CloseNativePosition(ulong positionTicket)
{
   if(!PositionSelectByTicket(positionTicket)) return false;

   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   double volume              = PositionGetDouble(POSITION_VOLUME);
   double closePrice          = (posType == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   ENUM_ORDER_TYPE orderType  = (posType == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;

   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action       = TRADE_ACTION_DEAL;
   request.position     = positionTicket;
   request.symbol       = _Symbol;
   request.volume       = volume;
   request.type         = orderType;
   request.price        = closePrice;
   request.deviation    = InpSlippage;
   request.type_filling = GetSymbolFillingType(_Symbol);
   request.magic        = InpMagicNumber;
   request.comment      = "Aurum AI Scalp Close";

   if(!OrderSend(request, result)) return false;
   return (result.retcode == TRADE_RETCODE_DONE);
}

//+------------------------------------------------------------------+
//| Move Stop Loss of a Position to Breakeven (BEP)                  |
//+------------------------------------------------------------------+
bool MovePositionSLToBEP(ulong positionTicket, double bepPrice)
{
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action   = TRADE_ACTION_SLTP;
   request.position = positionTicket;
   request.symbol   = _Symbol;
   request.sl       = bepPrice;
   request.tp       = PositionGetDouble(POSITION_TP);
   request.magic    = InpMagicNumber;

   if(!OrderSend(request, result))
   {
      PrintFormat("❌ [Modify SL Failed] Ticket #%I64u | Error: %d", positionTicket, GetLastError());
      return false;
   }
   return (result.retcode == TRADE_RETCODE_DONE);
}

//+------------------------------------------------------------------+
//| Close All Open Positions for Basket TP                           |
//+------------------------------------------------------------------+
void CloseAllPositions(string reason)
{
   PrintFormat("🚀 [BASKET TP HIT] %s -> Menutup semua posisi terbuka...", reason);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         CloseNativePosition(ticket);
      }
   }
   
   // Cancel all remaining pending limit orders
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong orderTicket = OrderGetTicket(i);
      if(orderTicket > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == InpMagicNumber)
      {
         MqlTradeRequest request;
         MqlTradeResult  result;
         ZeroMemory(request);
         ZeroMemory(result);
         request.action = TRADE_ACTION_REMOVE;
         request.order  = orderTicket;
         OrderSend(request, result);
      }
   }
}

//+------------------------------------------------------------------+
//| Autonomous Position Manager (Basket TP & Half-Secured Runner)    |
//+------------------------------------------------------------------+
void ManageActivePositions()
{
   int openCount = CountOpenPositions();
   if(openCount == 0)
   {
      g_isHalfSecuredDone = false;
      return;
   }

   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double currentAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   // 1. Mode Basket Close (< 70% Confidence)
   if(InpEnableBasketTP && g_activeMode == "BASKET_SCALPER" && g_activeTP1 > 0.0)
   {
      // Check if price reached TP1
      bool reachedTP1 = false;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         {
            ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
            if(posType == POSITION_TYPE_BUY && currentBid >= g_activeTP1) reachedTP1 = true;
            if(posType == POSITION_TYPE_SELL && currentAsk <= g_activeTP1) reachedTP1 = true;
         }
      }

      if(reachedTP1)
      {
         CloseAllPositions(StringFormat("Sinyal %s Basket TP1 (%.2f) Tercapai", g_activeSignalId, g_activeTP1));
         g_activeSignalId = "";
         return;
      }
   }

   // 2. Mode Half-Secured (>= 75% Confidence)
   if(InpEnableHalfSecured && g_activeMode == "HALF_SECURED" && !g_isHalfSecuredDone && g_activeTP1 > 0.0)
   {
      bool reachedTP1 = false;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         {
            ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
            if(posType == POSITION_TYPE_BUY && currentBid >= g_activeTP1) reachedTP1 = true;
            if(posType == POSITION_TYPE_SELL && currentAsk <= g_activeTP1) reachedTP1 = true;
         }
      }

      if(reachedTP1)
      {
         PrintFormat("🛡️ [HALF-SECURED TRIGGERED] Sinyal %s menyentuh TP1 (%.2f)! Menutup 50%% posisi & menggeser SL ke BEP...",
                     g_activeSignalId, g_activeTP1);

         int closedSoFar = 0;
         int halfToClose = (openCount >= 4) ? 3 : (openCount / 2);

         for(int i = PositionsTotal() - 1; i >= 0; i--)
         {
            ulong ticket = PositionGetTicket(i);
            if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
            {
               if(closedSoFar < halfToClose)
               {
                  CloseNativePosition(ticket);
                  closedSoFar++;
               }
               else
               {
                  // Move SL of remaining positions to Breakeven (Entry Price)
                  double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
                  MovePositionSLToBEP(ticket, openPrice);
               }
            }
         }

         g_isHalfSecuredDone = true;
      }
   }
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // 1. Demo Guard Verification
   if(InpDemoOnlyGuard)
   {
      long accountMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
      if(accountMode != ACCOUNT_TRADE_MODE_DEMO)
      {
         Alert("🚨 [SECURITY WARNING] EA di-lock dalam Mode DEMO ONLY! Akun ini terdeteksi sebagai REAL. EA otomatis dimatikan demi keamanan.");
         return INIT_FAILED;
      }
   }

   // 2. Start Polling Timer
   EventSetTimer(InpTimerSeconds);
   
   Print("=================================================");
   Print("🚀 [Aurum AI] Multi-Layer Scalper Engine v3.0");
   Print("🔗 Connecting to: ", InpApiUrl);
   Print("🛡️ Magic Number : ", InpMagicNumber);
   Print("🪜 Grid Layers  : ", InpNumMarketLayers, " Market + ", InpNumLimitLayers, " Limit (Total 5)");
   Print("💰 Dynamic Lots : Min ", InpMinLot, " | Mid ", InpMidLot, " | Max ", InpMaxLot);
   Print("⏱️ Polling Speed : Every ", InpTimerSeconds, " second(s)");
   Print("=================================================");

   // Initial status check
   string statusResponse = SendGetRequest(InpApiUrl + "/api/mt5/status");
   if(statusResponse != "")
   {
      Print("🟢 [Aurum AI Server Status] Connected OK: ", statusResponse);
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
   Print("🛑 [Aurum AI] MT5 Executor Deinitialized.");
}

//+------------------------------------------------------------------+
//| Expert timer function (Autonomous Loop)                         |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(!g_isInitialized) return;
   
   // 1. Manage existing positions (Basket TP & Half-Secured BEP)
   ManageActivePositions();

   // 2. Poll backend for new signals
   string url = InpApiUrl + "/api/mt5/signals/latest?token=" + InpApiToken;
   string json = SendGetRequest(url);
   
   if(json == "") return;

   string status = GetJsonString(json, "status");
   if(status != "ACTIVE_SIGNAL")
   {
      return; // No actionable signal
   }

   // Extract Signal Parameters
   string signalId = GetJsonString(json, "id");
   if(signalId == "" || signalId == g_lastProcessedId)
   {
      return; // Already executed
   }

   // Check Max Position Safety Cap
   if(CountOpenPositions() >= InpMaxOpenPositions)
   {
      PrintFormat("⚠️ [Safety Cap Reached] Total posisi aktif (%d) sudah mencapai batas maksimal (%d). Sinyal %s di-skip.",
                  CountOpenPositions(), InpMaxOpenPositions, signalId);
      return;
   }

   string type          = GetJsonString(json, "type");
   double entryPrice    = GetJsonDouble(json, "price");
   double stopLoss      = GetJsonDouble(json, "stopLoss");
   double takeProfit1   = GetJsonDouble(json, "takeProfit1");
   double takeProfit2   = GetJsonDouble(json, "takeProfit2");
   double confidence    = GetJsonDouble(json, "confidence");
   string execMode      = GetJsonString(json, "executionMode");

   if(confidence <= 0) confidence = 70.0;
   if(execMode == "") execMode = (confidence >= 75.0) ? "HALF_SECURED" : "BASKET_SCALPER";

   double targetTP = (execMode == "HALF_SECURED") ? takeProfit2 : takeProfit1;
   double lotSize  = GetLotSizeByConfidence(confidence);

   // Check Spread Filter
   long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(currentSpread > InpMaxSpreadPoints)
   {
      PrintFormat("⚠️ [Spread Filter] Spread saat ini %d pts melebihi batas toleransi %d pts. Entry sinyal %s ditunda.",
                  currentSpread, InpMaxSpreadPoints, signalId);
      return;
   }

   double currentAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double pointValue = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   double stepPrice = InpLayerStepPoints * pointValue;
   if(stepPrice <= 0) stepPrice = 0.35; // Default 3.5 pips on Gold

   ulong firstTicket = 0;
   int executedOrders = 0;

   // 1. Eksekusi 3x Market Orders (Instant Momentum Layer)
   for(int m = 1; m <= InpNumMarketLayers; m++)
   {
      ulong ticket = 0;
      bool ok = false;
      if(type == "BUY")
      {
         ok = ExecuteNativeTradeWithLot(ORDER_TYPE_BUY, lotSize, currentAsk, stopLoss, targetTP, 
                                        StringFormat("Aurum AI Mkt#%d %s", m, signalId), ticket);
      }
      else if(type == "SELL")
      {
         ok = ExecuteNativeTradeWithLot(ORDER_TYPE_SELL, lotSize, currentBid, stopLoss, targetTP, 
                                        StringFormat("Aurum AI Mkt#%d %s", m, signalId), ticket);
      }

      if(ok)
      {
         executedOrders++;
         if(firstTicket == 0) firstTicket = ticket;
         PrintFormat("🎯 [MARKET LAYER #%d EXECUTED] Ticket #%I64u | Sinyal %s | Lot: %.2f | TP: %.2f",
                     m, ticket, signalId, lotSize, targetTP);
      }
   }

   // 2. Eksekusi 2x Limit Pullback Orders (Discount Zone Layer)
   for(int l = 1; l <= InpNumLimitLayers; l++)
   {
      ulong ticket = 0;
      bool ok = false;
      if(type == "BUY")
      {
         double limitPrice = currentAsk - (stepPrice * l);
         ok = ExecuteNativeTradeWithLot(ORDER_TYPE_BUY_LIMIT, lotSize, limitPrice, stopLoss, targetTP, 
                                        StringFormat("Aurum AI Lmt#%d %s", l, signalId), ticket);
         if(ok)
         {
            executedOrders++;
            PrintFormat("⏳ [BUY LIMIT LAYER #%d PLACED] Ticket #%I64u | Limit Price: %.2f | Lot: %.2f",
                        l, ticket, limitPrice, lotSize);
         }
      }
      else if(type == "SELL")
      {
         double limitPrice = currentBid + (stepPrice * l);
         ok = ExecuteNativeTradeWithLot(ORDER_TYPE_SELL_LIMIT, lotSize, limitPrice, stopLoss, targetTP, 
                                        StringFormat("Aurum AI Lmt#%d %s", l, signalId), ticket);
         if(ok)
         {
            executedOrders++;
            PrintFormat("⏳ [SELL LIMIT LAYER #%d PLACED] Ticket #%I64u | Limit Price: %.2f | Lot: %.2f",
                        l, ticket, limitPrice, lotSize);
         }
      }
   }

   if(executedOrders > 0)
   {
      g_lastProcessedId   = signalId;
      g_activeSignalId    = signalId;
      g_activeConfidence  = confidence;
      g_activeMode        = execMode;
      g_activeTP1         = takeProfit1;
      g_activeTP2         = takeProfit2;
      g_isHalfSecuredDone = false;

      SendAck(signalId, firstTicket, (type == "BUY" ? currentAsk : currentBid), "OPENED", currentSpread);
      PrintFormat("🔥 [MULTI-LAYER SCALPER ENGAGED] Sinyal %s | Mode: %s | Total %d Layer Dibuka | Lot/Layer: %.2f",
                  signalId, execMode, executedOrders, lotSize);
   }
}
//+------------------------------------------------------------------+

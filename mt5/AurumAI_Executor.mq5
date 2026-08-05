//+------------------------------------------------------------------+
//|                                           AurumAI_Executor.mq5   |
//|                                  Copyright 2026, Aurum AI Quant  |
//|                                             https://aurum-ai.io  |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "2.20"
#property description "Aurum AI Autonomous Execution Engine for MetaTrader 5"
#property description "Automatically connects with Aurum AI VPS backend to execute XAU/USD signals."

//--- Input Parameters
input group "=== [ API Connection Settings ] ==="
input string   InpApiUrl          = "http://43.156.79.235:3002";     // Server Backend Base URL
input string   InpApiToken        = "aurum_secret_bridge_token_2026"; // Secret Bridge Token
input int      InpTimerSeconds    = 1;                               // Polling Interval (Seconds)

input group "=== [ Risk & Execution Guard ] ==="
input ulong    InpMagicNumber     = 778899;                          // Magic Number (Order ID Isolation)
input double   InpFixedLot        = 0.01;                            // Lot Size (Default: 0.01 Demo Safe)
input int      InpMaxSpreadPoints = 400;                             // Max Spread (Points, 400 = 40 pips on Gold)
input ulong    InpSlippage        = 30;                              // Max Slippage (Points)
input bool     InpDemoOnlyGuard   = true;                            // Demo Account Only Guard (Safety)
input bool     InpUseTP1Only      = true;                            // Default TP Target (true: TP1, false: TP2)
input bool     InpForceMarketExec = false;                           // Force Market Order (If true, ignores Limit)

//--- Global Variables
string         g_lastProcessedId  = "";
bool           g_isInitialized    = false;

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
   StringToCharArray(payload, postData);
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
//| Execute Order Send using Pure Native MQL5 API (Zero Dependencies)|
//+------------------------------------------------------------------+
bool ExecuteNativeTrade(ENUM_ORDER_TYPE orderType, double price, double sl, double tp, string comment, ulong &outTicket)
{
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action       = (orderType == ORDER_TYPE_BUY || orderType == ORDER_TYPE_SELL) ? TRADE_ACTION_DEAL : TRADE_ACTION_PENDING;
   request.symbol       = _Symbol;
   request.volume       = InpFixedLot;
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
   Print("🚀 [Aurum AI] MT5 Autonomous Executor v2.2 (Native Pure MQL5)");
   Print("🔗 Connecting to: ", InpApiUrl);
   Print("🛡️ Magic Number : ", InpMagicNumber);
   Print("💰 Fixed Lot     : ", InpFixedLot);
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
   
   // Poll backend for signals
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

   string type          = GetJsonString(json, "type");
   string executionType = GetJsonString(json, "executionType");
   double entryPrice    = GetJsonDouble(json, "price");
   double stopLoss      = GetJsonDouble(json, "stopLoss");
   double takeProfit1   = GetJsonDouble(json, "takeProfit1");
   double takeProfit2   = GetJsonDouble(json, "takeProfit2");

   double targetTP = InpUseTP1Only ? takeProfit1 : takeProfit2;

   // Check Spread Filter
   long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(currentSpread > InpMaxSpreadPoints)
   {
      PrintFormat("⚠️ [Spread Filter] Spread saat ini %d pts melebihi batas toleransi %d pts. Entry sinyal %s ditunda.",
                  currentSpread, InpMaxSpreadPoints, signalId);
      return;
   }

   // Execute Trade
   bool success = false;
   ulong orderTicket = 0;

   double currentAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // Instant Market Execution or Limit Execution
   if(executionType == "MARKET" || InpForceMarketExec)
   {
      if(type == "BUY")
      {
         success = ExecuteNativeTrade(ORDER_TYPE_BUY, currentAsk, stopLoss, targetTP, "Aurum AI " + signalId, orderTicket);
         if(success)
         {
            PrintFormat("🎯 [BUY INSTANT EXECUTED] Ticket #%I64u | Sinyal %s | Ask: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, currentAsk, stopLoss, targetTP);
         }
      }
      else if(type == "SELL")
      {
         success = ExecuteNativeTrade(ORDER_TYPE_SELL, currentBid, stopLoss, targetTP, "Aurum AI " + signalId, orderTicket);
         if(success)
         {
            PrintFormat("🎯 [SELL INSTANT EXECUTED] Ticket #%I64u | Sinyal %s | Bid: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, currentBid, stopLoss, targetTP);
         }
      }
   }
   else if(executionType == "LIMIT")
   {
      if(type == "BUY")
      {
         if(entryPrice >= currentAsk)
         {
            success = ExecuteNativeTrade(ORDER_TYPE_BUY, currentAsk, stopLoss, targetTP, "Aurum AI " + signalId, orderTicket);
         }
         else
         {
            success = ExecuteNativeTrade(ORDER_TYPE_BUY_LIMIT, entryPrice, stopLoss, targetTP, "Aurum AI Limit " + signalId, orderTicket);
         }

         if(success)
         {
            PrintFormat("⏳ [BUY LIMIT / MARKET PLACED] Ticket #%I64u | Sinyal %s | Entry: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, entryPrice, stopLoss, targetTP);
         }
      }
      else if(type == "SELL")
      {
         if(entryPrice <= currentBid)
         {
            success = ExecuteNativeTrade(ORDER_TYPE_SELL, currentBid, stopLoss, targetTP, "Aurum AI " + signalId, orderTicket);
         }
         else
         {
            success = ExecuteNativeTrade(ORDER_TYPE_SELL_LIMIT, entryPrice, stopLoss, targetTP, "Aurum AI Limit " + signalId, orderTicket);
         }

         if(success)
         {
            PrintFormat("⏳ [SELL LIMIT / MARKET PLACED] Ticket #%I64u | Sinyal %s | Entry: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, entryPrice, stopLoss, targetTP);
         }
      }
   }

   if(success)
   {
      g_lastProcessedId = signalId;
      SendAck(signalId, orderTicket, entryPrice, "OPENED", currentSpread);
   }
}
//+------------------------------------------------------------------+

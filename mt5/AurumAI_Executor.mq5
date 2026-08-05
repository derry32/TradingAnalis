//+------------------------------------------------------------------+
//|                                           AurumAI_Executor.mq5   |
//|                                  Copyright 2026, Aurum AI Quant  |
//|                                             https://aurum-ai.io  |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "2.00"
#property description "Aurum AI Autonomous Execution Engine for MetaTrader 5"
#property description "Automatically connects with Aurum AI VPS backend to execute XAU/USD signals."

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== [ API Connection Settings ] ==="
input string   InpApiUrl          = "http://43.156.79.235:3002";     // Server Backend Base URL
input string   InpApiToken        = "aurum_secret_bridge_token_2026"; // Secret Bridge Token
input int      InpTimerSeconds    = 1;                               // Polling Interval (Seconds)

input group "=== [ Risk & Execution Guard ] ==="
input ulong    InpMagicNumber     = 778899;                          // Magic Number (Order ID Isolation)
input double   InpFixedLot        = 0.01;                            // Lot Size (Default: 0.01 Demo Safe)
input int      InpMaxSpreadPoints = 400;                             // Max Spread (Points, 400 = 40 pips on Gold)
input ulong    InpSlippage        = 20;                              // Max Slippage (Points)
input bool     InpDemoOnlyGuard   = true;                            // Demo Account Only Guard (Safety)
input bool     InpUseTP1Only      = true;                            // Default TP Target (true: TP1, false: TP2)

//--- Global Variables
CTrade         g_trade;
string         g_lastProcessedId  = "";
datetime       g_lastPollTime     = 0;
bool           g_isInitialized    = false;

//+------------------------------------------------------------------+
//| Simple JSON parser helper for strings                            |
//+------------------------------------------------------------------+
string GetJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos == -1)
   {
      // Try unquoted value
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
         Print("❌ [Aurum AI Error] WebRequest URL not allowed! Add '", InpApiUrl, "' to Tools -> Options -> Expert Advisors -> Allow WebRequest");
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
         Alert("🚨 [SECURITY WARNING] EA di-lock dalam Mode DEMO ONLY! Akun ini terdeteksi sebagai REAL. EA otomatis dimatikan.");
         return INIT_FAILED;
      }
   }

   // 2. Setup Trade Instance
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(InpSlippage);
   g_trade.SetTypeFilling(ORDER_FILLING_FOK);

   // 3. Start Polling Timer
   EventSetTimer(InpTimerSeconds);
   
   Print("=================================================");
   Print("🚀 [Aurum AI] MT5 Autonomous Executor Started!");
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
   int    validSeconds  = (int)GetJsonDouble(json, "validSeconds");
   if(validSeconds <= 0) validSeconds = 900;

   double targetTP = InpUseTP1Only ? takeProfit1 : takeProfit2;

   // Check Spread Filter
   long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(currentSpread > InpMaxSpreadPoints)
   {
      PrintFormat("⚠️ [Spread Filter] Spread saat ini %d pts melebihi batas toleransi %d pts. Entry sinyal %s dibatalkan.",
                  currentSpread, InpMaxSpreadPoints, signalId);
      return;
   }

   // Execute Trade
   bool success = false;
   ulong orderTicket = 0;

   if(executionType == "MARKET")
   {
      // Instant Market Execution
      if(type == "BUY")
      {
         double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         success = g_trade.Buy(InpFixedLot, _Symbol, ask, stopLoss, targetTP, "Aurum AI " + signalId);
         if(success)
         {
            orderTicket = g_trade.ResultOrder();
            PrintFormat("🎯 [BUY INSTANT EXECUTED] Ticket #%I64u | Sinyal %s | Ask: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, ask, stopLoss, targetTP);
         }
      }
      else if(type == "SELL")
      {
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         success = g_trade.Sell(InpFixedLot, _Symbol, bid, stopLoss, targetTP, "Aurum AI " + signalId);
         if(success)
         {
            orderTicket = g_trade.ResultOrder();
            PrintFormat("🎯 [SELL INSTANT EXECUTED] Ticket #%I64u | Sinyal %s | Bid: %.2f | SL: %.2f | TP: %.2f",
                        orderTicket, signalId, bid, stopLoss, targetTP);
         }
      }
   }
   else if(executionType == "LIMIT")
   {
      // Pullback Pending Limit Execution
      datetime expiryTime = TimeCurrent() + validSeconds;

      if(type == "BUY")
      {
         success = g_trade.BuyLimit(InpFixedLot, entryPrice, _Symbol, stopLoss, targetTP, ORDER_TIME_SPECIFIED, expiryTime, "Aurum AI Limit " + signalId);
         if(success)
         {
            orderTicket = g_trade.ResultOrder();
            PrintFormat("⏳ [BUY LIMIT PLACED] Ticket #%I64u | Sinyal %s | Limit: %.2f | SL: %.2f | TP: %.2f | Expiry: %s",
                        orderTicket, signalId, entryPrice, stopLoss, targetTP, TimeToString(expiryTime));
         }
      }
      else if(type == "SELL")
      {
         success = g_trade.SellLimit(InpFixedLot, entryPrice, _Symbol, stopLoss, targetTP, ORDER_TIME_SPECIFIED, expiryTime, "Aurum AI Limit " + signalId);
         if(success)
         {
            orderTicket = g_trade.ResultOrder();
            PrintFormat("⏳ [SELL LIMIT PLACED] Ticket #%I64u | Sinyal %s | Limit: %.2f | SL: %.2f | TP: %.2f | Expiry: %s",
                        orderTicket, signalId, entryPrice, stopLoss, targetTP, TimeToString(expiryTime));
         }
      }
   }

   if(success)
   {
      g_lastProcessedId = signalId;
      SendAck(signalId, orderTicket, entryPrice, "OPENED", currentSpread);
   }
   else
   {
      uint retCode = g_trade.ResultRetcode();
      string retDesc = g_trade.ResultRetcodeDescription();
      PrintFormat("❌ [TRADE EXECUTION FAILED] Sinyal %s | Code: %d (%s)", signalId, retCode, retDesc);
   }
}
//+------------------------------------------------------------------+

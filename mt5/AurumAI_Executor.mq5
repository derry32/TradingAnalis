//+------------------------------------------------------------------+
//|                                          AurumAI_Executor.mq5    |
//|                                 Copyright 2026, Aurum AI Quant   |
//|                                            https://aurum-ai.io   |
//+------------------------------------------------------------------+
#property copyright   "Aurum AI Quant Systems 2026"
#property link        "https://aurum-ai.io"
#property version     "3.20"
#property description "Aurum AI Multi-Layer Scalper - Pure Native, No Includes, No Groups"

// ZERO #include directives - pure native MQL5 only

//--- Inputs: API
input string InpApiUrl       = "http://43.156.79.235:3002";      // Backend URL
input string InpApiToken     = "aurum_secret_bridge_token_2026"; // Secret Token
input int    InpTimerSeconds = 1;                                 // Polling (sec)

//--- Inputs: Scalper layers
input int    InpNumMarket    = 3;     // Market Order Layers (default 3)
input int    InpNumLimit     = 2;     // Limit Order Layers  (default 2)
input double InpMinLot       = 0.03;  // Lot Confidence < 70%
input double InpMidLot       = 0.05;  // Lot Confidence 70-79%
input double InpMaxLot       = 0.09;  // Lot Confidence >= 80%
input int    InpStepPoints   = 35;    // Step between limit layers (pts)
input int    InpMaxPositions = 15;    // Max simultaneous positions

//--- Inputs: Risk
input ulong  InpMagic        = 778899; // Magic Number
input int    InpMaxSpread    = 400;    // Max Spread pts
input ulong  InpSlippage     = 30;     // Slippage pts
input bool   InpDemoOnly     = true;   // Demo Guard
input bool   InpBasketTP     = true;   // Basket TP (conf < 70%)
input bool   InpHalfSecured  = true;   // Half-Secured BEP (conf >= 75%)

//--- State globals
string g_lastId      = "";
string g_activeId    = "";
string g_activeMode  = "";
double g_tp1         = 0.0;
double g_tp2         = 0.0;
bool   g_halfDone    = false;
bool   g_ready       = false;

//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetFilling()
{
   uint m = (uint)SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((m & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   if((m & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
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
   Print("[BASKET CLOSE] " + reason);
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
void ManagePositions()
{
   int open = CountPositions();
   if(open == 0) { g_halfDone = false; return; }

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   // Basket TP close
   if(InpBasketTP && g_activeMode == "BASKET" && g_tp1 > 0.0)
   {
      bool hit = false;
      for(int i = PositionsTotal()-1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 &&
            PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         {
            int pt = (int)PositionGetInteger(POSITION_TYPE);
            if(pt == POSITION_TYPE_BUY  && bid >= g_tp1) hit = true;
            if(pt == POSITION_TYPE_SELL && ask <= g_tp1) hit = true;
         }
      }
      if(hit) { CloseAllPositions("Basket TP1 hit for " + g_activeId); g_activeId = ""; }
   }

   // Half-secured BEP
   if(InpHalfSecured && g_activeMode == "HALF" && !g_halfDone && g_tp1 > 0.0)
   {
      bool hit = false;
      for(int i = PositionsTotal()-1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 &&
            PositionGetString(POSITION_SYMBOL) == _Symbol &&
            (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         {
            int pt = (int)PositionGetInteger(POSITION_TYPE);
            if(pt == POSITION_TYPE_BUY  && bid >= g_tp1) hit = true;
            if(pt == POSITION_TYPE_SELL && ask <= g_tp1) hit = true;
         }
      }
      if(hit)
      {
         PrintFormat("[HALF-SECURED] %s TP1=%.2f hit — closing half, BEP rest", g_activeId, g_tp1);
         int half    = MathMax(1, open / 2);
         int closed  = 0;
         for(int i = PositionsTotal()-1; i >= 0; i--)
         {
            ulong t = PositionGetTicket(i);
            if(t > 0 &&
               PositionGetString(POSITION_SYMBOL) == _Symbol &&
               (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
            {
               if(closed < half)
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
               else
               {
                  double openPx = PositionGetDouble(POSITION_PRICE_OPEN);
                  double curTP  = PositionGetDouble(POSITION_TP);
                  MqlTradeRequest req;
                  MqlTradeResult  res;
                  ZeroMemory(req);
                  ZeroMemory(res);
                  req.action   = TRADE_ACTION_SLTP;
                  req.symbol   = _Symbol;
                  req.position = t;
                  req.sl       = openPx;
                  req.tp       = curTP;
                  if(!OrderSend(req, res))
                     PrintFormat("[ModSLTP FAIL] ticket=%I64u err=%d", t, GetLastError());
               }
            }
         }
         g_halfDone = true;
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
      Alert("[SAFETY] Demo-only guard — EA stopped on REAL account!");
      return INIT_FAILED;
   }

   EventSetTimer(InpTimerSeconds);

   Print("============================");
   Print("[Aurum AI] v3.20 Started");
   Print("Layers : " + IntegerToString(InpNumMarket) + " Market + " + IntegerToString(InpNumLimit) + " Limit");
   Print("Lots   : " + DoubleToString(InpMinLot,2) + "/" + DoubleToString(InpMidLot,2) + "/" + DoubleToString(InpMaxLot,2));
   Print("URL    : " + InpApiUrl);
   Print("============================");

   string r = HttpGet(InpApiUrl + "/api/mt5/status");
   if(r != "") Print("[Server] " + r);

   g_ready = true;
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[Aurum AI] Deinitialized.");
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(!g_ready) return;

   ManagePositions();

   string json = HttpGet(InpApiUrl + "/api/mt5/signals/latest?token=" + InpApiToken);
   if(json == "") return;
   if(JStr(json, "status") != "ACTIVE_SIGNAL") return;

   string id = JStr(json, "id");
   if(id == "" || id == g_lastId) return;

   if(CountPositions() >= InpMaxPositions)
   {
      Print("[CAP] max positions reached — skipping " + id);
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
      Print("[SPREAD] " + IntegerToString((int)spread) + " pts too high — skip " + id);
      return;
   }

   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double pt   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double step = InpStepPoints * pt;
   if(step <= 0.0) step = 0.35;

   ulong firstTicket = 0;
   int   opened      = 0;

   PrintFormat("[SIGNAL] %s dir=%s conf=%.1f mode=%s lot=%.2f tp=%.2f",
               id, dir, conf, mode, lot, targetTP);

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
      g_lastId     = id;
      g_activeId   = id;
      g_activeMode = mode;
      g_tp1        = tp1;
      g_tp2        = tp2;
      g_halfDone   = false;
      SendAck(id, firstTicket, (dir == "BUY" ? ask : bid), "OPENED", spread);
      PrintFormat("[DONE] Signal %s | mode=%s | %d layers | lot/layer=%.2f",
                  id, mode, opened, lot);
   }
}
//+------------------------------------------------------------------+

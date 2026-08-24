import re

with open('AurumAI_Executor.mq5', 'r') as f:
    content = f.read()

# 1. Add TradeStats struct and array
struct_code = """
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
"""
content = re.sub(r'struct ClosedSignal \{.*?\n\};\nClosedSignal g_closeQueue\[\];', struct_code, content, flags=re.DOTALL)

# 2. Update QueueCloseAck
queue_ack_old = r'void QueueCloseAck\(string signalId, ulong ticket, double profit, double closePrice\)\n\{'
queue_ack_new = r"""void QueueCloseAck(string signalId, ulong ticket, double profit, double closePrice, double mfePips=0.0, double maePips=0.0, int mfeSec=0, int maeSec=0)
{"""
content = content.replace(queue_ack_old, queue_ack_new)

content = content.replace('g_closeQueue[size].closePrice = closePrice;', 
                          'g_closeQueue[size].closePrice = closePrice;\n   g_closeQueue[size].mfePips = mfePips;\n   g_closeQueue[size].maePips = maePips;\n   g_closeQueue[size].timeToMfeSec = mfeSec;\n   g_closeQueue[size].timeToMaeSec = maeSec;')

# 3. Update CheckAndReportClosedPositions to calculate MFE/MAE
check_report_old = r"""
      double closePrice = HistoryDealGetDouble\(dealTicket, DEAL_PRICE\);
      double profit     = HistoryDealGetDouble\(dealTicket, DEAL_PROFIT\);

      QueueCloseAck\(signalId, posId, profit, closePrice\);
"""
check_report_new = r"""
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      long dealType     = HistoryDealGetInteger(dealTicket, DEAL_TYPE);

      double mfePips = 0;
      double maePips = 0;
      int mfeSec = 0;
      int maeSec = 0;
      
      // Calculate MFE/MAE from tracking array
      for(int j=0; j<ArraySize(g_tradeStats); j++) {
         if(g_tradeStats[j].ticket == posId) {
            bool isBuy = (dealType == DEAL_TYPE_SELL); // Closing deal type is opposite
            if(isBuy) {
               mfePips = (g_tradeStats[j].maxPrice - g_tradeStats[j].fillPrice) * 10.0;
               maePips = (g_tradeStats[j].fillPrice - g_tradeStats[j].minPrice) * 10.0;
            } else {
               mfePips = (g_tradeStats[j].fillPrice - g_tradeStats[j].minPrice) * 10.0;
               maePips = (g_tradeStats[j].maxPrice - g_tradeStats[j].fillPrice) * 10.0;
            }
            mfeSec = (int)(g_tradeStats[j].maxTime - g_tradeStats[j].openTime);
            maeSec = (int)(g_tradeStats[j].minTime - g_tradeStats[j].openTime);
            break;
         }
      }

      QueueCloseAck(signalId, posId, profit, closePrice, mfePips, maePips, mfeSec, maeSec);
"""
content = re.sub(r'\s*double closePrice = HistoryDealGetDouble\(dealTicket, DEAL_PRICE\);\s*double profit\s*= HistoryDealGetDouble\(dealTicket, DEAL_PROFIT\);\s*QueueCloseAck\(signalId, posId, profit, closePrice\);', check_report_new, content)

# 4. Update FlushCloseQueue to send MFE/MAE
flush_old = r'StringFormat\("{\\"signalId\\":\\"%s\\",\\"ticket\\":%I64u,\\"profit\\":%.2f,\\"closePrice\\":%.5f}",'
flush_new = r'StringFormat("{\\"signalId\\":\\"%s\\",\\"ticket\\":%I64u,\\"profit\\":%.2f,\\"closePrice\\":%.5f,\\"mfePips\\":%.1f,\\"maePips\\":%.1f,\\"timeToMfeSec\\":%d,\\"timeToMaeSec\\":%d}",'
content = content.replace(flush_old, flush_new)

flush_args_old = r'item\.signalId, item\.ticket, item\.profit, item\.closePrice\);'
flush_args_new = r'item.signalId, item.ticket, item.profit, item.closePrice, item.mfePips, item.maePips, item.timeToMfeSec, item.timeToMaeSec);'
content = content.replace(flush_args_old, flush_args_new)

# 5. Add Tracker inside OnTick
on_tick_tracker = r"""
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
"""
content = re.sub(r'(void OnTick\(\)\n\{)', r'\1\n' + on_tick_tracker, content)

with open('AurumAI_Executor.mq5', 'w') as f:
    f.write(content)

print("Patched MFE EA successfully")

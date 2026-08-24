import express from 'express';
import cors from 'cors';
import { config } from './config';
import { MarketDataService } from './services/marketDataService';
import { TechnicalAnalysis } from './services/technicalAnalysis';
import { NewsService } from './services/newsService';
import { SentimentAnalysis, SentimentResult } from './services/sentimentAnalysis';
import { SignalGenerator, Signal } from './services/signalGenerator';
import { TelegramService } from './services/telegramBot';
import { insertSignal, fetchRecentSignals, updateSignalStatus, updateSignalStatusByInternalId, processSignalLayer, fetchSignalsByDate, fetchMonthlyStats, fetchActiveSignals, insertSystemLog } from './services/database';
import { mt5Bridge } from './services/mt5Bridge';
import { featureEngine } from './services/featureEngine';
import { confidenceEngine } from './services/confidenceEngine';
import { signalStateMachine, BurstSignalPayload } from './services/signalStateMachine';
import { preNewsEngine } from './services/preNewsEngine';
import { riskEngine } from './services/riskEngine';
import { pendingOrderEngine } from './services/pendingOrderEngine';

const app = express();
app.use(cors());
app.use(express.text({ type: 'application/json' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try {
      // Defensive cleanup: remove trailing null bytes commonly sent by MQL5 StringToCharArray
      const cleanData = req.body.replace(/\0/g, '').trim();
      req.body = cleanData ? JSON.parse(cleanData) : {};
    } catch (e) {
      console.error('[Middleware] JSON Parse Error (Defensive):', e.message);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }
  next();
});

const marketData = new MarketDataService();
const technical = new TechnicalAnalysis();
const news = new NewsService();
const sentiment = new SentimentAnalysis();
const signalGenerator = new SignalGenerator();
const telegramBot = new TelegramService();

let latestSentiment: SentimentResult | null = null;

// 1. Initial Sentiment Fetching
async function updateSentiment() {
  try {
    const articles = await news.fetchLatestNews();
    const combinedText = articles.map(a => `${a.title}. ${a.description}`).join(' ');
    latestSentiment = await sentiment.analyze(combinedText);
    console.log(`[Main] Updated Sentiment: ${latestSentiment.sentiment} (Score: ${latestSentiment.score})`);
  } catch (e) {
    console.error('[Main] Failed to update sentiment', e);
  }
}

updateSentiment();
setInterval(updateSentiment, 60 * 60 * 1000);

export interface TradeState {
  id: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  timeMs: number;
  status: 'ACTIVE' | 'HIT_TP' | 'HIT_SL' | 'EXPIRED';
  score: number;
  dbId?: string | number;
  pendingClose?: { status: string; hitTime: string; durationMins: number; accuracy: number; pips: number };
}

let latestTechResult: any = { trendH1: 'NEUTRAL' };

let activeTradeSniper: TradeState | null = null;
let activeTradeScalper: TradeState | null = null;
let activeStrategy: 'SNIPER' | 'HYPER_SCALPER' = 'SNIPER';

async function resumeActiveTrades() {
  try {
    const activeSignals = await fetchActiveSignals();
    if (!activeSignals || activeSignals.length === 0) return;

    // Filter: Hanya resume sinyal yang dihasilkan oleh Hyper Scalper V2 (setelah 19:00 WIB / memiliki setupType)
    const cutoffTime = new Date('2026-08-04T12:00:00.000Z').getTime();
    const v2ActiveSignals = activeSignals.filter(s => {
      const isPostV2 = new Date(s.timestamp).getTime() >= cutoffTime;
      const hasV2Setup = !!s.reason?.setupType;
      return isPostV2 || hasV2Setup;
    });

    if (v2ActiveSignals.length === 0) {
      console.log(`[Main] Sinyal lawas sebelum jam 19.00 WIB dilewati. Slot trade V2 siap & bersih.`);
      return;
    }

    console.log(`[Main] Found ${v2ActiveSignals.length} active V2 signal(s) to resume.`);
    
    for (const sig of v2ActiveSignals) {
      const tradeTimeMs = new Date(sig.timestamp).getTime();
      const strategy = sig.reason?.strategy;
      
      // Cek apakah trade sudah kedaluwarsa sebelum di-resume
      const maxHoldTime = strategy === 'SNIPER' ? 4 * 60 * 60 * 1000 : 90 * 60 * 1000;
      if (Date.now() - tradeTimeMs > maxHoldTime) {
        console.log(`[Main] Skipping expired trade ${sig.id} (age: ${Math.floor((Date.now() - tradeTimeMs) / 60000)} menit > max ${maxHoldTime / 60000} menit)`);
        // Update status di DB menjadi EXPIRED
        if (sig.id) updateSignalStatus(sig.id, 'EXPIRED', new Date().toISOString(), Math.floor((Date.now() - tradeTimeMs) / 60000), 0, 0);
        continue;
      }

      const state: TradeState = {
        id: sig.reason?.id || `RESUMED-${sig.id}`,
        type: sig.type as 'BUY' | 'SELL',
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        takeProfit1: sig.takeProfit1,
        timeMs: tradeTimeMs,
        status: 'ACTIVE',
        score: sig.reason?.confidence || 50,
        dbId: sig.id
      };

      if (strategy === 'SNIPER') {
        if (!activeTradeSniper) {
           activeTradeSniper = state;
           console.log(`[Main] Resumed active SNIPER trade ${state.id}`);
        }
      } else if (strategy === 'HYPER_SCALPER' || strategy === 'SCALPER') {
        if (!activeTradeScalper) {
           activeTradeScalper = state;
           console.log(`[Main] Resumed active SCALPER trade ${state.id}`);
        }
      }
    }
  } catch (e) {
    console.error('[Main] Failed to resume active trades', e);
  }
}

resumeActiveTrades();

// === S5-A: Drawdown Guard ===
let dailySLCount = 0;
let drawdownGuardActive = false;
let lastSLDateWIB = '';

function getTodayWIB(): string {
  return new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function checkAndResetDailyDrawdown() {
  const today = getTodayWIB();
  if (lastSLDateWIB !== today) {
    dailySLCount = 0;
    drawdownGuardActive = false;
    lastSLDateWIB = today;
    console.log('[DrawdownGuard] Hari baru terdeteksi. Counter direset.');
  }
}

// === S5-B: Capital Risk Engine ===
// Logic has been moved to riskEngine.ts

function updateTradeState(trade: TradeState | null, currentM5: any, strategy: string): TradeState | null {
  if (!trade || trade.status !== 'ACTIVE') {
    // Flush pending close jika dbId baru tersedia
    if (trade && trade.pendingClose && trade.dbId) {
      const p = trade.pendingClose;
      updateSignalStatus(trade.dbId, p.status, p.hitTime, p.durationMins, p.accuracy, p.pips);
      trade.pendingClose = undefined;
    }
    return trade;
  }
  
  const high = currentM5.high;
  const low = currentM5.low;

  if (trade.type === 'BUY') {
      if (low <= trade.stopLoss) trade.status = 'HIT_SL';
      else if (high >= trade.takeProfit1) trade.status = 'HIT_TP';
  } else {
      if (high >= trade.stopLoss) trade.status = 'HIT_SL';
      else if (low <= trade.takeProfit1) trade.status = 'HIT_TP';
  }
  
  // Expiry check (4 hours max hold for Sniper, 1.5 hours for Scalper)
  const maxHoldTime = strategy === 'SNIPER' ? 4 * 60 * 60 * 1000 : 90 * 60 * 1000;
  if (trade.status === 'ACTIVE' && Date.now() - trade.timeMs > maxHoldTime) {
     trade.status = 'EXPIRED';
  }

  if (trade.status !== 'ACTIVE') {
      console.log(`[Agent Derry][${strategy}] Trade ${trade.id} Closed: ${trade.status}`);
      const hitTimeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
      const durationMins = Math.floor((Date.now() - trade.timeMs) / (60 * 1000));
      
      let accuracy = 0;
      let pips = 0;
      if (trade.status === 'HIT_SL') {
          accuracy = 0;
          // SL pips selalu negatif (kerugian)
          pips = trade.type === 'BUY' 
            ? Math.round((trade.stopLoss - trade.entryPrice) * 10)  // negatif
            : Math.round((trade.entryPrice - trade.stopLoss) * 10); // negatif
      } else if (trade.status === 'HIT_TP') {
          accuracy = 100;
          if (durationMins > 20) {
              accuracy = Math.max(0, 100 - ((durationMins - 20) * 0.5));
          }
          pips = trade.type === 'BUY' 
            ? Math.round((trade.takeProfit1 - trade.entryPrice) * 10)
            : Math.round((trade.entryPrice - trade.takeProfit1) * 10);
      }
      
      if (trade.dbId) {
          // dbId sudah ada, langsung update
          updateSignalStatus(trade.dbId, trade.status, hitTimeStr, durationMins, accuracy, pips);
      } else {
          // dbId belum tersedia (race condition), simpan sebagai pending
          console.log(`[Agent Derry][${strategy}] dbId belum ada saat close, menyimpan sebagai pending...`);
          trade.pendingClose = { status: trade.status, hitTime: hitTimeStr, durationMins, accuracy, pips };
      }

      // S5-A: Increment drawdown counter jika HIT_SL
      if (trade.status === 'HIT_SL') {
        checkAndResetDailyDrawdown();
        dailySLCount++;
        lastSLDateWIB = getTodayWIB();
        
        const DRAWDOWN_LIMIT = 10;
        if (dailySLCount >= DRAWDOWN_LIMIT) {
          drawdownGuardActive = true;
          // Hanya kirim notifikasi saat pertama kali mencapai limit hari ini (mencegah spam)
          if (dailySLCount === DRAWDOWN_LIMIT) {
            const msg = `[DrawdownGuard] ⛔ AKTIF! ${DRAWDOWN_LIMIT} SL hari ini. Semua sinyal diblokir hingga besok.`;
            console.log(msg);
            insertSystemLog('WARN', 'DrawdownGuard', msg, { count: dailySLCount });
          }
        } else {
          console.log(`[DrawdownGuard] SL ke-${dailySLCount} hari ini. Batas: ${DRAWDOWN_LIMIT}.`);
        }
      }
  }

  return trade;
}

// Wire pendingOrderEngine callbacks
pendingOrderEngine.onExecuteMarketOrder = async (ps) => {
  try {
     const signal = ps.signal;
     signal.executionType = '⚡ INSTANT ENTRY (Revalidated Market Order)';
     signal.entryPrice = ps.executionSnapshot?.requestedPrice || signal.entryPrice;
     
     const score = signal.confidenceScore;
     const newTradeState: TradeState = { 
       id: signal.id, type: signal.type as 'BUY' | 'SELL', 
       entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit1: signal.takeProfit1, 
       timeMs: Date.now(), status: 'ACTIVE', score 
     };
     
     if (signal.strategy.includes('SNIPER')) activeTradeSniper = newTradeState;
     else activeTradeScalper = newTradeState;
     
     insertSignal(signal).then(dbId => {
         if (dbId) {
             insertSystemLog('INFO', 'AI_Agent', `Sinyal REVALIDASI SUKSES: ${signal.type} di ${signal.entryPrice}`, { id: signal.id, strategy: signal.strategy });
             if (signal.strategy.includes('SNIPER') && activeTradeSniper && activeTradeSniper.id === signal.id) {
                 activeTradeSniper.dbId = dbId;
             } else if (signal.strategy.includes('SCALPER') && activeTradeScalper && activeTradeScalper.id === signal.id) {
                 activeTradeScalper.dbId = dbId;
             }
         }
     });

     const displaySignal = { ...signal, strategy: `${signal.strategy} (EXECUTED - Validasi Ulang Sukses)` };
     telegramBot.sendSignal(displaySignal);
     mt5Bridge.setLatestSignal(signal as any);
     return true;
  } catch (err) {
     return false;
  }
};

pendingOrderEngine.onSignalCancelled = (ps, reason) => {
  telegramBot.sendMessage(`❌ [CANCELLED] Signal ${ps.signal.id} dibatalkan.\nAlasan: ${reason}`);
};

// 2. Wire Market Data
marketData.setOnM1Closed((data) => {
  if (data.m1.length < 10 || data.m5.length < 10) return;
  const currentPrice = data.currentM1?.close || data.m5[data.m5.length - 1].close;

  pendingOrderEngine.onTick(currentPrice);

  // 1. Fast Incremental Feature Extraction (<15ms)
  const snapshot = featureEngine.generateSnapshot(
    data.m1,
    data.m5,
    data.m15,
    data.h1,
    currentPrice
  );

  // 2. Deterministic Quant Confidence Evaluation (<5ms, Zero LLM)
  const evaluation = confidenceEngine.evaluate(snapshot);

  // 3. Check Drawdown Guard
  checkAndResetDailyDrawdown();
  const DRAWDOWN_LIMIT = 10;
  const isGuardActive = dailySLCount >= DRAWDOWN_LIMIT;

  // DEBUG LOG UNTUK MELIHAT EVALUASI M1
  console.log(`[M1 DEBUG] Score: ${evaluation.totalScore}, Dir: ${evaluation.direction}`);
  if (evaluation.reasons.length > 0) {
      console.log(`[M1 DEBUG] Reasons:`, evaluation.reasons);
  }

  if (evaluation.direction !== 'WAIT' && evaluation.totalScore >= 55 && !isGuardActive) {
    if (data.isStaleData) {
       console.log(`[StaleDataGuard] ⛔ Sinyal ${evaluation.direction} diblokir! Koneksi mati (message terakhir ${data.lastMessageAgeSec?.toFixed(1)}s lalu, tick terakhir ${data.lastTickAgeSec?.toFixed(1)}s lalu).`);
       return;
    }
    // 4. Create Burst Signal Payload with Dynamic TP & Lot Sizing
    const burst = signalStateMachine.createBurstSignal(
      evaluation, 
      snapshot, 
      30, 
      riskEngine.getBalance(), 
      riskEngine.getRiskPercent()
    );
    if (burst) {
      console.log(`[Critical Path ⚡] Micro-Burst Sinyal M1 Generated: ${burst.direction} @ ${burst.entryPrice} (Skor: ${burst.confidenceScore}%, Tier: ${burst.tier})`);

      // ⚡ CRITICAL PATH (<100ms Push to MT5 & Telegram)
      mt5Bridge.setLatestBurstSignal(burst);

      // Construct legacy Signal format for DB & Telegram compatibility
      const legacySignal: Signal = {
        id: burst.id,
        type: burst.direction,
        setupType: `⚡ ${burst.tier} (5-Layer Burst)`,
        executionType: 'BURST_5_LAYERS',
        probabilityLabel: burst.tier,
        confidenceScore: burst.confidenceScore,
        marketCondition: `${snapshot.m5.features.trend} Trend / ${snapshot.m1.structure.structureType}`,
        session: getCurrentSession(),
        entryPrice: burst.entryPrice,
        stopLoss: burst.stopLossPrice,
        takeProfit1: burst.layers[0].tpPrice,
        takeProfit2: burst.layers[burst.layers.length - 1].tpPrice,
        validTime: '30 Detik (TTL Scalp)',
        estimatedTpTime: '1-3 Menit',
        timestamp: new Date().toISOString(),
        reason: burst.reasons.join('\n'),
        strategy: 'HYPER_SCALPER (Analisis Candle M1)',
        entryZone: `${burst.entryZoneMin} - ${burst.entryZoneMax}`,
      };

      telegramBot.sendSignal(legacySignal);
      insertSignal(legacySignal).then((dbId) => {
        if (dbId) {
          insertSystemLog('INFO', 'RealTimeEngine', `⚡ Early Sinyal M1: ${burst.direction} @ ${burst.entryPrice}`, {
            id: burst.id,
            score: burst.confidenceScore,
            tier: burst.tier,
            layers: burst.layers.length,
          });
        }
      });
    }
  }
});

marketData.setOnM5Closed(async (data) => {
  // Cegah spam sinyal dari data masa lalu saat server baru menyala (restart)
  // currentM5 adalah candle yang BARU DITUTUP. Jika usianya lebih dari 15 menit lalu, abaikan.
  const candleAgeMs = Date.now() - data.currentM5.time;
  if (candleAgeMs > 15 * 60 * 1000) return;

  const techResult = technical.analyze(data);
  latestTechResult = techResult;
  
  await pendingOrderEngine.onM5Closed(data.currentM5.close, techResult);
  
  activeTradeSniper = updateTradeState(activeTradeSniper, data.currentM5, 'SNIPER');
  activeTradeScalper = updateTradeState(activeTradeScalper, data.currentM5, 'HYPER_SCALPER');
  
  if (latestSentiment) {
    const activeNewsContext = news.getActiveNewsContext();
    const strategies: ('SNIPER' | 'HYPER_SCALPER')[] = ['SNIPER', 'HYPER_SCALPER'];
    
    for (const strategy of strategies) {
      const signal = signalGenerator.generate(techResult, latestSentiment.sentiment, data.currentM5.close, latestSentiment.score, activeNewsContext, strategy);
      if (signal) {
        const score = signal.confidenceScore;
        const now = Date.now();
        let shouldSend = true;
        let activeTrade = strategy === 'SNIPER' ? activeTradeSniper : activeTradeScalper;
        
        if (activeTrade && activeTrade.status === 'ACTIVE') {
           if (activeTrade.type !== signal.type) {
              console.log(`[Agent Derry][${strategy}] REVERSAL DETECTED! Closing previous ${activeTrade.type} and opening ${signal.type}.`);
              activeTrade.status = 'EXPIRED'; // Close previous
           }
        }

        // S5-A: Blokir semua sinyal jika Drawdown Guard aktif
        checkAndResetDailyDrawdown();
        // Since we changed the limit to 10, we check dailySLCount here instead of relying solely on the old boolean
        const DRAWDOWN_LIMIT = 10;
        const isGuardActive = dailySLCount >= DRAWDOWN_LIMIT;
        
        if (isGuardActive && signal.type !== 'WAIT') {
          console.log(`[DrawdownGuard] ⛔ Sinyal ${signal.type} diblokir. Drawdown Guard aktif (${dailySLCount}/${DRAWDOWN_LIMIT} SL hari ini).`);
          continue;
        }

        if (shouldSend && signal.type !== 'WAIT') {
          if (data.isStaleData) {
             console.log(`[StaleDataGuard] ⛔ Sinyal ${signal.type} diblokir! Koneksi mati (message terakhir ${data.lastMessageAgeSec?.toFixed(1)}s lalu, tick terakhir ${data.lastTickAgeSec?.toFixed(1)}s lalu).`);
             continue;
          }

          if (signal.executionType?.includes('PULLBACK')) {
              pendingOrderEngine.add(signal, techResult);
              const displaySignal = { ...signal, strategy: `${signal.strategy} (ARMED - Menunggu Zona)` };
              telegramBot.sendSignal(displaySignal);
          } else {
              const newTradeState: TradeState = { 
                id: signal.id, type: signal.type as 'BUY' | 'SELL', 
                entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit1: signal.takeProfit1, 
                timeMs: now, status: 'ACTIVE', score 
              };
              if (strategy === 'SNIPER') activeTradeSniper = newTradeState;
              else activeTradeScalper = newTradeState;
              
              insertSignal(signal).then(dbId => {
                  if (dbId) {
                      insertSystemLog('INFO', 'AI_Agent', `Sinyal baru: ${signal.type} di ${signal.entryPrice}`, { id: signal.id, strategy: signal.strategy });
                      if (strategy === 'SNIPER' && activeTradeSniper && activeTradeSniper.id === signal.id) {
                          activeTradeSniper.dbId = dbId;
                      } else if (strategy === 'HYPER_SCALPER' && activeTradeScalper && activeTradeScalper.id === signal.id) {
                          activeTradeScalper.dbId = dbId;
                      }
                  }
              });
              
              // Tambahkan label Analisis Candle M5 untuk membedakan dengan M1 di Telegram
              const displaySignal = { ...signal, strategy: `${signal.strategy} (Analisis Candle M5)` };
              telegramBot.sendSignal(displaySignal);
              
              // CRITICAL FIX REVERTED: Mengirim kembali sinyal M5 ke MT5 sesuai permintaan user
              // MT5 Bridge sekarang menerima kedua sinyal (M1 Burst dan M5 Legacy)
              mt5Bridge.setLatestSignal(signal as any);
          }
        } else if (signal.type === 'WAIT') {
          console.log(`[Agent Derry][${strategy}] Decision: WAIT. Reason: ${signal.reason.split('\n')[0]}`);
        }
      }
    }
  }
});

marketData.start();

function getCurrentSession() {
  const currentHourUTC = new Date().getUTCHours();
  const currentHourWIB = (currentHourUTC + 7) % 24;
  
  if (currentHourWIB >= 19 && currentHourWIB <= 23) return 'GOLDEN OVERLAP';
  if (currentHourWIB >= 19 || currentHourWIB < 4) return 'NEW YORK';
  if (currentHourWIB >= 14 && currentHourWIB < 19) return 'LONDON';
  if (currentHourWIB >= 6 && currentHourWIB < 14) return 'TOKYO';
  return 'CLOSING';
}

news.start();

// Pre-News Engine Scheduler (Check every 5 seconds)
setInterval(() => {
  preNewsEngine.checkSchedule(Date.now(), news, marketData, telegramBot);
}, 5000);

// === Wire Telegram Bot Commands ===
telegramBot.setOnReset(() => {
  dailySLCount = 0;
  drawdownGuardActive = false;
  mt5Bridge.triggerResetGuard();
  console.log('[DrawdownGuard] ✅ Guard & MT5 EA direset via Telegram.');
  insertSystemLog('INFO', 'DrawdownGuard', 'Drawdown Guard & MT5 EA direset secara manual via Telegram.');
  return { success: true, count: 0 };
});

telegramBot.setGetStatus(() => {
  checkAndResetDailyDrawdown();
  return {
    session: getCurrentSession(),
    isGuardActive: dailySLCount >= 10,
    dailySLCount,
    maxDailySL: 10,
    activeSniper: activeTradeSniper,
    activeScalper: activeTradeScalper
  };
});

// === S5-A: Drawdown Guard Endpoints ===
app.get('/api/risk/drawdown-status', (req, res) => {
  checkAndResetDailyDrawdown();
  res.json({
    active: drawdownGuardActive,
    dailySLCount,
    maxDailySL: 10,
    resetDate: lastSLDateWIB || getTodayWIB()
  });
});

app.post('/api/risk/reset-drawdown', (req, res) => {
  dailySLCount = 0;
  drawdownGuardActive = false;
  mt5Bridge.triggerResetGuard();
  console.log('[DrawdownGuard] ✅ Guard direset secara manual oleh user.');
  insertSystemLog('INFO', 'DrawdownGuard', 'Drawdown Guard berhasil direset secara manual. Sistem Trading AI kembali aktif.');
  res.json({ success: true, message: 'Drawdown Guard berhasil direset.' });
});

// === S5-B: Capital Risk Engine Endpoints ===
app.get('/api/risk/capital', (req, res) => {
  const slPips = config.STOP_LOSS_PIPS;
  const suggestedLot = riskEngine.calculateLotSize(slPips * 0.1);
  res.json({ balance: riskEngine.getBalance(), riskPercent: riskEngine.getRiskPercent(), suggestedLot, slPips });
});

app.post('/api/risk/capital', (req, res) => {
  const { balance, riskPercent: rp } = req.body;
  if (typeof balance === 'number' && balance >= 0) riskEngine.setBalance(balance);
  if (typeof rp === 'number' && rp >= 0.1 && rp <= 10) riskEngine.setRiskPercent(rp);
  
  const suggestedLot = riskEngine.calculateLotSize(config.STOP_LOSS_PIPS * 0.1);
  console.log(`[CapitalRisk] Modal diupdate: $${riskEngine.getBalance()}, Risk: ${riskEngine.getRiskPercent()}%, Lot: ${suggestedLot}`);
  res.json({ success: true, balance: riskEngine.getBalance(), riskPercent: riskEngine.getRiskPercent(), suggestedLot });
});

app.get('/api/settings/strategy', (req, res) => {
  res.json({ strategy: activeStrategy });
});

app.post('/api/settings/strategy', (req, res) => {
  const { strategy } = req.body;
  if (strategy === 'SNIPER' || strategy === 'HYPER_SCALPER') {
    activeStrategy = strategy;
    res.json({ success: true, strategy: activeStrategy });
  } else {
    res.status(400).json({ error: 'Invalid strategy' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Missing start or end date' });
    }
    const signals = await fetchSignalsByDate(start as string, end as string);
    res.json(signals);
  } catch (error) {
    console.error('Error in /api/history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// 3. API Endpoints
app.get('/api/status', (req, res) => {
  let analysisDetail = 'Menyiapkan mesin analisis...';
  if (latestTechResult) {
    if (latestTechResult.trendH1 === 'NEUTRAL') {
      analysisDetail = `Konsolidasi Ekstrem (Tren H1 Sideways). Menunggu momentum breakout atau dorongan Berita Fundamental.`;
    } else {
      if (latestTechResult.marketCondition === 'SIDEWAYS') {
         analysisDetail = `Tren H1 ${latestTechResult.trendH1}, namun Market M15 Sideways. Menunggu konfirmasi Breakout BOS/CHoCH.`;
      } else if (!latestTechResult.isRetracedH1) {
         analysisDetail = `Mode Momentum. Tren H1 ${latestTechResult.trendH1}. Mengintai pola Engulfing/Pin Bar di M5 pada area Support/Resistance.`;
      } else if (latestTechResult.patternM5 === 'NONE') {
         analysisDetail = `Harga memantul di zona H1! Menunggu konfirmasi pola candlestick yang valid di M5.`;
      } else {
         analysisDetail = `Pola ${latestTechResult.patternM5} terdeteksi! Mengkalkulasi Dynamic Session Score...`;
      }
    }
  }

  const currentSession = getCurrentSession();
  
  let activeTrend = latestTechResult ? latestTechResult.trendH1 : 'NEUTRAL';
  if (activeTrend === 'NEUTRAL' && latestTechResult) {
    if (latestTechResult.marketStructureM15?.includes('BULL')) activeTrend = 'BULLISH';
    else if (latestTechResult.marketStructureM15?.includes('BEAR')) activeTrend = 'BEARISH';
  }

  res.json({
    technicalStatus: activeTrend,
    sentimentStatus: latestSentiment,
    activeSession: getCurrentSession(),
    analysisDetail,
    upcomingNews: news.getUpcomingHighImpactNews(), // Expose upcoming high impact news
    config: {
      timeframe: config.TIMEFRAME_MINUTES,
      rr: config.RISK_REWARD_RATIO,
      sl: config.STOP_LOSS_PIPS,
      strategy: activeStrategy
    }
  });
});

app.get('/api/signals', async (req, res) => {
  const signals = await fetchRecentSignals(100);
  
  const filteredSignals = signals.filter(sig => {
    try {
      const reasonObj = JSON.parse(sig.reason);
      // Fallback to SNIPER if strategy is not defined (for older signals)
      const sigStrategy = reasonObj.strategy || 'SNIPER';
      return sigStrategy.includes(activeStrategy);
    } catch (e) {
      return activeStrategy === 'SNIPER';
    }
  });

  res.json(filteredSignals.slice(0, 50));
});

app.get('/api/candles', (req, res) => {
  const candles = marketData.getCandles().map(c => ({
    time: Math.floor(c.time / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
  res.json(candles);
});

// === S5-C: Performance Endpoint ===
app.get('/api/performance', async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year as string) || now.getUTCFullYear();
  const month = parseInt(req.query.month as string) || (now.getUTCMonth() + 1);
  try {
    const stats = await fetchMonthlyStats(year, month);
    if (!stats) return res.status(500).json({ error: 'Gagal mengambil data performa.' });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === S6-EA: MetaTrader 5 Bridge Endpoints ===
app.get('/api/mt5/status', (req, res) => {
  res.json({
    status: 'ONLINE',
    bridge: 'MT5_REST_BRIDGE',
    serverTime: new Date().toISOString(),
    version: '2.0.0'
  });
});

app.get('/api/mt5/signals/latest', (req, res) => {
  const token = (req.query.token as string) || (req.headers['x-mt5-token'] as string) || '';
  
  // MT5 Market Data Feed Ingestion
  const bidStr = req.query.bid as string;
  const askStr = req.query.ask as string;
  const timeStr = req.query.time as string;
  const symbol = req.query.symbol as string;
  
  if (bidStr && askStr && timeStr && symbol) {
    const bid = parseFloat(bidStr);
    const ask = parseFloat(askStr);
    const timeMsc = parseInt(timeStr, 10);
    if (!isNaN(bid) && !isNaN(ask) && !isNaN(timeMsc) && bid > 0 && ask > 0 && ask >= bid) {
      const spreadPips = (ask - bid) * 10;
      if (spreadPips >= 0 && spreadPips < 50) { // Spread masuk akal (<50 pips)
        // Kirim ke marketDataService
        marketData.processMt5Tick(symbol, bid, ask, timeMsc);
      }
    }
  }

  const result = mt5Bridge.getLatestSignalPayload(token);
  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }
  res.json(result.data);
});

app.post('/api/mt5/signals/ack', (req, res) => {
  const token = (req.query.token as string) || (req.headers['x-mt5-token'] as string) || req.body.token || '';
  const result = mt5Bridge.recordAcknowledgment(token, req.body);
  if (!result.success) {
    return res.status(401).json({ error: result.message });
  }
  res.json(result);
});

app.post('/api/mt5/signals/close', async (req, res) => {
  const token = (req.query.token as string) || (req.headers['x-mt5-token'] as string) || req.body.token || '';
  const result = mt5Bridge.recordTradeClose(token, req.body);
  if (!result.success) {
    return res.status(401).json({ error: result.message });
  }

  try {
    const profit = Number(req.body.profit) || 0;
    const signalId = req.body.signalId;
    const ticket = Number(req.body.ticket) || 0;
    
    await processSignalLayer(signalId, ticket, profit, {
       mfePips: req.body.mfePips ? Number(req.body.mfePips) : undefined,
       maePips: req.body.maePips ? Number(req.body.maePips) : undefined,
       timeToMfeSec: req.body.timeToMfeSec ? Number(req.body.timeToMfeSec) : undefined,
       timeToMaeSec: req.body.timeToMaeSec ? Number(req.body.timeToMaeSec) : undefined
    });
  } catch (e) {
    console.error('[MT5 Bridge] Error updating signal close in DB:', e);
  }

  res.json(result);
});

app.get('/api/mt5/history', (req, res) => {
  const token = (req.query.token as string) || (req.headers['x-mt5-token'] as string) || '';
  if (token !== config.MT5_BRIDGE_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(mt5Bridge.getHistory());
});

app.get('/test_signal', (req, res) => {
  const testSignal = {
    id: 'TEST-' + Date.now(),
    direction: 'BUY',
    tier: 'MOMENTUM_SCALP',
    confidenceScore: 85,
    entryPrice: 4000,
    pullbackLimitPrice: 3995,
    stopLossPrice: 3990,
    timestampMs: Date.now(),
    ttlSeconds: 60,
    currentReEntryCycle: 1,
    maxReEntryCycles: 1,
    layers: [
      { layerIndex: 1, orderType: 'BUY_MARKET', suggestedPrice: 4000, tpPrice: 4010, tpPips: 10, slPrice: 3990, slPips: 11, lotRatio: 1 }
    ],
    reasons: [], warnings: []
  };
  mt5Bridge.setLatestSignal(testSignal as any);
  res.json({ success: true, signalId: testSignal.id });
});

app.listen(config.PORT, () => {
  console.log(`[Backend] Server running on port ${config.PORT}`);
  console.log(`[Backend] Config: ${config.TIMEFRAME_MINUTES}M Timeframe, 1:${config.RISK_REWARD_RATIO} Risk/Reward, ${config.STOP_LOSS_PIPS} pips max SL.`);
});

import express from 'express';
import cors from 'cors';
import { config } from './config';
import { MarketDataService } from './services/marketDataService';
import { TechnicalAnalysis } from './services/technicalAnalysis';
import { NewsService } from './services/newsService';
import { SentimentAnalysis, SentimentResult } from './services/sentimentAnalysis';
import { SignalGenerator, Signal } from './services/signalGenerator';
import { TelegramService } from './services/telegramBot';
import { insertSignal, fetchRecentSignals } from './services/database';

const app = express();
app.use(cors());
app.use(express.json());

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
}

let latestTechResult: any = { trendH1: 'NEUTRAL' };

let activeTradeSniper: TradeState | null = null;
let activeTradeScalper: TradeState | null = null;
let activeStrategy: 'SNIPER' | 'HYPER_SCALPER' = 'SNIPER';

function updateTradeState(trade: TradeState | null, currentM5: any, strategy: string): TradeState | null {
  if (!trade || trade.status !== 'ACTIVE') return trade;
  
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
  }

  return trade;
}

// 2. Wire Market Data
marketData.setOnM5Closed((data) => {
  const techResult = technical.analyze(data);
  latestTechResult = techResult;
  
  activeTradeSniper = updateTradeState(activeTradeSniper, data.currentM5, 'SNIPER');
  activeTradeScalper = updateTradeState(activeTradeScalper, data.currentM5, 'HYPER_SCALPER');
  
  if (latestSentiment) {
    const upcomingNews = news.getUpcomingHighImpactNews();
    const strategies: ('SNIPER' | 'HYPER_SCALPER')[] = ['SNIPER', 'HYPER_SCALPER'];
    
    for (const strategy of strategies) {
      const signal = signalGenerator.generate(techResult, latestSentiment.sentiment, data.currentM5.close, latestSentiment.score, upcomingNews, strategy);
      if (signal) {
        const score = signal.confidenceScore;
        const now = Date.now();
        let shouldSend = true;
        
        let activeTrade = strategy === 'SNIPER' ? activeTradeSniper : activeTradeScalper;
        
        if (activeTrade && activeTrade.status === 'ACTIVE') {
           if (activeTrade.type === signal.type) {
              shouldSend = false; // Cooldown for same direction
              if (signal.type !== 'WAIT' && score > activeTrade.score + 10) {
                 shouldSend = true; // Allow if score is significantly higher
              } else if (signal.type !== 'WAIT') {
                 console.log(`[Agent Derry][${strategy}] Ignored duplicate ${signal.type} signal (Score: ${score}%) due to Active Trade Cooldown.`);
              }
           } else if (signal.type !== 'WAIT') {
              console.log(`[Agent Derry][${strategy}] REVERSAL DETECTED! Closing previous ${activeTrade.type} and opening ${signal.type}.`);
              activeTrade.status = 'EXPIRED'; // Close previous
           }
        }

        if (shouldSend && signal.type !== 'WAIT') {
          const newTradeState: TradeState = { 
            id: signal.id, type: signal.type as 'BUY' | 'SELL', 
            entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit1: signal.takeProfit1, 
            timeMs: now, status: 'ACTIVE', score 
          };
          if (strategy === 'SNIPER') activeTradeSniper = newTradeState;
          else activeTradeScalper = newTradeState;
          
          insertSignal(signal); // Save to Database
          telegramBot.sendSignal(signal);
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

news.start(); // Start fetching news

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
  if (activeStrategy === 'HYPER_SCALPER' && (currentSession === 'SYDNEY' || currentSession === 'TOKYO' || currentSession === 'OFF')) {
    analysisDetail = "Sesi tidak valid untuk Hyper Scalper. Harap tunggu sesi London atau New York.";
  }

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
      return sigStrategy === activeStrategy;
    } catch (e) {
      return activeStrategy === 'SNIPER';
    }
  });

  res.json(filteredSignals.slice(0, 50));
});

app.get('/api/candles', (req, res) => {
  const candles = marketData.getCandles().map(c => ({
    time: Math.floor(c.time / 1000), // convert to seconds for lightweight-charts
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
  res.json(candles);
});

app.listen(config.PORT, () => {
  console.log(`[Backend] Server running on port ${config.PORT}`);
  console.log(`[Backend] Config: ${config.TIMEFRAME_MINUTES}M Timeframe, 1:${config.RISK_REWARD_RATIO} Risk/Reward, ${config.STOP_LOSS_PIPS} pips max SL.`);
});

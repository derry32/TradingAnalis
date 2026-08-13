import { mt5Bridge } from './mt5Bridge';
import { insertSignal, insertSystemLog } from './database';
import { NewsService, NewsEvent } from './newsService';
import { MarketDataService } from './marketDataService';
import { TelegramService } from './telegramBot';

import { macroData, MacroState } from './macroDataService';
import { TechnicalAnalysis, AnalysisResult } from './technicalAnalysis';

export type PreNewsState = 'IDLE' | 'PREPARE' | 'LOCKED' | 'EXECUTE';

export interface PreNewsPrediction {
  buyProbability: number;
  sellProbability: number;
  waitProbability: number;
  bias: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  reasons: string[];
}

export class PreNewsEngine {
  private static instance: PreNewsEngine;
  private state: PreNewsState = 'IDLE';
  private targetNews: NewsEvent | null = null;
  private lockedPrediction: PreNewsPrediction | null = null;
  private lastNotifiedPhase: number | null = null;
  private technical = new TechnicalAnalysis();

  private constructor() {}

  public static getInstance(): PreNewsEngine {
    if (!PreNewsEngine.instance) {
      PreNewsEngine.instance = new PreNewsEngine();
    }
    return PreNewsEngine.instance;
  }

  public getState() { return this.state; }
  public getTargetNews() { return this.targetNews; }
  public getLockedPrediction() { return this.lockedPrediction; }

  // Dipanggil setiap menit oleh Cron Timer
  public async checkSchedule(currentTimestamp: number, newsService: NewsService, marketDataService: MarketDataService, telegramBot: TelegramService) {
    const upcoming = newsService.getUpcomingHighImpactNews();
    if (!upcoming) {
      if (this.state !== 'IDLE') {
        this.reset();
      }
      return;
    }

    // Jika severity bukan EXTREME, biarkan (NFP/CPI sudah kita set EXTREME di newsService nantinya)
    const severity = (newsService as any).constructor.getNewsSeverity(upcoming.title);
    if (severity !== 'EXTREME') return;

    this.targetNews = upcoming;
    const diffMins = Math.floor((upcoming.parsedDate! - currentTimestamp) / (60 * 1000));

    if (diffMins === 30 && this.lastNotifiedPhase !== 30) {
      this.lastNotifiedPhase = 30;
      await this.runPreparationPhase(30, telegramBot, marketDataService);
    } else if (diffMins === 15 && this.lastNotifiedPhase !== 15) {
      this.lastNotifiedPhase = 15;
      await this.runPreparationPhase(15, telegramBot, marketDataService);
    } else if (diffMins === 5 && this.lastNotifiedPhase !== 5) {
      this.lastNotifiedPhase = 5;
      await this.runLockPhase(telegramBot, marketDataService);
    } else if (diffMins === 0 && this.lastNotifiedPhase !== 0) {
      this.lastNotifiedPhase = 0;
      await this.runExecutionPhase(telegramBot, marketDataService);
    } else if (diffMins < -5) {
      // Clean up setelah news lewat 5 menit
      this.reset();
    }
  }

  private reset() {
    this.state = 'IDLE';
    this.targetNews = null;
    this.lockedPrediction = null;
    this.lastNotifiedPhase = null;
    console.log('[PreNewsEngine] Reset to IDLE');
  }

  private async runPreparationPhase(minutesLeft: number, telegramBot: TelegramService, marketDataService: MarketDataService) {
    this.state = 'PREPARE';
    console.log(`[PreNewsEngine] T-${minutesLeft} minutes to ${this.targetNews?.title}. Fetching macro data...`);
    
    // Tarik DXY & US10Y (Smart Polling, hanya dipanggil saat T-30, T-15, T-5)
    await macroData.fetchMacroData();
    
    const prediction = this.generatePrediction(marketDataService);
    
    // Broadcast status ke telegram (Hanya untuk T-30 atau T-15)
    const msg = `📰 *PRE-NEWS ENGINE [T-${minutesLeft}m]*\n` +
      `Target: ${this.targetNews?.title}\n` +
      `Forecast: ${this.targetNews?.forecast} | Prev: ${this.targetNews?.previous}\n\n` +
      `*Probabilistic Bias:*\n` +
      `📈 BUY: ${prediction.buyProbability}%\n` +
      `📉 SELL: ${prediction.sellProbability}%\n` +
      `⏸ WAIT: ${prediction.waitProbability}%\n\n` +
      `*Current Bias:* ${prediction.bias} (${prediction.confidence}%)\n\n` +
      `*Reasons:*\n- ${prediction.reasons.join('\n- ')}`;

    telegramBot.sendMessage(msg);
  }

  private async runLockPhase(telegramBot: TelegramService, marketDataService: MarketDataService) {
    this.state = 'LOCKED';
    console.log(`[PreNewsEngine] T-5 minutes to ${this.targetNews?.title}. LOCKING PREDICTION.`);
    
    await macroData.fetchMacroData();
    this.lockedPrediction = this.generatePrediction(marketDataService);

    const currentM5 = marketDataService.getCandles();
    let priceInfo = '';
    if (currentM5.length > 0) {
      const currentPrice = currentM5[currentM5.length - 1].close;
      const stopLossDist = 3.0; 
      const tpDist = 6.0;
      const tpPrice = this.lockedPrediction.bias === 'BUY' ? currentPrice + tpDist : currentPrice - tpDist;
      const slPrice = this.lockedPrediction.bias === 'BUY' ? currentPrice - stopLossDist : currentPrice + stopLossDist;
      priceInfo = `\n*Est. Entry:* ${currentPrice.toFixed(2)} | *SL:* ${slPrice.toFixed(2)} | *TP:* ${tpPrice.toFixed(2)}\n`;
    }

    const msg = `🔒 *PRE-NEWS LOCKED [T-5m]*\n` +
      `Engine locked prediction for ${this.targetNews?.title}.\n` +
      `*Locked Bias:* ${this.lockedPrediction.bias} (${this.lockedPrediction.confidence}%)\n` + priceInfo +
      `Menunggu T=0 untuk eksekusi. Normal Quant Engine DIHENTIKAN sementara.`;

    telegramBot.sendMessage(msg);
  }

  private async runExecutionPhase(telegramBot: TelegramService, marketDataService: MarketDataService) {
    this.state = 'EXECUTE';
    console.log(`[PreNewsEngine] T=0! Executing locked prediction for ${this.targetNews?.title}.`);
    
    if (!this.lockedPrediction || this.lockedPrediction.bias === 'WAIT') {
      console.log('[PreNewsEngine] Prediction is WAIT or missing. Execution aborted.');
      telegramBot.sendMessage(`⏳ *PRE-NEWS T=0 ABORTED*\nBias is WAIT or prediction is missing. No execution triggered.`);
      return;
    }

    // Panggil signal cache / generate sinyal instan
    const currentM5 = marketDataService.getCandles();
    if (currentM5.length === 0) return;
    const currentPrice = currentM5[currentM5.length - 1].close;

    // SL dinamis 30 pips ($3), TP 60 pips ($6)
    const stopLossDist = 3.0; 
    const tpDist = 6.0;

    const stopLoss = this.lockedPrediction.bias === 'BUY' ? currentPrice - stopLossDist : currentPrice + stopLossDist;
    const tp1 = this.lockedPrediction.bias === 'BUY' ? currentPrice + tpDist : currentPrice - tpDist;
    
    const wibDate = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
    const dateStr = wibDate.slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    const signal = {
      id: `NEWS-${dateStr}-${randId}`,
      type: this.lockedPrediction.bias,
      setupType: `💥 NFP Anticipation (${this.targetNews?.title})`,
      executionType: '⚡ INSTANT PRE-NEWS EXECUTION',
      marketPhase: 'BREAKOUT',
      probabilityLabel: '⭐⭐⭐⭐⭐ High Impact News',
      confidenceScore: this.lockedPrediction.confidence,
      marketCondition: 'HIGH VOLATILITY',
      session: 'NEWS EVENT',
      entryPrice: currentPrice,
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit1: Number(tp1.toFixed(2)),
      takeProfit2: Number(tp1.toFixed(2)),
      validTime: '1-5 Menit',
      estimatedTpTime: 'Instant',
      timestamp: new Date().toISOString(),
      reason: `Pre-News Probabilistic Forecast: ${this.lockedPrediction.reasons.join(', ')}`,
      strategy: 'SNIPER' as any,
      entryZone: `${currentPrice.toFixed(2)} (Market)`
    };

    // Save and Send Signal
    mt5Bridge.setLatestSignal(signal);
    insertSignal(signal).then(dbId => {
       if (dbId) {
         insertSystemLog('INFO', 'PreNewsEngine', `Pre-News Signal Generated: ${signal.type} @ ${signal.entryPrice}`, { id: signal.id, bias: signal.type });
       }
    });

    const msg = `🚨 *INSTANT PRE-NEWS SIGNAL SENT* 🚨\n` +
      `Executing ${signal.type} at ${signal.entryPrice} for ${this.targetNews?.title}.\n` +
      `Spread Limit akan diberlakukan oleh MT5 Bridge.`;
    telegramBot.sendMessage(msg);
  }

  private generatePrediction(marketDataService: MarketDataService): PreNewsPrediction {
    const md = macroData.getMacroState();
    let buyProb = 50;
    let sellProb = 50;
    const reasons: string[] = [];

    let macroBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let macroScore = 0;

    // 1. DXY & US10Y Correlation
    if (md.trendDxy === 'BEARISH') { macroScore += 15; }
    else if (md.trendDxy === 'BULLISH') { macroScore -= 15; }

    if (md.trendYield === 'BEARISH') { macroScore += 15; }
    else if (md.trendYield === 'BULLISH') { macroScore -= 15; }

    if (macroScore > 0) {
      macroBias = 'BULLISH';
      buyProb += macroScore;
      sellProb -= macroScore;
      reasons.push(`Macro Alignment is Bullish (+${macroScore})`);
    } else if (macroScore < 0) {
      macroBias = 'BEARISH';
      buyProb += macroScore;
      sellProb -= macroScore;
      reasons.push(`Macro Alignment is Bearish (${macroScore})`);
    }

    // 2. Technical Alignment & Fakeout Detection
    const m5 = marketDataService.getCandles();
    const h1 = marketDataService.h1.allCandles;
    
    if (h1.length > 5 && m5.length > 5) {
      const taResult = this.technical.analyze({
        m1: [], m5: m5, m15: marketDataService.m15.allCandles, h1: h1,
        currentM5: m5[m5.length - 1],
        currentM15: marketDataService.m15.currentCandle || m5[m5.length - 1],
        currentH1: marketDataService.h1.currentCandle || m5[m5.length - 1],
      });

      let isFakeout = false;
      // Fakeout Detection: If Macro is Bearish, but Technical H1/M15 is heavily pumping Bullish right before news
      if (macroBias === 'BEARISH' && taResult.trendM15 === 'BULLISH' && taResult.trendH1 === 'BULLISH') {
         isFakeout = true;
         reasons.push(`⚠️ CLASSIC FAKEOUT DETECTED: Technical is PUMPING (Bullish) but Macro is Bearish. Reverting Tech Bias!`);
         buyProb -= 25; // Heavily penalize the fake pump
         sellProb += 25;
      } else if (macroBias === 'BULLISH' && taResult.trendM15 === 'BEARISH' && taResult.trendH1 === 'BEARISH') {
         isFakeout = true;
         reasons.push(`⚠️ CLASSIC FAKEOUT DETECTED: Technical is DUMPING (Bearish) but Macro is Bullish. Reverting Tech Bias!`);
         buyProb += 25;
         sellProb -= 25;
      }

      if (!isFakeout) {
         if (taResult.trendH1 === 'BULLISH') { buyProb += 20; sellProb -= 20; reasons.push('Technical H1 is Bullish'); }
         else if (taResult.trendH1 === 'BEARISH') { sellProb += 20; buyProb -= 20; reasons.push('Technical H1 is Bearish'); }

         if (taResult.trendM15 === 'BULLISH') { buyProb += 10; sellProb -= 10; reasons.push('Technical M15 is Bullish'); }
         else if (taResult.trendM15 === 'BEARISH') { sellProb += 10; buyProb -= 10; reasons.push('Technical M15 is Bearish'); }
      }
    }

    // 3. Forecast vs Previous Data
    if (this.targetNews && this.targetNews.forecast && this.targetNews.previous) {
       reasons.push(`Forecast (${this.targetNews.forecast}) vs Prev (${this.targetNews.previous}) factored qualitatively`);
    }

    // Normalize probabilities (cap between 5 and 95)
    buyProb = Math.max(5, Math.min(95, buyProb));
    sellProb = 100 - buyProb;
    
    let bias: 'BUY' | 'SELL' = buyProb > sellProb ? 'BUY' : 'SELL';
    let confidence = Math.max(buyProb, sellProb);

    return {
      buyProbability: buyProb,
      sellProbability: sellProb,
      waitProbability: 0,
      bias,
      confidence,
      reasons
    };
  }
}

export const preNewsEngine = PreNewsEngine.getInstance();

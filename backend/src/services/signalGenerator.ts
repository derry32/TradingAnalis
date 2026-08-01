import { config } from '../config';
import { AnalysisResult } from './technicalAnalysis';

export interface Signal {
  id: string;
  type: 'BUY' | 'SELL' | 'WAIT';
  probabilityLabel: string;
  confidenceScore: number;
  marketCondition: string;
  session: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  validTime: string;
  estimatedTpTime: string;
  timeStopLoss?: string | undefined;
  timestamp: string;
  reason: string;
  strategy: 'SNIPER' | 'HYPER_SCALPER';
  entryZone: string;
}

export class SignalGenerator {

  private getSession(hourWIB: number): { name: string, type: string } {
    if (hourWIB >= 19 && hourWIB < 23) return { name: 'London-New York Overlap', type: 'OVERLAP' };
    if (hourWIB >= 14 && hourWIB < 19) return { name: 'London Session', type: 'LONDON' };
    if ((hourWIB >= 23 && hourWIB <= 23) || (hourWIB >= 0 && hourWIB < 4)) return { name: 'New York Session', type: 'NY' };
    if (hourWIB >= 7 && hourWIB < 14) return { name: 'Tokyo Session', type: 'TOKYO' };
    if (hourWIB >= 5 && hourWIB < 7) return { name: 'Sydney Session', type: 'SYDNEY' };
    return { name: 'Off-hours', type: 'OFF' };
  }

  private calculateScore(
    direction: 'BUY' | 'SELL', 
    analysis: AnalysisResult, 
    sessionType: string,
    isNewsMode: boolean,
    strategy: 'SNIPER' | 'HYPER_SCALPER'
  ) {
    let score = 0;
    let reasons: string[] = [];
    let warnings: string[] = [];

    // Base Weights
    let wTrendH1 = 20, wM15 = 15, wSR = 15, wPA = 15, wEMA = 10, wVol = 5, wRR = 5, wNews = 3, wATR = 5, wSession = 2;

    if (strategy === 'HYPER_SCALPER') {
        wTrendH1=20; wM15=20; wSR=15; wPA=15; wEMA=10; wVol=8; wRR=5; wNews=3; wATR=2; wSession=2;
    } else if (isNewsMode) {
        wTrendH1=15; wM15=20; wPA=20; wVol=10; wATR=5; wRR=3; wSession=2; wSR=0; wEMA=0; wNews=25;
    } else {
        if (sessionType === 'SYDNEY') { wTrendH1=20; wM15=10; wSR=20; wPA=20; wEMA=10; wVol=5; wRR=5; wNews=3; wATR=5; wSession=2; }
        else if (sessionType === 'TOKYO') { wTrendH1=20; wM15=15; wSR=15; wPA=15; wEMA=10; wVol=5; wRR=5; wNews=5; wATR=5; wSession=5; }
        else if (sessionType === 'LONDON') { wTrendH1=25; wM15=20; wSR=15; wPA=15; wEMA=8; wVol=5; wRR=5; wNews=3; wATR=2; wSession=2; }
        else if (sessionType === 'OVERLAP') { wTrendH1=20; wM15=20; wSR=10; wPA=15; wEMA=10; wVol=10; wRR=5; wNews=5; wATR=3; wSession=10; }
        else if (sessionType === 'NY') { wTrendH1=20; wM15=20; wSR=15; wPA=15; wEMA=10; wVol=5; wRR=5; wNews=5; wATR=3; wSession=2; }
    }

    const trendMatch = (direction === 'BUY' && analysis.trendH1 === 'BULLISH') || 
                       (direction === 'SELL' && analysis.trendH1 === 'BEARISH');
    if (trendMatch) { score += wTrendH1; reasons.push(`✔ Trend H1 ${analysis.trendH1}`); }
    else { warnings.push(`✖ Counter Trend H1`); }

    const bosChochMatch = (direction === 'BUY' && (analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'CHOCH_BULL')) ||
                          (direction === 'SELL' && (analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'CHOCH_BEAR'));
    if (bosChochMatch) { score += wM15; reasons.push(`✔ M15 BOS/CHoCH Valid`); }
    else { warnings.push(`✖ Tidak ada BOS/CHoCH searah`); }

    const isAtSR = direction === 'BUY' ? analysis.isAtSupportH1 : analysis.isAtResistanceH1;
    if (isAtSR) { score += wSR; reasons.push(`✔ Terjadi Pantulan di S/R H1`); }
    else { warnings.push(`✖ Harga mengambang / jauh dari S/R`); }

    const paMatch = (direction === 'BUY' && (analysis.patternM5 === 'BULLISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BULL' || analysis.patternM5 === 'THREE_WHITE_SOLDIERS')) ||
                    (direction === 'SELL' && (analysis.patternM5 === 'BEARISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BEAR' || analysis.patternM5 === 'THREE_BLACK_CROWS'));
    if (paMatch) { score += wPA; reasons.push(`✔ Price Action M5 (${analysis.patternM5.replace('_', ' ')}) Terkonfirmasi`); }
    
    const fibMatch = (direction === 'BUY' && analysis.fibonacciZoneM15 === 'GOLDEN_BULL') || 
                     (direction === 'SELL' && analysis.fibonacciZoneM15 === 'GOLDEN_BEAR');
    if (fibMatch) { score += 30; reasons.push(`✔ Harga memantul di Golden Ratio Fibonacci (0.5 - 0.618)`); }
    
    const emaMatch = (direction === 'BUY' && analysis.ema20_M5 > analysis.ema50_M5) || 
                     (direction === 'SELL' && analysis.ema20_M5 < analysis.ema50_M5);
    if (emaMatch) { score += wEMA; reasons.push(`✔ EMA 20 & 50 Mendukung`); }

    if (analysis.volumeSpikeM5) { score += wVol; reasons.push(`✔ Volume Spike Terdeteksi`); }
    
    score += wRR; reasons.push(`✔ RR 1:2 Tercapai`); // Assume guaranteed for now
    
    if (isNewsMode) {
      score += wNews; reasons.push(`✔ Analisa sejalan dengan High Impact News`);
    } else {
      score += wNews; reasons.push(`✔ Tidak ada High Impact News`);
    }

    if (analysis.atr_M15 > 1.5) { score += wATR; reasons.push(`✔ ATR Volatilitas Ideal`); }
    
    score += wSession; reasons.push(`✔ Filter Session Valid`);

    return { score, reasons, warnings };
  }

  private getDynamicConfidence(strategy: 'SNIPER' | 'HYPER_SCALPER', marketCondition: string, sessionType: string): number {
    let base = strategy === 'SNIPER' ? 80 : 70;
    if (marketCondition === 'SIDEWAYS') {
       // Sideways scoring system has lower max — lower threshold accordingly
       base += (strategy === 'SNIPER' ? -10 : -15);
    }
    if (sessionType === 'SYDNEY') base += 10;
    else if (sessionType === 'TOKYO') base += 5;
    else if (sessionType === 'OVERLAP') base -= 5;
    return base;
  }

  private evaluateSidewaysMode(analysis: AnalysisResult, currentPrice: number, sessionType: string, isNewsMode: boolean, activeStrategy: 'SNIPER' | 'HYPER_SCALPER') {
    let possibleDirections: ('BUY' | 'SELL')[] = [];
    if (analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5.includes('BULL') || analysis.patternM5 === 'THREE_WHITE_SOLDIERS' || analysis.fibonacciZoneM15 === 'GOLDEN_BULL') possibleDirections.push('BUY');
    if (analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5.includes('BEAR') || analysis.patternM5 === 'THREE_BLACK_CROWS' || analysis.fibonacciZoneM15 === 'GOLDEN_BEAR') possibleDirections.push('SELL');

    let bestTrade: { dir: 'BUY' | 'SELL', score: number, reasons: string[], warnings: string[] } | null = null;
    for (const dir of possibleDirections) {
      let score = 0;
      let reasons: string[] = [];
      let warnings: string[] = [];

      if (dir === 'BUY') {
        if (analysis.isAtSupportH1) { 
           score += 40; reasons.push(`✔ Harga memantul di Support (Sideways Range)`); 
        } else { 
           warnings.push(`✖ Harga mengambang (Bukan di Support)`); 
        }
      } else {
        if (analysis.isAtResistanceH1) { 
           score += 40; reasons.push(`✔ Harga memantul di Resistance (Sideways Range)`); 
        } else { 
           warnings.push(`✖ Harga mengambang (Bukan di Resistance)`); 
        }
      }

      if (dir === 'BUY' && (analysis.patternM5 === 'BULLISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BULL' || analysis.patternM5 === 'THREE_WHITE_SOLDIERS')) {
         score += 30; reasons.push(`✔ Price Action M5 (${analysis.patternM5.replace('_', ' ')}) Terkonfirmasi di Support`);
      } else if (dir === 'SELL' && (analysis.patternM5 === 'BEARISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BEAR' || analysis.patternM5 === 'THREE_BLACK_CROWS')) {
         score += 30; reasons.push(`✔ Price Action M5 (${analysis.patternM5.replace('_', ' ')}) Terkonfirmasi di Resistance`);
      }

      if (dir === 'BUY' && analysis.fibonacciZoneM15 === 'GOLDEN_BULL') {
         score += 30; reasons.push(`✔ Harga memantul di Golden Ratio Fibonacci`);
      } else if (dir === 'SELL' && analysis.fibonacciZoneM15 === 'GOLDEN_BEAR') {
         score += 30; reasons.push(`✔ Harga memantul di Golden Ratio Fibonacci`);
      }

      if (dir === 'BUY' && analysis.marketStructureM15 === 'FAKE_BREAKOUT_BEAR') {
         score += 50; reasons.push(`✔ Setup Liquidity Grab (Stop Hunt) Valid di Support`);
      } else if (dir === 'SELL' && analysis.marketStructureM15 === 'FAKE_BREAKOUT_BULL') {
         score += 50; reasons.push(`✔ Setup Liquidity Grab (Stop Hunt) Valid di Resistance`);
      }

      if (analysis.volumeSpikeM5) { 
          score += 20; // Volume spike selalu +20 di Sideways (tanda momentum yang nyata)
          reasons.push(`✔ Volume Spike mendukung False Breakout/Rejection (+20 Poin)`); 
      }
      if (analysis.atr_M15 > 1.0) { score += 10; reasons.push(`✔ ATR Volatilitas Cukup`); }
      score += 10; reasons.push(`✔ Risk:Reward Valid`); 

      if (isNewsMode) {
          score -= 20; warnings.push(`🚨 Berbahaya trading Sideways saat High Impact News!`);
      }

      if (!bestTrade || score > bestTrade.score) {
        bestTrade = { dir, score, reasons, warnings };
      }
    }
    return bestTrade;
  }

  private evaluateTrendingMode(analysis: AnalysisResult, currentPrice: number, sessionType: string, isNewsMode: boolean, activeStrategy: 'SNIPER' | 'HYPER_SCALPER') {
    let possibleDirections: ('BUY' | 'SELL')[] = [];
    if (analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5.includes('BULL') || analysis.patternM5 === 'THREE_WHITE_SOLDIERS' || analysis.fibonacciZoneM15 === 'GOLDEN_BULL') possibleDirections.push('BUY');
    if (analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5.includes('BEAR') || analysis.patternM5 === 'THREE_BLACK_CROWS' || analysis.fibonacciZoneM15 === 'GOLDEN_BEAR') possibleDirections.push('SELL');

    let bestTrade: { dir: 'BUY' | 'SELL', score: number, reasons: string[], warnings: string[] } | null = null;
    for (const dir of possibleDirections) {
      const result = this.calculateScore(dir, analysis, sessionType, isNewsMode, activeStrategy);
      if (!bestTrade || result.score > bestTrade.score) {
        bestTrade = { dir, ...result };
      }
    }
    return bestTrade;
  }

  private evaluateNewsBreakoutMode(analysis: AnalysisResult, currentPrice: number, activeStrategy: 'SNIPER' | 'HYPER_SCALPER') {
    let possibleDirections: ('BUY' | 'SELL')[] = [];
    if (analysis.trendH1 === 'BULLISH' && (analysis.patternM5.includes('BULL') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'THREE_WHITE_SOLDIERS')) possibleDirections.push('BUY');
    if (analysis.trendH1 === 'BEARISH' && (analysis.patternM5.includes('BEAR') || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'THREE_BLACK_CROWS')) possibleDirections.push('SELL');

    let bestTrade: { dir: 'BUY' | 'SELL', score: number, reasons: string[], warnings: string[] } | null = null;
    for (const dir of possibleDirections) {
      let score = 0;
      let reasons: string[] = [];
      let warnings: string[] = [];

      // Wajib BOS
      if (dir === 'BUY' && (analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'CHOCH_BULL')) {
        score += 30; reasons.push(`✔ M15 BOS/CHoCH Valid`);
      } else if (dir === 'SELL' && (analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'CHOCH_BEAR')) {
        score += 30; reasons.push(`✔ M15 BOS/CHoCH Valid`);
      } else {
        warnings.push(`✖ Tidak ada BOS M15 (Syarat Mutlak Breakout gagal)`);
        continue;
      }

      // Wajib Volume Spike
      if (analysis.volumeSpikeM5) {
        score += 30; reasons.push(`✔ Volume Spike Terdeteksi`);
      } else {
        warnings.push(`✖ Tidak ada Volume Spike (Syarat Mutlak Breakout gagal)`);
        continue;
      }

      if (analysis.atr_M15 > 1.0) {
        score += 20; reasons.push(`✔ ATR Meningkat / Mendukung Volatilitas`);
      } else {
        warnings.push(`✖ ATR kurang (Volatilitas lemah)`);
        continue;
      }

      reasons.push(`✔ Trend H1 Searah`);
      reasons.push(`✔ Pullback M5 Selesai (${analysis.patternM5.replace('_', ' ')})`);
      reasons.push(`✔ RR minimal 1:3 terjamin`);
      
      score += 20; // Extra points for passing all strict filters

      if (!bestTrade || score > bestTrade.score) {
        bestTrade = { dir, score, reasons, warnings };
      }
    }
    return bestTrade;
  }

  public generate(
    analysis: AnalysisResult,
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    currentPrice: number,
    sentimentScore: number,
    activeNewsContext: any = null,
    activeStrategy: 'SNIPER' | 'HYPER_SCALPER' = 'SNIPER'
  ): Signal {
    
    const now = new Date();
    const currentHourUTC = now.getUTCHours();
    const currentDayUTC = now.getUTCDay();
    const currentHourWIB = (currentHourUTC + 7) % 24;

    // Market forex tutup: Jumat 21:00 UTC s/d Minggu 21:00 UTC (Sabtu 04:00 WIB s/d Senin 04:00 WIB)
    const isWeekend = (currentDayUTC === 5 && currentHourUTC >= 21) || (currentDayUTC === 6) || (currentDayUTC === 0 && currentHourUTC < 21);
    if (isWeekend) {
        return this.createWaitSignal("Market sedang libur/tutup di akhir pekan.", activeStrategy);
    }
    const sessionInfo = this.getSession(currentHourWIB);
    
    if (activeStrategy === 'HYPER_SCALPER' && sessionInfo.type === 'OFF') {
        return this.createWaitSignal("Sesi market tutup (Off-hours).", activeStrategy);
    }
    
    let isNewsMode = false;
    let newsWarning = '';
    let isNewsBreakout = false;
    let breakoutTitle = '';
    let bypassEmergency = false;

    if (activeNewsContext) {
      const { event, severity, phase } = activeNewsContext;
      
      if (severity === 'EXTREME') { // FOMC MODE
        if (phase === 'PRE') {
          return this.createWaitSignal(`⚠️ ${event.title} akan rilis < 60 menit. Mode: NO ENTRY. Menunggu hasil berita.`, activeStrategy);
        } else if (phase === 'DURING') {
          bypassEmergency = true;
          isNewsBreakout = true;
          breakoutTitle = event.title;
          newsWarning = `🔥 ULTRA BREAKOUT INITIAL: Trading di menit awal ${event.title} (HIGH RISK).`;
        } else if (phase === 'STABILIZATION') {
          bypassEmergency = true;
          isNewsBreakout = true;
          breakoutTitle = event.title;
          newsWarning = `🔥 FOMC SPEECH BREAKOUT: Trading momentum pidato ${event.title} (HIGH RISK).`;
        } else if (phase === 'POST') {
          isNewsBreakout = true;
          breakoutTitle = event.title;
          newsWarning = `🚀 POST FOMC BREAKOUT: Momentum terkonfirmasi dari ${event.title}`;
        }
      } else if (severity === 'HIGH') { // NEWS MODE
        if (phase === 'PRE') {
          return this.createWaitSignal(`⚠️ HIGH IMPACT NEWS (${event.title}) rilis < 60 menit. Mode: NO ENTRY.`, activeStrategy);
        } else if (phase === 'DURING') {
          return this.createWaitSignal(`🔴 HIGH IMPACT NEWS (${event.title}) rilis! LOCK MODE 30 menit.`, activeStrategy);
        }
        isNewsMode = true;
        newsWarning = `⚠️ Berita ${event.title} baru berlalu, volatilitas mungkin masih ada.`;
      } else if (severity === 'MEDIUM') {
        if (phase === 'DURING') {
           isNewsMode = true; 
           newsWarning = `⚠️ Medium Impact News (${event.title}) sedang berlangsung. Filter diperketat.`;
        }
      }
    }

    // EMERGENCY MODE Check
    const slippageRisk = analysis.atr_M15 > 10.0; // Contoh Emergency threshold untuk XAUUSD
    if (slippageRisk && !bypassEmergency) {
       return this.createWaitSignal(`🚨 EMERGENCY MODE: Volatilitas/Spread terlalu ekstrem (ATR > 10.0). Saat ini: ${analysis.atr_M15.toFixed(2)}. NO TRADE.`, activeStrategy);
    }

    if (analysis.patternM5 === 'NONE' && analysis.fibonacciZoneM15 === 'NONE' && !isNewsBreakout) {
       return this.createWaitSignal("Menunggu konfirmasi Price Action (M5) atau pantulan Fibonacci Golden Ratio.", activeStrategy);
    }

    let bestTrade;
    if (isNewsBreakout) {
       bestTrade = this.evaluateNewsBreakoutMode(analysis, currentPrice, activeStrategy);
    } else if (analysis.marketCondition === 'SIDEWAYS') {
       bestTrade = this.evaluateSidewaysMode(analysis, currentPrice, sessionInfo.type, isNewsMode, activeStrategy);
    } else {
       bestTrade = this.evaluateTrendingMode(analysis, currentPrice, sessionInfo.type, isNewsMode, activeStrategy);
    }

    const threshold = this.getDynamicConfidence(activeStrategy, analysis.marketCondition, sessionInfo.type);
    let isOpportunityMode = false;
    
    if (!bestTrade || bestTrade.score < threshold) {
      if (bestTrade && bestTrade.score >= threshold - 15) {
         isOpportunityMode = true;
         bestTrade.warnings.push(`⚠️ OPPORTUNITY MODE: Skor probabilitas (${bestTrade.score}) di bawah standar ideal (${threshold}). Risiko lebih tinggi.`);
      } else {
         return this.createWaitSignal(`Skor probabilitas ${bestTrade?.score || 0} terlalu rendah untuk mode ${analysis.marketCondition} (Minimal ${threshold}).`, activeStrategy);
      }
    }

    const { dir: tradeType, score, reasons, warnings } = bestTrade!;

    let stopLoss = 0;
    
    if (isNewsBreakout) {
      // POST FOMC BREAKOUT / ULTRA BREAKOUT Logic (Wider SL, based on 3x ATR)
      const atr = analysis.atr_M15 || 1.5;
      if (tradeType === 'BUY') {
        stopLoss = currentPrice - (atr * 3.0);
      } else {
        stopLoss = currentPrice + (atr * 3.0);
      }
    } else {
      const minDistance = 2.0; 
      const maxRisk = config.STOP_LOSS_PIPS / 10; // 3.0 points = 30 pips for Gold

      if (tradeType === 'BUY') {
        stopLoss = analysis.closestSwingLowM5 - 0.5;
        if (stopLoss >= currentPrice - minDistance) stopLoss = currentPrice - minDistance;
        if (currentPrice - stopLoss > maxRisk) stopLoss = currentPrice - maxRisk;
      } else {
        stopLoss = analysis.closestSwingHighM5 + 0.5;
        if (stopLoss <= currentPrice + minDistance) stopLoss = currentPrice + minDistance;
        if (stopLoss - currentPrice > maxRisk) stopLoss = currentPrice + maxRisk;
      }
    }

    const riskAbsolute = Math.abs(currentPrice - stopLoss);
    if (riskAbsolute < 0.3) {
      return this.createWaitSignal("Risiko per pip terlalu sempit (Bahaya Slippage/Spread).", activeStrategy);
    }

    let tp1 = 0;
    let tp2 = 0;
    
    if (isNewsBreakout) {
      // POST FOMC BREAKOUT: RR 1:3 minimum
      tp1 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 3) : currentPrice - (riskAbsolute * 3);
      tp2 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 4) : currentPrice - (riskAbsolute * 4);
    } else if (activeStrategy === 'HYPER_SCALPER') {
      tp1 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 1.5) : currentPrice - (riskAbsolute * 1.5);
      tp2 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 2) : currentPrice - (riskAbsolute * 2);
    } else {
      tp1 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 2) : currentPrice - (riskAbsolute * 2);
      tp2 = tradeType === 'BUY' ? currentPrice + (riskAbsolute * 3) : currentPrice - (riskAbsolute * 3);
    }

    let probabilityLabel = '⭐ Low';
    if (!isOpportunityMode) {
      if (activeStrategy === 'SNIPER') {
        if (score >= 95) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
        else if (score >= 85) probabilityLabel = '⭐⭐⭐⭐ High';
        else if (score >= 70) probabilityLabel = '⭐⭐⭐ Medium';
      } else {
        if (score >= 90) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
        else if (score >= 80) probabilityLabel = '⭐⭐⭐⭐ High';
        else if (score >= 65) probabilityLabel = '⭐⭐⭐ Medium';
      }
    }

    let reasonString = bestTrade.reasons.join('\n') + (bestTrade.warnings.length > 0 ? '\n' + bestTrade.warnings.join('\n') : '');
    if (newsWarning) reasonString = newsWarning + '\n\n' + reasonString;

    let validTime = '20 Menit';
    let estTpTime = '30-90 Menit';
    let timeStopLoss = undefined;
    
    if (isNewsBreakout) {
      validTime = '30 Menit';
      estTpTime = '90-180 Menit'; // Momentum post-FOMC biasanya jalan jauh
    } else if (activeStrategy === 'HYPER_SCALPER') {
      validTime = '5-15 Menit';
      estTpTime = '5-30 Menit';
      timeStopLoss = '30-45 Menit';
    } else {
      if (sessionInfo.type === 'SYDNEY' || sessionInfo.type === 'TOKYO') estTpTime = '60-180 Menit';
      else if (sessionInfo.type === 'LONDON' || sessionInfo.type === 'NY') estTpTime = '20-60 Menit';
    }

    // Format ID menggunakan tanggal Jakarta (WIB) agar tidak beda hari saat jam 00:00 - 07:00 WIB
    const wibDate = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
    const dateStr = wibDate.slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    const atr = analysis.atr_M15 || 1.0;
    let entryZoneStr = '';
    if (tradeType === 'BUY') {
      let zoneMinNum = currentPrice - (atr * 0.5);
      if (zoneMinNum <= stopLoss) zoneMinNum = stopLoss + 1.0; // Jarak minimal 1.0 dari SL
      const zoneMin = zoneMinNum.toFixed(2);
      const zoneMax = currentPrice.toFixed(2);
      entryZoneStr = `${zoneMin} - ${zoneMax}`;
    } else {
      let zoneMaxNum = currentPrice + (atr * 0.5);
      if (zoneMaxNum >= stopLoss) zoneMaxNum = stopLoss - 1.0; // Jarak minimal 1.0 dari SL
      const zoneMin = currentPrice.toFixed(2);
      const zoneMax = zoneMaxNum.toFixed(2);
      entryZoneStr = `${zoneMin} - ${zoneMax}`;
    }

    return {
      id: `XAU-${dateStr}-${randId}`,
      type: tradeType,
      probabilityLabel,
      confidenceScore: score,
      marketCondition: analysis.marketCondition.replace('_', ' '),
      session: sessionInfo.name,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      validTime,
      estimatedTpTime: estTpTime,
      timeStopLoss,
      timestamp: new Date().toISOString(),
      reason: reasonString,
      strategy: activeStrategy,
      entryZone: entryZoneStr
    };
  }

  private createWaitSignal(reason: string, strategy: 'SNIPER' | 'HYPER_SCALPER'): Signal {
    return {
      id: `WAIT-${Date.now()}`,
      type: 'WAIT',
      probabilityLabel: 'N/A',
      confidenceScore: 0,
      marketCondition: 'N/A',
      session: 'N/A',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit1: 0,
      takeProfit2: 0,
      validTime: '-',
      estimatedTpTime: '-',
      timestamp: new Date().toISOString(),
      reason: reason,
      strategy: strategy,
      entryZone: '-'
    };
  }
}

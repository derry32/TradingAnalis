import { config } from '../config';
import { AnalysisResult } from './technicalAnalysis';

export interface Signal {
  id: string;
  type: 'BUY' | 'SELL' | 'WAIT';
  setupType?: string;
  marketPhase?: string;
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

  private determineSetupType(
    direction: 'BUY' | 'SELL',
    analysis: AnalysisResult,
    isNewsBreakout: boolean
  ): string {
    if (isNewsBreakout) return '💥 Breakout (High Impact News)';
    
    if (analysis.marketStructureM15.includes('FAKE_BREAKOUT')) {
      return '🪤 Liquidity Grab (Stop Hunt)';
    }

    if (analysis.marketPhase === 'BREAKOUT' || analysis.marketStructureM15.includes('BOS')) {
      return '💥 Breakout Momentum';
    }

    if (analysis.marketPhase === 'PULLBACK' || analysis.fibonacciZoneM15 !== 'NONE') {
      return '🔄 Pullback Entry (Golden Zone)';
    }

    if (analysis.marketPhase === 'RANGE' || analysis.structureH1 === 'EQUAL_RANGE') {
      return direction === 'BUY' ? '📦 Range Buy (Support Bound)' : '📦 Range Sell (Resistance Bound)';
    }

    if (analysis.isAtSupportH1 || analysis.isAtResistanceH1) {
      return '🔁 S/R Key Level Reversal';
    }

    return '📈 Trend Continuation';
  }

  private calculateScoreV2(
    direction: 'BUY' | 'SELL',
    analysis: AnalysisResult,
    sessionType: string,
    isNewsMode: boolean,
    strategy: 'SNIPER' | 'HYPER_SCALPER',
    roomPenalty: number
  ) {
    let score = 0;
    let reasons: string[] = [];
    let warnings: string[] = [];

    // 100-Point Institutional Scoring Matrix
    // 1. Trend H1 (25 Poin)
    const trendMatch = (direction === 'BUY' && analysis.trendH1 === 'BULLISH') || 
                       (direction === 'SELL' && analysis.trendH1 === 'BEARISH');
    if (trendMatch) { 
      score += 25; 
      reasons.push(`✔ Trend H1 ${analysis.trendH1} (+25)`); 
    } else if (analysis.trendH1 === 'NEUTRAL') {
      score += 10;
      reasons.push(`✔ Trend H1 Netral/Sideways Range (+10)`);
    } else { 
      warnings.push(`✖ Counter Trend H1 (0 Poin)`); 
    }

    // 2. Market Structure H1 (20 Poin)
    const structMatch = (direction === 'BUY' && analysis.structureH1 === 'HH_HL') ||
                        (direction === 'SELL' && analysis.structureH1 === 'LH_LL');
    if (structMatch) {
      score += 20;
      reasons.push(`✔ Market Structure H1 (${analysis.structureH1}) Terkonfirmasi (+20)`);
    } else if (analysis.structureH1 === 'EQUAL_RANGE') {
      score += 15;
      reasons.push(`✔ Struktur Range/Sideways Teratur (+15)`);
    } else {
      warnings.push(`✖ Struktur H1 belum rapi (0 Poin)`);
    }

    // 3. BOS / CHoCH M15 (15 Poin)
    const bosChochMatch = (direction === 'BUY' && (analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'CHOCH_BULL')) ||
                          (direction === 'SELL' && (analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'CHOCH_BEAR'));
    if (bosChochMatch) { 
      score += 15; 
      reasons.push(`✔ M15 BOS/CHoCH Valid (+15)`); 
    } else if (analysis.marketStructureM15.includes('FAKE_BREAKOUT')) {
      score += 15;
      reasons.push(`✔ Liquidity Grab / Stop Hunt M15 Terdeteksi (+15)`);
    } else { 
      warnings.push(`✖ Tidak ada BOS/CHoCH searah (0 Poin)`); 
    }

    // 4. Key Level S/R H1 & Fibonacci (15 Poin)
    const isAtSR = direction === 'BUY' ? analysis.isAtSupportH1 : analysis.isAtResistanceH1;
    const fibMatch = (direction === 'BUY' && analysis.fibonacciZoneM15 === 'GOLDEN_BULL') || 
                     (direction === 'SELL' && analysis.fibonacciZoneM15 === 'GOLDEN_BEAR');
    if (isAtSR || fibMatch) { 
      score += 15; 
      reasons.push(`✔ Pantulan S/R H1 / Fibonacci Golden Ratio (+15)`); 
    } else { 
      warnings.push(`✖ Harga mengambang / jauh dari S/R (0 Poin)`); 
    }

    // 5. Price Action Trigger M5 (10 Poin)
    const paMatch = (direction === 'BUY' && (analysis.patternM5 === 'BULLISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BULL' || analysis.patternM5 === 'THREE_WHITE_SOLDIERS')) ||
                    (direction === 'SELL' && (analysis.patternM5 === 'BEARISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BEAR' || analysis.patternM5 === 'THREE_BLACK_CROWS'));
    if (paMatch) { 
      score += 10; 
      reasons.push(`✔ Price Action M5 (${analysis.patternM5.replace('_', ' ')}) Valid (+10)`); 
    } else {
      warnings.push(`✖ Konfirmasi Candle M5 Kurang Tegas (0 Poin)`);
    }

    // 6. Institutional Volume (10 Poin)
    if (analysis.strongVolumeM5) {
      score += 10;
      reasons.push(`✔ Institutional Volume Kuat (Spike + Solid Body + Extreme Close) (+10)`);
    } else if (analysis.volumeSpikeM5) {
      score += 6;
      reasons.push(`✔ Volume Spike Terdeteksi (+6)`);
    }

    // 7. Multi-Timeframe Alignment (5 Poin)
    const mtfAligned = (direction === 'BUY' && (analysis.trendH1 === 'BULLISH' || analysis.marketPhase === 'TRENDING') && paMatch) ||
                       (direction === 'SELL' && (analysis.trendH1 === 'BEARISH' || analysis.marketPhase === 'TRENDING') && paMatch);
    if (mtfAligned) {
      score += 5;
      reasons.push(`✔ Multi-Timeframe Alignment (H1-M15-M5 Selaras) (+5)`);
    }

    // Kurangi penalti Room jika berada di Tier 2 (1.5x - 1.8x SL)
    if (roomPenalty > 0) {
      score -= roomPenalty;
      warnings.push(`⚠️ Penalti Ruang ke Target (Tier 2 RR 1.5-1.8x): -${roomPenalty} Poin`);
    }

    // Penalti Momentum Exhaustion (jika sudah lari 6 candle sejenis)
    if (analysis.consecutiveCandlesM5.count >= 6 && 
        ((direction === 'BUY' && analysis.consecutiveCandlesM5.direction === 'BULLISH') || 
         (direction === 'SELL' && analysis.consecutiveCandlesM5.direction === 'BEARISH'))) {
      score -= 10;
      warnings.push(`⚠️ Momentum Exhaustion Guard: Sudah reli ${analysis.consecutiveCandlesM5.count} candle sejenis berturut-turut (-10 Poin)`);
    }

    return { score, reasons, warnings };
  }

  public generate(
    analysis: AnalysisResult,
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    currentPrice: number,
    sentimentScore: number,
    activeNewsContext: any = null,
    activeStrategy: 'SNIPER' | 'HYPER_SCALPER' = 'HYPER_SCALPER'
  ): Signal {
    
    const now = new Date();
    const currentHourUTC = now.getUTCHours();
    const currentDayUTC = now.getUTCDay();
    const currentHourWIB = (currentHourUTC + 7) % 24;

    // 1. Weekend Guard (Sabtu 04:00 WIB s/d Senin 04:00 WIB)
    const isWeekend = (currentDayUTC === 5 && currentHourUTC >= 21) || (currentDayUTC === 6) || (currentDayUTC === 0 && currentHourUTC < 21);
    if (isWeekend) {
        return this.createWaitSignal("Market sedang libur/tutup di akhir pekan.", activeStrategy);
    }

    const sessionInfo = this.getSession(currentHourWIB);
    if (activeStrategy === 'HYPER_SCALPER' && sessionInfo.type === 'OFF') {
        return this.createWaitSignal("Sesi market tutup (Off-hours).", activeStrategy);
    }

    // 2. News Hard Filter
    let isNewsMode = false;
    let newsWarning = '';
    let isNewsBreakout = false;
    let bypassEmergency = false;

    if (activeNewsContext) {
      const { event, severity, phase } = activeNewsContext;
      
      if (severity === 'EXTREME') {
        if (phase === 'PRE') {
          return this.createWaitSignal(`⚠️ ${event.title} rilis < 60 menit. Hard Filter: Menahan posisi.`, activeStrategy);
        } else if (phase === 'DURING') {
          bypassEmergency = true;
          isNewsBreakout = true;
          newsWarning = `🔥 ULTRA BREAKOUT INITIAL: Trading momentum awal ${event.title}`;
        } else if (phase === 'STABILIZATION' || phase === 'POST') {
          isNewsBreakout = true;
          newsWarning = `🚀 POST FOMC BREAKOUT: Momentum terkonfirmasi dari ${event.title}`;
        }
      } else if (severity === 'HIGH') {
        if (phase === 'PRE') {
          return this.createWaitSignal(`⚠️ HIGH IMPACT NEWS (${event.title}) rilis < 20 menit. Hard Filter: Lock Mode.`, activeStrategy);
        } else if (phase === 'DURING') {
          return this.createWaitSignal(`🔴 HIGH IMPACT NEWS (${event.title}) sedang rilis. Hard Filter: Lock Mode.`, activeStrategy);
        }
        isNewsMode = true;
        newsWarning = `⚠️ Berita ${event.title} baru berlalu, volatilitas tinggi.`;
      }
    }

    // 3. Volatility Hard Filters (Spread / Slippage Protection)
    const atr = analysis.atr_M15 || 1.5;
    if (atr > 10.0 && !bypassEmergency) {
      return this.createWaitSignal(`🚨 EMERGENCY MODE: Volatilitas terlalu liar (ATR ${atr.toFixed(2)} > 10.0). NO TRADE.`, activeStrategy);
    }
    if (atr < 1.0) {
      return this.createWaitSignal(`⚠️ HARD FILTER: Volatilitas market terlalu mati (ATR ${atr.toFixed(2)} < 1.0). Ruang gerak minim.`, activeStrategy);
    }

    // 4. Momentum Exhaustion Hard Filter (Anti-Pucuk/Lembah jika >= 8 candle)
    if (analysis.consecutiveCandlesM5.count >= 8) {
      return this.createWaitSignal(`⚠️ MOMENTUM EXHAUSTION: Terjadi reli ${analysis.consecutiveCandlesM5.count} candle berturut-turut. Rawan reversal. Menunggu koreksi.`, activeStrategy);
    }

    // 5. Market Phase Check (Jika fase pasar tidak teridentifikasi -> Langsung WAIT)
    if (analysis.marketPhase === 'UNKNOWN') {
      return this.createWaitSignal("Struktur fase pasar (Market Phase) tidak jelas. Menunggu formasi yang rapi.", activeStrategy);
    }

    // 6. Price Action Entry Trigger Check (Minimal 1 konfirmasi wajib)
    const hasTrigger = analysis.patternM5 !== 'NONE' || analysis.fibonacciZoneM15 !== 'NONE' || analysis.marketStructureM15.includes('BOS') || analysis.marketStructureM15.includes('FAKE_BREAKOUT') || isNewsBreakout;
    if (!hasTrigger) {
      return this.createWaitSignal("Menunggu konfirmasi Price Action (M5) atau pantulan Fibonacci Golden Ratio.", activeStrategy);
    }

    // 7. Evaluasi Arah Trade & Dynamic Stop Loss
    let possibleDirections: ('BUY' | 'SELL')[] = [];
    if (analysis.patternM5.includes('BULL') || analysis.patternM5 === 'PIN_BAR' || analysis.fibonacciZoneM15 === 'GOLDEN_BULL' || analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'FAKE_BREAKOUT_BEAR') {
      possibleDirections.push('BUY');
    }
    if (analysis.patternM5.includes('BEAR') || analysis.patternM5 === 'PIN_BAR' || analysis.fibonacciZoneM15 === 'GOLDEN_BEAR' || analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'FAKE_BREAKOUT_BULL') {
      possibleDirections.push('SELL');
    }

    if (possibleDirections.length === 0) {
      return this.createWaitSignal("Tidak ada sinyal arah trading yang valid.", activeStrategy);
    }

    let bestTrade: {
      dir: 'BUY' | 'SELL';
      score: number;
      reasons: string[];
      warnings: string[];
      stopLoss: number;
      tp1: number;
      tp2: number;
      setupType: string;
    } | null = null;

    for (const dir of possibleDirections) {
      // Dynamic Stop Loss Calculation: Swing Point + ATR Buffer
      const atrBuffer = Math.max(1.0, atr * 0.8);
      let calculatedSL = 0;
      if (dir === 'BUY') {
        calculatedSL = analysis.closestSwingLowM5 - atrBuffer;
        if (calculatedSL >= currentPrice - 1.5) calculatedSL = currentPrice - 1.5; // Jarak minimal $1.5 (15 pips)
      } else {
        calculatedSL = analysis.closestSwingHighM5 + atrBuffer;
        if (calculatedSL <= currentPrice + 1.5) calculatedSL = currentPrice + 1.5; // Jarak minimal $1.5 (15 pips)
      }

      const riskDist = Math.abs(currentPrice - calculatedSL);

      // Hard Filter Safety Cap SL (Maksimal $8.0 / 80 pips untuk menghindari setup liar)
      if (riskDist > 8.0) {
        continue; // SL terlalu jauh, abaikan arah ini
      }
      if (riskDist < 0.8) {
        continue; // SL terlalu sempit (bahaya noise)
      }

      // 8. 3-Tier Room to Target Calculation dengan Market Phase Intelligence
      let targetPrice = 0;
      if (analysis.marketPhase === 'RANGE' || analysis.structureH1 === 'EQUAL_RANGE') {
        // Mode Sideways: Target kaku di S/R terdekat
        targetPrice = dir === 'BUY' ? analysis.nearestResistanceH1 : analysis.nearestSupportH1;
      } else {
        // Mode Trending / Breakout: Boleh proyeksikan ke Next S/R atau 2.0x ATR
        if (dir === 'BUY') {
          targetPrice = Math.max(analysis.nextResistanceH1, currentPrice + (atr * 2.0));
        } else {
          targetPrice = Math.min(analysis.nextSupportH1, currentPrice - (atr * 2.0));
        }
      }

      const roomDist = Math.abs(targetPrice - currentPrice);
      const roomRatio = roomDist / riskDist;

      // Tier 3: Room < 1.5x SL -> Reject / WAIT
      if (roomRatio < 1.5) {
        continue; 
      }

      // Tier 2: 1.5 <= Room < 1.8 -> Penalti 8 poin
      let roomPenalty = 0;
      if (roomRatio < 1.8) {
        roomPenalty = 8;
      }

      // Hitung Skor 100-Point Matrix
      const scoreResult = this.calculateScoreV2(dir, analysis, sessionInfo.type, isNewsMode, activeStrategy, roomPenalty);
      
      const setupType = this.determineSetupType(dir, analysis, isNewsBreakout);

      // TP1 = 1:1.8, TP2 = 1:2.5
      const tp1 = dir === 'BUY' ? currentPrice + (riskDist * 1.8) : currentPrice - (riskDist * 1.8);
      const tp2 = dir === 'BUY' ? currentPrice + (riskDist * 2.5) : currentPrice - (riskDist * 2.5);

      if (!bestTrade || scoreResult.score > bestTrade.score) {
        bestTrade = {
          dir,
          score: scoreResult.score,
          reasons: scoreResult.reasons,
          warnings: scoreResult.warnings,
          stopLoss: calculatedSL,
          tp1,
          tp2,
          setupType
        };
      }
    }

    // 9. Strict Threshold Filter: Skor < 50 LANGSUNG WAIT (Blokir Sinyal Lemah!)
    if (!bestTrade || bestTrade.score < 50) {
      const highestScore = bestTrade?.score || 0;
      return this.createWaitSignal(`Skor probabilitas (${highestScore}/100) di bawah ambang batas minimal kelulusan (Minimal 50 Poin).`, activeStrategy);
    }

    const { dir: tradeType, score, reasons, warnings, stopLoss, tp1, tp2, setupType } = bestTrade;

    // 10. Probability Label (5-Star Classification)
    let probabilityLabel = '⭐⭐ Low';
    if (score >= 90) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
    else if (score >= 80) probabilityLabel = '⭐⭐⭐⭐ High';
    else if (score >= 65) probabilityLabel = '⭐⭐⭐ Medium';
    else if (score >= 50) probabilityLabel = '⭐⭐ Low';

    let reasonString = reasons.join('\n') + (warnings.length > 0 ? '\n' + warnings.join('\n') : '');
    if (newsWarning) reasonString = newsWarning + '\n\n' + reasonString;

    // Format Entry Zone Dinamis
    let entryZoneStr = '';
    if (tradeType === 'BUY') {
      const zoneMin = (currentPrice - (atr * 0.4)).toFixed(2);
      const zoneMax = currentPrice.toFixed(2);
      entryZoneStr = `${zoneMin} - ${zoneMax}`;
    } else {
      const zoneMin = currentPrice.toFixed(2);
      const zoneMax = (currentPrice + (atr * 0.4)).toFixed(2);
      entryZoneStr = `${zoneMin} - ${zoneMax}`;
    }

    const wibDate = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
    const dateStr = wibDate.slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    return {
      id: `XAU-${dateStr}-${randId}`,
      type: tradeType,
      setupType,
      marketPhase: analysis.marketPhase || 'RANGE',
      probabilityLabel,
      confidenceScore: score,
      marketCondition: (analysis.marketCondition || 'SIDEWAYS').replace(/_/g, ' '),
      session: sessionInfo.name,
      entryPrice: currentPrice,
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit1: Number(tp1.toFixed(2)),
      takeProfit2: Number(tp2.toFixed(2)),
      validTime: '10-20 Menit',
      estimatedTpTime: '15-45 Menit',
      timeStopLoss: '45-60 Menit',
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
      setupType: '⏳ Waiting for Setup',
      marketPhase: 'N/A',
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

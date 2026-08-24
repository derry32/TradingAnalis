import { config } from '../config';
import { AnalysisResult } from './technicalAnalysis';

export interface Signal {
  id: string;
  type: 'BUY' | 'SELL' | 'WAIT';
  setupType?: string;
  executionType?: string;
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
  strategy: string;
  entryZone: string;
  entryZoneMin?: number;
  entryZoneMax?: number;
  entryZoneType?: string;
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
    roomPenalty: number,
    currentPrice: number
  ) {
    let score = 0;
    let reasons: string[] = [];
    let warnings: string[] = [];

    // --- WEIGHTED PENALTY GUARDS ---

    // 1. RSI Exhaustion Guard
    if (direction === 'BUY') {
      if (analysis.rsiM15 > 80) { console.log(`[M5 DEBUG] VETO BUY: RSI M15 > 80`); return { score: 0, reasons: [], warnings: ['VETO: RSI M15 > 80 (Extreme Overbought). Blokir BUY.'] }; }
      if (analysis.rsiM15 > 75) { score -= 20; warnings.push(`⚠️ Penalti RSI > 75 (-20 Poin)`); }
      else if (analysis.rsiM15 > 70) { score -= 10; warnings.push(`⚠️ Penalti RSI > 70 (-10 Poin)`); }
    } else {
      if (analysis.rsiM15 < 20) { console.log(`[M5 DEBUG] VETO SELL: RSI M15 < 20`); return { score: 0, reasons: [], warnings: ['VETO: RSI M15 < 20 (Extreme Oversold). Blokir SELL.'] }; }
      if (analysis.rsiM15 < 25) { score -= 20; warnings.push(`⚠️ Penalti RSI < 25 (-20 Poin)`); }
      else if (analysis.rsiM15 < 30) { score -= 10; warnings.push(`⚠️ Penalti RSI < 30 (-10 Poin)`); }
    }

    // 2. Premium / Discount Zone Filter
    const m15Range = analysis.closestSwingHighM5 - analysis.closestSwingLowM5;
    if (m15Range > 0) {
      const pricePosition = (currentPrice - analysis.closestSwingLowM5) / m15Range; 
      
      if (direction === 'BUY') {
        if (pricePosition > 0.8) {
          console.log(`[M5 DEBUG] VETO BUY: Extreme Premium Zone. Pos=${pricePosition}`); 
          return { score: 0, reasons: [], warnings: ['VETO: Extreme Premium Zone (>80%). Blokir BUY FOMO.'] };
        }
        else if (pricePosition > 0.6) { score -= 10; warnings.push(`⚠️ Premium Zone (>60%): -10 Poin`); }
        else if (pricePosition < 0.4) { score += 10; reasons.push(`✔ Discount Zone (<40%): +10 Poin`); }
      } else {
        if (pricePosition < 0.2) { 
          console.log(`[M5 DEBUG] VETO SELL: Extreme Discount Zone. Pos=${pricePosition}`); 
          return { score: 0, reasons: [], warnings: ['VETO: Extreme Discount Zone (<20%). Blokir SELL FOMO.'] };
        }
        else if (pricePosition < 0.4) { score -= 10; warnings.push(`⚠️ Discount Zone (<40%): -10 Poin`); }
        else if (pricePosition > 0.6) { score += 10; reasons.push(`✔ Premium Zone (>60%): +10 Poin`); }
      }
    }

    // 3. M5 Rubber-Band Guard (Extension Filter)
    const distToEMA = Math.abs(currentPrice - analysis.ema20M5);
    if (distToEMA > analysis.atr_M15 * 1.5) {
      const isExtremeBreakout = analysis.strongVolumeM5 || ['MARUBOZU_BULL', 'MARUBOZU_BEAR', 'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS'].includes(analysis.patternM5);
      if (isExtremeBreakout) {
        score -= 10;
        warnings.push(`⚠️ Rubber Band Extension > 1.5 ATR tapi Breakout Kuat: -10 Poin`);
      } else {
        console.log(`[M5 DEBUG] VETO ${direction}: Rubber Band Ext > 1.5 ATR (${distToEMA.toFixed(2)} > ${(analysis.atr_M15 * 1.5).toFixed(2)})`);
        return { score: 0, reasons: [], warnings: ['VETO: Rubber Band Extension > 1.5 ATR tanpa konfirmasi kuat. Blokir.'] };
      }
    }

    // --- END WEIGHTED PENALTY GUARDS ---

    // 100-Point Institutional Scoring Matrix (Adaptive for Scalper & Sniper)
    // 1. Trend H1 & M15 Structure (30 Poin total)
    const trendH1Match = (direction === 'BUY' && analysis.trendH1 === 'BULLISH') || 
                         (direction === 'SELL' && analysis.trendH1 === 'BEARISH');
    const trendM15Match = (direction === 'BUY' && analysis.trendM15 === 'BULLISH') ||
                          (direction === 'SELL' && analysis.trendM15 === 'BEARISH');
    const structM15Match = (direction === 'BUY' && analysis.structureM15 === 'HH_HL') ||
                           (direction === 'SELL' && analysis.structureM15 === 'LH_LL');

    if (strategy === 'HYPER_SCALPER') {
      // Scalper prioritizes M15 momentum & short-term structure
      if (trendM15Match || structM15Match) {
        score += 20;
        reasons.push(`✔ Trend/Struktur M15 (${analysis.trendM15}) Selaras (+20)`);
      } else if (analysis.trendM15 === 'NEUTRAL') {
        score += 10;
        reasons.push(`✔ Struktur M15 Sideways / Range (+10)`);
      }

      if (trendH1Match) {
        score += 10;
        reasons.push(`✔ H1 Major Trend Support (${analysis.trendH1}) (+10)`);
      } else if (analysis.trendH1 === 'NEUTRAL') {
        score += 5;
      }
    } else {
      // Sniper prioritizes H1 Trend alignment
      if (trendH1Match) {
        score += 20;
        reasons.push(`✔ Trend H1 ${analysis.trendH1} (+20)`);
      } else if (analysis.trendH1 === 'NEUTRAL') {
        score += 10;
        reasons.push(`✔ Trend H1 Netral/Sideways Range (+10)`);
      }

      if (trendM15Match || structM15Match) {
        score += 10;
        reasons.push(`✔ Konfirmasi Struktur M15 (+10)`);
      }
    }

    // 2. BOS / CHoCH M15 (20 Poin)
    const bosChochMatch = (direction === 'BUY' && (analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'CHOCH_BULL')) ||
                          (direction === 'SELL' && (analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'CHOCH_BEAR'));
    if (bosChochMatch) { 
      score += 20; 
      reasons.push(`✔ M15 ${analysis.marketStructureM15} Valid (+20)`); 
    } else if (analysis.marketStructureM15.includes('FAKE_BREAKOUT')) {
      score += 20;
      reasons.push(`✔ Liquidity Grab / Stop Hunt M15 Terdeteksi (+20)`);
    } else { 
      warnings.push(`✖ Tidak ada BOS/CHoCH searah (0 Poin)`); 
    }

    // 3. Key Level S/R H1 & Fibonacci (15 Poin)
    const isAtSR = direction === 'BUY' ? analysis.isAtSupportH1 : analysis.isAtResistanceH1;
    const fibMatch = (direction === 'BUY' && analysis.fibonacciZoneM15 === 'GOLDEN_BULL') || 
                     (direction === 'SELL' && analysis.fibonacciZoneM15 === 'GOLDEN_BEAR');
    if (isAtSR) { 
      score += 15; 
      reasons.push(`✔ Pantulan Key Level S/R (+15)`); 
    } else if (fibMatch) {
      score += 12;
      reasons.push(`✔ Fibonacci Golden Ratio Zone (+12)`);
    } else { 
      warnings.push(`✖ Harga mengambang / jauh dari S/R (0 Poin)`); 
    }

    // 4. Price Action Trigger M5 (20 Poin)
    const paMatch = (direction === 'BUY' && (analysis.patternM5 === 'BULLISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BULL' || analysis.patternM5 === 'THREE_WHITE_SOLDIERS')) ||
                    (direction === 'SELL' && (analysis.patternM5 === 'BEARISH_ENGULFING' || analysis.patternM5 === 'PIN_BAR' || analysis.patternM5 === 'MARUBOZU_BEAR' || analysis.patternM5 === 'THREE_BLACK_CROWS'));
    if (paMatch) { 
      score += 20; 
      reasons.push(`✔ Price Action M5 (${analysis.patternM5.replace('_', ' ')}) Valid (+20)`); 
    } else {
      warnings.push(`✖ Konfirmasi Candle M5 Kurang Tegas (0 Poin)`);
    }

    // 5. Institutional Volume (10 Poin)
    if (analysis.strongVolumeM5) {
      score += 10;
      reasons.push(`✔ Institutional Volume Kuat (+10)`);
    } else if (analysis.volumeSpikeM5) {
      score += 6;
      reasons.push(`✔ Volume Spike Terdeteksi (+6)`);
    }

    // 6. Multi-Timeframe Alignment (5 Poin)
    const mtfAligned = (direction === 'BUY' && trendH1Match && trendM15Match) ||
                       (direction === 'SELL' && trendH1Match && trendM15Match);
    if (mtfAligned) {
      score += 5;
      reasons.push(`✔ MTF Alignment (H1 & M15 Selaras) (+5)`);
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
    if (atr > 25.0 && !bypassEmergency) {
      return this.createWaitSignal(`🚨 EMERGENCY MODE: Volatilitas terlalu liar (ATR ${atr.toFixed(2)} > 25.0). NO TRADE.`, activeStrategy);
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

    // 6. Price Action Entry Trigger Check (Wajib konfirmasi candle atau structure break)
    const hasCandleTrigger = analysis.patternM5 !== 'NONE' || analysis.strongVolumeM5 || analysis.volumeSpikeM5;
    const hasStructureTrigger = analysis.marketStructureM15.includes('BOS') || analysis.marketStructureM15.includes('CHOCH') || analysis.marketStructureM15.includes('FAKE_BREAKOUT') || isNewsBreakout;

    if (!hasCandleTrigger && !hasStructureTrigger) {
      return this.createWaitSignal("Menunggu konfirmasi Price Action Candle M5 atau Breakout Struktur M15.", activeStrategy);
    }

    // 7. Evaluasi Arah Trade & Dynamic Stop Loss
    let possibleDirections: ('BUY' | 'SELL')[] = [];
    const strongBearishPA = ['THREE_BLACK_CROWS', 'MARUBOZU_BEAR', 'BEARISH_ENGULFING'].includes(analysis.patternM5);
    const strongBullishPA = ['THREE_WHITE_SOLDIERS', 'MARUBOZU_BULL', 'BULLISH_ENGULFING'].includes(analysis.patternM5);

    if (!strongBearishPA && (analysis.patternM5.includes('BULL') || analysis.patternM5 === 'PIN_BAR' || analysis.marketStructureM15 === 'BOS_BULL' || analysis.marketStructureM15 === 'CHOCH_BULL' || analysis.marketStructureM15 === 'FAKE_BREAKOUT_BEAR' || (analysis.fibonacciZoneM15 === 'GOLDEN_BULL' && hasCandleTrigger) || analysis.trendM15 === 'BULLISH')) {
      possibleDirections.push('BUY');
    }
    if (!strongBullishPA && (analysis.patternM5.includes('BEAR') || analysis.patternM5 === 'PIN_BAR' || analysis.marketStructureM15 === 'BOS_BEAR' || analysis.marketStructureM15 === 'CHOCH_BEAR' || analysis.marketStructureM15 === 'FAKE_BREAKOUT_BULL' || (analysis.fibonacciZoneM15 === 'GOLDEN_BEAR' && hasCandleTrigger) || analysis.trendM15 === 'BEARISH')) {
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

    let lastRejectionReason = `Skor probabilitas di bawah ambang batas minimal kelulusan (Minimal ${activeStrategy === 'HYPER_SCALPER' ? 55 : 65} Poin).`;

    for (const dir of possibleDirections) {
      // Dynamic Stop Loss Calculation: Swing Point + ATR Buffer
      const atrBuffer = Math.max(0.6, atr * 0.5);
      let calculatedSL = 0;

      if (dir === 'BUY') {
        if (analysis.closestSwingLowM5 > 0 && analysis.closestSwingLowM5 < currentPrice && (currentPrice - analysis.closestSwingLowM5) <= 5.5) {
          calculatedSL = analysis.closestSwingLowM5 - atrBuffer;
        } else {
          // Swing terlalu jauh (> $5.5) atau tidak valid, fallback ke Micro-Structure / Default ATR Risk
          const defaultRisk = activeStrategy === 'HYPER_SCALPER' ? Math.max(1.8, Math.min(3.5, atr * 1.2)) : Math.max(2.0, Math.min(4.5, atr * 1.5));
          calculatedSL = currentPrice - defaultRisk;
        }
        if (calculatedSL >= currentPrice - 1.5) calculatedSL = currentPrice - 1.5; // Jarak minimal $1.5 (15 pips)
      } else {
        if (analysis.closestSwingHighM5 > 0 && analysis.closestSwingHighM5 > currentPrice && (analysis.closestSwingHighM5 - currentPrice) <= 5.5) {
          calculatedSL = analysis.closestSwingHighM5 + atrBuffer;
        } else {
          // Swing terlalu jauh (> $5.5) atau tidak valid, fallback ke Micro-Structure / Default ATR Risk
          const defaultRisk = activeStrategy === 'HYPER_SCALPER' ? Math.max(1.8, Math.min(3.5, atr * 1.2)) : Math.max(2.0, Math.min(4.5, atr * 1.5));
          calculatedSL = currentPrice + defaultRisk;
        }
        if (calculatedSL <= currentPrice + 1.5) calculatedSL = currentPrice + 1.5; // Jarak minimal $1.5 (15 pips)
      }

      const riskDist = Math.abs(currentPrice - calculatedSL);

      // 8. True Room to Target Calculation
      let maxTargetPrice = 0;
      let roomToTargetValid = true;
      let roomRejectReason = '';

      if (dir === 'BUY') {
         if (!analysis.nearestResistanceH1 || analysis.nearestResistanceH1 <= currentPrice + 0.5) {
             roomRejectReason = `Target resistance H1 tidak teridentifikasi atau terlalu dekat. Ruang gerak tidak valid.`;
             roomToTargetValid = false;
         }
         maxTargetPrice = analysis.nearestResistanceH1;
      } else {
         if (!analysis.nearestSupportH1 || analysis.nearestSupportH1 >= currentPrice - 0.5) {
             roomRejectReason = `Target support H1 tidak teridentifikasi atau terlalu dekat. Ruang gerak tidak valid.`;
             roomToTargetValid = false;
         }
         maxTargetPrice = analysis.nearestSupportH1;
      }
      
      const availableRoom = Math.abs(maxTargetPrice - currentPrice);
      const trueRR = riskDist > 0 ? availableRoom / riskDist : 0;
      
      if (trueRR < 1.3) {
        roomRejectReason = `Ruang gerak tertahan S/R nyata (True RR ${trueRR.toFixed(1)}x < 1.3x). Hindari trading menabrak dinding.`;
        roomToTargetValid = false;
      }

      let roomPenalty = 0;
      if (trueRR >= 1.3 && trueRR < 1.6) {
        roomPenalty = 6;
      }

      // Hitung Skor 100-Point Matrix
      const scoreResult = this.calculateScoreV2(dir, analysis, sessionInfo.type, isNewsMode, activeStrategy, roomPenalty, currentPrice);

      // Check Room To Target Validity first
      if (!roomToTargetValid) {
        lastRejectionReason = roomRejectReason;
        continue;
      }

      // Hard Filter Safety Cap SL (Di-evaluasi setelah tau score dan room)
      if (riskDist > 5.5) {
        if (scoreResult.score >= 85) {
          lastRejectionReason = `[WAIT] Confidence: ${scoreResult.score}, Direction: ${dir}, Structural SL: $${riskDist.toFixed(2)}, Max Allowed: $5.50. Reason: ENTRY TOO EXTENDED. Action: WAIT FOR PULLBACK.`;
        } else {
          lastRejectionReason = `Stop Loss terlalu lebar ($${riskDist.toFixed(2)} > $5.5). Menunggu titik entri yang lebih presisi.`;
        }
        continue;
      }
      
      if (riskDist < 1.0) {
        lastRejectionReason = `Stop Loss terlalu sempit ($${riskDist.toFixed(2)} < $1.0). Rawan noise market.`;
        continue;
      }

      const setupType = this.determineSetupType(dir, analysis, isNewsBreakout);

      // Scalper TP1 = 1:1.3, TP2 = 1:2.0 | Sniper TP1 = 1:1.8, TP2 = 1:2.5
      const tp1Ratio = activeStrategy === 'HYPER_SCALPER' ? 1.3 : 1.8;
      const tp2Ratio = activeStrategy === 'HYPER_SCALPER' ? 2.0 : 2.5;

      const tp1 = dir === 'BUY' ? currentPrice + (riskDist * tp1Ratio) : currentPrice - (riskDist * tp1Ratio);
      let tp2 = dir === 'BUY' ? currentPrice + (riskDist * tp2Ratio) : currentPrice - (riskDist * tp2Ratio);
      if (dir === 'BUY' && tp2 > maxTargetPrice) tp2 = maxTargetPrice;
      if (dir === 'SELL' && tp2 < maxTargetPrice) tp2 = maxTargetPrice;

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

    // 9. Strict Threshold Filter: Skor < Threshold LANGSUNG WAIT (Blokir Sinyal Lemah!)
    const minScore = activeStrategy === 'HYPER_SCALPER' ? (isNewsMode ? 50 : 55) : (isNewsMode ? 60 : 65);
    
    if (!bestTrade || bestTrade.score < minScore) {
      if (bestTrade) {
         console.log(`[M5 DEBUG] Setup ${bestTrade.dir} REJECTED. Score: ${bestTrade.score} < ${minScore}. Reasons: ${JSON.stringify(bestTrade.reasons)} Warnings: ${JSON.stringify(bestTrade.warnings)}`);
         return this.createWaitSignal(`Skor probabilitas (${bestTrade.score}/100) di bawah ambang batas minimal kelulusan (Minimal ${minScore} Poin).`, activeStrategy);
      } else {
         console.log(`[M5 DEBUG] All setups REJECTED. Last reason: ${lastRejectionReason}`);
         return this.createWaitSignal(lastRejectionReason, activeStrategy);
      }
    }

    const { dir: tradeType, score, reasons, warnings, stopLoss, tp1, tp2, setupType } = bestTrade;

    // 10. Probability Label (5-Star Classification)
    let probabilityLabel = '⭐⭐ Low';
    if (score >= 90) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
    else if (score >= 80) probabilityLabel = '⭐⭐⭐⭐ High';
    else if (score >= 65) probabilityLabel = '⭐⭐⭐ Medium';
    else if (score >= 65) probabilityLabel = '⭐⭐ Low';

    let reasonString = reasons.join('\n') + (warnings.length > 0 ? '\n' + warnings.join('\n') : '');
    if (newsWarning) reasonString = newsWarning + '\n\n' + reasonString;

    // 11. Smart Execution Type & Precision Entry Zone (SMC / Retracement)
    const isInstantMomentum = isNewsBreakout || 
                              analysis.strongVolumeM5 || 
                              analysis.patternM5 === 'MARUBOZU_BULL' || 
                              analysis.patternM5 === 'MARUBOZU_BEAR' ||
                              setupType.includes('Breakout');

    let executionType = isInstantMomentum 
      ? '⚡ INSTANT ENTRY (Market Execution)' 
      : '⏳ PULLBACK / LIMIT ENTRY (Wait for Zone)';

    let entryZoneStr = '';
    let entryZoneMin = 0;
    let entryZoneMax = 0;
    let entryZoneType = '';

    const candleRange = analysis.triggerCandleM5 ? Math.abs(analysis.triggerCandleM5.high - analysis.triggerCandleM5.low) : 0;

    if (tradeType === 'BUY') {
      if (isInstantMomentum) {
        entryZoneMin = currentPrice - Math.min(0.8, atr * 0.25);
        entryZoneMax = currentPrice;
        entryZoneType = 'MARKET';
      } else {
        // Pullback / Retracement Mode: Utamakan Bullish FVG atau 50% Candle Retrace
        if (analysis.fvgM5.type === 'BULLISH' && analysis.fvgM5.bottom > 0 && analysis.fvgM5.top <= currentPrice + 0.5) {
          entryZoneMin = analysis.fvgM5.bottom;
          entryZoneMax = analysis.fvgM5.top;
          entryZoneType = 'FVG';
        } else if (candleRange >= 1.5) {
          entryZoneMax = currentPrice - (candleRange * 0.2);
          entryZoneMin = currentPrice - (candleRange * 0.5);
          entryZoneType = 'RETRACE';
        } else if (analysis.isAtSupportH1 && analysis.nearestSupportH1 < currentPrice) {
          entryZoneMax = analysis.nearestSupportH1 + Math.min(1.5, atr * 0.4);
          entryZoneMin = analysis.nearestSupportH1;
          entryZoneType = 'SUPPORT';
        } else {
          entryZoneMin = currentPrice - Math.min(2.0, Math.max(0.8, atr * 0.5));
          entryZoneMax = currentPrice - 0.3;
          entryZoneType = 'DISCOUNT';
        }
      }
    } else {
      if (isInstantMomentum) {
        entryZoneMin = currentPrice;
        entryZoneMax = currentPrice + Math.min(0.8, atr * 0.25);
        entryZoneType = 'MARKET';
      } else {
        // Bearish Pullback / Retracement Mode: Utamakan Bearish FVG atau 50% Candle Retrace
        if (analysis.fvgM5.type === 'BEARISH' && analysis.fvgM5.top > 0 && analysis.fvgM5.bottom >= currentPrice - 0.5) {
          entryZoneMin = analysis.fvgM5.bottom;
          entryZoneMax = analysis.fvgM5.top;
          entryZoneType = 'FVG';
        } else if (candleRange >= 1.5) {
          entryZoneMin = currentPrice + (candleRange * 0.2);
          entryZoneMax = currentPrice + (candleRange * 0.5);
          entryZoneType = 'RETRACE';
        } else if (analysis.isAtResistanceH1 && analysis.nearestResistanceH1 > currentPrice) {
          entryZoneMin = analysis.nearestResistanceH1 - Math.min(1.5, atr * 0.4);
          entryZoneMax = analysis.nearestResistanceH1;
          entryZoneType = 'RESISTANCE';
        } else {
          entryZoneMin = currentPrice + 0.3;
          entryZoneMax = currentPrice + Math.min(2.0, Math.max(0.8, atr * 0.5));
          entryZoneType = 'PREMIUM';
        }
      }
    }
    entryZoneStr = `${entryZoneMin.toFixed(2)} - ${entryZoneMax.toFixed(2)} (${entryZoneType} Zone)`;

    const wibDate = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
    const dateStr = wibDate.slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    return {
      id: `XAU-${dateStr}-${randId}`,
      type: tradeType,
      setupType,
      executionType,
      marketPhase: analysis.marketPhase || 'RANGE',
      probabilityLabel,
      confidenceScore: score,
      marketCondition: (analysis.marketCondition || 'SIDEWAYS').replace(/_/g, ' '),
      session: sessionInfo.name,
      entryPrice: currentPrice,
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit1: Number(tp1.toFixed(2)),
      takeProfit2: Number(tp2.toFixed(2)),
      validTime: isInstantMomentum ? '5-10 Menit' : '10-20 Menit',
      estimatedTpTime: '15-45 Menit',
      timeStopLoss: '45-60 Menit',
      timestamp: new Date().toISOString(),
      reason: reasonString,
      strategy: activeStrategy,
      entryZone: entryZoneStr,
      entryZoneMin: Number(entryZoneMin.toFixed(2)),
      entryZoneMax: Number(entryZoneMax.toFixed(2)),
      entryZoneType
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

import { LiveMarketSnapshot } from './featureEngine';

export type SignalTier = 'WAIT' | 'QUICK_SCALP' | 'MOMENTUM_SCALP' | 'SUPER_TREND';

export interface ConfidenceEvaluation {
  direction: 'BUY' | 'SELL' | 'WAIT';
  totalScore: number;
  tier: SignalTier;
  maxReEntryCycles: number;
  targetTpPips: number[]; 
  slPips: number;
  breakdown: {
    trendScore: number;
    structureScore: number;
    momentumScore: number;
    liquidityScore: number;
    volatilityScore: number;
    timingScore: number;
    riskRewardScore: number;
  };
  reasons: string[];
  warnings: string[];
}

export class ConfidenceEngine {
  
  public evaluate(snapshot: LiveMarketSnapshot): ConfidenceEvaluation {
    const atrM5 = snapshot.m5.features.atr;
    
    // 1. Volatility Regime Check
    if (atrM5 >= 4.5) {
      return this.createWaitEval('EXTREME Volatility (ATR >= 4.5). Resiko terlalu tinggi.');
    }

    // 2. Check Regime Shift / Veto (Falling Knife & Shooting Rocket)
    const buyVeto = this.checkVeto('BUY', snapshot);
    const sellVeto = this.checkVeto('SELL', snapshot);

    let bestEval: ConfidenceEvaluation | null = null;
    let maxScore = -1;

    // 3. Evaluate BUY
    if (!buyVeto.isVetoed) {
      const isMacroBuy = snapshot.h1.features.trend === 'BULLISH' && snapshot.m15.features.trend !== 'BEARISH';
      const evalResult = isMacroBuy
        ? this.calculateNormalScore('BUY', snapshot)
        : this.calculateCounterTrendScore('BUY', snapshot);
      
      const threshold = isMacroBuy ? 55 : 75;
      if (evalResult.totalScore > maxScore && evalResult.totalScore >= threshold) {
        bestEval = evalResult;
        maxScore = evalResult.totalScore;
      }
    }

    // 4. Evaluate SELL
    if (!sellVeto.isVetoed) {
      const isMacroSell = snapshot.h1.features.trend === 'BEARISH' && snapshot.m15.features.trend !== 'BULLISH';
      const evalResult = isMacroSell
        ? this.calculateNormalScore('SELL', snapshot)
        : this.calculateCounterTrendScore('SELL', snapshot);
      
      const threshold = isMacroSell ? 55 : 75;
      if (evalResult.totalScore > maxScore && evalResult.totalScore >= threshold) {
        bestEval = evalResult;
        maxScore = evalResult.totalScore;
      }
    }

    if (!bestEval) {
       return this.createWaitEval('Pasar belum memenuhi threshold konfirmasi untuk Normal maupun Counter-Trend.');
    }

    // 5. Extension Guard (Don't Sell the Bottom, Don't Buy the Top)
    const isExtended = this.checkExtensionGuard(bestEval.direction, snapshot);
    if (isExtended) {
       bestEval.direction = 'WAIT';
       bestEval.reasons.push(`⛔ EXTENSION GUARD: Harga terlalu jauh dari EMA20 M5 (Chasing). Menunggu pullback.`);
       bestEval.tier = 'WAIT';
    }

    return bestEval;
  }

  private checkVeto(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): { isVetoed: boolean; reason: string } {
    if (direction === 'BUY') {
      const priceBelowM1Ema = s.currentPrice < s.m1.features.ema20;
      const priceBelowM5Ema = s.currentPrice < s.m5.features.ema20;
      
      const m1Displacement = s.currentPrice < s.m1.features.ema9 && s.m1.features.macd.histogram < -0.1;
      const m5BearishBOS = s.m5.structure.lastBOS === 'BEARISH_BOS';
      const macdBearish = s.m1.features.macd.histogram < 0 && s.m1.features.macd.histogram < s.m1.features.macd.signal;
      const rsiBearish = s.m1.features.rsi < 45 || s.m5.features.rsi < 45;

      if (priceBelowM1Ema && priceBelowM5Ema && (m1Displacement || m5BearishBOS || macdBearish || rsiBearish)) {
        return { isVetoed: true, reason: 'VETO BUY (Falling Knife): Regime shift ke bearish terdeteksi.' };
      }
    } else {
      const priceAboveM1Ema = s.currentPrice > s.m1.features.ema20;
      const priceAboveM5Ema = s.currentPrice > s.m5.features.ema20;

      const m1Displacement = s.currentPrice > s.m1.features.ema9 && s.m1.features.macd.histogram > 0.1;
      const m5BullishBOS = s.m5.structure.lastBOS === 'BULLISH_BOS';
      const macdBullish = s.m1.features.macd.histogram > 0 && s.m1.features.macd.histogram > s.m1.features.macd.signal;
      const rsiBullish = s.m1.features.rsi > 55 || s.m5.features.rsi > 55;

      if (priceAboveM1Ema && priceAboveM5Ema && (m1Displacement || m5BullishBOS || macdBullish || rsiBullish)) {
        return { isVetoed: true, reason: 'VETO SELL (Shooting Rocket): Regime shift ke bullish terdeteksi.' };
      }
    }
    return { isVetoed: false, reason: '' };
  }

  private checkExtensionGuard(direction: 'BUY' | 'SELL' | 'WAIT', s: LiveMarketSnapshot): boolean {
    if (direction === 'WAIT') return false;
    const atrM5 = s.m5.features.atr;
    const distToEma20 = Math.abs(s.currentPrice - s.m5.features.ema20);
    // Jika harga lebih dari 2.0x ATR jaraknya dari EMA20 M5, dilarang entry (rawan ditarik balik)
    return distToEma20 > atrM5 * 2.0;
  }

  private createWaitEval(reason: string): ConfidenceEvaluation {
    return {
      direction: 'WAIT',
      totalScore: 0,
      tier: 'WAIT',
      maxReEntryCycles: 0,
      targetTpPips: [10, 10, 10, 10, 10],
      slPips: 10,
      breakdown: { trendScore: 0, structureScore: 0, momentumScore: 0, liquidityScore: 0, volatilityScore: 0, timingScore: 0, riskRewardScore: 0 },
      reasons: [reason],
      warnings: [],
    };
  }

  private calculateNormalScore(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): ConfidenceEvaluation {
    let trendScore = 0; let structureScore = 0; let momentumScore = 0; let liquidityScore = 0;
    let volatilityScore = 0; let timingScore = 0; let riskRewardScore = 0;
    const reasons: string[] = []; const warnings: string[] = [];

    // 1. Trend (20)
    if ((direction === 'BUY' && s.h1.features.trend === 'BULLISH') || (direction === 'SELL' && s.h1.features.trend === 'BEARISH')) {
      trendScore += 10; reasons.push(`✔ Trend H1 Selaras (+10)`);
    }
    if ((direction === 'BUY' && s.m15.features.trend === 'BULLISH') || (direction === 'SELL' && s.m15.features.trend === 'BEARISH')) {
      trendScore += 10; reasons.push(`✔ Trend M15 Selaras (+10)`);
    }

    // 2. Structure (20)
    const isStructMatch = (direction === 'BUY' && (s.m5.structure.structureType === 'HH_HL' || s.m1.structure.structureType === 'HH_HL')) ||
                          (direction === 'SELL' && (s.m5.structure.structureType === 'LH_LL' || s.m1.structure.structureType === 'LH_LL'));
    if (isStructMatch) { structureScore += 10; reasons.push(`✔ Struktur Market Selaras (+10)`); }
    
    const isBOSMatch = (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
                       (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch = (direction === 'BUY' && s.m1.structure.lastCHoCH === 'BULLISH_CHOCH') ||
                         (direction === 'SELL' && s.m1.structure.lastCHoCH === 'BEARISH_CHOCH');
    if (isBOSMatch) { structureScore += 10; reasons.push(`✔ BOS Terkonfirmasi (+10)`); }
    else if (isCHoCHMatch) { structureScore += 10; reasons.push(`✔ CHoCH Terkonfirmasi (+10)`); }

    // 3. Momentum (15)
    const isEmaMatch = (direction === 'BUY' && s.m1.features.ema9 >= s.m1.features.ema20) ||
                       (direction === 'SELL' && s.m1.features.ema9 <= s.m1.features.ema20);
    if (isEmaMatch) { momentumScore += 5; reasons.push(`✔ Fast EMA Selaras (+5)`); }
    
    const rsi = s.m5.features.rsi;
    if (direction === 'BUY' && rsi >= 45 && rsi <= 68) { momentumScore += 5; reasons.push(`✔ RSI Sehat (+5)`); }
    else if (direction === 'SELL' && rsi >= 32 && rsi <= 55) { momentumScore += 5; reasons.push(`✔ RSI Sehat (+5)`); }

    if ((direction === 'BUY' && s.m1.features.macd.histogram > 0) || (direction === 'SELL' && s.m1.features.macd.histogram < 0)) {
      momentumScore += 5; reasons.push(`✔ MACD Selaras (+5)`);
    }

    // 4. Liquidity (15)
    if ((direction === 'BUY' && s.m1.structure.fvgZone?.type === 'BULLISH') || (direction === 'SELL' && s.m1.structure.fvgZone?.type === 'BEARISH')) {
      liquidityScore += 10; reasons.push(`✔ FVG Imbalance (+10)`);
    }
    const distToEma20 = Math.abs(s.currentPrice - s.m1.features.ema20);
    if (distToEma20 <= s.m1.features.atr * 0.8) { liquidityScore += 5; reasons.push(`✔ Retest Golden Zone (+5)`); }

    // 5. Volatility (10)
    if (s.m5.features.atr <= 3.0) { volatilityScore += 10; reasons.push(`✔ Normal Volatility (+10)`); }
    else { volatilityScore += 5; }

    // 6. Timing (10)
    const m1Candle = s.m1.candle;
    const isM1Momentum = (direction === 'BUY' && m1Candle.close > m1Candle.open && m1Candle.close >= s.m1.structure.swingHigh) ||
                         (direction === 'SELL' && m1Candle.close < m1Candle.open && m1Candle.close <= s.m1.structure.swingLow);
    if (isM1Momentum || isBOSMatch) { timingScore += 10; reasons.push(`✔ Intrabar Breakout (+10)`); }
    else { timingScore += 5; }

    // 7. R/R (10)
    riskRewardScore += 10; reasons.push(`✔ Dynamic R-Multiple (+10)`);

    const rawScore = trendScore + structureScore + momentumScore + liquidityScore + volatilityScore + timingScore + riskRewardScore;
    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'NORMAL', {
      trendScore, structureScore, momentumScore, liquidityScore, volatilityScore, timingScore, riskRewardScore
    });
  }

  private calculateCounterTrendScore(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): ConfidenceEvaluation {
    let momentumScore = 0; let structureScore = 0; let emaDisplacementScore = 0; let macdScore = 0;
    let volatilityScore = 0; let liquidityScore = 0; let riskRewardScore = 5;
    const reasons: string[] = []; const warnings: string[] = [];
    
    reasons.push(`⚡ Mode COUNTER-TREND (Melawan arah Makro H1/M15). Syarat skor kelulusan lebih ketat (>= 75).`);

    const m1Candle = s.m1.candle;
    const isStrongMomentum = (direction === 'BUY' && m1Candle.close > m1Candle.open + s.m1.features.atr * 0.5) ||
                             (direction === 'SELL' && m1Candle.close < m1Candle.open - s.m1.features.atr * 0.5);
    if (isStrongMomentum) { momentumScore += 25; reasons.push(`✔ Momentum Counter-Trend Ekstrem (+25)`); }
    else { momentumScore += 10; }

    const isBOSMatch = (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
                       (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch = (direction === 'BUY' && (s.m1.structure.lastCHoCH === 'BULLISH_CHOCH' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH')) ||
                         (direction === 'SELL' && (s.m1.structure.lastCHoCH === 'BEARISH_CHOCH' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH'));
    if (isBOSMatch || isCHoCHMatch) { structureScore += 25; reasons.push(`✔ Structure Shift / BOS / CHoCH mendukung (+25)`); }

    const isEmaDisplaced = (direction === 'BUY' && s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20) ||
                           (direction === 'SELL' && s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20);
    if (isEmaDisplaced) { emaDisplacementScore += 15; reasons.push(`✔ Displacement Harga dari EMA20 (+15)`); }

    if ((direction === 'BUY' && s.m1.features.macd.histogram > 0) || (direction === 'SELL' && s.m1.features.macd.histogram < 0)) {
       macdScore += 10; reasons.push(`✔ MACD Histogram sejalan (+10)`);
    }

    if (s.m5.features.atr > 1.5 && s.m5.features.atr <= 4.0) {
       volatilityScore += 10; reasons.push(`✔ Volatilitas ideal Counter-Trend (+10)`);
    }

    if ((direction === 'BUY' && s.m1.structure.liquiditySweep === 'SWEEP_LOW') || (direction === 'SELL' && s.m1.structure.liquiditySweep === 'SWEEP_HIGH')) {
       liquidityScore += 10; reasons.push(`✔ Konfirmasi Liquidity Sweep (+10)`);
    }

    const rawScore = momentumScore + structureScore + emaDisplacementScore + macdScore + volatilityScore + liquidityScore + riskRewardScore;
    
    // Map scores to breakdown (reuse fields appropriately)
    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'COUNTER_TREND', {
      trendScore: 0, structureScore, momentumScore: momentumScore + macdScore, 
      liquidityScore, volatilityScore, timingScore: emaDisplacementScore, riskRewardScore
    });
  }

  private finalizeEvaluation(
    direction: 'BUY' | 'SELL', totalScore: number, s: LiveMarketSnapshot, reasons: string[], warnings: string[], mode: 'NORMAL' | 'COUNTER_TREND', breakdown: any
  ): ConfidenceEvaluation {
    const atrM5 = s.m5.features.atr;
    const atrPips = Math.round(atrM5 * 10);
    const atrBasedSL = Math.round(atrPips * 1.2);
    
    let swingDistPrice = 0;
    if (direction === 'BUY') {
      swingDistPrice = s.currentPrice - s.m5.structure.swingLow;
    } else {
      swingDistPrice = s.m5.structure.swingHigh - s.currentPrice;
    }
    const swingDistPips = Math.max(0, Math.round(swingDistPrice * 10));

    let slPips = Math.max(atrBasedSL, swingDistPips);
    slPips = Math.min(slPips, 25);
    slPips = Math.max(slPips, 10);
    
    reasons.push(`🛡 Dynamic SL: ${slPips} pips (Base ATR/Swing)`);

    const targetTpPips = [
      Math.round(slPips * 1.0), Math.round(slPips * 1.2), Math.round(slPips * 1.5), 
      Math.round(slPips * 2.0), Math.round(slPips * 2.5)  
    ];

    let tier: SignalTier = 'WAIT';
    let maxReEntryCycles = 0;
    
    const thresholdBase = mode === 'NORMAL' ? 55 : 75;
    const thresholdMid = mode === 'NORMAL' ? 65 : 85;
    const thresholdTop = mode === 'NORMAL' ? 80 : 95;

    if (totalScore >= thresholdTop) {
      tier = 'SUPER_TREND'; maxReEntryCycles = 3;
    } else if (totalScore >= thresholdMid) {
      tier = 'MOMENTUM_SCALP'; maxReEntryCycles = 1;
    } else if (totalScore >= thresholdBase) {
      tier = 'QUICK_SCALP'; maxReEntryCycles = 0;
    }

    return {
      direction: totalScore >= thresholdBase ? direction : 'WAIT',
      totalScore,
      tier,
      maxReEntryCycles,
      targetTpPips,
      slPips,
      breakdown,
      reasons,
      warnings,
    };
  }
}

export const confidenceEngine = new ConfidenceEngine();

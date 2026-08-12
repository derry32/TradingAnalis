import { LiveMarketSnapshot } from './featureEngine';

export type SignalTier = 'WAIT' | 'QUICK_SCALP' | 'MOMENTUM_SCALP' | 'SUPER_TREND';

export interface ConfidenceEvaluation {
  direction: 'BUY' | 'SELL' | 'WAIT';
  totalScore: number;
  tier: SignalTier;
  maxReEntryCycles: number;
  targetTpPips: number[]; // Array 5 layer target TP (e.g. [8, 9, 10, 11, 12])
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
  /**
   * Evaluasi Skor 100 Poin Deterministik secara Kuantitatif (<5ms)
   */
  public evaluate(snapshot: LiveMarketSnapshot): ConfidenceEvaluation {
    const atrM5 = snapshot.m5.features.atr;
    
    // 1. Volatility Regime Check
    if (atrM5 >= 4.5) {
      return {
        direction: 'WAIT',
        totalScore: 0,
        tier: 'WAIT',
        maxReEntryCycles: 0,
        targetTpPips: [10, 10, 10, 10, 10],
        slPips: 10,
        breakdown: { trendScore: 0, structureScore: 0, momentumScore: 0, liquidityScore: 0, volatilityScore: 0, timingScore: 0, riskRewardScore: 0 },
        reasons: ['Market diabaikan karena EXTREME Volatility (ATR >= 4.5). Resiko terlalu tinggi.'],
        warnings: ['EXTREME Volatility: NO TRADE.'],
      };
    }

    const buyEval = this.calculateDirectionalScore('BUY', snapshot);
    const sellEval = this.calculateDirectionalScore('SELL', snapshot);

    // Ambil skor tertinggi jika di atas batas minimum
    if (buyEval.totalScore >= 65 && buyEval.totalScore >= sellEval.totalScore) {
      return buyEval;
    } else if (sellEval.totalScore >= 65 && sellEval.totalScore > buyEval.totalScore) {
      return sellEval;
    }

    return {
      direction: 'WAIT',
      totalScore: Math.max(buyEval.totalScore, sellEval.totalScore),
      tier: 'WAIT',
      maxReEntryCycles: 0,
      targetTpPips: [8, 8, 10, 10, 12],
      slPips: 10,
      breakdown: buyEval.breakdown,
      reasons: ['Pasar belum memenuhi threshold minimum konfirmasi (Skor < 65).'],
      warnings: ['Kondisi chop / sideways. Menunggu momentum valid.'],
    };
  }

  private calculateDirectionalScore(
    direction: 'BUY' | 'SELL',
    s: LiveMarketSnapshot
  ): ConfidenceEvaluation {
    let trendScore = 0;
    let structureScore = 0;
    let momentumScore = 0;
    let liquidityScore = 0;
    let volatilityScore = 0;
    let timingScore = 0;
    let riskRewardScore = 0;

    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Trend Alignment (20 Poin)
    const isH1Match =
      (direction === 'BUY' && s.h1.features.trend === 'BULLISH') ||
      (direction === 'SELL' && s.h1.features.trend === 'BEARISH');
    const isM15Match =
      (direction === 'BUY' && s.m15.features.trend === 'BULLISH') ||
      (direction === 'SELL' && s.m15.features.trend === 'BEARISH');

    if (isH1Match) {
      trendScore += 10;
      reasons.push(`✔ Trend H1 ${s.h1.features.trend} Selaras (+10)`);
    }
    if (isM15Match) {
      trendScore += 10;
      reasons.push(`✔ Trend M15 ${s.m15.features.trend} Selaras (+10)`);
    } else if (s.m15.features.trend === 'NEUTRAL') {
      trendScore += 5;
    }

    // 2. Market Structure & SMC (20 Poin)
    const isStructMatch =
      (direction === 'BUY' && (s.m5.structure.structureType === 'HH_HL' || s.m1.structure.structureType === 'HH_HL')) ||
      (direction === 'SELL' && (s.m5.structure.structureType === 'LH_LL' || s.m1.structure.structureType === 'LH_LL'));

    if (isStructMatch) {
      structureScore += 10;
      reasons.push(`✔ Struktur Market Selaras (+10)`);
    }

    const isBOSMatch =
      (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
      (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));

    const isCHoCHMatch =
      (direction === 'BUY' && s.m1.structure.lastCHoCH === 'BULLISH_CHOCH') ||
      (direction === 'SELL' && s.m1.structure.lastCHoCH === 'BEARISH_CHOCH');

    if (isBOSMatch) {
      structureScore += 10;
      reasons.push(`✔ BOS (Break of Structure) Terkonfirmasi (+10)`);
    } else if (isCHoCHMatch) {
      structureScore += 10;
      reasons.push(`✔ CHoCH Reversal Terkonfirmasi (+10)`);
    }

    // 3. Momentum & Indicator Confluence (15 Poin)
    const isEmaMatch =
      (direction === 'BUY' && s.m1.features.ema9 >= s.m1.features.ema20) ||
      (direction === 'SELL' && s.m1.features.ema9 <= s.m1.features.ema20);

    if (isEmaMatch) {
      momentumScore += 5;
      reasons.push(`✔ Fast EMA Micro Crossover Selaras (+5)`);
    }

    const rsi = s.m5.features.rsi;
    if (direction === 'BUY') {
      if (rsi >= 45 && rsi <= 68) {
        momentumScore += 5;
        reasons.push(`✔ RSI M5 Sehat (${rsi.toFixed(1)}) (+5)`);
      } else if (rsi > 75) {
        warnings.push(`⚠ RSI Overbought (${rsi.toFixed(1)}), rawan pullback`);
      }
    } else {
      if (rsi >= 32 && rsi <= 55) {
        momentumScore += 5;
        reasons.push(`✔ RSI M5 Sehat (${rsi.toFixed(1)}) (+5)`);
      } else if (rsi < 25) {
        warnings.push(`⚠ RSI Oversold (${rsi.toFixed(1)}), rawan rebound`);
      }
    }

    const macdHist = s.m1.features.macd.histogram;
    if ((direction === 'BUY' && macdHist > 0) || (direction === 'SELL' && macdHist < 0)) {
      momentumScore += 5;
      reasons.push(`✔ MACD Histogram Momentum Selaras (+5)`);
    }

    // 4. Smart Money Liquidity & Imbalance (15 Poin)
    const isBullishFVG = s.m1.structure.fvgZone?.type === 'BULLISH' || s.m5.structure.fvgZone?.type === 'BULLISH';
    const isBearishFVG = s.m1.structure.fvgZone?.type === 'BEARISH' || s.m5.structure.fvgZone?.type === 'BEARISH';
    
    if ((direction === 'BUY' && isBullishFVG) || (direction === 'SELL' && isBearishFVG)) {
      liquidityScore += 10;
      reasons.push(`✔ FVG (Fair Value Gap) Imbalance Zone Terdeteksi (+10)`);
    } else if ((direction === 'BUY' && s.m1.structure.liquiditySweep === 'SWEEP_LOW') || 
               (direction === 'SELL' && s.m1.structure.liquiditySweep === 'SWEEP_HIGH')) {
      liquidityScore += 10;
      reasons.push(`✔ Liquidity Sweep Terdeteksi (+10)`);
    } else {
      liquidityScore += 5;
    }

    // Retest Golden Zone (Pullback dekat EMA20)
    const distToEma20 = Math.abs(s.currentPrice - s.m1.features.ema20);
    if (distToEma20 <= s.m1.features.atr * 0.8) {
      liquidityScore += 5;
      reasons.push(`✔ Harga Berada di Golden Zone / EMA20 Retest (+5)`);
    }

    // 5. Volatility & ATR Range (10 Poin)
    const atrM5 = s.m5.features.atr;
    
    // Regimes: LOW (< 1.5), NORMAL (1.5 - 3.0), HIGH (3.0 - 4.5). EXTREME handled above.
    if (atrM5 < 1.5) {
      volatilityScore += 5;
      reasons.push(`✔ Volatility Regime: LOW (${atrM5.toFixed(2)} pips).`);
    } else if (atrM5 <= 3.0) {
      volatilityScore += 10;
      reasons.push(`✔ Volatility Regime: NORMAL (${atrM5.toFixed(2)} pips) - Ideal Scalping. (+10)`);
    } else {
      volatilityScore += 5;
      reasons.push(`✔ Volatility Regime: HIGH (${atrM5.toFixed(2)} pips). SL dilebarkan.`);
    }

    // 6. Entry Timing & Intrabar Micro Trigger (10 Poin)
    const m1Candle = s.m1.candle;
    const isM1Momentum =
      (direction === 'BUY' && m1Candle.close > m1Candle.open && m1Candle.close >= s.m1.structure.swingHigh) ||
      (direction === 'SELL' && m1Candle.close < m1Candle.open && m1Candle.close <= s.m1.structure.swingLow);

    const isDirectionalBOS = 
      (direction === 'BUY' && s.m1.structure.lastBOS === 'BULLISH_BOS') || 
      (direction === 'SELL' && s.m1.structure.lastBOS === 'BEARISH_BOS');

    if (isM1Momentum || isDirectionalBOS) {
      timingScore += 10;
      reasons.push(`✔ Intrabar M1 Micro Breakout Trigger (+10)`);
    } else {
      timingScore += 5;
    }

    // 7. Risk / Reward & Room to Move (10 Poin)
    riskRewardScore += 10;
    reasons.push(`✔ Dynamic R-Multiple TP digunakan (+10)`);

    const totalScore = Math.min(
      100,
      trendScore +
        structureScore +
        momentumScore +
        liquidityScore +
        volatilityScore +
        timingScore +
        riskRewardScore
    );

    // --- DYNAMIC STOP LOSS CALCULATION ---
    // 1 pip = 0.1 di XAUUSD (jika harga 2400.15 ke 2400.25 = 10 pips = $1.0)
    const atrPips = Math.round(atrM5 * 10);
    const atrBasedSL = Math.round(atrPips * 1.2);
    
    let swingDistPrice = 0;
    if (direction === 'BUY') {
      swingDistPrice = s.currentPrice - s.m5.structure.swingLow;
    } else {
      swingDistPrice = s.m5.structure.swingHigh - s.currentPrice;
    }
    const swingDistPips = Math.max(0, Math.round(swingDistPrice * 10));

    // Ambil max antara ATR dan Swing Invalidation
    let slPips = Math.max(atrBasedSL, swingDistPips);
    
    // Hard Caps
    slPips = Math.min(slPips, 25); // Max SL 25 pips ($2.5)
    slPips = Math.max(slPips, 10); // Min SL 10 pips ($1.0)
    
    reasons.push(`🛡 Dynamic SL: ${slPips} pips (ATR base: ${atrBasedSL}, Swing base: ${swingDistPips})`);

    // --- DYNAMIC TAKE PROFIT CALCULATION (R-MULTIPLES) ---
    const targetTpPips = [
      Math.round(slPips * 1.0), // TP1 = 1.0R
      Math.round(slPips * 1.2), // TP2 = 1.2R
      Math.round(slPips * 1.5), // TP3 = 1.5R
      Math.round(slPips * 2.0), // TP4 = 2.0R
      Math.round(slPips * 2.5)  // TP5 = 2.5R Runner
    ];

    // Tentukan Tiering
    let tier: SignalTier = 'WAIT';
    let maxReEntryCycles = 0;

    if (totalScore >= 85) {
      tier = 'SUPER_TREND';
      maxReEntryCycles = 3;
    } else if (totalScore >= 75) {
      tier = 'MOMENTUM_SCALP';
      maxReEntryCycles = 1;
    } else if (totalScore >= 65) {
      tier = 'QUICK_SCALP';
      maxReEntryCycles = 0;
    }

    return {
      direction: totalScore >= 65 ? direction : 'WAIT',
      totalScore,
      tier,
      maxReEntryCycles,
      targetTpPips,
      slPips,
      breakdown: {
        trendScore,
        structureScore,
        momentumScore,
        liquidityScore,
        volatilityScore,
        timingScore,
        riskRewardScore,
      },
      reasons,
      warnings,
    };
  }
}

export const confidenceEngine = new ConfidenceEngine();

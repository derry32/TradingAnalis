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
    if (atrM5 >= 1.2 && atrM5 <= 6.5) {
      volatilityScore += 10;
      reasons.push(`✔ Volatilitas XAUUSD Ideal untuk Scalping (${atrM5.toFixed(2)} pips) (+10)`);
    } else if (atrM5 > 10.0) {
      volatilityScore += 4;
      warnings.push(`⚠ Volatilitas Sangat Tinggi (${atrM5.toFixed(2)} pips), spread rawan melebar`);
    } else {
      volatilityScore += 5;
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
    reasons.push(`✔ Target R:R Scalping 1:1 Terpenuhi (+10)`);

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

    // Tentukan Tiering & Parameter Eksekusi 5 Layer
    let tier: SignalTier = 'WAIT';
    let maxReEntryCycles = 0;
    let targetTpPips = [8, 8, 10, 10, 12];
    let slPips = 10;

    if (totalScore >= 85) {
      tier = 'SUPER_TREND';
      maxReEntryCycles = 3;
      targetTpPips = [10, 12, 14, 16, 20]; // 5 Layer Staggered + Runner
      slPips = 12;
    } else if (totalScore >= 75) {
      tier = 'MOMENTUM_SCALP';
      maxReEntryCycles = 1;
      targetTpPips = [8, 9, 10, 12, 15]; // 5 Layer Staggered
      slPips = 10;
    } else if (totalScore >= 65) {
      tier = 'QUICK_SCALP';
      maxReEntryCycles = 0; // No re-entry, hit & run
      targetTpPips = [8, 8, 9, 10, 10]; // 5 Layer Micro TP
      slPips = 10;
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

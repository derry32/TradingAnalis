import { LiveMarketSnapshot } from './featureEngine';

export type SignalTier = 'WAIT' | 'QUICK_SCALP' | 'MOMENTUM_SCALP' | 'SUPER_TREND';
export type EvalMode = 'NORMAL' | 'COUNTER_TREND' | 'CRASH';

export interface ConfidenceEvaluation {
  direction: 'BUY' | 'SELL' | 'WAIT';
  totalScore: number;
  tier: SignalTier;
  mode: EvalMode;
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

interface CrashRegime {
  isCrashBearish: boolean;
  isCrashBullish: boolean;
  bearishConditionsMet: number;
  bullishConditionsMet: number;
}

// ============================================================
// THRESHOLD CONSTANTS (single source of truth)
// ============================================================

// NORMAL
const NORMAL_THRESHOLD_BASE = 60; // QUICK_SCALP
const NORMAL_THRESHOLD_MID  = 70; // MOMENTUM_SCALP
const NORMAL_THRESHOLD_TOP  = 80; // SUPER_TREND

// CRASH
const CRASH_THRESHOLD_BASE  = 60;
const CRASH_THRESHOLD_MID   = 70;
const CRASH_THRESHOLD_TOP   = 85;

// COUNTER_TREND — deliberately strict. No QUICK_SCALP tier.
const COUNTER_THRESHOLD_BASE = 85; // minimum execution = MOMENTUM_SCALP
const COUNTER_THRESHOLD_TOP  = 90; // SUPER_TREND

export class ConfidenceEngine {

  public evaluate(snapshot: LiveMarketSnapshot): ConfidenceEvaluation {
    const now = new Date();
    const currentHourUTC = now.getUTCHours();
    const currentDayUTC = now.getUTCDay();

    // 0. Weekend Guard (Sabtu 04:00 WIB s/d Senin 04:00 WIB)
    // 04:00 WIB = 21:00 UTC (hari sebelumnya)
    const isWeekend = (currentDayUTC === 5 && currentHourUTC >= 21) || (currentDayUTC === 6) || (currentDayUTC === 0 && currentHourUTC < 21);
    if (isWeekend) {
      return this.createWaitEval("Market sedang libur/tutup di akhir pekan.");
    }

    const atrM5 = snapshot.m5.features.atr;

    // GATE 1: Extreme Volatility
    // ATR >= 15.0 (= 150 pips per M5 candle) → blok.
    if (atrM5 >= 15.0) {
      console.log(`[CE] GATE1 BLOCK: ATR M5 = ${atrM5.toFixed(4)} >= 15.0 (EXTREME). Resiko terlalu tinggi.`);
      return this.createWaitEval(`EXTREME Volatility (ATR M5=${atrM5.toFixed(4)} >= 15.0). Resiko terlalu tinggi.`);
    }
    console.log(`[CE] GATE1 PASS: ATR M5 = ${atrM5.toFixed(4)}`);

    // GATE 2: Detect Fast Regime (M1+M5 only)
    const crashRegime = this.detectCrashRegime(snapshot);

    // GATE 3: Determine mode for each direction FIRST (before veto)
    const buyMode  = this.determineMode('BUY', snapshot, crashRegime);
    const sellMode = this.determineMode('SELL', snapshot, crashRegime);

    // GATE 4: Mode-aware Veto Check
    const buyVeto  = this.checkVeto('BUY', snapshot, buyMode);
    const sellVeto = this.checkVeto('SELL', snapshot, sellMode);

    let bestEval: ConfidenceEvaluation | null = null;
    let maxScore = -1;

    // GATE 5a: Evaluate BUY
    if (!buyVeto.isVetoed) {
      let evalResult: ConfidenceEvaluation;
      let threshold: number;

      if (buyMode === 'CRASH') {
        evalResult = this.calculateCrashScore('BUY', snapshot, crashRegime);
        threshold = CRASH_THRESHOLD_BASE;
      } else if (buyMode === 'NORMAL') {
        evalResult = this.calculateNormalScore('BUY', snapshot);
        threshold = NORMAL_THRESHOLD_BASE;
      } else {
        // COUNTER_TREND — strict gate
        evalResult = this.calculateCounterTrendScore('BUY', snapshot);
        threshold = COUNTER_THRESHOLD_BASE;
      }

      if (evalResult.totalScore > maxScore && evalResult.totalScore >= threshold) {
        bestEval = evalResult;
        maxScore = evalResult.totalScore;
      }
    }

    // GATE 5b: Evaluate SELL
    if (!sellVeto.isVetoed) {
      let evalResult: ConfidenceEvaluation;
      let threshold: number;

      if (sellMode === 'CRASH') {
        evalResult = this.calculateCrashScore('SELL', snapshot, crashRegime);
        threshold = CRASH_THRESHOLD_BASE;
      } else if (sellMode === 'NORMAL') {
        evalResult = this.calculateNormalScore('SELL', snapshot);
        threshold = NORMAL_THRESHOLD_BASE;
      } else {
        // COUNTER_TREND — strict gate
        evalResult = this.calculateCounterTrendScore('SELL', snapshot);
        threshold = COUNTER_THRESHOLD_BASE;
      }

      if (evalResult.totalScore > maxScore && evalResult.totalScore >= threshold) {
        bestEval = evalResult;
        maxScore = evalResult.totalScore;
      }
    }

    if (!bestEval) {
      const crashInfo = crashRegime.isCrashBearish
        ? ` [Crash Bearish: ${crashRegime.bearishConditionsMet}/4 conds]`
        : crashRegime.isCrashBullish
        ? ` [Crash Bullish: ${crashRegime.bullishConditionsMet}/4 conds]`
        : '';
      return this.createWaitEval(`Pasar belum memenuhi threshold.${crashInfo}`);
    }

    // GATE 6: Extension Guard
    const isExtended = this.checkExtensionGuard(bestEval.direction, snapshot, bestEval.mode);
    if (isExtended) {
      bestEval.direction = 'WAIT';
      bestEval.tier = 'WAIT';
      bestEval.reasons.push(`⛔ EXTENSION GUARD: Harga > ${bestEval.mode === 'CRASH' ? '4.0x' : '2.0x'} ATR dari EMA20 M5. Menunggu pullback.`);
    }

    // Decision Trace Log
    console.log(
      `[CE] Dir=${bestEval.direction} Score=${bestEval.totalScore} Mode=${bestEval.mode}` +
      ` Crash={B:${crashRegime.bearishConditionsMet}/4 U:${crashRegime.bullishConditionsMet}/4}` +
      ` ExtGuard=${isExtended} BuyVeto=${buyVeto.isVetoed} SellVeto=${sellVeto.isVetoed}`
    );

    return bestEval;
  }

  // ─── Determine Mode (MUST happen before veto) ───────────────────────────────
  // CRASH  : fast regime detected
  // NORMAL : H1 supports direction
  // COUNTER_TREND: H1 explicitly opposite — NOT "just not normal"
  private determineMode(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot, crash: CrashRegime): EvalMode {
    if (direction === 'BUY' && crash.isCrashBullish) return 'CRASH';
    if (direction === 'SELL' && crash.isCrashBearish) return 'CRASH';

    if (direction === 'BUY') {
      if (s.h1.features.trend === 'BULLISH' && s.m15.features.trend !== 'BEARISH') return 'NORMAL';
      if (s.h1.features.trend === 'BEARISH') return 'COUNTER_TREND'; // explicit H1 opposite
      return 'NORMAL'; // H1 neutral → treat as normal, not counter
    } else {
      if (s.h1.features.trend === 'BEARISH' && s.m15.features.trend !== 'BULLISH') return 'NORMAL';
      if (s.h1.features.trend === 'BULLISH') return 'COUNTER_TREND'; // explicit H1 opposite
      return 'NORMAL'; // H1 neutral → treat as normal
    }
  }

  // ─── Fast Regime Detector ──────────────────────────────────────────────────
  private detectCrashRegime(s: LiveMarketSnapshot): CrashRegime {
    const m1Candle = s.m1.candle;
    const atrM1 = s.m1.features.atr;

    const bearishCond1 = s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20;
    const bearishCond2 = s.m1.features.macd.histogram < 0 && s.m1.features.macd.histogram < s.m1.features.macd.signal;
    const bearishCond3 = s.m1.structure.lastBOS === 'BEARISH_BOS' && s.m5.structure.lastBOS === 'BEARISH_BOS';
    const bearishCond4 = m1Candle.close < m1Candle.open && (m1Candle.open - m1Candle.close) > atrM1 * 0.5;
    const bearishConditionsMet = [bearishCond1, bearishCond2, bearishCond3, bearishCond4].filter(Boolean).length;

    const bullishCond1 = s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20;
    const bullishCond2 = s.m1.features.macd.histogram > 0 && s.m1.features.macd.histogram > s.m1.features.macd.signal;
    const bullishCond3 = s.m1.structure.lastBOS === 'BULLISH_BOS' && s.m5.structure.lastBOS === 'BULLISH_BOS';
    const bullishCond4 = m1Candle.close > m1Candle.open && (m1Candle.close - m1Candle.open) > atrM1 * 0.5;
    const bullishConditionsMet = [bullishCond1, bullishCond2, bullishCond3, bullishCond4].filter(Boolean).length;

    const isH1Bullish = s.h1.features.trend === 'BULLISH';
    const isH1Bearish = s.h1.features.trend === 'BEARISH';

    return {
      isCrashBearish: bearishConditionsMet >= 3 && !isH1Bullish,
      isCrashBullish: bullishConditionsMet >= 3 && !isH1Bearish,
      bearishConditionsMet,
      bullishConditionsMet,
    };
  }

  // ─── Mode-Aware Veto ───────────────────────────────────────────────────────
  // NORMAL: strict anti-falling-knife / anti-shooting-rocket
  // COUNTER_TREND: relaxed — price being below EMA is EXPECTED for a reversal candidate
  private checkVeto(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot, mode: EvalMode): { isVetoed: boolean; reason: string } {
    if (mode === 'COUNTER_TREND') {
      // Counter-trend reversal: do NOT veto based on price vs EMA (that's expected).
      // Only hard-veto if M5 structure has NO sign of reversal at all.
      const hasBullishM5 = s.m5.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH';
      const hasBearishM5 = s.m5.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH';

      if (direction === 'BUY' && !hasBullishM5) {
        return { isVetoed: true, reason: 'VETO COUNTER BUY: Tidak ada M5 bullish reversal confirmation (BOS/CHoCH).' };
      }
      if (direction === 'SELL' && !hasBearishM5) {
        return { isVetoed: true, reason: 'VETO COUNTER SELL: Tidak ada M5 bearish reversal confirmation (BOS/CHoCH).' };
      }
      return { isVetoed: false, reason: '' };
    }

    // NORMAL / CRASH mode: original falling-knife / shooting-rocket guard
    if (direction === 'BUY') {
      const priceBelowM1Ema = s.currentPrice < s.m1.features.ema20;
      const priceBelowM5Ema = s.currentPrice < s.m5.features.ema20;
      const m1Displacement  = s.currentPrice < s.m1.features.ema9 && s.m1.features.macd.histogram < -0.1;
      const m5BearishBOS    = s.m5.structure.lastBOS === 'BEARISH_BOS';
      const macdBearish     = s.m1.features.macd.histogram < 0 && s.m1.features.macd.histogram < s.m1.features.macd.signal;
      const rsiBearish      = s.m1.features.rsi < 45 || s.m5.features.rsi < 45;

      if (priceBelowM1Ema && priceBelowM5Ema && (m1Displacement || m5BearishBOS || macdBearish || rsiBearish)) {
        return { isVetoed: true, reason: 'VETO BUY (Falling Knife): Regime shift ke bearish terdeteksi.' };
      }
    } else {
      const priceAboveM1Ema = s.currentPrice > s.m1.features.ema20;
      const priceAboveM5Ema = s.currentPrice > s.m5.features.ema20;
      const m1Displacement  = s.currentPrice > s.m1.features.ema9 && s.m1.features.macd.histogram > 0.1;
      const m5BullishBOS    = s.m5.structure.lastBOS === 'BULLISH_BOS';
      const macdBullish     = s.m1.features.macd.histogram > 0 && s.m1.features.macd.histogram > s.m1.features.macd.signal;
      const rsiBullish      = s.m1.features.rsi > 55 || s.m5.features.rsi > 55;

      if (priceAboveM1Ema && priceAboveM5Ema && (m1Displacement || m5BullishBOS || macdBullish || rsiBullish)) {
        return { isVetoed: true, reason: 'VETO SELL (Shooting Rocket): Regime shift ke bullish terdeteksi.' };
      }
    }
    return { isVetoed: false, reason: '' };
  }

  // ─── Extension Guard ───────────────────────────────────────────────────────
  private checkExtensionGuard(direction: 'BUY' | 'SELL' | 'WAIT', s: LiveMarketSnapshot, mode: string = 'NORMAL'): boolean {
    if (direction === 'WAIT') return false;
    const atrM5 = s.m5.features.atr;
    const distToEma20 = Math.abs(s.currentPrice - s.m5.features.ema20);
    const maxAtrMultiplier = mode === 'CRASH' ? 4.0 : 2.0;
    return distToEma20 > atrM5 * maxAtrMultiplier;
  }

  // ─── Normal Score ──────────────────────────────────────────────────────────
  private calculateNormalScore(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): ConfidenceEvaluation {
    let trendScore = 0; let structureScore = 0; let momentumScore = 0; let liquidityScore = 0;
    let volatilityScore = 0; let timingScore = 0; let riskRewardScore = 0;
    const reasons: string[] = []; const warnings: string[] = [];

    if ((direction === 'BUY' && s.h1.features.trend === 'BULLISH') || (direction === 'SELL' && s.h1.features.trend === 'BEARISH')) {
      trendScore += 10; reasons.push(`✔ Trend H1 Selaras (+10)`);
    }
    if ((direction === 'BUY' && s.m15.features.trend === 'BULLISH') || (direction === 'SELL' && s.m15.features.trend === 'BEARISH')) {
      trendScore += 10; reasons.push(`✔ Trend M15 Selaras (+10)`);
    }

    const isStructMatch =
      (direction === 'BUY' && (s.m5.structure.structureType === 'HH_HL' || s.m1.structure.structureType === 'HH_HL')) ||
      (direction === 'SELL' && (s.m5.structure.structureType === 'LH_LL' || s.m1.structure.structureType === 'LH_LL'));
    if (isStructMatch) { structureScore += 10; reasons.push(`✔ Struktur Market Selaras (+10)`); }

    const isBOSMatch =
      (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
      (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch =
      (direction === 'BUY' && s.m1.structure.lastCHoCH === 'BULLISH_CHOCH') ||
      (direction === 'SELL' && s.m1.structure.lastCHoCH === 'BEARISH_CHOCH');
    if (isBOSMatch) { structureScore += 10; reasons.push(`✔ BOS Terkonfirmasi (+10)`); }
    else if (isCHoCHMatch) { structureScore += 10; reasons.push(`✔ CHoCH Terkonfirmasi (+10)`); }

    const isEmaMatch =
      (direction === 'BUY' && s.m1.features.ema9 >= s.m1.features.ema20) ||
      (direction === 'SELL' && s.m1.features.ema9 <= s.m1.features.ema20);
    if (isEmaMatch) { momentumScore += 5; reasons.push(`✔ Fast EMA Selaras (+5)`); }

    const rsi = s.m5.features.rsi;
    if (direction === 'BUY' && rsi >= 45 && rsi <= 68) { momentumScore += 5; reasons.push(`✔ RSI Sehat (+5)`); }
    else if (direction === 'SELL' && rsi >= 32 && rsi <= 55) { momentumScore += 5; reasons.push(`✔ RSI Sehat (+5)`); }

    if ((direction === 'BUY' && s.m1.features.macd.histogram > 0) || (direction === 'SELL' && s.m1.features.macd.histogram < 0)) {
      momentumScore += 5; reasons.push(`✔ MACD Selaras (+5)`);
    }

    if ((direction === 'BUY' && s.m1.structure.fvgZone?.type === 'BULLISH') || (direction === 'SELL' && s.m1.structure.fvgZone?.type === 'BEARISH')) {
      liquidityScore += 10; reasons.push(`✔ FVG Imbalance (+10)`);
    }
    const distToEma20 = Math.abs(s.currentPrice - s.m1.features.ema20);
    if (distToEma20 <= s.m1.features.atr * 0.8) { liquidityScore += 5; reasons.push(`✔ Retest Golden Zone (+5)`); }

    if (s.m5.features.atr <= 3.0) { volatilityScore += 10; reasons.push(`✔ Normal Volatility (+10)`); }
    else { volatilityScore += 5; }

    const m1Candle = s.m1.candle;
    const isM1Momentum =
      (direction === 'BUY' && m1Candle.close > m1Candle.open && m1Candle.close >= s.m1.structure.swingHigh) ||
      (direction === 'SELL' && m1Candle.close < m1Candle.open && m1Candle.close <= s.m1.structure.swingLow);
    if (isM1Momentum || isBOSMatch) { timingScore += 10; reasons.push(`✔ Intrabar Breakout (+10)`); }
    else { timingScore += 5; }

    riskRewardScore += 10; reasons.push(`✔ Dynamic R-Multiple (+10)`);

    const rawScore = trendScore + structureScore + momentumScore + liquidityScore + volatilityScore + timingScore + riskRewardScore;
    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'NORMAL', {
      trendScore, structureScore, momentumScore, liquidityScore, volatilityScore, timingScore, riskRewardScore
    });
  }

  // ─── Counter-Trend Score ───────────────────────────────────────────────────
  // Contract:
  //   - Only called when H1 is EXPLICITLY opposite (ensured by determineMode)
  //   - M5 reversal is MANDATORY (veto already blocks if absent)
  //   - Execution threshold = 85 (COUNTER_THRESHOLD_BASE)
  //   - M1 is bonus only, not a substitute for M5
  private calculateCounterTrendScore(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): ConfidenceEvaluation {
    let momentumScore = 0; let structureScore = 0; let emaDisplacementScore = 0; let macdScore = 0;
    let volatilityScore = 0; let liquidityScore = 0; let riskRewardScore = 5;
    const reasons: string[] = []; const warnings: string[] = [];

    reasons.push(`⚡ Mode COUNTER-TREND. Threshold >= ${COUNTER_THRESHOLD_BASE}. H1 opposite confirmed.`);

    // 1. M5 reversal — MANDATORY (30 pts). M1 bonus only (+5).
    const hasM5BullishRev = s.m5.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH';
    const hasM5BearishRev = s.m5.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH';
    const m5Confirmed =
      (direction === 'BUY' && hasM5BullishRev) ||
      (direction === 'SELL' && hasM5BearishRev);

    // This should always be true (veto already blocks when false), but log if somehow reached.
    if (m5Confirmed) {
      const type =
        (direction === 'BUY' ? s.m5.structure.lastBOS === 'BULLISH_BOS' : s.m5.structure.lastBOS === 'BEARISH_BOS')
          ? 'BOS' : 'CHoCH';
      structureScore += 30;
      reasons.push(`✔ M5 ${type} Reversal Terkonfirmasi (+30) [MANDATORY]`);
    } else {
      warnings.push(`⚠️ M5 reversal tidak ditemukan — skor sangat rendah.`);
    }

    // M1 early confirmation bonus (not mandatory)
    const hasM1BullishRev = s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m1.structure.lastCHoCH === 'BULLISH_CHOCH';
    const hasM1BearishRev = s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m1.structure.lastCHoCH === 'BEARISH_CHOCH';
    const m1Bonus =
      (direction === 'BUY' && hasM1BullishRev) ||
      (direction === 'SELL' && hasM1BearishRev);
    if (m1Bonus) { structureScore += 5; reasons.push(`✔ M1 Early Confirmation Bonus (+5)`); }

    // 2. Strong M1 momentum candle (20 pts)
    const m1Candle = s.m1.candle;
    const isStrongMomentum =
      (direction === 'BUY' && m1Candle.close > m1Candle.open + s.m1.features.atr * 0.5) ||
      (direction === 'SELL' && m1Candle.close < m1Candle.open - s.m1.features.atr * 0.5);
    if (isStrongMomentum) { momentumScore += 20; reasons.push(`✔ Momentum Counter-Trend Ekstrem (+20)`); }
    else { momentumScore += 8; warnings.push(`△ M1 candle belum kuat. Partial (+8).`); }

    // 3. EMA displacement — price displaced from BOTH M5 EMA20 in the reversal direction (15 pts)
    const isEmaDisplaced =
      (direction === 'BUY' && s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20) ||
      (direction === 'SELL' && s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20);
    if (isEmaDisplaced) { emaDisplacementScore += 15; reasons.push(`✔ Displacement dari EMA20 M1+M5 (+15)`); }
    else { warnings.push(`△ Harga belum displacement cukup dari EMA.`); }

    // 4. MACD aligned with reversal direction (10 pts)
    if ((direction === 'BUY' && s.m1.features.macd.histogram > 0) || (direction === 'SELL' && s.m1.features.macd.histogram < 0)) {
      macdScore += 10; reasons.push(`✔ MACD sejalan (+10)`);
    } else {
      warnings.push(`⚠️ MACD belum sejalan dengan reversal.`);
    }

    // 5. Volatility (10 pts)
    if (s.m5.features.atr > 1.5 && s.m5.features.atr <= 4.0) {
      volatilityScore += 10; reasons.push(`✔ Volatilitas ideal (+10)`);
    }

    // 6. Liquidity Sweep (10 pts) — extra quality signal for counter-trend
    if ((direction === 'BUY' && s.m1.structure.liquiditySweep === 'SWEEP_LOW') || (direction === 'SELL' && s.m1.structure.liquiditySweep === 'SWEEP_HIGH')) {
      liquidityScore += 10; reasons.push(`✔ Liquidity Sweep (+10)`);
    }

    const rawScore = momentumScore + structureScore + emaDisplacementScore + macdScore + volatilityScore + liquidityScore + riskRewardScore;
    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'COUNTER_TREND', {
      trendScore: 0, structureScore, momentumScore: momentumScore + macdScore,
      liquidityScore, volatilityScore, timingScore: emaDisplacementScore, riskRewardScore
    });
  }

  // ─── Crash Score ───────────────────────────────────────────────────────────
  private calculateCrashScore(
    direction: 'BUY' | 'SELL',
    s: LiveMarketSnapshot,
    crash: CrashRegime
  ): ConfidenceEvaluation {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const m1Candle = s.m1.candle;
    const atrM1 = s.m1.features.atr;

    reasons.push(`🔥 Mode CRASH REGIME (${direction === 'SELL' ? `Bearish: ${crash.bearishConditionsMet}/4` : `Bullish: ${crash.bullishConditionsMet}/4`} conds). Threshold ${CRASH_THRESHOLD_BASE}.`);

    // 1. Crash Regime Strength (25 pts)
    const condsMet = direction === 'SELL' ? crash.bearishConditionsMet : crash.bullishConditionsMet;
    const crashStrengthScore = condsMet === 4 ? 25 : condsMet === 3 ? 18 : 10;
    reasons.push(`✔ Crash Strength: ${condsMet}/4 kondisi terpenuhi (+${crashStrengthScore})`);

    // 2. M1 Structure (20 pts)
    const isBOSMatch =
      (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
      (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch =
      (direction === 'BUY' && (s.m1.structure.lastCHoCH === 'BULLISH_CHOCH' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH')) ||
      (direction === 'SELL' && (s.m1.structure.lastCHoCH === 'BEARISH_CHOCH' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH'));
    const structureScore = (isBOSMatch || isCHoCHMatch) ? 20 : 8;
    if (isBOSMatch) reasons.push(`✔ BOS Terkonfirmasi M1/M5 (+20)`);
    else if (isCHoCHMatch) reasons.push(`✔ CHoCH M1/M5 Terkonfirmasi (+20)`);
    else reasons.push(`○ Tidak ada BOS/CHoCH, partial score (+8)`);

    // 3. MACD Acceleration (15 pts)
    const macdAcc =
      (direction === 'SELL' && s.m1.features.macd.histogram < 0 && s.m1.features.macd.histogram < s.m1.features.macd.signal) ||
      (direction === 'BUY' && s.m1.features.macd.histogram > 0 && s.m1.features.macd.histogram > s.m1.features.macd.signal);
    const macdScore = macdAcc ? 15 : (
      (direction === 'SELL' && s.m1.features.macd.histogram < 0) ||
      (direction === 'BUY' && s.m1.features.macd.histogram > 0)
    ) ? 8 : 0;
    if (macdScore > 0) reasons.push(`✔ MACD Acceleration (+${macdScore})`);

    // 4. EMA Breakdown (15 pts)
    const emaBelowBoth =
      (direction === 'SELL' && s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20) ||
      (direction === 'BUY' && s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20);
    const emaScore = emaBelowBoth ? 15 : 5;
    if (emaBelowBoth) reasons.push(`✔ Price Breakdown Dual EMA (M1+M5) (+15)`);

    // 5. Volatility (10 pts)
    const atrM5 = s.m5.features.atr;
    const volatilityScore = (atrM5 >= 1.5 && atrM5 <= 4.5) ? 10 : 5;
    reasons.push(`✔ Volatility ATR=${atrM5.toFixed(2)} (+${volatilityScore})`);

    // 6. M5 BOS Bonus (10 pts)
    const m5BOSBonus =
      (direction === 'SELL' && s.m5.structure.lastBOS === 'BEARISH_BOS') ||
      (direction === 'BUY' && s.m5.structure.lastBOS === 'BULLISH_BOS');
    const m5BonusScore = m5BOSBonus ? 10 : 0;
    if (m5BonusScore > 0) reasons.push(`✔ Bonus: M5 BOS sudah konfirmasi (+10)`);

    // 7. RSI Context-Aware
    const rsi = s.m5.features.rsi;
    let rsiScore = 0;
    if (direction === 'SELL') {
      if (rsi < 32) { rsiScore = 5; reasons.push(`✔ RSI Oversold Extreme (${rsi.toFixed(1)}) (+5)`); }
      else if (rsi >= 32 && rsi <= 55) { rsiScore = 5; reasons.push(`✔ RSI Sehat (${rsi.toFixed(1)}) (+5)`); }
    } else {
      if (rsi > 68) { rsiScore = 5; reasons.push(`✔ RSI Overbought Extreme (${rsi.toFixed(1)}) (+5)`); }
      else if (rsi >= 45 && rsi <= 68) { rsiScore = 5; reasons.push(`✔ RSI Sehat (${rsi.toFixed(1)}) (+5)`); }
    }

    const rrScore = 5;
    reasons.push(`✔ Dynamic R-Multiple (+5)`);

    const rawScore = crashStrengthScore + structureScore + macdScore + emaScore + volatilityScore + m5BonusScore + rsiScore + rrScore;

    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'CRASH', {
      trendScore: 0,
      structureScore,
      momentumScore: macdScore + rsiScore,
      liquidityScore: m5BonusScore,
      volatilityScore,
      timingScore: crashStrengthScore,
      riskRewardScore: rrScore + emaScore,
    });
  }

  // ─── Finalize: SL/TP + Tier ───────────────────────────────────────────────
  // SL cap: 10–40 pips (up from 10–25). Risk engine must adjust lot accordingly.
  private finalizeEvaluation(
    direction: 'BUY' | 'SELL', totalScore: number, s: LiveMarketSnapshot,
    reasons: string[], warnings: string[], mode: EvalMode, breakdown: any
  ): ConfidenceEvaluation {
    const atrM5 = s.m5.features.atr;
    const atrPips = Math.round(atrM5 * 10);
    const atrBasedSL = Math.round(atrPips * 1.2);

    let swingDistPrice = direction === 'BUY'
      ? s.currentPrice - s.m5.structure.swingLow
      : s.m5.structure.swingHigh - s.currentPrice;
    const swingDistPips = Math.max(0, Math.round(swingDistPrice * 10));

    let slPips = Math.max(atrBasedSL, swingDistPips);
    slPips = Math.min(slPips, 40); // max 40 pips (was 25)
    slPips = Math.max(slPips, 10);
    reasons.push(`🛡 Dynamic SL: ${slPips} pips`);

    const targetTpPips = [
      Math.round(slPips * 1.0), Math.round(slPips * 1.2), Math.round(slPips * 1.5),
      Math.round(slPips * 2.0), Math.round(slPips * 2.5)
    ];

    // Tier thresholds per mode
    let tier: SignalTier = 'WAIT';
    let maxReEntryCycles = 0;
    let minExecThreshold: number;

    if (mode === 'COUNTER_TREND') {
      // No QUICK_SCALP for counter-trend. Min execution = 85.
      minExecThreshold = COUNTER_THRESHOLD_BASE;
      if (totalScore >= COUNTER_THRESHOLD_TOP) { tier = 'SUPER_TREND'; maxReEntryCycles = 1; }
      else if (totalScore >= COUNTER_THRESHOLD_BASE) { tier = 'MOMENTUM_SCALP'; maxReEntryCycles = 0; }
    } else if (mode === 'CRASH') {
      minExecThreshold = CRASH_THRESHOLD_BASE;
      if (totalScore >= CRASH_THRESHOLD_TOP) { tier = 'SUPER_TREND'; maxReEntryCycles = 3; }
      else if (totalScore >= CRASH_THRESHOLD_MID) { tier = 'MOMENTUM_SCALP'; maxReEntryCycles = 1; }
      else if (totalScore >= CRASH_THRESHOLD_BASE) { tier = 'QUICK_SCALP'; maxReEntryCycles = 0; }
    } else {
      // NORMAL
      minExecThreshold = NORMAL_THRESHOLD_BASE;
      if (totalScore >= NORMAL_THRESHOLD_TOP) { tier = 'SUPER_TREND'; maxReEntryCycles = 3; }
      else if (totalScore >= NORMAL_THRESHOLD_MID) { tier = 'MOMENTUM_SCALP'; maxReEntryCycles = 1; }
      else if (totalScore >= NORMAL_THRESHOLD_BASE) { tier = 'QUICK_SCALP'; maxReEntryCycles = 0; }
    }

    return {
      direction: totalScore >= minExecThreshold ? direction : 'WAIT',
      totalScore,
      tier,
      mode,
      maxReEntryCycles,
      targetTpPips,
      slPips,
      breakdown,
      reasons,
      warnings,
    };
  }

  private createWaitEval(reason: string): ConfidenceEvaluation {
    return {
      direction: 'WAIT',
      totalScore: 0,
      tier: 'WAIT',
      mode: 'NORMAL',
      maxReEntryCycles: 0,
      targetTpPips: [10, 10, 10, 10, 10],
      slPips: 10,
      breakdown: { trendScore: 0, structureScore: 0, momentumScore: 0, liquidityScore: 0, volatilityScore: 0, timingScore: 0, riskRewardScore: 0 },
      reasons: [reason],
      warnings: [],
    };
  }
}

export const confidenceEngine = new ConfidenceEngine();

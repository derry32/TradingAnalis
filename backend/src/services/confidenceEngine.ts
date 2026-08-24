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
    // ATR dihitung dalam satuan harga raw XAUUSD. 1 pip = 0.1 jadi ATR 15.0 = 150 pips per M5 candle.
    // Threshold 4.5 (= 45 pips) terlalu rendah untuk hari-hari volatile XAUUSD.
    // Dinaikkan ke 15.0 (= 150 pips) agar hanya memblok kondisi benar-benar ekstrem (misal: news NFP crash 1500 pips).
    if (atrM5 >= 15.0) {
      console.log(`[CE] GATE1 BLOCK: ATR M5 = ${atrM5.toFixed(4)} >= 15.0 (EXTREME). Resiko terlalu tinggi.`);
      return this.createWaitEval(`EXTREME Volatility (ATR M5=${atrM5.toFixed(4)} >= 15.0). Resiko terlalu tinggi.`);
    }
    console.log(`[CE] GATE1 PASS: ATR M5 = ${atrM5.toFixed(4)}`);

    // GATE 2: Detect Fast Regime (M1+M5 only, tidak menunggu H1/M15)
    const crashRegime = this.detectCrashRegime(snapshot);

    // GATE 3: Veto Check (Falling Knife & Shooting Rocket)
    const buyVeto = this.checkVeto('BUY', snapshot);
    const sellVeto = this.checkVeto('SELL', snapshot);

    let bestEval: ConfidenceEvaluation | null = null;
    let maxScore = -1;

    // GATE 4a: Evaluate BUY
    if (!buyVeto.isVetoed) {
      const isMacroBuy = snapshot.h1.features.trend === 'BULLISH' && snapshot.m15.features.trend !== 'BEARISH';
      const isCrashBuy = crashRegime.isCrashBullish;

      let evalResult: ConfidenceEvaluation;
      let threshold: number;

      if (isCrashBuy) {
        evalResult = this.calculateCrashScore('BUY', snapshot, crashRegime);
        threshold = 60; // Crash Mode threshold
      } else if (isMacroBuy) {
        evalResult = this.calculateNormalScore('BUY', snapshot);
        threshold = 60;
      } else {
        evalResult = this.calculateCounterTrendScore('BUY', snapshot);
        threshold = 70;
      }

      if (evalResult.totalScore > maxScore && evalResult.totalScore >= threshold) {
        bestEval = evalResult;
        maxScore = evalResult.totalScore;
      }
    }

    // GATE 4b: Evaluate SELL
    if (!sellVeto.isVetoed) {
      const isMacroSell = snapshot.h1.features.trend === 'BEARISH' && snapshot.m15.features.trend !== 'BULLISH';
      const isCrashSell = crashRegime.isCrashBearish;

      let evalResult: ConfidenceEvaluation;
      let threshold: number;

      if (isCrashSell) {
        evalResult = this.calculateCrashScore('SELL', snapshot, crashRegime);
        threshold = 60; // Crash Mode threshold
      } else if (isMacroSell) {
        evalResult = this.calculateNormalScore('SELL', snapshot);
        threshold = 60;
      } else {
        evalResult = this.calculateCounterTrendScore('SELL', snapshot);
        threshold = 70;
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

    // GATE 5: Extension Guard
    // Saat CRASH, batas dilonggarkan ke 4.0x ATR agar bisa ikut momentum tajam tanpa harus menunggu pullback
    const isExtended = this.checkExtensionGuard(bestEval.direction, snapshot, bestEval.mode);
    if (isExtended) {
      bestEval.direction = 'WAIT';
      bestEval.tier = 'WAIT';
      bestEval.reasons.push(`⛔ EXTENSION GUARD: Harga > 2.0x ATR dari EMA20 M5. Menunggu pullback.`);
    }

    // Decision Trace Log
    console.log(
      `[CE] Dir=${bestEval.direction} Score=${bestEval.totalScore} Mode=${bestEval.mode}` +
      ` Crash={B:${crashRegime.bearishConditionsMet}/4 U:${crashRegime.bullishConditionsMet}/4}` +
      ` ExtGuard=${isExtended} BuyVeto=${buyVeto.isVetoed} SellVeto=${sellVeto.isVetoed}`
    );

    return bestEval;
  }

  // ─── Fast Regime Detector (M1 + M5 only, tidak bergantung H1/M15) ───────────
  private detectCrashRegime(s: LiveMarketSnapshot): CrashRegime {
    const m1Candle = s.m1.candle;
    const atrM1 = s.m1.features.atr;

    // --- Bearish Crash Conditions ---
    const bearishCond1 = s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20;
    const bearishCond2 = s.m1.features.macd.histogram < 0 && s.m1.features.macd.histogram < s.m1.features.macd.signal;
    const bearishCond3 = s.m1.structure.lastBOS === 'BEARISH_BOS' && s.m5.structure.lastBOS === 'BEARISH_BOS';
    const bearishCond4 = m1Candle.close < m1Candle.open && (m1Candle.open - m1Candle.close) > atrM1 * 0.5;

    const bearishConditionsMet = [bearishCond1, bearishCond2, bearishCond3, bearishCond4].filter(Boolean).length;

    // --- Bullish Crash Conditions ---
    const bullishCond1 = s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20;
    const bullishCond2 = s.m1.features.macd.histogram > 0 && s.m1.features.macd.histogram > s.m1.features.macd.signal;
    const bullishCond3 = s.m1.structure.lastBOS === 'BULLISH_BOS' && s.m5.structure.lastBOS === 'BULLISH_BOS';
    const bullishCond4 = m1Candle.close > m1Candle.open && (m1Candle.close - m1Candle.open) > atrM1 * 0.5;

    const bullishConditionsMet = [bullishCond1, bullishCond2, bullishCond3, bullishCond4].filter(Boolean).length;

    // H1 Trend Guard (Mencegah false crash saat H1 berlawanan)
    const isH1Bullish = s.h1.features.trend === 'BULLISH';
    const isH1Bearish = s.h1.features.trend === 'BEARISH';

    return {
      isCrashBearish: bearishConditionsMet >= 3 && !isH1Bullish,
      isCrashBullish: bullishConditionsMet >= 3 && !isH1Bearish,
      bearishConditionsMet,
      bullishConditionsMet,
    };
  }

  // ─── Crash Mode Scoring (H1 bias dikurangi, M1 structure & momentum naik) ──
  private calculateCrashScore(
    direction: 'BUY' | 'SELL',
    s: LiveMarketSnapshot,
    crash: CrashRegime
  ): ConfidenceEvaluation {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const m1Candle = s.m1.candle;
    const atrM1 = s.m1.features.atr;

    reasons.push(`🔥 Mode CRASH REGIME (${direction === 'SELL' ? `Bearish: ${crash.bearishConditionsMet}/4` : `Bullish: ${crash.bullishConditionsMet}/4`} conds). Threshold 60.`);

    // 1. Crash Regime Strength (25 pts)
    const condsMet = direction === 'SELL' ? crash.bearishConditionsMet : crash.bullishConditionsMet;
    const crashStrengthScore = condsMet === 4 ? 25 : condsMet === 3 ? 18 : 10;
    reasons.push(`✔ Crash Strength: ${condsMet}/4 kondisi terpenuhi (+${crashStrengthScore})`);

    // 2. M1 Structure — early confirmation, M5 BOS bukan prerequisite (20 pts)
    const isBOSMatch =
      (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
      (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch =
      (direction === 'BUY' && (s.m1.structure.lastCHoCH === 'BULLISH_CHOCH' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH')) ||
      (direction === 'SELL' && (s.m1.structure.lastCHoCH === 'BEARISH_CHOCH' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH'));
    const structureScore = (isBOSMatch || isCHoCHMatch) ? 20 : 8; // partial credit even without BOS
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

    // 4. EMA Breakdown Score (15 pts)
    const emaBelowBoth =
      (direction === 'SELL' && s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20) ||
      (direction === 'BUY' && s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20);
    const emaScore = emaBelowBoth ? 15 : 5;
    if (emaBelowBoth) reasons.push(`✔ Price Breakdown Dual EMA (M1+M5) (+15)`);

    // 5. Volatility (10 pts) — lebih longgar di crash mode
    const atrM5 = s.m5.features.atr;
    const volatilityScore = (atrM5 >= 1.5 && atrM5 <= 4.5) ? 10 : 5;
    reasons.push(`✔ Volatility ATR=${atrM5.toFixed(2)} (+${volatilityScore})`);

    // 6. M5 BOS Bonus — confirmation, bukan prerequisite (0 atau 10 pts)
    const m5BOSBonus =
      (direction === 'SELL' && s.m5.structure.lastBOS === 'BEARISH_BOS') ||
      (direction === 'BUY' && s.m5.structure.lastBOS === 'BULLISH_BOS');
    const m5BonusScore = m5BOSBonus ? 10 : 0;
    if (m5BonusScore > 0) reasons.push(`✔ Bonus: M5 BOS sudah konfirmasi (+10)`);

    // 7. RSI Context-Aware (dynamic, bukan batas bawah = 0)
    const rsi = s.m5.features.rsi;
    let rsiScore = 0;
    if (direction === 'SELL') {
      if (rsi < 32) {
        rsiScore = 5;
        reasons.push(`✔ RSI Oversold Extreme (${rsi.toFixed(1)}) — bearish momentum kuat (+5)`);
      } else if (rsi >= 32 && rsi <= 55) {
        rsiScore = 5;
        reasons.push(`✔ RSI Sehat (${rsi.toFixed(1)}) (+5)`);
      }
    } else {
      if (rsi > 68) {
        rsiScore = 5;
        reasons.push(`✔ RSI Overbought Extreme (${rsi.toFixed(1)}) — bullish momentum kuat (+5)`);
      } else if (rsi >= 45 && rsi <= 68) {
        rsiScore = 5;
        reasons.push(`✔ RSI Sehat (${rsi.toFixed(1)}) (+5)`);
      }
    }

    // R/R (5 pts)
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

  // ─── Veto Check ──────────────────────────────────────────────────────────────
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

  // ─── Extension Guard ────────────────────────────────────────────────────────
  private checkExtensionGuard(direction: 'BUY' | 'SELL' | 'WAIT', s: LiveMarketSnapshot, mode: string = 'NORMAL'): boolean {
    if (direction === 'WAIT') return false;
    const atrM5 = s.m5.features.atr;
    const distToEma20 = Math.abs(s.currentPrice - s.m5.features.ema20);
    
    // Saat CRASH, batas dilonggarkan ke 4.0x ATR karena harga bergerak sangat cepat menjauhi EMA.
    // Jika Normal / Counter-Trend, batas tetap ketat 2.0x ATR untuk mencegah fomo (anti-chasing).
    const maxAtrMultiplier = mode === 'CRASH' ? 4.0 : 2.0;
    
    return distToEma20 > atrM5 * maxAtrMultiplier;
  }

  // ─── Normal Score ────────────────────────────────────────────────────────────
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

  // ─── Counter-Trend Score ─────────────────────────────────────────────────────
  private calculateCounterTrendScore(direction: 'BUY' | 'SELL', s: LiveMarketSnapshot): ConfidenceEvaluation {
    let momentumScore = 0; let structureScore = 0; let emaDisplacementScore = 0; let macdScore = 0;
    let volatilityScore = 0; let liquidityScore = 0; let riskRewardScore = 5;
    const reasons: string[] = []; const warnings: string[] = [];

    reasons.push(`⚡ Mode COUNTER-TREND. Threshold >= 75.`);

    const m1Candle = s.m1.candle;
    const isStrongMomentum =
      (direction === 'BUY' && m1Candle.close > m1Candle.open + s.m1.features.atr * 0.5) ||
      (direction === 'SELL' && m1Candle.close < m1Candle.open - s.m1.features.atr * 0.5);
    if (isStrongMomentum) { momentumScore += 25; reasons.push(`✔ Momentum Counter-Trend Ekstrem (+25)`); }
    else { momentumScore += 10; }

    const isBOSMatch =
      (direction === 'BUY' && (s.m1.structure.lastBOS === 'BULLISH_BOS' || s.m5.structure.lastBOS === 'BULLISH_BOS')) ||
      (direction === 'SELL' && (s.m1.structure.lastBOS === 'BEARISH_BOS' || s.m5.structure.lastBOS === 'BEARISH_BOS'));
    const isCHoCHMatch =
      (direction === 'BUY' && (s.m1.structure.lastCHoCH === 'BULLISH_CHOCH' || s.m5.structure.lastCHoCH === 'BULLISH_CHOCH')) ||
      (direction === 'SELL' && (s.m1.structure.lastCHoCH === 'BEARISH_CHOCH' || s.m5.structure.lastCHoCH === 'BEARISH_CHOCH'));
    if (isBOSMatch || isCHoCHMatch) { structureScore += 25; reasons.push(`✔ BOS/CHoCH mendukung (+25)`); }

    const isEmaDisplaced =
      (direction === 'BUY' && s.currentPrice > s.m1.features.ema20 && s.currentPrice > s.m5.features.ema20) ||
      (direction === 'SELL' && s.currentPrice < s.m1.features.ema20 && s.currentPrice < s.m5.features.ema20);
    if (isEmaDisplaced) { emaDisplacementScore += 15; reasons.push(`✔ Displacement dari EMA20 (+15)`); }

    if ((direction === 'BUY' && s.m1.features.macd.histogram > 0) || (direction === 'SELL' && s.m1.features.macd.histogram < 0)) {
      macdScore += 10; reasons.push(`✔ MACD sejalan (+10)`);
    }

    if (s.m5.features.atr > 1.5 && s.m5.features.atr <= 4.0) {
      volatilityScore += 10; reasons.push(`✔ Volatilitas ideal (+10)`);
    }

    if ((direction === 'BUY' && s.m1.structure.liquiditySweep === 'SWEEP_LOW') || (direction === 'SELL' && s.m1.structure.liquiditySweep === 'SWEEP_HIGH')) {
      liquidityScore += 10; reasons.push(`✔ Liquidity Sweep (+10)`);
    }

    const rawScore = momentumScore + structureScore + emaDisplacementScore + macdScore + volatilityScore + liquidityScore + riskRewardScore;
    return this.finalizeEvaluation(direction, Math.min(100, rawScore), s, reasons, warnings, 'COUNTER_TREND', {
      trendScore: 0, structureScore, momentumScore: momentumScore + macdScore,
      liquidityScore, volatilityScore, timingScore: emaDisplacementScore, riskRewardScore
    });
  }

  // ─── Finalize: SL/TP + Tier ──────────────────────────────────────────────────
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
    slPips = Math.min(slPips, 25);
    slPips = Math.max(slPips, 10);
    reasons.push(`🛡 Dynamic SL: ${slPips} pips`);

    const targetTpPips = [
      Math.round(slPips * 1.0), Math.round(slPips * 1.2), Math.round(slPips * 1.5),
      Math.round(slPips * 2.0), Math.round(slPips * 2.5)
    ];

    const thresholdBase = mode === 'NORMAL' ? 55 : mode === 'CRASH' ? 55 : 70;
    const thresholdMid  = mode === 'NORMAL' ? 65 : mode === 'CRASH' ? 70 : 80;
    const thresholdTop  = mode === 'NORMAL' ? 80 : mode === 'CRASH' ? 85 : 90;

    let tier: SignalTier = 'WAIT';
    let maxReEntryCycles = 0;
    if (totalScore >= thresholdTop) { tier = 'SUPER_TREND'; maxReEntryCycles = 3; }
    else if (totalScore >= thresholdMid) { tier = 'MOMENTUM_SCALP'; maxReEntryCycles = 1; }
    else if (totalScore >= thresholdBase) { tier = 'QUICK_SCALP'; maxReEntryCycles = 0; }

    return {
      direction: totalScore >= thresholdBase ? direction : 'WAIT',
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

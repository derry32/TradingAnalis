import { config } from '../config';
import { AnalysisResult } from './technicalAnalysis';

export type AtrRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

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

  // === BASKET ENGINE v2 ===
  basketTarget?: number;
  basketInvalidation?: number;
  atrRegime?: AtrRegime;
}

type Direction = 'BUY' | 'SELL';
type Strategy = 'SNIPER' | 'HYPER_SCALPER';

interface ScoreBreakdown {
  total: number;

  directionScore: number;
  setupScore: number;
  locationScore: number;
  entryScore: number;
  volumeScore: number;
  regimeScore: number;
  roomScore: number;

  reasons: string[];
  warnings: string[];
}

interface TradeCandidate {
  dir: Direction;
  score: number;
  breakdown: ScoreBreakdown;

  stopLoss: number;
  tp1: number;
  tp2: number;

  setupType: string;
  maxTargetPrice: number;
  trueRR: number;
}

export class SignalGenerator {

  // ============================================================
  // V3 RELAXED 60
  // ============================================================

  /**
   * TOTAL SCORE = 100
   *
   * Direction = 15
   * Structure = 20
   * Location = 15
   * Entry = 25
   * Volume = 10
   * Regime = 10
   * Room = 5
   *
   * TOTAL = 100
   */
  private readonly SCORE_WEIGHTS = {
    direction: 15,
    structure: 20,
    location: 15,
    entry: 25,
    volume: 10,
    regime: 10,
    room: 5,
  };

  // ============================================================
  // CATEGORY GATES
  // ============================================================

  /**
   * V3 RELAXED 60
   *
   * Direction >= 45
   * Setup     >= 45
   * Entry     >= 55
   *
   * Total      >= 60
   *
   * Hard protection tetap aktif.
   */
  private readonly MIN_DIRECTION_SCORE = 45;
  private readonly MIN_SETUP_SCORE = 45;
  private readonly MIN_ENTRY_SCORE = 55;

  // ============================================================
  // TRUE RR
  // ============================================================

  private readonly MIN_TRUE_RR = 1.15;

  // ============================================================
  // SL BOUNDARY
  // ============================================================

  private readonly MIN_SL_DISTANCE = 0.80;
  private readonly MAX_SL_DISTANCE = 6.50;

  // ============================================================
  // ATR REGIME
  // ============================================================

  private getAtrRegime(atr: number): AtrRegime {

    if (!Number.isFinite(atr) || atr <= 0) {
      return 'LOW';
    }

    if (atr >= config.ATR_REGIME_HIGH_MAX) {
      return 'EXTREME';
    }

    if (atr >= config.ATR_REGIME_NORMAL_MAX) {
      return 'HIGH';
    }

    if (atr >= config.ATR_REGIME_LOW_MAX) {
      return 'NORMAL';
    }

    return 'LOW';
  }

  // ============================================================
  // SESSION
  // ============================================================

  private getSession(hourWIB: number): {
    name: string;
    type: string;
  } {

    if (hourWIB >= 19 && hourWIB < 23) {
      return {
        name: 'London-New York Overlap',
        type: 'OVERLAP',
      };
    }

    if (hourWIB >= 14 && hourWIB < 19) {
      return {
        name: 'London Session',
        type: 'LONDON',
      };
    }

    if (hourWIB >= 23 || hourWIB < 4) {
      return {
        name: 'New York Session',
        type: 'NY',
      };
    }

    if (hourWIB >= 7 && hourWIB < 14) {
      return {
        name: 'Tokyo Session',
        type: 'TOKYO',
      };
    }

    if (hourWIB >= 5 && hourWIB < 7) {
      return {
        name: 'Sydney Session',
        type: 'SYDNEY',
      };
    }

    return {
      name: 'Off-hours',
      type: 'OFF',
    };
  }

  // ============================================================
  // PATTERN HELPERS
  // ============================================================

  private isBullishPattern(pattern: string): boolean {

    return [
      'BULLISH_ENGULFING',
      'MARUBOZU_BULL',
      'THREE_WHITE_SOLDIERS',
    ].includes(pattern);
  }

  private isBearishPattern(pattern: string): boolean {

    return [
      'BEARISH_ENGULFING',
      'MARUBOZU_BEAR',
      'THREE_BLACK_CROWS',
    ].includes(pattern);
  }

  private isDirectionalPattern(
    direction: Direction,
    pattern: string
  ): boolean {

    if (pattern === 'PIN_BAR') {
      return true;
    }

    return direction === 'BUY'
      ? this.isBullishPattern(pattern)
      : this.isBearishPattern(pattern);
  }

  private isStrongDirectionalPattern(
    direction: Direction,
    pattern: string
  ): boolean {

    if (direction === 'BUY') {
      return [
        'BULLISH_ENGULFING',
        'MARUBOZU_BULL',
        'THREE_WHITE_SOLDIERS',
      ].includes(pattern);
    }

    return [
      'BEARISH_ENGULFING',
      'MARUBOZU_BEAR',
      'THREE_BLACK_CROWS',
    ].includes(pattern);
  }

  private isOppositeStrongPattern(
    direction: Direction,
    pattern: string
  ): boolean {

    if (direction === 'BUY') {
      return this.isBearishPattern(pattern);
    }

    return this.isBullishPattern(pattern);
  }

  // ============================================================
  // ATR M5
  // ============================================================

  private getAtrM5(
    analysis: AnalysisResult
  ): number {

    const analysisWithAtrM5 =
      analysis as AnalysisResult & {
        atr_M5?: number;
      };

    const atrM5 =
      Number(analysisWithAtrM5.atr_M5);

    if (
      Number.isFinite(atrM5) &&
      atrM5 > 0
    ) {
      return atrM5;
    }

    return analysis.atr_M15 || 1.5;
  }

  // ============================================================
  // SETUP TYPE
  // ============================================================

  private determineSetupType(
    direction: Direction,
    analysis: AnalysisResult,
    isNewsBreakout: boolean
  ): string {

    if (isNewsBreakout) {
      return '💥 Breakout (High Impact News)';
    }

    if (
      analysis.marketStructureM15.includes(
        'FAKE_BREAKOUT'
      )
    ) {
      return '🪤 Liquidity Grab / Reclaim';
    }

    if (
      analysis.marketPhase === 'BREAKOUT' ||
      (
        direction === 'BUY' &&
        analysis.marketStructureM15 === 'BOS_BULL'
      ) ||
      (
        direction === 'SELL' &&
        analysis.marketStructureM15 === 'BOS_BEAR'
      )
    ) {
      return '💥 Breakout Momentum';
    }

    if (
      analysis.marketPhase === 'PULLBACK' ||
      analysis.fibonacciZoneM15 !== 'NONE'
    ) {
      return '🔄 Pullback Entry';
    }

    if (
      analysis.marketPhase === 'RANGE' ||
      analysis.structureH1 === 'EQUAL_RANGE'
    ) {
      return direction === 'BUY'
        ? '📦 Range Buy / Support Bound'
        : '📦 Range Sell / Resistance Bound';
    }

    if (
      (direction === 'BUY' &&
        analysis.isAtSupportH1) ||
      (direction === 'SELL' &&
        analysis.isAtResistanceH1)
    ) {
      return '🔁 S/R Key Level Reversal';
    }

    return '📈 Trend Continuation';
  }

  // ============================================================
  // DIRECTION SCORE
  // MAX = 15
  // ============================================================

  private calculateDirectionComponent(
    direction: Direction,
    analysis: AnalysisResult,
    reasons: string[],
    warnings: string[]
  ): number {

    let score = 0;

    const h1Match =
      (
        direction === 'BUY' &&
        analysis.trendH1 === 'BULLISH'
      ) ||
      (
        direction === 'SELL' &&
        analysis.trendH1 === 'BEARISH'
      );

    const m15Match =
      (
        direction === 'BUY' &&
        analysis.trendM15 === 'BULLISH'
      ) ||
      (
        direction === 'SELL' &&
        analysis.trendM15 === 'BEARISH'
      );

    const h1Neutral =
      analysis.trendH1 === 'NEUTRAL';

    const m15Neutral =
      analysis.trendM15 === 'NEUTRAL';

    // H1 = 8
    if (h1Match) {

      score += 8;

      reasons.push(
        `✔ H1 Direction ${analysis.trendH1} selaras (+8)`
      );

    } else if (h1Neutral) {

      score += 4;

      reasons.push(
        `△ H1 Neutral / Range (+4)`
      );

    } else {

      warnings.push(
        `⚠️ H1 ${analysis.trendH1} berlawanan dengan ${direction}`
      );
    }

    // M15 = 7
    if (m15Match) {

      score += 7;

      reasons.push(
        `✔ M15 Direction ${analysis.trendM15} selaras (+7)`
      );

    } else if (m15Neutral) {

      score += 3;

      reasons.push(
        `△ M15 Neutral / Range (+3)`
      );

    } else {

      warnings.push(
        `⚠️ M15 ${analysis.trendM15} tidak mendukung ${direction}`
      );
    }

    return score;
  }

  // ============================================================
  // STRUCTURE SCORE
  // MAX = 20
  // ============================================================

  private calculateStructureComponent(
    direction: Direction,
    analysis: AnalysisResult,
    reasons: string[],
    warnings: string[]
  ): number {

    const structure =
      analysis.marketStructureM15;

    if (
      (
        direction === 'BUY' &&
        structure === 'BOS_BULL'
      ) ||
      (
        direction === 'SELL' &&
        structure === 'BOS_BEAR'
      )
    ) {

      reasons.push(
        `✔ M15 BOS searah (+20)`
      );

      return 20;
    }

    if (
      (
        direction === 'BUY' &&
        structure === 'CHOCH_BULL'
      ) ||
      (
        direction === 'SELL' &&
        structure === 'CHOCH_BEAR'
      )
    ) {

      reasons.push(
        `✔ M15 CHoCH searah (+15)`
      );

      return 15;
    }

    if (
      (
        direction === 'BUY' &&
        structure === 'FAKE_BREAKOUT_BULL'
      ) ||
      (
        direction === 'SELL' &&
        structure === 'FAKE_BREAKOUT_BEAR'
      )
    ) {

      reasons.push(
        `✔ Liquidity Grab / Fake Breakout searah (+8)`
      );

      warnings.push(
        `⚠️ Liquidity Grab belum sekuat BOS continuation`
      );

      return 8;
    }

    warnings.push(
      `△ Tidak ada M15 structure confirmation searah`
    );

    return 0;
  }

  // ============================================================
  // LOCATION SCORE
  // MAX = 15
  // ============================================================

  private calculateLocationComponent(
    direction: Direction,
    analysis: AnalysisResult,
    reasons: string[],
    warnings: string[]
  ): number {

    let score = 0;

    const atSR =
      direction === 'BUY'
        ? analysis.isAtSupportH1
        : analysis.isAtResistanceH1;

    const fibMatch =
      direction === 'BUY'
        ? analysis.fibonacciZoneM15 === 'GOLDEN_BULL'
        : analysis.fibonacciZoneM15 === 'GOLDEN_BEAR';

    if (atSR) {

      score += 10;

      reasons.push(
        direction === 'BUY'
          ? `✔ Harga berada di Support H1 (+10)`
          : `✔ Harga berada di Resistance H1 (+10)`
      );
    }

    if (fibMatch) {

      score += 5;

      reasons.push(
        `✔ Fibonacci Golden Zone searah (+5)`
      );
    }

    if (!atSR && !fibMatch) {

      warnings.push(
        `△ Tidak ada S/R atau Fibonacci confluence yang jelas`
      );
    }

    if (atSR && fibMatch) {

      reasons.push(
        `🔥 S/R + Fibonacci Confluence aktif`
      );
    }

    return score;
  }

  // ============================================================
  // ENTRY SCORE
  // MAX = 25
  // ============================================================

  private calculateEntryComponent(
    direction: Direction,
    analysis: AnalysisResult,
    isNewsBreakout: boolean,
    reasons: string[],
    warnings: string[]
  ): number {

    if (isNewsBreakout) {

      reasons.push(
        `🔥 News Breakout Mode (+25)`
      );

      return 25;
    }

    const pattern =
      analysis.patternM5;

    const directionalPattern =
      this.isDirectionalPattern(
        direction,
        pattern
      );

    const strongPattern =
      this.isStrongDirectionalPattern(
        direction,
        pattern
      );

    if (strongPattern) {

      reasons.push(
        `✔ Strong M5 Entry Trigger ` +
        `(${pattern.replace(/_/g, ' ')}) (+25)`
      );

      return 25;
    }

    if (directionalPattern) {

      reasons.push(
        `✔ M5 Price Action Trigger ` +
        `(${pattern.replace(/_/g, ' ')}) (+20)`
      );

      return 20;
    }

    if (analysis.strongVolumeM5) {

      reasons.push(
        `✔ Strong Volume M5 (+16)`
      );

      return 16;
    }

    if (analysis.volumeSpikeM5) {

      warnings.push(
        `⚠️ Volume Spike M5 — aggressive entry (+12)`
      );

      return 12;
    }

    if (
      (
        direction === 'BUY' &&
        analysis.marketStructureM15 === 'BOS_BULL'
      ) ||
      (
        direction === 'SELL' &&
        analysis.marketStructureM15 === 'BOS_BEAR'
      )
    ) {

      warnings.push(
        `△ M15 BOS tersedia tetapi M5 candle belum ideal (+10)`
      );

      return 10;
    }

    if (
      (
        direction === 'BUY' &&
        analysis.marketStructureM15 === 'CHOCH_BULL'
      ) ||
      (
        direction === 'SELL' &&
        analysis.marketStructureM15 === 'CHOCH_BEAR'
      )
    ) {

      warnings.push(
        `△ M15 CHoCH tersedia tetapi M5 trigger belum ideal (+8)`
      );

      return 8;
    }

    warnings.push(
      `△ Tidak ada M5 trigger yang cukup kuat`
    );

    return 0;
  }

  // ============================================================
  // VOLUME SCORE
  // MAX = 10
  // ============================================================

  private calculateVolumeComponent(
    analysis: AnalysisResult,
    reasons: string[],
    warnings: string[]
  ): number {

    if (analysis.strongVolumeM5) {

      reasons.push(
        `✔ Institutional Volume M5 kuat (+10)`
      );

      return 10;
    }

    if (analysis.volumeSpikeM5) {

      reasons.push(
        `✔ Volume Spike M5 (+6)`
      );

      return 6;
    }

    warnings.push(
      `△ Volume belum menunjukkan expansion kuat`
    );

    return 0;
  }

  // ============================================================
  // REGIME SCORE
  // MAX = 10
  // ============================================================

  private calculateRegimeComponent(
    atrRegime: AtrRegime,
    reasons: string[],
    warnings: string[]
  ): number {

    switch (atrRegime) {

      case 'NORMAL':

        reasons.push(
          `✔ ATR NORMAL — kondisi sehat (+10)`
        );

        return 10;

      case 'HIGH':

        reasons.push(
          `✔ ATR HIGH — momentum bagus, risk meningkat (+8)`
        );

        return 8;

      case 'LOW':

        warnings.push(
          `⚠️ ATR LOW — market relatif sepi (+6)`
        );

        return 6;

      case 'EXTREME':

        warnings.push(
          `🚨 ATR EXTREME — emergency/news mode`
        );

        return 0;
    }
  }

  // ============================================================
  // ROOM SCORE
  // MAX = 5
  // ============================================================

  private calculateRoomComponent(
    trueRR: number,
    reasons: string[],
    warnings: string[]
  ): number {

    if (trueRR >= 2.0) {

      reasons.push(
        `✔ Room sangat luas (RR ${trueRR.toFixed(2)}x) (+5)`
      );

      return 5;
    }

    if (trueRR >= 1.7) {

      reasons.push(
        `✔ Room bagus (RR ${trueRR.toFixed(2)}x) (+4)`
      );

      return 4;
    }

    if (trueRR >= 1.5) {

      reasons.push(
        `✔ Room cukup (RR ${trueRR.toFixed(2)}x) (+3)`
      );

      return 3;
    }

    if (trueRR >= this.MIN_TRUE_RR) {

      reasons.push(
        `△ Room minimum valid (RR ${trueRR.toFixed(2)}x) (+2)`
      );

      return 2;
    }

    warnings.push(
      `✖ Room terlalu sempit (RR ${trueRR.toFixed(2)}x)`
    );

    return 0;
  }

  // ============================================================
  // SCORE ENGINE
  // ============================================================

  private calculateScoreV3(
    direction: Direction,
    analysis: AnalysisResult,
    atrRegime: AtrRegime,
    isNewsBreakout: boolean,
    trueRR: number
  ): ScoreBreakdown {

    const reasons: string[] = [];
    const warnings: string[] = [];

    const directionRaw =
      this.calculateDirectionComponent(
        direction,
        analysis,
        reasons,
        warnings
      );

    const structureRaw =
      this.calculateStructureComponent(
        direction,
        analysis,
        reasons,
        warnings
      );

    const locationRaw =
      this.calculateLocationComponent(
        direction,
        analysis,
        reasons,
        warnings
      );

    const entryRaw =
      this.calculateEntryComponent(
        direction,
        analysis,
        isNewsBreakout,
        reasons,
        warnings
      );

    const volumeRaw =
      this.calculateVolumeComponent(
        analysis,
        reasons,
        warnings
      );

    const regimeRaw =
      this.calculateRegimeComponent(
        atrRegime,
        reasons,
        warnings
      );

    const roomRaw =
      this.calculateRoomComponent(
        trueRR,
        reasons,
        warnings
      );

    const total =
      directionRaw +
      structureRaw +
      locationRaw +
      entryRaw +
      volumeRaw +
      regimeRaw +
      roomRaw;

    const directionScore =
      Math.round(
        (
          directionRaw /
          this.SCORE_WEIGHTS.direction
        ) * 100
      );

    const setupScore =
      Math.round(
        (
          (
            structureRaw +
            locationRaw
          ) /
          (
            this.SCORE_WEIGHTS.structure +
            this.SCORE_WEIGHTS.location
          )
        ) * 100
      );

    const entryScore =
      Math.round(
        (
          (
            entryRaw +
            volumeRaw
          ) /
          (
            this.SCORE_WEIGHTS.entry +
            this.SCORE_WEIGHTS.volume
          )
        ) * 100
      );

    return {

      total:
        Math.max(
          0,
          Math.min(
            100,
            Math.round(total)
          )
        ),

      directionScore,

      setupScore,

      locationScore:
        Math.round(
          (
            locationRaw /
            this.SCORE_WEIGHTS.location
          ) * 100
        ),

      entryScore,

      volumeScore:
        Math.round(
          (
            volumeRaw /
            this.SCORE_WEIGHTS.volume
          ) * 100
        ),

      regimeScore:
        Math.round(
          (
            regimeRaw /
            this.SCORE_WEIGHTS.regime
          ) * 100
        ),

      roomScore:
        Math.round(
          (
            roomRaw /
            this.SCORE_WEIGHTS.room
          ) * 100
        ),

      reasons,

      warnings,
    };
  }

  // ============================================================
  // DIRECTION SAFETY
  // ============================================================

  private checkDirectionSafety(
    direction: Direction,
    analysis: AnalysisResult
  ): string | null {

    const pattern =
      analysis.patternM5;

    if (
      this.isOppositeStrongPattern(
        direction,
        pattern
      )
    ) {

      return (
        `Opposite M5 Price Action terdeteksi ` +
        `(${pattern}). Thesis ${direction} invalid.`
      );
    }

    if (
      direction === 'BUY' &&
      analysis.marketStructureM15 === 'CHOCH_BEAR'
    ) {

      return (
        `M15 CHOCH_BEAR membatalkan thesis BUY.`
      );
    }

    if (
      direction === 'SELL' &&
      analysis.marketStructureM15 === 'CHOCH_BULL'
    ) {

      return (
        `M15 CHOCH_BULL membatalkan thesis SELL.`
      );
    }

    return null;
  }

  // ============================================================
  // RSI PENALTY
  // ============================================================

  private calculateRsiPenalty(
    direction: Direction,
    analysis: AnalysisResult,
    warnings: string[]
  ): number {

    let penalty = 0;

    if (direction === 'BUY') {

      if (analysis.rsiM15 > 80) {

        warnings.push(
          `🚨 RSI M15 > 80 — BUY sangat extended`
        );

        return 25;
      }

      if (analysis.rsiM15 > 75) {

        penalty = 10;

        warnings.push(
          `⚠️ RSI M15 > 75 — BUY penalty (-10)`
        );

      } else if (analysis.rsiM15 > 70) {

        penalty = 5;

        warnings.push(
          `⚠️ RSI M15 > 70 — BUY penalty (-5)`
        );
      }

    } else {

      if (analysis.rsiM15 < 20) {

        warnings.push(
          `🚨 RSI M15 < 20 — SELL sangat extended`
        );

        return 25;
      }

      if (analysis.rsiM15 < 25) {

        penalty = 10;

        warnings.push(
          `⚠️ RSI M15 < 25 — SELL penalty (-10)`
        );

      } else if (analysis.rsiM15 < 30) {

        penalty = 5;

        warnings.push(
          `⚠️ RSI M15 < 30 — SELL penalty (-5)`
        );
      }
    }

    return penalty;
  }

  // ============================================================
  // PREMIUM / DISCOUNT
  // ============================================================

  private calculatePremiumDiscount(
    direction: Direction,
    analysis: AnalysisResult,
    currentPrice: number,
    reasons: string[],
    warnings: string[]
  ): number {

    const range =
      analysis.closestSwingHighM5 -
      analysis.closestSwingLowM5;

    const valid =
      Number.isFinite(range) &&
      range > 0 &&
      analysis.closestSwingLowM5 < currentPrice &&
      analysis.closestSwingHighM5 > currentPrice;

    if (!valid) {
      return 0;
    }

    const rawPosition =
      (
        currentPrice -
        analysis.closestSwingLowM5
      ) / range;

    const position =
      Math.max(
        0,
        Math.min(
          1,
          rawPosition
        )
      );

    let adjustment = 0;

    if (direction === 'BUY') {

      if (position >= 0.85) {

        warnings.push(
          `🚫 BUY extreme premium zone ` +
          `(${(position * 100).toFixed(0)}%)`
        );

        return -25;
      }

      if (position >= 0.65) {

        adjustment = -8;

        warnings.push(
          `⚠️ BUY premium zone ` +
          `(${(position * 100).toFixed(0)}%)`
        );

      } else if (position <= 0.35) {

        adjustment = 5;

        reasons.push(
          `✔ BUY discount zone ` +
          `(${(position * 100).toFixed(0)}%) (+5)`
        );
      }

    } else {

      if (position <= 0.15) {

        warnings.push(
          `🚫 SELL extreme discount zone ` +
          `(${(position * 100).toFixed(0)}%)`
        );

        return -25;
      }

      if (position <= 0.35) {

        adjustment = -8;

        warnings.push(
          `⚠️ SELL discount zone ` +
          `(${(position * 100).toFixed(0)}%)`
        );

      } else if (position >= 0.65) {

        adjustment = 5;

        reasons.push(
          `✔ SELL premium zone ` +
          `(${(position * 100).toFixed(0)}%) (+5)`
        );
      }
    }

    return adjustment;
  }

  // ============================================================
  // RUBBER BAND
  // ============================================================

  private checkRubberBand(
    direction: Direction,
    analysis: AnalysisResult,
    currentPrice: number,
    atrM5: number
  ): {
    blocked: boolean;
    penalty: number;
    reason?: string;
  } {

    const distToEMA =
      Math.abs(
        currentPrice -
        analysis.ema20M5
      );

    const extensionLimit =
      atrM5 * 1.8;

    if (
      !Number.isFinite(extensionLimit) ||
      extensionLimit <= 0
    ) {

      return {
        blocked: false,
        penalty: 0,
      };
    }

    if (
      distToEMA <= extensionLimit
    ) {

      return {
        blocked: false,
        penalty: 0,
      };
    }

    const strongBreakout =
      analysis.strongVolumeM5 ||
      analysis.patternM5 === 'MARUBOZU_BULL' ||
      analysis.patternM5 === 'MARUBOZU_BEAR' ||
      analysis.patternM5 === 'THREE_WHITE_SOLDIERS' ||
      analysis.patternM5 === 'THREE_BLACK_CROWS';

    if (strongBreakout) {

      return {

        blocked: false,

        penalty: 8,

        reason:
          `⚠️ Price ${direction} extended ` +
          `${distToEMA.toFixed(2)} vs ATR threshold ` +
          `${extensionLimit.toFixed(2)}, ` +
          `tetapi momentum kuat.`
      };
    }

    return {

      blocked: true,

      penalty: 0,

      reason:
        `Rubber Band Extension terlalu jauh: ` +
        `${distToEMA.toFixed(2)} > ` +
        `${extensionLimit.toFixed(2)}.`
    };
  }

  // ============================================================
  // MOMENTUM EXHAUSTION
  // ============================================================

  private getMomentumExhaustionPenalty(
    direction: Direction,
    analysis: AnalysisResult
  ): number {

    const count =
      analysis.consecutiveCandlesM5.count;

    const sameDirection =
      (
        direction === 'BUY' &&
        analysis.consecutiveCandlesM5.direction === 'BULLISH'
      ) ||
      (
        direction === 'SELL' &&
        analysis.consecutiveCandlesM5.direction === 'BEARISH'
      );

    if (!sameDirection) {
      return 0;
    }

    if (count >= 8) {
      return 100;
    }

    if (count >= 6) {
      return 10;
    }

    return 0;
  }

  // ============================================================
  // STOP LOSS
  // ============================================================

  private calculateStopLoss(
    direction: Direction,
    analysis: AnalysisResult,
    currentPrice: number,
    atrM5: number,
    strategy: Strategy
  ): number {

    const atrBuffer =
      Math.max(
        0.35,
        atrM5 * 0.35
      );

    let stopLoss = 0;

    if (direction === 'BUY') {

      const swingValid =
        analysis.closestSwingLowM5 > 0 &&
        analysis.closestSwingLowM5 < currentPrice;

      const swingDistance =
        swingValid
          ? currentPrice -
          analysis.closestSwingLowM5
          : Infinity;

      if (
        swingValid &&
        swingDistance <= 6.5
      ) {

        stopLoss =
          analysis.closestSwingLowM5 -
          atrBuffer;

      } else {

        const fallbackRisk =
          strategy === 'HYPER_SCALPER'
            ? Math.max(
              1.0,
              Math.min(
                4.0,
                atrM5 * 1.2
              )
            )
            : Math.max(
              1.2,
              Math.min(
                5.0,
                atrM5 * 1.5
              )
            );

        stopLoss =
          currentPrice -
          fallbackRisk;
      }

    } else {

      const swingValid =
        analysis.closestSwingHighM5 >
        currentPrice;

      const swingDistance =
        swingValid
          ? analysis.closestSwingHighM5 -
          currentPrice
          : Infinity;

      if (
        swingValid &&
        swingDistance <= 6.5
      ) {

        stopLoss =
          analysis.closestSwingHighM5 +
          atrBuffer;

      } else {

        const fallbackRisk =
          strategy === 'HYPER_SCALPER'
            ? Math.max(
              1.0,
              Math.min(
                4.0,
                atrM5 * 1.2
              )
            )
            : Math.max(
              1.2,
              Math.min(
                5.0,
                atrM5 * 1.5
              )
            );

        stopLoss =
          currentPrice +
          fallbackRisk;
      }
    }

    return stopLoss;
  }

  // ============================================================
  // STRUCTURAL TARGET
  // ============================================================

  private getStructuralTarget(
    direction: Direction,
    analysis: AnalysisResult,
    currentPrice: number
  ): {
    valid: boolean;
    target: number;
    reason: string;
  } {

    if (direction === 'BUY') {

      const resistance =
        analysis.nearestResistanceH1;

      if (
        !Number.isFinite(resistance) ||
        resistance <= 0
      ) {

        return {
          valid: false,
          target: 0,
          reason:
            `Nearest H1 resistance tidak tersedia.`
        };
      }

      if (
        resistance <= currentPrice
      ) {

        return {
          valid: false,
          target: resistance,
          reason:
            `Nearest H1 resistance berada di bawah/di entry.`
        };
      }

      return {
        valid: true,
        target: resistance,
        reason:
          `Nearest H1 resistance ${resistance.toFixed(2)}`
      };
    }

    const support =
      analysis.nearestSupportH1;

    if (
      !Number.isFinite(support) ||
      support <= 0
    ) {

      return {
        valid: false,
        target: 0,
        reason:
          `Nearest H1 support tidak tersedia.`
      };
    }

    if (
      support >= currentPrice
    ) {

      return {
        valid: false,
        target: support,
        reason:
          `Nearest H1 support berada di atas/di entry.`
      };
    }

    return {
      valid: true,
      target: support,
      reason:
        `Nearest H1 support ${support.toFixed(2)}`
    };
  }

  // ============================================================
  // TAKE PROFIT
  // ============================================================

  private calculateTakeProfits(
    direction: Direction,
    currentPrice: number,
    riskDist: number,
    structuralTarget: number,
    strategy: Strategy
  ): {
    tp1: number;
    tp2: number;
  } {

    const tp1Ratio =
      strategy === 'HYPER_SCALPER'
        ? 1.30
        : 1.80;

    const tp2Ratio =
      strategy === 'HYPER_SCALPER'
        ? 2.00
        : 2.50;

    let tp1 =
      direction === 'BUY'
        ? currentPrice + riskDist * tp1Ratio
        : currentPrice - riskDist * tp1Ratio;

    let tp2 =
      direction === 'BUY'
        ? currentPrice + riskDist * tp2Ratio
        : currentPrice - riskDist * tp2Ratio;

    if (direction === 'BUY') {

      tp1 = Math.min(tp1, structuralTarget);
      tp2 = Math.min(tp2, structuralTarget);

    } else {

      tp1 = Math.max(tp1, structuralTarget);
      tp2 = Math.max(tp2, structuralTarget);
    }

    return {
      tp1,
      tp2,
    };
  }

  // ============================================================
  // POSSIBLE DIRECTIONS
  // ============================================================

  private getPossibleDirections(
    analysis: AnalysisResult
  ): Direction[] {

    const possibleDirections: Direction[] = [];

    const pattern =
      analysis.patternM5;

    // ==========================================================
    // BUY
    // ==========================================================

    const bullishPA =
      this.isBullishPattern(pattern) ||
      pattern === 'PIN_BAR';

    const bullishStructure =
      analysis.marketStructureM15 === 'BOS_BULL' ||
      analysis.marketStructureM15 === 'CHOCH_BULL' ||
      analysis.marketStructureM15 === 'FAKE_BREAKOUT_BULL';

    const bullishContext =
      analysis.trendH1 === 'BULLISH' ||
      analysis.trendM15 === 'BULLISH' ||
      analysis.fibonacciZoneM15 === 'GOLDEN_BULL' ||
      analysis.isAtSupportH1;

    const bullishTrigger =
      bullishPA ||
      bullishStructure ||
      analysis.strongVolumeM5 ||
      analysis.volumeSpikeM5;

    const bullishInvalid =
      analysis.marketStructureM15 === 'CHOCH_BEAR' &&
      !bullishPA &&
      !analysis.isAtSupportH1;

    if (
      bullishTrigger &&
      bullishContext &&
      !bullishInvalid
    ) {

      possibleDirections.push('BUY');
    }

    // ==========================================================
    // SELL
    // ==========================================================

    const bearishPA =
      this.isBearishPattern(pattern) ||
      pattern === 'PIN_BAR';

    const bearishStructure =
      analysis.marketStructureM15 === 'BOS_BEAR' ||
      analysis.marketStructureM15 === 'CHOCH_BEAR' ||
      analysis.marketStructureM15 === 'FAKE_BREAKOUT_BEAR';

    const bearishContext =
      analysis.trendH1 === 'BEARISH' ||
      analysis.trendM15 === 'BEARISH' ||
      analysis.fibonacciZoneM15 === 'GOLDEN_BEAR' ||
      analysis.isAtResistanceH1;

    const bearishTrigger =
      bearishPA ||
      bearishStructure ||
      analysis.strongVolumeM5 ||
      analysis.volumeSpikeM5;

    const bearishInvalid =
      analysis.marketStructureM15 === 'CHOCH_BULL' &&
      !bearishPA &&
      !analysis.isAtResistanceH1;

    if (
      bearishTrigger &&
      bearishContext &&
      !bearishInvalid
    ) {

      possibleDirections.push('SELL');
    }

    return possibleDirections;
  }

  // ============================================================
  // GENERATE
  // ============================================================

  public generate(
    analysis: AnalysisResult,
    sentiment:
      'BULLISH' |
      'BEARISH' |
      'NEUTRAL',
    currentPrice: number,
    sentimentScore: number,
    activeNewsContext: any = null,
    activeStrategy: Strategy = 'HYPER_SCALPER'
  ): Signal {

    const now =
      new Date();

    const currentHourUTC =
      now.getUTCHours();

    const currentDayUTC =
      now.getUTCDay();

    const currentHourWIB =
      (currentHourUTC + 7) % 24;

    // ==========================================================
    // 1. WEEKEND
    // ==========================================================

    const isWeekend =
      (
        currentDayUTC === 5 &&
        currentHourUTC >= 21
      ) ||
      currentDayUTC === 6 ||
      (
        currentDayUTC === 0 &&
        currentHourUTC < 21
      );

    if (isWeekend) {

      return this.createWaitSignal(
        'Market sedang libur/tutup di akhir pekan.',
        activeStrategy
      );
    }

    // ==========================================================
    // 2. SESSION
    // ==========================================================

    const sessionInfo =
      this.getSession(
        currentHourWIB
      );

    if (
      activeStrategy === 'HYPER_SCALPER' &&
      sessionInfo.type === 'OFF'
    ) {

      return this.createWaitSignal(
        'Sesi market tutup (Off-hours).',
        activeStrategy
      );
    }

    // ==========================================================
    // 3. NEWS
    // ==========================================================

    let isNewsMode = false;
    let isNewsBreakout = false;
    let newsWarning = '';
    let bypassEmergency = false;

    if (activeNewsContext) {

      const {
        event,
        severity,
        phase,
      } = activeNewsContext;

      if (
        severity === 'EXTREME'
      ) {

        if (
          phase === 'PRE'
        ) {

          return this.createWaitSignal(
            `⚠️ ${event.title} rilis < 60 menit. ` +
            `Hard Filter: Menahan posisi.`,
            activeStrategy
          );

        } else if (
          phase === 'DURING'
        ) {

          bypassEmergency = true;
          isNewsBreakout = true;

          newsWarning =
            `🔥 ULTRA BREAKOUT INITIAL: ` +
            `Trading momentum awal ${event.title}`;

        } else if (
          phase === 'STABILIZATION' ||
          phase === 'POST'
        ) {

          isNewsBreakout = true;

          newsWarning =
            `🚀 POST NEWS BREAKOUT: ` +
            `Momentum terkonfirmasi dari ${event.title}`;
        }

      } else if (
        severity === 'HIGH'
      ) {

        if (
          phase === 'PRE'
        ) {

          return this.createWaitSignal(
            `⚠️ HIGH IMPACT NEWS ` +
            `(${event.title}) rilis < 20 menit. ` +
            `Hard Filter: Lock Mode.`,
            activeStrategy
          );

        } else if (
          phase === 'DURING'
        ) {

          return this.createWaitSignal(
            `🔴 HIGH IMPACT NEWS ` +
            `(${event.title}) sedang rilis. ` +
            `Hard Filter: Lock Mode.`,
            activeStrategy
          );
        }

        isNewsMode = true;

        newsWarning =
          `⚠️ Berita ${event.title} baru berlalu, ` +
          `volatilitas masih tinggi.`;
      }
    }

    // ==========================================================
    // 4. ATR
    // ==========================================================

    const atrM5 =
      this.getAtrM5(
        analysis
      );

    const atrM15 =
      analysis.atr_M15 || 1.5;

    const atrRegime =
      this.getAtrRegime(
        atrM15
      );

    // ==========================================================
    // EXTREME VOLATILITY
    // ==========================================================

    if (
      atrRegime === 'EXTREME' &&
      !bypassEmergency
    ) {

      return this.createWaitSignal(
        `🚨 EMERGENCY MODE: Volatilitas terlalu liar ` +
        `(ATR M15 ${atrM15.toFixed(2)} ` +
        `≥ ${config.ATR_REGIME_HIGH_MAX}). ` +
        `NO TRADE.`,
        activeStrategy
      );
    }

    // ==========================================================
    // DEAD MARKET
    // ==========================================================

    if (
      atrM15 < 0.80
    ) {

      return this.createWaitSignal(
        `⚠️ HARD FILTER: Volatilitas terlalu rendah ` +
        `(ATR M15 ${atrM15.toFixed(2)} < 0.80).`,
        activeStrategy
      );
    }

    // ==========================================================
    // 5. MOMENTUM EXHAUSTION
    // ==========================================================

    if (
      analysis.consecutiveCandlesM5.count >= 8
    ) {

      return this.createWaitSignal(
        `⚠️ MOMENTUM EXHAUSTION: ` +
        `${analysis.consecutiveCandlesM5.count} candle ` +
        `searah berturut-turut. Menunggu koreksi.`,
        activeStrategy
      );
    }

    // ==========================================================
    // 6. MARKET PHASE
    // ==========================================================

    if (
      analysis.marketPhase === 'UNKNOWN'
    ) {

      return this.createWaitSignal(
        `Market Phase UNKNOWN. ` +
        `Menunggu struktur yang lebih jelas.`,
        activeStrategy
      );
    }

    // ==========================================================
    // 7. DIRECTIONS
    // ==========================================================

    const possibleDirections =
      this.getPossibleDirections(
        analysis
      );

    if (
      possibleDirections.length === 0
    ) {

      return this.createWaitSignal(
        `Tidak ada setup direction + trigger yang valid. ` +
        `Menunggu context atau trigger berikutnya.`,
        activeStrategy
      );
    }

    // ==========================================================
    // 8. THRESHOLD V3 RELAXED 60
    // ==========================================================

    const configuredThreshold =
      Number(
        config.INITIAL_ENTRY_THRESHOLD
      );

    /**
     * IMPORTANT:
     *
     * Minimum = 60.
     *
     * Tidak lagi menggunakan Math.max(62,...)
     */
    const baseThreshold =
      Number.isFinite(configuredThreshold)
        ? Math.max(
          60,
          configuredThreshold
        )
        : 60;

    /**
     * LOW ATR tetap lebih selektif.
     *
     * Normal = 60
     * LOW    = 64
     *
     * Tetapi dead market < 0.80
     * sudah diblokir sebelumnya.
     */
    const effectiveThreshold =
      atrRegime === 'LOW'
        ? Math.max(
          64,
          baseThreshold + 4
        )
        : baseThreshold;

    // ==========================================================
    // 9. BUILD CANDIDATES
    // ==========================================================

    let bestTrade:
      TradeCandidate | null = null;

    let lastRejectionReason =
      'Tidak ada setup yang memenuhi V3 RELAXED 60.';

    for (
      const direction of possibleDirections
    ) {

      // --------------------------------------------------------
      // Direction Safety
      // --------------------------------------------------------

      const directionSafety =
        this.checkDirectionSafety(
          direction,
          analysis
        );

      if (
        directionSafety
      ) {

        lastRejectionReason =
          directionSafety;

        continue;
      }

      const scoreWarnings:
        string[] = [];

      // --------------------------------------------------------
      // RSI
      // --------------------------------------------------------

      const rsiPenalty =
        this.calculateRsiPenalty(
          direction,
          analysis,
          scoreWarnings
        );

      if (
        rsiPenalty >= 25
      ) {

        lastRejectionReason =
          `RSI M15 extreme untuk ${direction}.`;

        continue;
      }

      // --------------------------------------------------------
      // PREMIUM / DISCOUNT
      // --------------------------------------------------------

      const pdReasons:
        string[] = [];

      const pdAdjustment =
        this.calculatePremiumDiscount(
          direction,
          analysis,
          currentPrice,
          pdReasons,
          scoreWarnings
        );

      if (
        pdAdjustment <= -25
      ) {

        lastRejectionReason =
          `Entry ${direction} berada di extreme ` +
          `Premium/Discount zone.`;

        continue;
      }

      // --------------------------------------------------------
      // RUBBER BAND
      // --------------------------------------------------------

      const rubberBand =
        this.checkRubberBand(
          direction,
          analysis,
          currentPrice,
          atrM5
        );

      if (
        rubberBand.blocked
      ) {

        lastRejectionReason =
          rubberBand.reason ||
          'Rubber Band Extension terlalu jauh.';

        continue;
      }

      // --------------------------------------------------------
      // STOP LOSS
      // --------------------------------------------------------

      const calculatedSL =
        this.calculateStopLoss(
          direction,
          analysis,
          currentPrice,
          atrM5,
          activeStrategy
        );

      const riskDist =
        Math.abs(
          currentPrice -
          calculatedSL
        );

      if (
        !Number.isFinite(riskDist) ||
        riskDist <= 0
      ) {

        lastRejectionReason =
          `Risk distance tidak valid.`;

        continue;
      }

      if (
        riskDist <
        this.MIN_SL_DISTANCE
      ) {

        lastRejectionReason =
          `SL terlalu sempit ` +
          `($${riskDist.toFixed(2)} < ` +
          `$${this.MIN_SL_DISTANCE.toFixed(2)}).`;

        continue;
      }

      if (
        riskDist >
        this.MAX_SL_DISTANCE
      ) {

        lastRejectionReason =
          `SL terlalu lebar ` +
          `($${riskDist.toFixed(2)} > ` +
          `$${this.MAX_SL_DISTANCE.toFixed(2)}). ` +
          `Menunggu pullback.`;

        continue;
      }

      // --------------------------------------------------------
      // STRUCTURAL TARGET
      // --------------------------------------------------------

      const structuralTarget =
        this.getStructuralTarget(
          direction,
          analysis,
          currentPrice
        );

      if (
        !structuralTarget.valid
      ) {

        lastRejectionReason =
          structuralTarget.reason;

        continue;
      }

      const maxTargetPrice =
        structuralTarget.target;

      // --------------------------------------------------------
      // TRUE RR
      // --------------------------------------------------------

      const availableRoom =
        Math.abs(
          maxTargetPrice -
          currentPrice
        );

      const trueRR =
        riskDist > 0
          ? availableRoom / riskDist
          : 0;

      if (
        !Number.isFinite(trueRR) ||
        trueRR < this.MIN_TRUE_RR
      ) {

        lastRejectionReason =
          `True RR ke structural target ` +
          `hanya ${trueRR.toFixed(2)}x ` +
          `(minimum ${this.MIN_TRUE_RR.toFixed(2)}x).`;

        continue;
      }

      // --------------------------------------------------------
      // SCORE
      // --------------------------------------------------------

      const score =
        this.calculateScoreV3(
          direction,
          analysis,
          atrRegime,
          isNewsBreakout,
          trueRR
        );

      /**
       * Tambahkan context Premium/Discount
       * ke reason score.
       */
      if (pdReasons.length > 0) {
        score.reasons.push(...pdReasons);
      }

      // --------------------------------------------------------
      // ADJUSTED SCORE
      // --------------------------------------------------------

      let adjustedScore =
        score.total;

      // RSI
      if (
        rsiPenalty > 0
      ) {

        adjustedScore -=
          rsiPenalty;

        score.warnings.push(
          `⚠️ RSI penalty total: -${rsiPenalty}`
        );
      }

      // Premium / Discount
      if (
        pdAdjustment !== 0
      ) {

        adjustedScore +=
          pdAdjustment;
      }

      // Rubber Band
      if (
        rubberBand.penalty > 0
      ) {

        adjustedScore -=
          rubberBand.penalty;

        if (
          rubberBand.reason
        ) {

          score.warnings.push(
            rubberBand.reason
          );
        }
      }

      // Momentum exhaustion
      const exhaustionPenalty =
        this.getMomentumExhaustionPenalty(
          direction,
          analysis
        );

      if (
        exhaustionPenalty >= 100
      ) {

        lastRejectionReason =
          `Momentum exhaustion extreme.`;

        continue;
      }

      if (
        exhaustionPenalty > 0
      ) {

        adjustedScore -=
          exhaustionPenalty;

        score.warnings.push(
          `⚠️ Momentum exhaustion ` +
          `-${exhaustionPenalty}`
        );
      }

      adjustedScore =
        Math.max(
          0,
          Math.min(
            100,
            Math.round(
              adjustedScore
            )
          )
        );

      // ========================================================
      // CATEGORY GATES
      // ========================================================

      if (
        score.directionScore <
        this.MIN_DIRECTION_SCORE
      ) {

        lastRejectionReason =
          `${direction} rejected: ` +
          `Direction Score ` +
          `${score.directionScore}/100 ` +
          `< ${this.MIN_DIRECTION_SCORE}.`;

        continue;
      }

      if (
        score.setupScore <
        this.MIN_SETUP_SCORE
      ) {

        lastRejectionReason =
          `${direction} rejected: ` +
          `Setup Score ` +
          `${score.setupScore}/100 ` +
          `< ${this.MIN_SETUP_SCORE}.`;

        continue;
      }

      if (
        score.entryScore <
        this.MIN_ENTRY_SCORE &&
        !isNewsBreakout
      ) {

        lastRejectionReason =
          `${direction} rejected: ` +
          `Entry Score ` +
          `${score.entryScore}/100 ` +
          `< ${this.MIN_ENTRY_SCORE}.`;

        continue;
      }

      // ========================================================
      // TOTAL THRESHOLD
      // ========================================================

      if (
        adjustedScore <
        effectiveThreshold
      ) {

        lastRejectionReason =
          `${direction} score ` +
          `${adjustedScore}/100 ` +
          `< ${effectiveThreshold}.`;

        continue;
      }

      // ========================================================
      // TP
      // ========================================================

      const {
        tp1,
        tp2,
      } =
        this.calculateTakeProfits(
          direction,
          currentPrice,
          riskDist,
          maxTargetPrice,
          activeStrategy
        );

      const tp1RR =
        riskDist > 0
          ? Math.abs(
            tp1 -
            currentPrice
          ) / riskDist
          : 0;

      if (
        tp1RR < 1.0
      ) {

        lastRejectionReason =
          `TP1 terlalu dekat setelah structural cap ` +
          `(TP1 RR ${tp1RR.toFixed(2)}x).`;

        continue;
      }

      // ========================================================
      // SETUP TYPE
      // ========================================================

      const setupType =
        this.determineSetupType(
          direction,
          analysis,
          isNewsBreakout
        );

      // ========================================================
      // CANDIDATE
      // ========================================================

      const candidate:
        TradeCandidate = {

        dir:
          direction,

        score:
          adjustedScore,

        breakdown:
          score,

        stopLoss:
          calculatedSL,

        tp1,

        tp2,

        setupType,

        maxTargetPrice,

        trueRR,
      };

      // ========================================================
      // BEST CANDIDATE
      // ========================================================

      if (!bestTrade) {

        bestTrade =
          candidate;

      } else {

        const betterTotal =
          candidate.score >
          bestTrade.score;

        const sameTotalBetterEntry =
          candidate.score ===
          bestTrade.score &&
          candidate.breakdown.entryScore >
          bestTrade.breakdown.entryScore;

        const sameTotalEntryBetterRR =
          candidate.score ===
          bestTrade.score &&
          candidate.breakdown.entryScore ===
          bestTrade.breakdown.entryScore &&
          candidate.trueRR >
          bestTrade.trueRR;

        if (
          betterTotal ||
          sameTotalBetterEntry ||
          sameTotalEntryBetterRR
        ) {

          bestTrade =
            candidate;
        }
      }
    }

    // ==========================================================
    // 10. FINAL VALIDATION
    // ==========================================================

    if (!bestTrade) {

      console.log(
        `[M5 DEBUG] V3 RELAXED 60 ALL REJECTED: ` +
        `${lastRejectionReason}`
      );

      return this.createWaitSignal(
        lastRejectionReason,
        activeStrategy
      );
    }

    if (
      bestTrade.score <
      effectiveThreshold
    ) {

      return this.createWaitSignal(
        `Skor V3 RELAXED ` +
        `${bestTrade.score}/100 ` +
        `< minimum ${effectiveThreshold}. ` +
        `Direction=${bestTrade.breakdown.directionScore}, ` +
        `Setup=${bestTrade.breakdown.setupScore}, ` +
        `Entry=${bestTrade.breakdown.entryScore}.`,
        activeStrategy
      );
    }

    // ==========================================================
    // 11. FINAL DATA
    // ==========================================================

    const {
      dir: tradeType,
      score,
      breakdown,
      stopLoss,
      tp1,
      tp2,
      setupType,
      maxTargetPrice,
      trueRR,
    } =
      bestTrade;

    // ==========================================================
    // 12. PROBABILITY
    // ==========================================================

    let probabilityLabel =
      '⭐⭐ Low';

    if (score >= 90) {

      probabilityLabel =
        '⭐⭐⭐⭐⭐ Very High';

    } else if (score >= 80) {

      probabilityLabel =
        '⭐⭐⭐⭐ High';

    } else if (score >= 70) {

      probabilityLabel =
        '⭐⭐⭐ Medium';

    } else if (score >= 60) {

      probabilityLabel =
        '⭐⭐ Low';

    } else {

      probabilityLabel =
        '⭐ Very Low';
    }

    // ==========================================================
    // 13. REASON
    // ==========================================================

    const scoreSummary =
      [
        `📊 V3 RELAXED 60 SCORE: ${score}/100`,
        `🎯 Direction: ${breakdown.directionScore}/100`,
        `🏗️ Setup: ${breakdown.setupScore}/100`,
        `⚡ Entry: ${breakdown.entryScore}/100`,
        `📍 Location: ${breakdown.locationScore}/100`,
        `📈 Volume: ${breakdown.volumeScore}/100`,
        `🌡️ Regime: ${breakdown.regimeScore}/100`,
        `🎯 Room: ${breakdown.roomScore}/100`,
        `💰 True RR: ${trueRR.toFixed(2)}x`,
      ].join('\n');

    let reasonString =
      scoreSummary +
      '\n\n' +
      breakdown.reasons.join('\n');

    if (
      breakdown.warnings.length > 0
    ) {

      reasonString +=
        '\n\n' +
        breakdown.warnings.join('\n');
    }

    if (
      newsWarning
    ) {

      reasonString =
        newsWarning +
        '\n\n' +
        reasonString;
    }

    // ==========================================================
    // 14. EXECUTION TYPE
    // ==========================================================

    const isInstantMomentum =
      isNewsBreakout ||
      (
        breakdown.entryScore >= 85 &&
        (
          analysis.strongVolumeM5 ||
          analysis.patternM5 === 'MARUBOZU_BULL' ||
          analysis.patternM5 === 'MARUBOZU_BEAR'
        )
      ) ||
      setupType.includes('Breakout');

    const executionType =
      isInstantMomentum
        ? '⚡ INSTANT ENTRY (Market Execution)'
        : '⏳ PULLBACK / LIMIT ENTRY (Wait for Zone)';

    // ==========================================================
    // 15. ENTRY ZONE
    // ==========================================================

    let entryZoneMin = 0;
    let entryZoneMax = 0;
    let entryZoneType = '';

    const candleRange =
      analysis.triggerCandleM5
        ? Math.abs(
          analysis.triggerCandleM5.high -
          analysis.triggerCandleM5.low
        )
        : 0;

    if (
      tradeType === 'BUY'
    ) {

      if (
        isInstantMomentum
      ) {

        entryZoneMin =
          currentPrice -
          Math.min(
            0.8,
            atrM5 * 0.25
          );

        entryZoneMax =
          currentPrice;

        entryZoneType =
          'MARKET';

      } else if (
        analysis.fvgM5.type === 'BULLISH' &&
        analysis.fvgM5.bottom > 0 &&
        analysis.fvgM5.top <= currentPrice + 0.5
      ) {

        entryZoneMin =
          analysis.fvgM5.bottom;

        entryZoneMax =
          analysis.fvgM5.top;

        entryZoneType =
          'FVG';

      } else if (
        candleRange >= 1.5
      ) {

        entryZoneMax =
          currentPrice -
          candleRange * 0.2;

        entryZoneMin =
          currentPrice -
          candleRange * 0.5;

        entryZoneType =
          'RETRACE';

      } else if (
        analysis.isAtSupportH1 &&
        analysis.nearestSupportH1 <
        currentPrice
      ) {

        entryZoneMax =
          analysis.nearestSupportH1 +
          Math.min(
            1.5,
            atrM5 * 0.4
          );

        entryZoneMin =
          analysis.nearestSupportH1;

        entryZoneType =
          'SUPPORT';

      } else {

        entryZoneMin =
          currentPrice -
          Math.min(
            2.0,
            Math.max(
              0.8,
              atrM5 * 0.5
            )
          );

        entryZoneMax =
          currentPrice -
          0.3;

        entryZoneType =
          'DISCOUNT';
      }

    } else {

      if (
        isInstantMomentum
      ) {

        entryZoneMin =
          currentPrice;

        entryZoneMax =
          currentPrice +
          Math.min(
            0.8,
            atrM5 * 0.25
          );

        entryZoneType =
          'MARKET';

      } else if (
        analysis.fvgM5.type === 'BEARISH' &&
        analysis.fvgM5.top > 0 &&
        analysis.fvgM5.bottom >= currentPrice - 0.5
      ) {

        entryZoneMin =
          analysis.fvgM5.bottom;

        entryZoneMax =
          analysis.fvgM5.top;

        entryZoneType =
          'FVG';

      } else if (
        candleRange >= 1.5
      ) {

        entryZoneMin =
          currentPrice +
          candleRange * 0.2;

        entryZoneMax =
          currentPrice +
          candleRange * 0.5;

        entryZoneType =
          'RETRACE';

      } else if (
        analysis.isAtResistanceH1 &&
        analysis.nearestResistanceH1 >
        currentPrice
      ) {

        entryZoneMin =
          analysis.nearestResistanceH1 -
          Math.min(
            1.5,
            atrM5 * 0.4
          );

        entryZoneMax =
          analysis.nearestResistanceH1;

        entryZoneType =
          'RESISTANCE';

      } else {

        entryZoneMin =
          currentPrice +
          0.3;

        entryZoneMax =
          currentPrice +
          Math.min(
            2.0,
            Math.max(
              0.8,
              atrM5 * 0.5
            )
          );

        entryZoneType =
          'PREMIUM';
      }
    }

    const entryZoneStr =
      `${entryZoneMin.toFixed(2)} - ` +
      `${entryZoneMax.toFixed(2)} ` +
      `(${entryZoneType} Zone)`;

    // ==========================================================
    // 16. ID
    // ==========================================================

    const wibDate =
      new Date().toLocaleString(
        'sv-SE',
        {
          timeZone:
            'Asia/Jakarta',
        }
      );

    const dateStr =
      wibDate
        .slice(0, 10)
        .replace(/-/g, '');

    const randId =
      Math.floor(
        Math.random() * 1000
      )
        .toString()
        .padStart(3, '0');

    // ==========================================================
    // 17. BASKET ENGINE
    // ==========================================================

    const basketTarget =
      Number(
        maxTargetPrice.toFixed(2)
      );

    const basketInvalidation =
      Number(
        stopLoss.toFixed(2)
      );

    console.log(
      `[BasketEngine] ` +
      `BASKET_INIT approved | ` +
      `Dir=${tradeType} | ` +
      `Score=${score}/${effectiveThreshold} | ` +
      `Direction=${breakdown.directionScore} | ` +
      `Setup=${breakdown.setupScore} | ` +
      `Entry=${breakdown.entryScore} | ` +
      `ATR=${atrRegime} | ` +
      `TrueRR=${trueRR.toFixed(2)} | ` +
      `Target=${basketTarget} | ` +
      `Invalidation=${basketInvalidation}`
    );

    // ==========================================================
    // 18. FINAL SIGNAL
    // ==========================================================

    return {

      id:
        `XAU-${dateStr}-${randId}`,

      type:
        tradeType,

      setupType,

      executionType,

      marketPhase:
        analysis.marketPhase ||
        'RANGE',

      probabilityLabel,

      confidenceScore:
        score,

      marketCondition:
        (
          analysis.marketCondition ||
          'SIDEWAYS'
        ).replace(
          /_/g,
          ' '
        ),

      session:
        sessionInfo.name,

      entryPrice:
        currentPrice,

      stopLoss:
        Number(
          stopLoss.toFixed(2)
        ),

      takeProfit1:
        Number(
          tp1.toFixed(2)
        ),

      takeProfit2:
        Number(
          tp2.toFixed(2)
        ),

      validTime:
        isInstantMomentum
          ? '5-10 Menit'
          : '10-20 Menit',

      estimatedTpTime:
        '15-45 Menit',

      timeStopLoss:
        '45-60 Menit',

      timestamp:
        new Date().toISOString(),

      reason:
        reasonString,

      strategy:
        activeStrategy,

      entryZone:
        entryZoneStr,

      entryZoneMin:
        Number(
          entryZoneMin.toFixed(2)
        ),

      entryZoneMax:
        Number(
          entryZoneMax.toFixed(2)
        ),

      entryZoneType,

      // === BASKET ENGINE v2 ===
      basketTarget,

      basketInvalidation,

      atrRegime,
    };
  }

  // ============================================================
  // WAIT SIGNAL
  // ============================================================

  private createWaitSignal(
    reason: string,
    strategy: Strategy
  ): Signal {

    return {

      id:
        `WAIT-${Date.now()}`,

      type:
        'WAIT',

      setupType:
        '⏳ Waiting for Setup',

      marketPhase:
        'N/A',

      probabilityLabel:
        'N/A',

      confidenceScore:
        0,

      marketCondition:
        'N/A',

      session:
        'N/A',

      entryPrice:
        0,

      stopLoss:
        0,

      takeProfit1:
        0,

      takeProfit2:
        0,

      validTime:
        '-',

      estimatedTpTime:
        '-',

      timestamp:
        new Date().toISOString(),

      reason,

      strategy,

      entryZone:
        '-',
    };
  }
}
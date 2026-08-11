import { ConfidenceEvaluation, SignalTier } from './confidenceEngine';
import { LiveMarketSnapshot } from './featureEngine';

export type SignalLifecycleState =
  | 'WAITING'
  | 'SETUP_DETECTED'
  | 'TRIGGERED'
  | 'SIGNAL_SENT'
  | 'ACTIVE'
  | 'HIT_TP'
  | 'HIT_SL'
  | 'EXPIRED';

export interface BurstLayer {
  layerIndex: number;
  orderType: 'BUY_MARKET' | 'SELL_MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT';
  suggestedPrice: number;
  tpPrice: number;
  tpPips: number;
  slPrice: number;
  slPips: number;
  lotRatio: number; // e.g. 0.2 (20% of total lot per layer)
}

export interface BurstSignalPayload {
  id: string;
  state: SignalLifecycleState;
  direction: 'BUY' | 'SELL';
  tier: SignalTier;
  confidenceScore: number;
  entryPrice: number;
  entryZoneMin: number;
  entryZoneMax: number;
  pullbackLimitPrice: number;
  stopLossPrice: number;
  timestampMs: number;
  ttlSeconds: number;
  currentReEntryCycle: number;
  maxReEntryCycles: number;
  layers: BurstLayer[];
  reasons: string[];
  warnings: string[];
  aiExplanation?: string;
}

export class SignalStateMachine {
  private currentState: SignalLifecycleState = 'WAITING';
  private currentActiveSignal: BurstSignalPayload | null = null;
  private reEntryCycleCount: number = 0;
  private lastTradeResult: 'HIT_TP' | 'HIT_SL' | 'NONE' = 'NONE';
  private lastSignalTime: number = 0;

  /**
   * Cek apakah sinyal masih berlaku (belum kadaluarsa berdasarkan TTL)
   */
  public isSignalValid(signal: BurstSignalPayload): boolean {
    const ageSeconds = (Date.now() - signal.timestampMs) / 1000;
    return ageSeconds <= signal.ttlSeconds;
  }

  /**
   * Bangun payload 5 Layer Burst Scalping yang siap ditembakkan ke MT5 & Telegram (<5ms)
   */
  public createBurstSignal(
    evaluation: ConfidenceEvaluation,
    snapshot: LiveMarketSnapshot,
    ttlSeconds: number = 30
  ): BurstSignalPayload | null {
    if (evaluation.direction === 'WAIT') {
      this.currentState = 'WAITING';
      return null;
    }

    // Cooldown check: minimal 15 detik dari sinyal sebelumnya agar tidak spam
    if (Date.now() - this.lastSignalTime < 15000) {
      return null;
    }

    const price = snapshot.currentPrice;
    const dir = evaluation.direction;
    const atr = snapshot.m1.features.atr || 1.5;

    // Hitung Entry Zone Toleransi (0.5x ATR M1, misal +/- $0.8 Gold)
    const zoneTolerance = Math.max(0.5, atr * 0.5);
    const entryZoneMin = dir === 'BUY' ? price - zoneTolerance : price - zoneTolerance * 1.5;
    const entryZoneMax = dir === 'BUY' ? price + zoneTolerance * 1.5 : price + zoneTolerance;

    // Pullback Limit Price (Retest level / Fibo 50%)
    const pullbackLimitPrice =
      dir === 'BUY'
        ? Number((price - atr * 0.8).toFixed(2))
        : Number((price + atr * 0.8).toFixed(2));

    const slPips = evaluation.slPips;
    const slPrice =
      dir === 'BUY'
        ? Number((price - slPips * 0.1).toFixed(2))
        : Number((price + slPips * 0.1).toFixed(2));

    // Bangun 5 Layer dengan TP bertingkat
    const layers: BurstLayer[] = [];
    const targetTps = evaluation.targetTpPips; // e.g. [8, 9, 10, 11, 12]

    for (let i = 0; i < 5; i++) {
      const tpPips = targetTps[i] || 10;
      const tpPrice =
        dir === 'BUY'
          ? Number((price + tpPips * 0.1).toFixed(2))
          : Number((price - tpPips * 0.1).toFixed(2));

      layers.push({
        layerIndex: i + 1,
        orderType: dir === 'BUY' ? 'BUY_MARKET' : 'SELL_MARKET',
        suggestedPrice: price,
        tpPrice,
        tpPips,
        slPrice,
        slPips,
        lotRatio: 0.2, // 20% total lot per layer (5 layer = 100%)
      });
    }

    const signalId = `AURUM-${Date.now().toString().slice(-6)}`;
    this.lastSignalTime = Date.now();
    this.currentState = 'TRIGGERED';

    const payload: BurstSignalPayload = {
      id: signalId,
      state: 'SIGNAL_SENT',
      direction: dir,
      tier: evaluation.tier,
      confidenceScore: evaluation.totalScore,
      entryPrice: price,
      entryZoneMin: Number(entryZoneMin.toFixed(2)),
      entryZoneMax: Number(entryZoneMax.toFixed(2)),
      pullbackLimitPrice,
      stopLossPrice: slPrice,
      timestampMs: Date.now(),
      ttlSeconds,
      currentReEntryCycle: this.reEntryCycleCount + 1,
      maxReEntryCycles: evaluation.maxReEntryCycles,
      layers,
      reasons: evaluation.reasons,
      warnings: evaluation.warnings,
    };

    this.currentActiveSignal = payload;
    return payload;
  }

  /**
   * Catat hasil penutupan posisi untuk kontrol siklus Re-Entry
   */
  public recordTradeOutcome(result: 'HIT_TP' | 'HIT_SL') {
    this.lastTradeResult = result;
    if (result === 'HIT_TP') {
      this.reEntryCycleCount++;
      this.currentState = 'HIT_TP';
    } else {
      // Jika kena SL, reset siklus re-entry agar tidak memburu kerugian (anti-revenge)
      this.reEntryCycleCount = 0;
      this.currentState = 'HIT_SL';
    }
  }

  /**
   * Periksa apakah robot diizinkan melakukan Re-Entry Stacking
   */
  public canReEnter(maxAllowedCycles: number): boolean {
    return this.lastTradeResult === 'HIT_TP' && this.reEntryCycleCount < maxAllowedCycles;
  }

  public getCurrentSignal(): BurstSignalPayload | null {
    if (this.currentActiveSignal && !this.isSignalValid(this.currentActiveSignal)) {
      this.currentActiveSignal.state = 'EXPIRED';
    }
    return this.currentActiveSignal;
  }

  public updateAiExplanation(signalId: string, explanation: string) {
    if (this.currentActiveSignal && this.currentActiveSignal.id === signalId) {
      this.currentActiveSignal.aiExplanation = explanation;
    }
  }
}

export const signalStateMachine = new SignalStateMachine();

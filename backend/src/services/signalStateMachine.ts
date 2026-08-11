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
  
  // Smart Re-Entry Active Cycle tracking
  private activeCycle: {
    id: string;
    direction: 'BUY' | 'SELL';
    entriesCount: number;
    lastEntryPrice: number;
    initialEntryPrice: number;
    lastSignalTime: number;
  } | null = null;

  private lastTradeResult: 'HIT_TP' | 'HIT_SL' | 'NONE' = 'NONE';

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
    if (evaluation.direction === 'WAIT' || evaluation.totalScore < 65) {
      this.currentState = 'WAITING';
      return null;
    }

    const now = Date.now();
    const dir = evaluation.direction;
    const price = snapshot.currentPrice;
    const atr = snapshot.m1.features.atr || 1.5;

    // Check if we have an active cycle
    if (this.activeCycle) {
      // Reset cycle if direction changes or it's been more than 2 hours since the first signal
      if (this.activeCycle.direction !== dir || (now - this.activeCycle.lastSignalTime) > 2 * 60 * 60 * 1000) {
        this.activeCycle = null;
      }
    }

    let currentEntryCycle = 1;
    // Normalized Risk Budget (Total 100% / 1.0)
    let lotRatioPerLayer = 0.1052; // Entry 1: 52.6% total (0.1052 * 5)

    if (this.activeCycle) {
      // Cooldown check: minimal 15 detik dari sinyal sebelumnya agar tidak spam
      if (now - this.activeCycle.lastSignalTime < 15000) {
        return null;
      }

      if (this.activeCycle.entriesCount >= 3) {
        return null; // Max 3 entries reached for this cycle
      }

      // Calculate Pullback Distance: MAX(5 pips, ATR_M5 * 0.25)
      // Since 1 pip = 0.1 in price (XAUUSD), 5 pips = 0.5 price diff
      const atrM5 = snapshot.m5.features.atr || atr;
      const minPullbackPoints = Math.max(0.5, atrM5 * 0.25);

      // Anti-chasing check
      if (dir === 'BUY') {
        if (price > this.activeCycle.lastEntryPrice - minPullbackPoints) {
           return null; // Must be lower by minPullbackPoints
        }
      } else {
        if (price < this.activeCycle.lastEntryPrice + minPullbackPoints) {
           return null; // Must be higher by minPullbackPoints
        }
      }

      currentEntryCycle = this.activeCycle.entriesCount + 1;
      
      // Update lot ratios for re-entries
      if (currentEntryCycle === 2) {
        lotRatioPerLayer = 0.0632; // Entry 2: 31.6% total (0.0632 * 5)
      } else if (currentEntryCycle === 3) {
        lotRatioPerLayer = 0.0316; // Entry 3: 15.8% total (0.0316 * 5)
      }
    }

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
        lotRatio: lotRatioPerLayer,
      });
    }

    const signalId = `AURUM-${Date.now().toString().slice(-6)}`;
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
      timestampMs: now,
      ttlSeconds,
      currentReEntryCycle: currentEntryCycle,
      maxReEntryCycles: 3,
      layers,
      reasons: evaluation.reasons,
      warnings: evaluation.warnings,
    };

    // Update active cycle state
    if (!this.activeCycle) {
      this.activeCycle = {
        id: signalId,
        direction: dir,
        entriesCount: 1,
        lastEntryPrice: price,
        initialEntryPrice: price,
        lastSignalTime: now,
      };
    } else {
      this.activeCycle.entriesCount = currentEntryCycle;
      this.activeCycle.lastEntryPrice = price;
      this.activeCycle.lastSignalTime = now;
    }

    this.currentActiveSignal = payload;
    return payload;
  }

  /**
   * Catat hasil penutupan posisi untuk kontrol siklus Re-Entry
   */
  public recordTradeOutcome(result: 'HIT_TP' | 'HIT_SL') {
    this.lastTradeResult = result;
    
    // Reset siklus jika trade ditutup (baik kena TP maupun SL)
    // agar setup berikutnya bersih memulai dari Entry #1 lagi.
    this.activeCycle = null;
    
    if (result === 'HIT_TP') {
      this.currentState = 'HIT_TP';
    } else {
      this.currentState = 'HIT_SL';
    }
  }

  /**
   * Periksa apakah robot diizinkan melakukan Re-Entry Stacking
   * (Fungsi legacy, sekarang logika dikendalikan di dalam createBurstSignal)
   */
  public canReEnter(maxAllowedCycles: number): boolean {
    return false; // Disable legacy logic
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

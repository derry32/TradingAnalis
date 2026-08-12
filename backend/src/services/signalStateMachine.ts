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
  recommendedLot?: number; // Dynamically calculated total basket lot
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
   * Bangun payload Burst Scalping dengan Dynamic TP & Lot Sizing yang siap ditembakkan ke MT5 & Telegram (<5ms)
   */
  public createBurstSignal(
    evaluation: ConfidenceEvaluation,
    snapshot: LiveMarketSnapshot,
    ttlSeconds: number = 30,
    accountBalance: number = 1000,
    riskPercent: number = 1.0
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
      if (this.activeCycle.direction !== dir || (now - this.activeCycle.lastSignalTime) > 2 * 60 * 60 * 1000) {
        this.activeCycle = null;
      }
    }

    let currentEntryCycle = 1;

    if (this.activeCycle) {
      if (now - this.activeCycle.lastSignalTime < 15000) {
        return null;
      }

      if (this.activeCycle.entriesCount >= 3) {
        return null;
      }

      const atrM5 = snapshot.m5.features.atr || atr;
      const minPullbackPoints = Math.max(0.5, atrM5 * 0.25);

      if (dir === 'BUY') {
        if (price > this.activeCycle.lastEntryPrice - minPullbackPoints) {
           return null;
        }
      } else {
        if (price < this.activeCycle.lastEntryPrice + minPullbackPoints) {
           return null;
        }
      }

      currentEntryCycle = this.activeCycle.entriesCount + 1;
    }

    // --- Dynamic Lot Sizing & Basket Risk (1% Risk Cap) ---
    const slPips = evaluation.slPips;
    const slDistancePrice = slPips * 0.1; // Convert pips to price distance
    
    // Total risk dollar amount
    const riskAmount = accountBalance * (riskPercent / 100);
    const lossPerLot = slDistancePrice * 100; 
    const calculatedTotalLot = Math.floor((riskAmount / lossPerLot) * 100) / 100;

    // Update lot size for re-entries (scale down)
    let finalTotalLot = calculatedTotalLot;
    if (currentEntryCycle === 2) {
      finalTotalLot = Math.floor(calculatedTotalLot * 0.6 * 100) / 100;
    } else if (currentEntryCycle === 3) {
      finalTotalLot = Math.floor(calculatedTotalLot * 0.3 * 100) / 100;
    }

    if (finalTotalLot < 0.01) {
      evaluation.warnings.push(`⚠ NO TRADE: Resiko total melampaui batas (Lot < 0.01). SL: $${slDistancePrice.toFixed(2)}`);
      return null;
    }

    // --- Layer Condensation Logic ---
    let maxLayers = 5;
    if (evaluation.tier === 'QUICK_SCALP') {
      maxLayers = 2; // "Tes Ombak"
    } else if (evaluation.tier === 'MOMENTUM_SCALP') {
      maxLayers = 3;
    }

    // Determine how many 0.01 lots we have, up to maxLayers
    const numLayers = Math.min(maxLayers, Math.floor(finalTotalLot / 0.01));
    const lotRatioPerLayer = 1.0 / numLayers; // Spread evenly among active layers
    const actualBasketLot = numLayers * 0.01; // e.g. if numLayers=3, we only send 0.03 total to MT5

    const zoneTolerance = Math.max(0.5, atr * 0.5);
    const entryZoneMin = dir === 'BUY' ? price - zoneTolerance : price - zoneTolerance * 1.5;
    const entryZoneMax = dir === 'BUY' ? price + zoneTolerance * 1.5 : price + zoneTolerance;

    const pullbackLimitPrice =
      dir === 'BUY'
        ? Number((price - atr * 0.8).toFixed(2))
        : Number((price + atr * 0.8).toFixed(2));

    const slPrice =
      dir === 'BUY'
        ? Number((price - slPips * 0.1).toFixed(2))
        : Number((price + slPips * 0.1).toFixed(2));

    // Bangun Layer yang diringkas (Condense) jika lot < 0.05
    const layers: BurstLayer[] = [];
    const targetTps = evaluation.targetTpPips; // e.g. [1R, 1.2R, 1.5R, 2.0R, 2.5R]
    
    // Spread the targets depending on numLayers
    // Example: If 3 layers -> we pick indices [0, 2, 4] from targetTps (TP1, TP3, TP5)
    for (let i = 0; i < numLayers; i++) {
      let tpIndex = i;
      if (numLayers === 1) tpIndex = 2; // TP3
      else if (numLayers === 2) tpIndex = i === 0 ? 1 : 4; // TP2, TP5
      else if (numLayers === 3) tpIndex = i === 0 ? 0 : (i === 1 ? 2 : 4); // TP1, TP3, TP5
      else if (numLayers === 4) tpIndex = i === 3 ? 4 : i; // TP1, TP2, TP3, TP5

      const tpPips = targetTps[tpIndex] || 10;
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
      // We attach the dynamically calculated total lot to the payload
      // We will override recommendedLot in MT5Bridge
      recommendedLot: actualBasketLot 
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

import { Signal } from './signalGenerator';
import { AnalysisResult } from './technicalAnalysis';

export type EngineState = 'ARMED' | 'REVALIDATING' | 'EXECUTING' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED';

export interface SignalSnapshot {
  score: number;
  price: number;
  h1Trend: string;
  m15Trend: string;
  m15Structure: string;
  sl: number;
  entryZoneMin: number;
  entryZoneMax: number;
  entryZoneType: string;
}

export interface RevalidationSnapshot {
  price: number;
  h1TrendValid: boolean;
  m15TrendValid: boolean;
  structureValid: boolean;
  triggerM5Valid: boolean;
}

export interface ExecutionSnapshot {
  signalPrice: number;
  zoneMin: number;
  zoneMax: number;
  triggerPrice: number;
  requestedPrice: number;
  actualFillPrice?: number;
  slippage?: number;
}

export interface PendingSignal {
  signal: Signal;
  state: EngineState;
  waitingReason?: string;
  armTimeMs: number;
  maxExpiryMs: number;
  signalSnapshot: SignalSnapshot;
  revalidationSnapshot?: RevalidationSnapshot;
  executionSnapshot?: ExecutionSnapshot;
  analysisAtArm: AnalysisResult;
}

export class PendingOrderEngine {
  private activeSignals: Map<string, PendingSignal> = new Map();
  // We'll mock the execute callback, which index.ts will set to mt5Bridge.executeMarketOrder
  public onExecuteMarketOrder: ((signal: PendingSignal) => Promise<boolean>) | null = null;
  public onSignalCancelled: ((signal: PendingSignal, reason: string) => void) | null = null;

  public add(signal: Signal, analysis: AnalysisResult): void {
    if (!signal.entryZoneMin || !signal.entryZoneMax) return;

    const signalSnapshot: SignalSnapshot = {
      score: signal.confidenceScore,
      price: signal.entryPrice,
      h1Trend: analysis.trendH1,
      m15Trend: analysis.trendM15,
      m15Structure: analysis.structureM15,
      sl: signal.stopLoss,
      entryZoneMin: signal.entryZoneMin,
      entryZoneMax: signal.entryZoneMax,
      entryZoneType: signal.entryZoneType || 'UNKNOWN'
    };

    const pendingSignal: PendingSignal = {
      signal,
      state: 'ARMED',
      armTimeMs: Date.now(),
      maxExpiryMs: Date.now() + 20 * 60 * 1000, // 20 minutes expiry
      signalSnapshot,
      analysisAtArm: analysis
    };

    this.activeSignals.set(signal.id, pendingSignal);
    console.log(`[PendingOrderEngine] ARMED Signal ${signal.id} - Waiting for price to enter ${signal.entryZoneMin}-${signal.entryZoneMax}`);
  }

  // Tick layer for price boundaries, expiry, etc.
  public onTick(currentPrice: number): void {
    const now = Date.now();
    for (const [id, ps] of this.activeSignals.entries()) {
      if (ps.state !== 'ARMED' && ps.state !== 'REVALIDATING') continue;

      if (now > ps.maxExpiryMs) {
        ps.state = 'EXPIRED';
        this.activeSignals.delete(id);
        console.log(`[PendingOrderEngine] EXPIRED Signal ${id}`);
        if (this.onSignalCancelled) this.onSignalCancelled(ps, 'EXPIRED (Timeout)');
        continue;
      }

      // Check if price entered zone
      if (currentPrice >= ps.signalSnapshot.entryZoneMin && currentPrice <= ps.signalSnapshot.entryZoneMax) {
         if (ps.state === 'ARMED') {
           ps.state = 'REVALIDATING';
           console.log(`[PendingOrderEngine] ZONE HIT Signal ${id} at ${currentPrice}`);
         }
      } else {
         // Emergency invalidation if price flies away
         if (ps.signal.type === 'BUY' && currentPrice < ps.signalSnapshot.sl) {
            ps.state = 'CANCELLED';
            this.activeSignals.delete(id);
            console.log(`[PendingOrderEngine] CANCELLED Signal ${id} - Price hit SL before entry`);
            if (this.onSignalCancelled) this.onSignalCancelled(ps, 'CANCELLED (Hit SL before entry)');
         } else if (ps.signal.type === 'SELL' && currentPrice > ps.signalSnapshot.sl) {
            ps.state = 'CANCELLED';
            this.activeSignals.delete(id);
            console.log(`[PendingOrderEngine] CANCELLED Signal ${id} - Price hit SL before entry`);
            if (this.onSignalCancelled) this.onSignalCancelled(ps, 'CANCELLED (Hit SL before entry)');
         }
      }
    }
  }

  // Candle layer for structural validation
  public async onM5Closed(currentPrice: number, analysis: AnalysisResult): Promise<void> {
    // Collect promises for EXECUTING state so we don't block the loop on async calls but we keep it atomic
    const executionPromises: Promise<void>[] = [];

    for (const [id, ps] of this.activeSignals.entries()) {
      if (ps.state !== 'REVALIDATING' && ps.state !== 'ARMED') continue;

      const dir = ps.signal.type;
      
      // 1. Structural Invalidation
      if (dir === 'BUY' && (analysis.marketStructureM15 === 'CHOCH_BEAR' || analysis.trendM15 === 'BEARISH')) {
         ps.state = 'CANCELLED';
         this.activeSignals.delete(id);
         console.log(`[PendingOrderEngine] CANCELLED Signal ${id} - M15 Structure broken (BEARISH)`);
         if (this.onSignalCancelled) this.onSignalCancelled(ps, 'CANCELLED (Structural Invalidation)');
         continue;
      }
      if (dir === 'SELL' && (analysis.marketStructureM15 === 'CHOCH_BULL' || analysis.trendM15 === 'BULLISH')) {
         ps.state = 'CANCELLED';
         this.activeSignals.delete(id);
         console.log(`[PendingOrderEngine] CANCELLED Signal ${id} - M15 Structure broken (BULLISH)`);
         if (this.onSignalCancelled) this.onSignalCancelled(ps, 'CANCELLED (Structural Invalidation)');
         continue;
      }

      // If price is in zone, we check for triggers
      if (ps.state === 'REVALIDATING') {
        const h1TrendValid = dir === 'BUY' ? analysis.trendH1 !== 'BEARISH' : analysis.trendH1 !== 'BULLISH';
        const m15TrendValid = dir === 'BUY' ? analysis.trendM15 !== 'BEARISH' : analysis.trendM15 !== 'BULLISH';
        const structureValid = true; // Checked above

        let triggerM5Valid = false;
        if (dir === 'BUY') {
           triggerM5Valid = analysis.triggerCandleM5.close >= analysis.triggerCandleM5.open || analysis.patternM5 === 'PIN_BAR';
        } else {
           triggerM5Valid = analysis.triggerCandleM5.close <= analysis.triggerCandleM5.open || analysis.patternM5 === 'PIN_BAR';
        }

        ps.revalidationSnapshot = {
          price: currentPrice,
          h1TrendValid,
          m15TrendValid,
          structureValid,
          triggerM5Valid
        };

        if (h1TrendValid && m15TrendValid && structureValid) {
           if (triggerM5Valid) {
              ps.state = 'EXECUTING'; // ATOMIC LOCK
              console.log(`[PendingOrderEngine] EXECUTING Signal ${id}`);
              
              ps.executionSnapshot = {
                 signalPrice: ps.signalSnapshot.price,
                 zoneMin: ps.signalSnapshot.entryZoneMin,
                 zoneMax: ps.signalSnapshot.entryZoneMax,
                 triggerPrice: analysis.triggerCandleM5.close,
                 requestedPrice: currentPrice
              };

              if (this.onExecuteMarketOrder) {
                 const executeTask = this.onExecuteMarketOrder(ps).then((success) => {
                     if (success) {
                        ps.state = 'EXECUTED';
                        this.activeSignals.delete(id);
                        console.log(`[PendingOrderEngine] EXECUTED Signal ${id}`);
                     } else {
                        ps.state = 'CANCELLED';
                        this.activeSignals.delete(id);
                        console.log(`[PendingOrderEngine] FAILED TO EXECUTE Signal ${id}`);
                     }
                 });
                 executionPromises.push(executeTask);
              }
           } else {
              ps.state = 'ARMED';
              ps.waitingReason = 'WAITING_FOR_M5_TRIGGER';
              console.log(`[PendingOrderEngine] WAIT Signal ${id} - Waiting for M5 Trigger. Back to ARMED.`);
           }
        } else {
           ps.state = 'CANCELLED';
           this.activeSignals.delete(id);
           console.log(`[PendingOrderEngine] CANCELLED Signal ${id} - Revalidation Failed (Trend/Structure mismatch)`);
           if (this.onSignalCancelled) this.onSignalCancelled(ps, 'CANCELLED (Revalidation Failed)');
        }
      }
    }

    await Promise.all(executionPromises);
  }

  public getActiveSignals(): PendingSignal[] {
    return Array.from(this.activeSignals.values());
  }
}

export const pendingOrderEngine = new PendingOrderEngine();

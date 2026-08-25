import { config } from '../config';
import { Signal } from './signalGenerator';
import { BurstSignalPayload, signalStateMachine } from './signalStateMachine';

export interface MT5SignalPayload {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  executionType: 'MARKET' | 'LIMIT';
  price: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  strategy: string;
  confidence: number;
  validSeconds: number;
  timestamp: string;
  timestampMs?: number;
  entryZoneMin?: number;
  entryZoneMax?: number;
  pullbackLimitPrice?: number;
  recommendedLot?: number;
  executionMode?: 'BASKET_SCALPER' | 'HALF_SECURED' | 'BURST_5_LAYERS';
  tier?: string;
  currentReEntryCycle?: number;
  maxReEntryCycles?: number;
  layers?: any[];
}

export interface MT5AckPayload {
  signalId: string;
  ticket: number;
  executedPrice: number;
  status: 'OPENED' | 'FAILED' | 'CLOSED' | 'CANCELLED';
  comment?: string;
  spreadPips?: number;
}

export interface MT5ClosePayload {
  signalId: string;
  ticket: number;
  profit: number;
  closePrice: number;
}

export class MT5BridgeService {
  private latestSignal: Signal | null = null;
  private latestBurstSignal: BurstSignalPayload | null = null;
  private acknowledgedSignals: Map<string, MT5AckPayload> = new Map();
  private resetRequestedUntil: number = 0;

  public triggerResetGuard(): void {
    this.resetRequestedUntil = Date.now() + 30000; // Keep reset flag active for 30 seconds
    console.log('[MT5 Bridge] Reset Guard signal flagged active for next 30 seconds.');
  }

  public setLatestBurstSignal(burst: BurstSignalPayload): void {
    this.latestBurstSignal = burst;
  }

  public setLatestSignal(signal: Signal): void {
    if (signal.type === 'WAIT') return;
    this.latestSignal = signal;
  }

  public getLatestSignalPayload(token: string): { success: boolean; data?: any; error?: string } {
    if (!this.authenticate(token)) {
      return { success: false, error: 'Unauthorized: Invalid token' };
    }

    const isReset = Date.now() < this.resetRequestedUntil;

    // Prioritaskan Burst Signal State Machine jika tersedia dan belum kadaluarsa
    const currentBurst = signalStateMachine.getCurrentSignal() || this.latestBurstSignal;
    if (currentBurst && signalStateMachine.isSignalValid(currentBurst) && currentBurst.state !== 'EXPIRED') {
      const isAlreadyAcked = this.acknowledgedSignals.has(currentBurst.id);
      
      const burstPayload: any = {
        id: currentBurst.id,
        symbol: 'XAUUSD',
        type: currentBurst.direction,
        executionType: 'MARKET',
        price: currentBurst.entryPrice,
        stopLoss: currentBurst.stopLossPrice,
        takeProfit1: currentBurst.layers[0]?.tpPrice || currentBurst.entryPrice + 1.0,
        takeProfit2: currentBurst.layers[currentBurst.layers.length - 1]?.tpPrice || currentBurst.entryPrice + 1.5,
        strategy: currentBurst.tier,
        confidence: currentBurst.confidenceScore,
        validSeconds: currentBurst.ttlSeconds,
        timestamp: new Date(currentBurst.timestampMs).toISOString(),
        timestampMs: currentBurst.timestampMs,
        entryZoneMin: currentBurst.entryZoneMin,
        entryZoneMax: currentBurst.entryZoneMax,
        pullbackLimitPrice: currentBurst.pullbackLimitPrice,
        recommendedLot: currentBurst.recommendedLot || (currentBurst.confidenceScore >= 85 ? 0.05 : 0.03),
        executionMode: 'BURST_5_LAYERS',
        tier: currentBurst.tier,
        currentReEntryCycle: currentBurst.currentReEntryCycle,
        maxReEntryCycles: currentBurst.maxReEntryCycles,
        layerCount: currentBurst.layers.length,
      };

      currentBurst.layers.forEach((layer, idx) => {
        burstPayload[`layer${idx+1}_tpPrice`] = layer.tpPrice;
        burstPayload[`layer${idx+1}_tpPips`] = layer.tpPips;
        burstPayload[`layer${idx+1}_slPrice`] = layer.slPrice;
        burstPayload[`layer${idx+1}_slPips`] = layer.slPips;
        burstPayload[`layer${idx+1}_lotRatio`] = layer.lotRatio;
      });

      return {
        success: true,
        data: {
          status: isAlreadyAcked ? 'ALREADY_ACKNOWLEDGED' : 'ACTIVE_SIGNAL',
          resetGuard: isReset ? 'true' : 'false',
          signal: burstPayload,
          serverTime: new Date().toISOString(),
        },
      };
    }

    if (!this.latestSignal || this.latestSignal.type === 'WAIT') {
      return {
        success: true,
        data: {
          status: 'NO_SIGNAL',
          resetGuard: isReset ? 'true' : 'false',
          serverTime: new Date().toISOString(),
        },
      };
    }

    // Check if signal age exceeds 20 minutes
    const signalAgeMs = Date.now() - new Date(this.latestSignal.timestamp).getTime();
    if (signalAgeMs > 20 * 60 * 1000) {
      return {
        success: true,
        data: {
          status: 'NO_SIGNAL',
          resetGuard: isReset ? 'true' : 'false',
          reason: 'Latest signal expired (>20m)',
          serverTime: new Date().toISOString(),
        },
      };
    }

    const isLimit =
      this.latestSignal.executionType?.includes('PULLBACK') ||
      this.latestSignal.executionType?.includes('LIMIT');

    let targetPrice = this.latestSignal.entryPrice;
    let zoneMin: number | undefined = undefined;
    let zoneMax: number | undefined = undefined;

    if (this.latestSignal.entryZone && this.latestSignal.entryZone.includes('-')) {
      const parts = this.latestSignal.entryZone
        .split('(')[0]
        .split('-')
        .map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        zoneMin = Math.min(parts[0], parts[1]);
        zoneMax = Math.max(parts[0], parts[1]);
        if (isLimit) {
          targetPrice = Number(((parts[0] + parts[1]) / 2).toFixed(2));
        }
      }
    }

    const confidence = this.latestSignal.confidenceScore || 70;
    let recommendedLot = 0.03;
    if (confidence >= 80) recommendedLot = 0.09;
    else if (confidence >= 70) recommendedLot = 0.05;

    const payload: MT5SignalPayload = {
      id: this.latestSignal.id,
      symbol: 'XAUUSD',
      type: this.latestSignal.type as 'BUY' | 'SELL',
      executionType: isLimit ? 'LIMIT' : 'MARKET',
      price: targetPrice,
      stopLoss: this.latestSignal.stopLoss,
      takeProfit1: this.latestSignal.takeProfit1,
      takeProfit2: this.latestSignal.takeProfit2,
      strategy: this.latestSignal.strategy,
      confidence: confidence,
      validSeconds: isLimit ? 1200 : 30, // 30s TTL default
      timestamp: this.latestSignal.timestamp,
      timestampMs: new Date(this.latestSignal.timestamp).getTime(),
      entryZoneMin: zoneMin,
      entryZoneMax: zoneMax,
      recommendedLot: recommendedLot,
      executionMode: 'BURST_5_LAYERS',
    };

    const isAlreadyAcked = this.acknowledgedSignals.has(this.latestSignal.id);

    return {
      success: true,
      data: {
        status: isAlreadyAcked ? 'ALREADY_ACKNOWLEDGED' : 'ACTIVE_SIGNAL',
        resetGuard: isReset ? 'true' : 'false',
        signal: payload,
        serverTime: new Date().toISOString(),
      },
    };
  }

  public recordAcknowledgment(
    token: string,
    ack: MT5AckPayload
  ): { success: boolean; message: string } {
    if (!this.authenticate(token)) {
      return { success: false, message: 'Unauthorized: Invalid token' };
    }

    if (!ack.signalId) {
      return { success: false, message: 'Missing signalId' };
    }

    this.acknowledgedSignals.set(ack.signalId, ack);
    console.log(
      `[MT5 Bridge] Received ACK from MT5 for ${ack.signalId}: Ticket #${ack.ticket} | Status: ${ack.status} | Price: ${ack.executedPrice} | Spread: ${ack.spreadPips || 0} pips`
    );

    return {
      success: true,
      message: `Signal ${ack.signalId} acknowledged with ticket #${ack.ticket}`,
    };
  }

  public hasAcknowledged(signalId: string): boolean {
    return this.acknowledgedSignals.has(signalId);
  }

  public recordTradeClose(
    token: string,
    payload: MT5ClosePayload
  ): { success: boolean; message: string } {
    if (!this.authenticate(token)) {
      return { success: false, message: 'Unauthorized: Invalid token' };
    }

    if (!payload.signalId) {
      return { success: false, message: 'Missing signalId' };
    }

    console.log(
      `[MT5 Bridge] Received CLOSE from MT5 for ${payload.signalId}: Ticket #${payload.ticket} | Profit: ${payload.profit} | ClosePrice: ${payload.closePrice}`
    );

    return {
      success: true,
      message: `Signal ${payload.signalId} close acknowledged with ticket #${payload.ticket}`,
    };
  }

  public getHistory(): any[] {
    return Array.from(this.acknowledgedSignals.values());
  }

  private authenticate(token: string): boolean {
    if (!token) return false;
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    return cleanToken === config.MT5_BRIDGE_TOKEN;
  }
}

export const mt5Bridge = new MT5BridgeService();

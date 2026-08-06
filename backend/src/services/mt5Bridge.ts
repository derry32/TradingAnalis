import { config } from '../config';
import { Signal } from './signalGenerator';

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
  entryZoneMin?: number;
  entryZoneMax?: number;
  recommendedLot?: number;
  executionMode?: 'BASKET_SCALPER' | 'HALF_SECURED';
}

export interface MT5AckPayload {
  signalId: string;
  ticket: number;
  executedPrice: number;
  status: 'OPENED' | 'FAILED' | 'CLOSED' | 'CANCELLED';
  comment?: string;
  spreadPips?: number;
}

export class MT5BridgeService {
  private latestSignal: Signal | null = null;
  private acknowledgedSignals: Map<string, MT5AckPayload> = new Map();
  private resetRequested: boolean = false;

  public triggerResetGuard(): void {
    this.resetRequested = true;
    console.log('[MT5 Bridge] Reset Guard signal flagged for next MT5 poll.');
  }

  public setLatestSignal(signal: Signal): void {
    if (signal.type === 'WAIT') return;
    this.latestSignal = signal;
  }

  public getLatestSignalPayload(token: string): { success: boolean; data?: any; error?: string } {
    if (!this.authenticate(token)) {
      return { success: false, error: 'Unauthorized: Invalid token' };
    }

    const resetFlag = this.resetRequested;
    if (this.resetRequested) {
      this.resetRequested = false; // consume flag
    }

    if (!this.latestSignal || this.latestSignal.type === 'WAIT') {
      return { 
        success: true, 
        data: { 
          status: 'NO_SIGNAL',
          resetGuard: resetFlag ? "true" : "false",
          serverTime: new Date().toISOString() 
        } 
      };
    }

    // Check if signal age exceeds 20 minutes
    const signalAgeMs = Date.now() - new Date(this.latestSignal.timestamp).getTime();
    if (signalAgeMs > 20 * 60 * 1000) {
      return { 
        success: true, 
        data: { 
          status: 'NO_SIGNAL', 
          reason: 'Latest signal expired (>20m)',
          serverTime: new Date().toISOString() 
        } 
      };
    }

    const isLimit = this.latestSignal.executionType?.includes('PULLBACK') || this.latestSignal.executionType?.includes('LIMIT');
    
    // Calculate targeted entry price and zone bounds for precision layering
    let targetPrice = this.latestSignal.entryPrice;
    let zoneMin: number | undefined = undefined;
    let zoneMax: number | undefined = undefined;

    if (this.latestSignal.entryZone && this.latestSignal.entryZone.includes('-')) {
      const parts = this.latestSignal.entryZone.split('(')[0].split('-').map(s => parseFloat(s.trim()));
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

    const executionMode = confidence >= 75 ? 'HALF_SECURED' : 'BASKET_SCALPER';

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
      validSeconds: isLimit ? 1200 : 300, // 20 mins for limit, 5 mins for market
      timestamp: this.latestSignal.timestamp,
      entryZoneMin: zoneMin,
      entryZoneMax: zoneMax,
      recommendedLot: recommendedLot,
      executionMode: executionMode
    };

    const isAlreadyAcked = this.acknowledgedSignals.has(this.latestSignal.id);

    return {
      success: true,
      data: {
        status: isAlreadyAcked ? 'ALREADY_ACKNOWLEDGED' : 'ACTIVE_SIGNAL',
        resetGuard: resetFlag ? "true" : "false",
        signal: payload,
        serverTime: new Date().toISOString()
      }
    };
  }

  public recordAcknowledgment(token: string, ack: MT5AckPayload): { success: boolean; message: string } {
    if (!this.authenticate(token)) {
      return { success: false, message: 'Unauthorized: Invalid token' };
    }

    if (!ack.signalId) {
      return { success: false, message: 'Missing signalId' };
    }

    this.acknowledgedSignals.set(ack.signalId, ack);
    console.log(`[MT5 Bridge] Received ACK from MT5 for ${ack.signalId}: Ticket #${ack.ticket} | Status: ${ack.status} | Price: ${ack.executedPrice} | Spread: ${ack.spreadPips || 0} pips`);

    return { success: true, message: `Signal ${ack.signalId} acknowledged with ticket #${ack.ticket}` };
  }

  public getHistory(): MT5AckPayload[] {
    return Array.from(this.acknowledgedSignals.values());
  }

  private authenticate(token: string): boolean {
    return !!token && token === config.MT5_BRIDGE_TOKEN;
  }
}

export const mt5Bridge = new MT5BridgeService();

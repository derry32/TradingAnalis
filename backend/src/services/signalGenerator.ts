import { config } from '../config';

export interface Signal {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: string;
  reason: string;
}

export class SignalGenerator {
  public generate(
    technical: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    currentPrice: number,
    sentimentScore: number
  ): Signal | null {
    if (technical === 'NEUTRAL' || sentiment === 'NEUTRAL') {
      return null;
    }

    const currentHourUTC = new Date().getUTCHours();
    const currentHourWIB = (currentHourUTC + 7) % 24;
    const isAsianSession = currentHourWIB >= 6 && currentHourWIB < 14;
    const isGoldenOverlap = currentHourWIB >= 19 && currentHourWIB <= 23;

    let strength: 'HIGH' | 'LOW' = 'LOW';
    if (sentimentScore >= 7 && !isAsianSession) strength = 'HIGH';
    if (isGoldenOverlap && sentimentScore >= 6) strength = 'HIGH'; 

    let sessionName = 'Sesi Eropa/AS';
    if (isAsianSession) sessionName = 'Sesi Asia';
    if (isGoldenOverlap) sessionName = 'Golden Overlap';

    if (technical === 'BULLISH' && sentiment === 'BULLISH') {
      return this.calculateRisk(currentPrice, 'BUY', strength, sessionName);
    }

    if (technical === 'BEARISH' && sentiment === 'BEARISH') {
      return this.calculateRisk(currentPrice, 'SELL', strength, sessionName);
    }

    return null;
  }

  private calculateRisk(price: number, type: 'BUY' | 'SELL', strength: 'HIGH' | 'LOW', sessionName: string): Signal {
    // 1 pip pergerakan XAUUSD rata-rata = $0.1
    const pipValue = 0.1;
    const slPips = config.STOP_LOSS_PIPS;
    const tpPips = config.STOP_LOSS_PIPS * config.RISK_REWARD_RATIO;
    
    const slDistance = slPips * pipValue;
    const tpDistance = tpPips * pipValue;

    if (type === 'BUY') {
      return {
        type: 'BUY',
        entryPrice: price,
        stopLoss: price - slDistance,
        takeProfit: price + tpDistance,
        timestamp: new Date().toISOString(),
        reason: `[${strength} PROBABILITY] (${sessionName}) Teknikal & Sentimen sepakat BULLISH. SL: ${slPips} pips, TP: ${tpPips} pips.`
      };
    } else {
      return {
        type: 'SELL',
        entryPrice: price,
        stopLoss: price + slDistance,
        takeProfit: price - tpDistance,
        timestamp: new Date().toISOString(),
        reason: `[${strength} PROBABILITY] (${sessionName}) Teknikal & Sentimen sepakat BEARISH. SL: ${slPips} pips, TP: ${tpPips} pips.`
      };
    }
  }
}

import { config } from '../config';
import { AnalysisResult } from './technicalAnalysis';

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
    analysis: AnalysisResult,
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    currentPrice: number,
    sentimentScore: number
  ): Signal | null {
    // SOP Check
    if (analysis.trendH4 === 'NEUTRAL') return null;

    let tradeType: 'BUY' | 'SELL' | null = null;
    let stopLoss = 0;

    if (analysis.trendH4 === 'BULLISH' && analysis.isRetracedH1 && analysis.patternM5.includes('BULLISH')) {
      tradeType = 'BUY';
      stopLoss = analysis.closestSwingLowM5 - 0.5; // buffer
    }

    if (analysis.trendH4 === 'BEARISH' && analysis.isRetracedH1 && analysis.patternM5.includes('BEARISH')) {
      tradeType = 'SELL';
      stopLoss = analysis.closestSwingHighM5 + 0.5; // buffer
    }

    // Pin bar logic
    if (analysis.trendH4 === 'BULLISH' && analysis.isRetracedH1 && analysis.patternM5 === 'PIN_BAR') {
      tradeType = 'BUY';
      stopLoss = analysis.closestSwingLowM5 - 0.5;
    }
    
    if (analysis.trendH4 === 'BEARISH' && analysis.isRetracedH1 && analysis.patternM5 === 'PIN_BAR') {
      tradeType = 'SELL';
      stopLoss = analysis.closestSwingHighM5 + 0.5;
    }

    // Optional: Filter with sentiment if needed, but SOP relies purely on PA. 
    // We will still include sentiment in strength scoring.
    if (!tradeType) return null;

    // Check risk distance
    const riskAbsolute = Math.abs(currentPrice - stopLoss);
    // Limit max SL to $10 absolute for XAUUSD to prevent account blowout
    if (riskAbsolute > 10) {
      console.log(`[SignalGenerator] Ignored signal. SL distance too large: $${riskAbsolute.toFixed(2)}`);
      return null;
    }
    
    if (riskAbsolute < 0.5) return null; // Invalid SL too tight

    const currentHourUTC = new Date().getUTCHours();
    const currentHourWIB = (currentHourUTC + 7) % 24;
    const isAsianSession = currentHourWIB >= 6 && currentHourWIB < 14;
    const isGoldenOverlap = currentHourWIB >= 19 && currentHourWIB <= 23;

    let strength: 'HIGH' | 'LOW' = 'LOW';
    if (sentimentScore >= 7 && sentiment === analysis.trendH4 && !isAsianSession) strength = 'HIGH';
    if (isGoldenOverlap && sentimentScore >= 6) strength = 'HIGH'; 

    let sessionName = 'Sesi Eropa/AS';
    if (isAsianSession) sessionName = 'Sesi Asia';
    if (isGoldenOverlap) sessionName = 'Golden Overlap';

    const tpDistance = riskAbsolute * config.RISK_REWARD_RATIO;
    let takeProfit = tradeType === 'BUY' ? currentPrice + tpDistance : currentPrice - tpDistance;

    const patternName = analysis.patternM5.replace('_', ' ');

    return {
      type: tradeType,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      timestamp: new Date().toISOString(),
      reason: `[${strength} PROBABILITY] (${sessionName}) SOP Valid: H4 ${analysis.trendH4}, H1 Pantulan Area, M5 ${patternName}. SL dinamis RR 1:${config.RISK_REWARD_RATIO}.`
    };
  }
}

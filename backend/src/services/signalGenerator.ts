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
    let tradeType: 'BUY' | 'SELL' | null = null;
    let stopLoss = 0;
    let strategyName = '';

    // Skenario 1: Momentum (Tren H4 Jelas, Abaikan Koreksi H1 jika M5 kuat)
    if (analysis.trendH4 === 'BULLISH' && (analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'BUY';
      stopLoss = analysis.closestSwingLowM5 - 0.5;
      strategyName = 'H4 Momentum';
    } 
    else if (analysis.trendH4 === 'BEARISH' && (analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'SELL';
      stopLoss = analysis.closestSwingHighM5 + 0.5;
      strategyName = 'H4 Momentum';
    }
    // Skenario 2: Scalping H1 (Jika H4 Sideways, gunakan Tren H1)
    else if (analysis.trendH4 === 'NEUTRAL' && analysis.trendH1 === 'BULLISH' && (analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'BUY';
      stopLoss = analysis.closestSwingLowM5 - 0.5;
      strategyName = 'H1 Scalping';
    }
    else if (analysis.trendH4 === 'NEUTRAL' && analysis.trendH1 === 'BEARISH' && (analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'SELL';
      stopLoss = analysis.closestSwingHighM5 + 0.5;
      strategyName = 'H1 Scalping';
    }
    // Skenario 3: News Trading (Jika Teknikal Sideways, gunakan Sentimen + M5 Pattern)
    else if (analysis.trendH4 === 'NEUTRAL' && analysis.trendH1 === 'NEUTRAL' && sentiment === 'BULLISH' && sentimentScore >= 7 && (analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'BUY';
      stopLoss = analysis.closestSwingLowM5 - 0.5;
      strategyName = 'News Trading';
    }
    else if (analysis.trendH4 === 'NEUTRAL' && analysis.trendH1 === 'NEUTRAL' && sentiment === 'BEARISH' && sentimentScore >= 7 && (analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR')) {
      tradeType = 'SELL';
      stopLoss = analysis.closestSwingHighM5 + 0.5;
      strategyName = 'News Trading';
    }

    if (!tradeType) return null;

    // Check risk distance (Hapus batas $10 absolut untuk support akun Cent)
    const riskAbsolute = Math.abs(currentPrice - stopLoss);
    
    // Invalid SL terlalu ketat (mencegah spread hunting)
    if (riskAbsolute < 0.3) return null; 


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
      reason: `[${strength} PROB] [${strategyName}] (${sessionName}) M5 ${patternName}. Strict SL Dinamis & TP berjenjang dengan metode baku RR 1:${config.RISK_REWARD_RATIO}.`
    };
  }
}

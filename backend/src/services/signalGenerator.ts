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
  
  private calculateScore(direction: 'BUY' | 'SELL', analysis: AnalysisResult, sentiment: string, isAsianSession: boolean) {
    let score = 10; // Base 10 for guaranteed 1:2 RR
    let reasons: string[] = ['✔ RR 1:2 (10)'];

    // H4 Trend (20)
    if ((direction === 'BUY' && analysis.trendH4 === 'BULLISH') || (direction === 'SELL' && analysis.trendH4 === 'BEARISH')) {
        score += 20; reasons.push(`✔ H4 ${analysis.trendH4} (20)`);
    } else if (analysis.trendH4 !== 'NEUTRAL') {
        reasons.push(`✖ Counter Trend H4 (0)`);
    } else {
        reasons.push(`✖ H4 Neutral (0)`);
    }

    // H1 Trend (15)
    if ((direction === 'BUY' && analysis.trendH1 === 'BULLISH') || (direction === 'SELL' && analysis.trendH1 === 'BEARISH')) {
        score += 15; reasons.push(`✔ H1 ${analysis.trendH1} (15)`);
    } else if (analysis.trendH1 !== 'NEUTRAL') {
        reasons.push(`✖ Counter Trend H1 (0)`);
    }

    // H1 S/R Retracement (15)
    if (analysis.isRetracedH1) {
        score += 15; reasons.push(`✔ H1 Support/Resistance (15)`);
    }

    // M5 Pattern (15)
    const isBullPattern = analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR';
    const isBearPattern = analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR';
    
    if (direction === 'BUY' && isBullPattern) {
        score += 15; reasons.push(`✔ M5 ${analysis.patternM5.replace('_', ' ')} (15)`);
    } else if (direction === 'SELL' && isBearPattern) {
        score += 15; reasons.push(`✔ M5 ${analysis.patternM5.replace('_', ' ')} (15)`);
    }

    // Sentiment (10)
    if ((direction === 'BUY' && sentiment === 'BULLISH') || (direction === 'SELL' && sentiment === 'BEARISH')) {
        score += 10; reasons.push(`✔ AI Sentiment ${sentiment} (10)`);
    }

    // Session (10)
    if (!isAsianSession) {
        score += 10; reasons.push(`✔ London/NY Session (10)`);
    }

    // Volume Spike (5)
    if (analysis.volumeSpikeM5) {
        score += 5; reasons.push(`✔ M5 Volume Spike (5)`);
    }

    return { score, reasons };
  }

  public generate(
    analysis: AnalysisResult,
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    currentPrice: number,
    sentimentScore: number
  ): Signal | null {
    
    // Harus ada trigger Price Action di M5
    if (analysis.patternM5 === 'NONE') return null;

    const currentHourUTC = new Date().getUTCHours();
    const currentHourWIB = (currentHourUTC + 7) % 24;
    const isAsianSession = currentHourWIB >= 6 && currentHourWIB < 14;

    let possibleDirections: ('BUY' | 'SELL')[] = [];
    if (analysis.patternM5.includes('BULLISH')) possibleDirections.push('BUY');
    if (analysis.patternM5.includes('BEARISH')) possibleDirections.push('SELL');
    if (analysis.patternM5 === 'PIN_BAR') {
      possibleDirections.push('BUY');
      possibleDirections.push('SELL');
    }

    let bestTrade: { dir: 'BUY' | 'SELL', score: number, reasons: string[] } | null = null;

    for (const dir of possibleDirections) {
      const { score, reasons } = this.calculateScore(dir, analysis, sentiment, isAsianSession);
      // Threshold minimal 60 poin untuk bisa dianggap sinyal valid
      if (score >= 60) {
        if (!bestTrade || score > bestTrade.score) {
          bestTrade = { dir, score, reasons };
        }
      }
    }

    if (!bestTrade) return null;

    const tradeType = bestTrade.dir;
    const score = bestTrade.score;
    const reasons = bestTrade.reasons;

    let stopLoss = 0;
    if (tradeType === 'BUY') {
      stopLoss = analysis.closestSwingLowM5 - 0.5;
    } else {
      stopLoss = analysis.closestSwingHighM5 + 0.5;
    }

    const riskAbsolute = Math.abs(currentPrice - stopLoss);
    
    // Invalid SL terlalu ketat (mencegah spread hunting)
    if (riskAbsolute < 0.3) return null; 

    // Calculate TP1 (1:2)
    const tp1Distance = riskAbsolute * 2;
    let takeProfit = tradeType === 'BUY' ? currentPrice + tp1Distance : currentPrice - tp1Distance;

    // Convert Score to Probability Label
    let probabilityLabel = '⭐ Low';
    if (score >= 90) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
    else if (score >= 80) probabilityLabel = '⭐⭐⭐⭐ High';
    else if (score >= 65) probabilityLabel = '⭐⭐⭐ Medium';

    const reasonString = `[Agent Derry] ${probabilityLabel} (${score}% Confidence).\\nReasons:\\n${reasons.join('\\n')}`;

    return {
      type: tradeType,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit: takeProfit, 
      timestamp: new Date().toISOString(),
      reason: reasonString
    };
  }
}

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
    let score = 5; // Base 5 for guaranteed 1:2 RR
    let reasons: string[] = ['✔ RR 1:2 (5)'];

    // H4 Trend (20)
    if ((direction === 'BUY' && analysis.trendH4 === 'BULLISH') || (direction === 'SELL' && analysis.trendH4 === 'BEARISH')) {
        score += 20; reasons.push(`✔ H4 ${analysis.trendH4} (20)`);
    } else if (analysis.trendH4 !== 'NEUTRAL') {
        reasons.push(`✖ Counter Trend H4 (0)`);
    }

    // M5 Pattern (15)
    const isBullPattern = analysis.patternM5.includes('BULLISH') || analysis.patternM5 === 'PIN_BAR';
    const isBearPattern = analysis.patternM5.includes('BEARISH') || analysis.patternM5 === 'PIN_BAR';
    
    if (direction === 'BUY' && isBullPattern) {
        score += 15; reasons.push(`✔ M5 ${analysis.patternM5.replace('_', ' ')} (15)`);
    } else if (direction === 'SELL' && isBearPattern) {
        score += 15; reasons.push(`✔ M5 ${analysis.patternM5.replace('_', ' ')} (15)`);
    }

    // EMA Alignment (10)
    const currentPriceH1 = analysis.ema20_H1; // approximation since we don't pass current price to calculateScore directly, wait, EMA needs to be checked against current price.
    // Actually, let's just check if EMA20 > EMA50 > EMA200 for Bullish
    if (direction === 'BUY' && analysis.ema20_H1 > analysis.ema50_H1 && analysis.ema50_H1 > analysis.ema200_H1) {
        score += 10; reasons.push(`✔ EMA Alignment Bullish (10)`);
    } else if (direction === 'SELL' && analysis.ema20_H1 < analysis.ema50_H1 && analysis.ema50_H1 < analysis.ema200_H1) {
        score += 10; reasons.push(`✔ EMA Alignment Bearish (10)`);
    }

    // BOS/CHoCH Market Structure (10)
    if (direction === 'BUY' && (analysis.marketStructureH1 === 'BOS_BULL' || analysis.marketStructureH1 === 'CHOCH_BULL')) {
        score += 10; reasons.push(`✔ H1 Structure ${analysis.marketStructureH1} (10)`);
    } else if (direction === 'SELL' && (analysis.marketStructureH1 === 'BOS_BEAR' || analysis.marketStructureH1 === 'CHOCH_BEAR')) {
        score += 10; reasons.push(`✔ H1 Structure ${analysis.marketStructureH1} (10)`);
    }

    // H1 Trend (10)
    if ((direction === 'BUY' && analysis.trendH1 === 'BULLISH') || (direction === 'SELL' && analysis.trendH1 === 'BEARISH')) {
        score += 10; reasons.push(`✔ H1 ${analysis.trendH1} (10)`);
    }

    // H1 S/R Retracement (10)
    if (analysis.isRetracedH1) {
        score += 10; reasons.push(`✔ H1 Support/Resistance (10)`);
    }

    // Sentiment (10)
    if ((direction === 'BUY' && sentiment === 'BULLISH') || (direction === 'SELL' && sentiment === 'BEARISH')) {
        score += 10; reasons.push(`✔ AI Sentiment ${sentiment} (10)`);
    }

    // Session (5)
    if (!isAsianSession) {
        score += 5; reasons.push(`✔ London/NY Session (5)`);
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
    sentimentScore: number,
    upcomingNews: any = null
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
    const minDistance = 2.0; // Minimal $2 distance for SL on XAUUSD to avoid immediate stop out
    if (tradeType === 'BUY') {
      stopLoss = analysis.closestSwingLowM5 - 0.5;
      // Ensure SL is strictly below Entry
      if (stopLoss >= currentPrice - minDistance) {
        stopLoss = currentPrice - minDistance;
      }
    } else {
      stopLoss = analysis.closestSwingHighM5 + 0.5;
      // Ensure SL is strictly above Entry
      if (stopLoss <= currentPrice + minDistance) {
        stopLoss = currentPrice + minDistance;
      }
    }

    const riskAbsolute = Math.abs(currentPrice - stopLoss);
    
    // Invalid SL terlalu ketat (mencegah spread hunting)
    if (riskAbsolute < 0.3) return null; 

    // Calculate TP1 (1:2) and TP2 (1:3)
    const tp1Distance = riskAbsolute * 2;
    const tp2Distance = riskAbsolute * 3;
    let takeProfit = tradeType === 'BUY' ? currentPrice + tp1Distance : currentPrice - tp1Distance;
    let takeProfit2 = tradeType === 'BUY' ? currentPrice + tp2Distance : currentPrice - tp2Distance;

    // Convert Score to Probability Label
    let probabilityLabel = '⭐ Low';
    if (score >= 90) probabilityLabel = '⭐⭐⭐⭐⭐ Very High';
    else if (score >= 80) probabilityLabel = '⭐⭐⭐⭐ High';
    else if (score >= 65) probabilityLabel = '⭐⭐⭐ Medium';

    let reasonString = `[Analisis] ${probabilityLabel} (${score}% Confidence).\nTarget TP1: ${takeProfit.toFixed(2)} (RR 1:2) | TP2: ${takeProfit2.toFixed(2)} (RR 1:3)\nReasons:\n${reasons.join('\n')}`;

    if (upcomingNews) {
      const eventTime = new Date(upcomingNews.date).getTime();
      const now = Date.now();
      const windowStart = eventTime - (30 * 60 * 1000);
      const windowEnd = eventTime + (30 * 60 * 1000);
      
      if (now >= windowStart && now <= windowEnd) {
        reasonString = `🚨 HIGH IMPACT NEWS WARNING: ${upcomingNews.title} 🚨\nVolatilitas ekstrem diprediksi terjadi.\nPrediksi Fundamental AI: Cenderung ${sentiment}\n\n` + reasonString;
      }
    }

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

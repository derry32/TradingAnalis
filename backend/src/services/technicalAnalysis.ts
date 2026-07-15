import { OHLCV, MultiTimeframeData } from './marketDataService';

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  time: number;
}

export interface AnalysisResult {
  trendH4: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  isRetracedH1: boolean;
  patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE';
  closestSwingLowM5: number;
  closestSwingHighM5: number;
}

export class TechnicalAnalysis {
  private findSwingPoints(candles: OHLCV[], leftBars = 3, rightBars = 3): SwingPoint[] {
    const swings: SwingPoint[] = [];
    if (candles.length < leftBars + rightBars + 1) return swings;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (i === j) continue;
        if (candles[j].high > current.high) isHigh = false;
        if (candles[j].low < current.low) isLow = false;
      }

      if (isHigh) swings.push({ type: 'HIGH', price: current.high, time: current.time });
      if (isLow) swings.push({ type: 'LOW', price: current.low, time: current.time });
    }
    return swings;
  }

  private detectTrend(swings: SwingPoint[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    const highs = swings.filter(s => s.type === 'HIGH').slice(-2);
    const lows = swings.filter(s => s.type === 'LOW').slice(-2);

    if (highs.length < 2 || lows.length < 2) return 'NEUTRAL';

    const [prevHigh, lastHigh] = highs;
    const [prevLow, lastLow] = lows;

    if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
      return 'BULLISH'; // Higher High & Higher Low
    }
    if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
      return 'BEARISH'; // Lower High & Lower Low
    }

    return 'NEUTRAL';
  }

  private checkRetracementH1(currentPrice: number, swingsH1: SwingPoint[], trend: 'BULLISH' | 'BEARISH'): boolean {
    const threshold = 5; // 5 pips threshold (in absolute price difference, approx $5 for Gold)
    
    if (trend === 'BULLISH') {
      // Look for bounce near recent H1 Swing Low (Support)
      const recentLows = swingsH1.filter(s => s.type === 'LOW').slice(-3);
      for (const low of recentLows) {
        if (Math.abs(currentPrice - low.price) <= threshold) return true;
        // Or if current price is just bouncing off it
        if (currentPrice > low.price && currentPrice - low.price <= threshold) return true;
      }
    } else if (trend === 'BEARISH') {
      // Look for rejection near recent H1 Swing High (Resistance)
      const recentHighs = swingsH1.filter(s => s.type === 'HIGH').slice(-3);
      for (const high of recentHighs) {
        if (Math.abs(high.price - currentPrice) <= threshold) return true;
        if (currentPrice < high.price && high.price - currentPrice <= threshold) return true;
      }
    }
    return false;
  }

  private detectCandlestickPattern(candle1: OHLCV, candle2: OHLCV): 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE' {
    // candle1 is prev, candle2 is current
    const isBullish1 = candle1.close > candle1.open;
    const isBullish2 = candle2.close > candle2.open;

    // Engulfing
    if (!isBullish1 && isBullish2 && candle2.close > candle1.open && candle2.open < candle1.close) {
      return 'BULLISH_ENGULFING';
    }
    if (isBullish1 && !isBullish2 && candle2.close < candle1.open && candle2.open > candle1.close) {
      return 'BEARISH_ENGULFING';
    }

    // Pin bar (Long lower wick for bullish, long upper wick for bearish)
    const bodySize = Math.abs(candle2.close - candle2.open);
    const upperWick = candle2.high - Math.max(candle2.open, candle2.close);
    const lowerWick = Math.min(candle2.open, candle2.close) - candle2.low;
    const totalSize = candle2.high - candle2.low;

    if (totalSize > 0) {
      if (lowerWick > bodySize * 2 && lowerWick > upperWick * 2) return 'PIN_BAR'; // Bullish Pin bar
      if (upperWick > bodySize * 2 && upperWick > lowerWick * 2) return 'PIN_BAR'; // Bearish Pin bar
    }

    return 'NONE';
  }

  public analyze(data: MultiTimeframeData): AnalysisResult {
    // Get H4 Trend from Closed Candles
    const swingsH4 = this.findSwingPoints(data.h4, 2, 2);
    const trendH4 = this.detectTrend(swingsH4);

    // Get H1 Support/Resistance
    const swingsH1 = this.findSwingPoints(data.h1, 3, 3);
    const isRetracedH1 = this.checkRetracementH1(data.currentH1.close, swingsH1, trendH4);

    // Pattern M5
    const len = data.m5.length;
    let patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE' = 'NONE';
    if (len >= 2) {
      patternM5 = this.detectCandlestickPattern(data.m5[len - 2], data.m5[len - 1]);
    }

    // Swing M5 for Stop Loss
    const swingsM5 = this.findSwingPoints(data.m5, 3, 3);
    const lastM5Low = swingsM5.filter(s => s.type === 'LOW').pop()?.price || data.currentM5.low - 3;
    const lastM5High = swingsM5.filter(s => s.type === 'HIGH').pop()?.price || data.currentM5.high + 3;

    return {
      trendH4,
      isRetracedH1,
      patternM5,
      closestSwingLowM5: lastM5Low,
      closestSwingHighM5: lastM5High
    };
  }
}

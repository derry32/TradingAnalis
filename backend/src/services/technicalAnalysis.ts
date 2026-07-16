import { OHLCV, MultiTimeframeData } from './marketDataService';

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  time: number;
}

export interface AnalysisResult {
  trendH4: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trendH1: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  isRetracedH1: boolean;
  patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE';
  closestSwingLowM5: number;
  closestSwingHighM5: number;
  ema20_H1: number;
  ema50_H1: number;
  ema200_H1: number;
  atr_H1: number;
  marketStructureH1: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'NONE';
  volumeSpikeM5: boolean;
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

  private checkRetracementH1(currentPrice: number, swingsH1: SwingPoint[], trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): boolean {
    if (trend === 'NEUTRAL') return false;
    const threshold = 5; 
    
    if (trend === 'BULLISH') {
      const recentLows = swingsH1.filter(s => s.type === 'LOW').slice(-3);
      for (const low of recentLows) {
        if (Math.abs(currentPrice - low.price) <= threshold) return true;
        if (currentPrice > low.price && currentPrice - low.price <= threshold) return true;
      }
    } else if (trend === 'BEARISH') {
      const recentHighs = swingsH1.filter(s => s.type === 'HIGH').slice(-3);
      for (const high of recentHighs) {
        if (Math.abs(high.price - currentPrice) <= threshold) return true;
        if (currentPrice < high.price && high.price - currentPrice <= threshold) return true;
      }
    }
    return false;
  }

  private detectCandlestickPattern(candle1: OHLCV, candle2: OHLCV): 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE' {
    const isBullish1 = candle1.close > candle1.open;
    const isBullish2 = candle2.close > candle2.open;

    if (!isBullish1 && isBullish2 && candle2.close > candle1.open && candle2.open < candle1.close) {
      return 'BULLISH_ENGULFING';
    }
    if (isBullish1 && !isBullish2 && candle2.close < candle1.open && candle2.open > candle1.close) {
      return 'BEARISH_ENGULFING';
    }

    const bodySize = Math.abs(candle2.close - candle2.open);
    const upperWick = candle2.high - Math.max(candle2.open, candle2.close);
    const lowerWick = Math.min(candle2.open, candle2.close) - candle2.low;
    const totalSize = candle2.high - candle2.low;

    if (totalSize > 0) {
      if (lowerWick > bodySize * 2 && lowerWick > upperWick * 2) return 'PIN_BAR';
      if (upperWick > bodySize * 2 && upperWick > lowerWick * 2) return 'PIN_BAR';
    }

    return 'NONE';
  }

  private calculateEMA(candles: OHLCV[], period: number): number {
    if (candles.length < period) return 0;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
    }
    return ema;
  }

  private calculateATR(candles: OHLCV[], period: number = 14): number {
    if (candles.length <= period) return 0;
    let trSum = 0;
    for(let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i-1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum += tr;
    }
    return trSum / period;
  }

  private detectBOSCHoCH(currentPrice: number, swings: SwingPoint[], trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'NONE' {
    if (trend === 'NEUTRAL') return 'NONE';
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    if (highs.length === 0 || lows.length === 0) return 'NONE';
    
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    
    if (trend === 'BULLISH') {
      if (currentPrice > lastHigh.price) return 'BOS_BULL';
      if (currentPrice < lastLow.price) return 'CHOCH_BEAR';
    } else {
      if (currentPrice < lastLow.price) return 'BOS_BEAR';
      if (currentPrice > lastHigh.price) return 'CHOCH_BULL';
    }
    return 'NONE';
  }

  private checkVolumeSpike(m5Candles: OHLCV[]): boolean {
    if (m5Candles.length < 6) return false;
    const last = m5Candles[m5Candles.length - 1];
    let sumVol = 0;
    for(let i = m5Candles.length - 6; i < m5Candles.length - 1; i++) {
      sumVol += m5Candles[i].volume;
    }
    const avgVol = sumVol / 5;
    return last.volume > avgVol * 1.5; // Spike if 50% larger than 5-candle average
  }

  public analyze(data: MultiTimeframeData): AnalysisResult {
    const swingsH4 = this.findSwingPoints(data.h4, 2, 2);
    const trendH4 = this.detectTrend(swingsH4);

    const swingsH1 = this.findSwingPoints(data.h1, 3, 3);
    const trendH1 = this.detectTrend(swingsH1);
    
    const activeTrendForSupport = trendH4 !== 'NEUTRAL' ? trendH4 : trendH1;
    const isRetracedH1 = this.checkRetracementH1(data.currentH1.close, swingsH1, activeTrendForSupport);

    const len = data.m5.length;
    let patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'NONE' = 'NONE';
    if (len >= 2) {
      patternM5 = this.detectCandlestickPattern(data.m5[len - 2], data.m5[len - 1]);
    }

    const swingsM5 = this.findSwingPoints(data.m5, 3, 3);
    const lastM5Low = swingsM5.filter(s => s.type === 'LOW').pop()?.price || data.currentM5.low - 3;
    const lastM5High = swingsM5.filter(s => s.type === 'HIGH').pop()?.price || data.currentM5.high + 3;

    return {
      trendH4,
      trendH1,
      isRetracedH1,
      patternM5,
      closestSwingLowM5: lastM5Low,
      closestSwingHighM5: lastM5High,
      ema20_H1: this.calculateEMA(data.h1, 20),
      ema50_H1: this.calculateEMA(data.h1, 50),
      ema200_H1: this.calculateEMA(data.h1, 200),
      atr_H1: this.calculateATR(data.h1, 14),
      marketStructureH1: this.detectBOSCHoCH(data.currentH1.close, swingsH1, trendH1),
      volumeSpikeM5: this.checkVolumeSpike(data.m5)
    };
  }
}

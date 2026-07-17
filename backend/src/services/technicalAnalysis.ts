import { OHLCV, MultiTimeframeData } from './marketDataService';

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  time: number;
}

export type MarketCondition = 'TRENDING_BULLISH' | 'TRENDING_BEARISH' | 'SIDEWAYS';

export interface AnalysisResult {
  trendH1: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  marketCondition: MarketCondition;
  isRetracedH1: boolean;
  marketStructureM15: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'FAKE_BREAKOUT_BULL' | 'FAKE_BREAKOUT_BEAR' | 'NONE';
  patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'MARUBOZU_BULL' | 'MARUBOZU_BEAR' | 'THREE_WHITE_SOLDIERS' | 'THREE_BLACK_CROWS' | 'NONE';
  closestSwingLowM5: number;
  closestSwingHighM5: number;
  ema20_M5: number;
  ema50_M5: number;
  atr_M15: number;
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
        const compareCandle = candles[j];
        if (!compareCandle) continue;
        if (compareCandle.high > current.high) isHigh = false;
        if (compareCandle.low < current.low) isLow = false;
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

    if (!prevHigh || !lastHigh || !prevLow || !lastLow) return 'NEUTRAL';

    if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
      return 'BULLISH'; // Higher High & Higher Low
    }
    if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
      return 'BEARISH'; // Lower High & Lower Low
    }

    return 'NEUTRAL';
  }

  private detectMarketCondition(swings: SwingPoint[]): MarketCondition {
     const trend = this.detectTrend(swings);
     if (trend === 'BULLISH') return 'TRENDING_BULLISH';
     if (trend === 'BEARISH') return 'TRENDING_BEARISH';
     return 'SIDEWAYS';
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

  private detectCandlestickPattern(candle0: OHLCV | undefined, candle1: OHLCV, candle2: OHLCV, atr: number): AnalysisResult['patternM5'] {
    const isBullish1 = candle1.close > candle1.open;
    const isBullish2 = candle2.close > candle2.open;

    if (candle0) {
      const isBullish0 = candle0.close > candle0.open;
      if (isBullish0 && isBullish1 && isBullish2 && candle1.close > candle0.close && candle2.close > candle1.close) {
         return 'THREE_WHITE_SOLDIERS';
      }
      if (!isBullish0 && !isBullish1 && !isBullish2 && candle1.close < candle0.close && candle2.close < candle1.close) {
         return 'THREE_BLACK_CROWS';
      }
    }

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

      if (bodySize / totalSize > 0.85 && totalSize > (atr * 0.8)) {
         return isBullish2 ? 'MARUBOZU_BULL' : 'MARUBOZU_BEAR';
      }
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

  private detectBOSCHoCH(currentPrice: number, swings: SwingPoint[], trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL', hasVolumeSpike: boolean, atr: number): AnalysisResult['marketStructureM15'] {
    if (trend === 'NEUTRAL') return 'NONE';
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    if (highs.length === 0 || lows.length === 0) return 'NONE';
    
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    if (!lastHigh || !lastLow) return 'NONE';
    
    const isValidBreakout = hasVolumeSpike || atr > 1.0;

    if (trend === 'BULLISH') {
      if (currentPrice > lastHigh.price) return isValidBreakout ? 'BOS_BULL' : 'FAKE_BREAKOUT_BULL';
      if (currentPrice < lastLow.price) return isValidBreakout ? 'CHOCH_BEAR' : 'FAKE_BREAKOUT_BEAR';
    } else {
      if (currentPrice < lastLow.price) return isValidBreakout ? 'BOS_BEAR' : 'FAKE_BREAKOUT_BEAR';
      if (currentPrice > lastHigh.price) return isValidBreakout ? 'CHOCH_BULL' : 'FAKE_BREAKOUT_BULL';
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
    const swingsH1 = this.findSwingPoints(data.h1, 3, 3);
    const trendH1 = this.detectTrend(swingsH1);
    const marketCondition = this.detectMarketCondition(swingsH1);
    
    const isRetracedH1 = this.checkRetracementH1(data.currentH1.close, swingsH1, trendH1);

    const atr_M15 = this.calculateATR(data.m15, 14);
    const volumeSpikeM5 = this.checkVolumeSpike(data.m5);

    const swingsM15 = this.findSwingPoints(data.m15, 2, 2);
    // BOS/CHoCH detection uses H1 trend as context to evaluate M15 structure break
    const marketStructureM15 = this.detectBOSCHoCH(data.currentM15.close, swingsM15, trendH1, volumeSpikeM5, atr_M15);

    const len = data.m5.length;
    let patternM5: AnalysisResult['patternM5'] = 'NONE';
    if (len >= 2) {
      const c0 = len >= 3 ? data.m5[len - 3] : undefined;
      const c1 = data.m5[len - 2];
      const c2 = data.m5[len - 1];
      if (c1 && c2) {
        patternM5 = this.detectCandlestickPattern(c0, c1, c2, atr_M15);
      }
    }

    const swingsM5 = this.findSwingPoints(data.m5, 3, 3);
    const lastM5Low = swingsM5.filter(s => s.type === 'LOW').pop()?.price || data.currentM5.low - 3;
    const lastM5High = swingsM5.filter(s => s.type === 'HIGH').pop()?.price || data.currentM5.high + 3;

    return {
      trendH1,
      marketCondition,
      isRetracedH1,
      marketStructureM15,
      patternM5,
      closestSwingLowM5: lastM5Low,
      closestSwingHighM5: lastM5High,
      ema20_M5: this.calculateEMA(data.m5, 20),
      ema50_M5: this.calculateEMA(data.m5, 50),
      atr_M15,
      volumeSpikeM5
    };
  }
}

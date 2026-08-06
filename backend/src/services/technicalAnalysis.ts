import { OHLCV, MultiTimeframeData } from './marketDataService';

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  time: number;
}

export type MarketCondition = 'TRENDING_BULLISH' | 'TRENDING_BEARISH' | 'SIDEWAYS';
export type MarketPhase = 'TRENDING' | 'PULLBACK' | 'RANGE' | 'BREAKOUT' | 'UNKNOWN';

export interface FVGZone {
  type: 'BULLISH' | 'BEARISH' | 'NONE';
  top: number;
  bottom: number;
}

export interface AnalysisResult {
  trendH1: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structureH1: 'HH_HL' | 'LH_LL' | 'EQUAL_RANGE' | 'NEUTRAL';
  trendM15: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structureM15: 'HH_HL' | 'LH_LL' | 'EQUAL_RANGE' | 'NEUTRAL';
  marketCondition: MarketCondition;
  marketPhase: MarketPhase;
  isAtSupportH1: boolean;
  isAtResistanceH1: boolean;
  nearestSupportH1: number;
  nearestResistanceH1: number;
  nextSupportH1: number;
  nextResistanceH1: number;
  marketStructureM15: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'FAKE_BREAKOUT_BULL' | 'FAKE_BREAKOUT_BEAR' | 'NONE';
  patternM5: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'PIN_BAR' | 'MARUBOZU_BULL' | 'MARUBOZU_BEAR' | 'THREE_WHITE_SOLDIERS' | 'THREE_BLACK_CROWS' | 'NONE';
  closestSwingLowM5: number;
  closestSwingHighM5: number;
  atr_M15: number;
  volumeSpikeM5: boolean;
  strongVolumeM5: boolean;
  consecutiveCandlesM5: { count: number; direction: 'BULLISH' | 'BEARISH' };
  fibonacciZoneM15: 'GOLDEN_BULL' | 'GOLDEN_BEAR' | 'NONE';
  fvgM5: FVGZone;
  triggerCandleM5: { open: number; high: number; low: number; close: number };
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

  private detectStructureH1(swings: SwingPoint[]): { trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL', structure: 'HH_HL' | 'LH_LL' | 'EQUAL_RANGE' | 'NEUTRAL' } {
    const highs = swings.filter(s => s.type === 'HIGH').slice(-3);
    const lows = swings.filter(s => s.type === 'LOW').slice(-3);

    if (highs.length < 2 || lows.length < 2) return { trend: 'NEUTRAL', structure: 'NEUTRAL' };

    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    if (!prevHigh || !lastHigh || !prevLow || !lastLow) return { trend: 'NEUTRAL', structure: 'NEUTRAL' };

    if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
      return { trend: 'BULLISH', structure: 'HH_HL' };
    }
    if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
      return { trend: 'BEARISH', structure: 'LH_LL' };
    }

    // Check if highs and lows are relatively equal (within $8 range)
    if (Math.abs(lastHigh.price - prevHigh.price) < 8.0 && Math.abs(lastLow.price - prevLow.price) < 8.0) {
      return { trend: 'NEUTRAL', structure: 'EQUAL_RANGE' };
    }

    return { trend: 'NEUTRAL', structure: 'NEUTRAL' };
  }

  private detectMarketPhase(
    trendH1: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    structureH1: 'HH_HL' | 'LH_LL' | 'EQUAL_RANGE' | 'NEUTRAL',
    marketStructureM15: string,
    isAtSupport: boolean,
    isAtResistance: boolean,
    fibZone: string,
    currentPrice: number,
    swingLowM5: number,
    swingHighM5: number
  ): MarketPhase {
    if (marketStructureM15.includes('BOS') || marketStructureM15.includes('BREAKOUT')) {
      return 'BREAKOUT';
    }

    if (structureH1 === 'EQUAL_RANGE' || trendH1 === 'NEUTRAL') {
      return 'RANGE';
    }

    if (trendH1 === 'BULLISH' || structureH1 === 'HH_HL') {
      if (fibZone === 'GOLDEN_BULL' || isAtSupport || (swingLowM5 > 0 && currentPrice <= swingLowM5 + 3.0)) {
        return 'PULLBACK';
      }
      return 'TRENDING';
    } else if (trendH1 === 'BEARISH' || structureH1 === 'LH_LL') {
      if (fibZone === 'GOLDEN_BEAR' || isAtResistance || (swingHighM5 > 0 && currentPrice >= swingHighM5 - 3.0)) {
        return 'PULLBACK';
      }
      return 'TRENDING';
    }

    return 'UNKNOWN';
  }

  private getSRLevels(currentPrice: number, swingsH1: SwingPoint[]): {
    nearestSupport: number;
    nearestResistance: number;
    nextSupport: number;
    nextResistance: number;
  } {
    const lows = swingsH1.filter(s => s.type === 'LOW' && s.price < currentPrice).sort((a, b) => b.price - a.price);
    const highs = swingsH1.filter(s => s.type === 'HIGH' && s.price > currentPrice).sort((a, b) => a.price - b.price);

    const nearestSupport = lows.length > 0 ? lows[0].price : currentPrice - 10;
    const nextSupport = lows.length > 1 ? lows[1].price : nearestSupport - 10;

    const nearestResistance = highs.length > 0 ? highs[0].price : currentPrice + 10;
    const nextResistance = highs.length > 1 ? highs[1].price : nearestResistance + 10;

    return { nearestSupport, nearestResistance, nextSupport, nextResistance };
  }

  private checkAtSupportH1(currentPrice: number, swingsH1: SwingPoint[], atr: number): boolean {
    const threshold = Math.max(atr * 1.5, 5); // dinamis: 1.5x ATR M15, minimal $5
    const recentLows = swingsH1.filter(s => s.type === 'LOW').slice(-3);
    for (const low of recentLows) {
      if (Math.abs(currentPrice - low.price) <= threshold) return true;
    }
    return false;
  }

  private checkAtResistanceH1(currentPrice: number, swingsH1: SwingPoint[], atr: number): boolean {
    const threshold = Math.max(atr * 1.5, 5); // dinamis: 1.5x ATR M15, minimal $5
    const recentHighs = swingsH1.filter(s => s.type === 'HIGH').slice(-3);
    for (const high of recentHighs) {
      if (Math.abs(high.price - currentPrice) <= threshold) return true;
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

  private detectBOSCHoCH(currentPrice: number, swings: SwingPoint[], trendH1: 'BULLISH' | 'BEARISH' | 'NEUTRAL', trendM15: 'BULLISH' | 'BEARISH' | 'NEUTRAL', hasVolumeSpike: boolean, atr: number): AnalysisResult['marketStructureM15'] {
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    if (highs.length === 0 || lows.length === 0) return 'NONE';
    
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    if (!lastHigh || !lastLow) return 'NONE';
    
    const isValidBreakout = hasVolumeSpike || atr > 1.0;

    // Direct M15 swing breakout
    if (currentPrice > lastHigh.price) {
      if (trendH1 === 'BULLISH' || trendM15 === 'BULLISH') {
        return isValidBreakout ? 'BOS_BULL' : 'FAKE_BREAKOUT_BULL';
      } else {
        return isValidBreakout ? 'CHOCH_BULL' : 'FAKE_BREAKOUT_BULL';
      }
    }

    if (currentPrice < lastLow.price) {
      if (trendH1 === 'BEARISH' || trendM15 === 'BEARISH') {
        return isValidBreakout ? 'BOS_BEAR' : 'FAKE_BREAKOUT_BEAR';
      } else {
        return isValidBreakout ? 'CHOCH_BEAR' : 'FAKE_BREAKOUT_BEAR';
      }
    }

    return 'NONE';
  }

  private checkVolume(m5Candles: OHLCV[]): { volumeSpike: boolean; strongVolume: boolean } {
    if (m5Candles.length < 6) return { volumeSpike: false, strongVolume: false };
    const last = m5Candles[m5Candles.length - 1];
    let sumVol = 0;
    for(let i = m5Candles.length - 6; i < m5Candles.length - 1; i++) {
      sumVol += m5Candles[i].volume;
    }
    const avgVol = sumVol / 5;
    const volumeSpike = last.volume > avgVol * 1.4;

    const totalRange = last.high - last.low;
    const bodySize = Math.abs(last.close - last.open);
    const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;
    
    // Strong volume: Spike + Body > 55% + Close near Extremes
    const isBull = last.close > last.open;
    const closeNearExtreme = isBull 
      ? (last.high - last.close) <= totalRange * 0.3
      : (last.close - last.low) <= totalRange * 0.3;

    const strongVolume = volumeSpike && bodyRatio >= 0.55 && closeNearExtreme;

    return { volumeSpike, strongVolume };
  }

  private countConsecutiveCandles(candles: OHLCV[]): { count: number; direction: 'BULLISH' | 'BEARISH' } {
    if (candles.length === 0) return { count: 0, direction: 'BULLISH' };
    const last = candles[candles.length - 1];
    const isBull = last.close >= last.open;
    const direction: 'BULLISH' | 'BEARISH' = isBull ? 'BULLISH' : 'BEARISH';
    
    let count = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      const c = candles[i];
      const bull = c.close >= c.open;
      if ((isBull && bull) || (!isBull && !bull)) {
        count++;
      } else {
        break;
      }
    }
    return { count, direction };
  }

  private detectFibonacciRetracement(currentPrice: number, swings: SwingPoint[], trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL', atr: number): AnalysisResult['fibonacciZoneM15'] {
    if (trend === 'NEUTRAL' || swings.length < 2) return 'NONE';
    
    // Get latest high and low
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    if (highs.length === 0 || lows.length === 0) return 'NONE';
    
    const lastHigh = highs[highs.length - 1].price;
    const lastLow = lows[lows.length - 1].price;
    
    // Range must be somewhat significant (at least 2x ATR)
    const range = Math.abs(lastHigh - lastLow);
    if (range < atr * 2) return 'NONE';

    // Tolerance to be considered "in the zone" is proportional to ATR
    const tolerance = Math.max(1.0, atr * 0.5);

    if (trend === 'BULLISH') {
      // Swing Low to Swing High -> Pullback down to 0.5 - 0.618
      const fib50 = lastLow + (range * 0.5);
      const fib618 = lastLow + (range * 0.382); // 1 - 0.618 = 0.382 from bottom
      
      // If current price is near the golden zone
      if ((currentPrice <= fib50 + tolerance && currentPrice >= fib618 - tolerance)) {
        return 'GOLDEN_BULL';
      }
    } else if (trend === 'BEARISH') {
      // Swing High to Swing Low -> Pullback up to 0.5 - 0.618
      const fib50 = lastHigh - (range * 0.5);
      const fib618 = lastHigh - (range * 0.382); // 1 - 0.618 = 0.382 from top
      
      if ((currentPrice >= fib50 - tolerance && currentPrice <= fib618 + tolerance)) {
        return 'GOLDEN_BEAR';
      }
    }

    return 'NONE';
  }

  private detectFVGM5(candles: OHLCV[]): FVGZone {
    if (candles.length < 3) return { type: 'NONE', top: 0, bottom: 0 };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (!c1 || !c2 || !c3) return { type: 'NONE', top: 0, bottom: 0 };

    // Bullish FVG: Imbalance di mana c3.low > c1.high pada candle impulsif naik
    if (c3.low > c1.high && c2.close > c2.open) {
      return { type: 'BULLISH', top: Number(c3.low.toFixed(2)), bottom: Number(c1.high.toFixed(2)) };
    }
    // Bearish FVG: Imbalance di mana c3.high < c1.low pada candle impulsif turun
    if (c3.high < c1.low && c2.close < c2.open) {
      return { type: 'BEARISH', top: Number(c1.low.toFixed(2)), bottom: Number(c3.high.toFixed(2)) };
    }
    return { type: 'NONE', top: 0, bottom: 0 };
  }

  public analyze(data: MultiTimeframeData): AnalysisResult {
    const swingsH1 = this.findSwingPoints(data.h1, 3, 3);
    const { trend: trendH1, structure: structureH1 } = this.detectStructureH1(swingsH1);

    const swingsM15 = this.findSwingPoints(data.m15, 2, 2);
    const { trend: trendM15, structure: structureM15 } = this.detectStructureH1(swingsM15);

    const marketCondition: MarketCondition = trendM15 === 'BULLISH' ? 'TRENDING_BULLISH' : trendM15 === 'BEARISH' ? 'TRENDING_BEARISH' : (trendH1 === 'BULLISH' ? 'TRENDING_BULLISH' : trendH1 === 'BEARISH' ? 'TRENDING_BEARISH' : 'SIDEWAYS');
    
    const atr_M15 = this.calculateATR(data.m15, 14);

    const isAtSupportH1 = this.checkAtSupportH1(data.currentH1.close, swingsH1, atr_M15);
    const isAtResistanceH1 = this.checkAtResistanceH1(data.currentH1.close, swingsH1, atr_M15);
    const { nearestSupport, nearestResistance, nextSupport, nextResistance } = this.getSRLevels(data.currentH1.close, swingsH1);

    const { volumeSpike: volumeSpikeM5, strongVolume: strongVolumeM5 } = this.checkVolume(data.m5);
    const consecutiveCandlesM5 = this.countConsecutiveCandles(data.m5);

    // BOS/CHoCH detection using H1 and M15 trends
    const marketStructureM15 = this.detectBOSCHoCH(data.currentM15.close, swingsM15, trendH1, trendM15, volumeSpikeM5, atr_M15);

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

    const fibonacciZoneM15 = this.detectFibonacciRetracement(data.currentM15.close, swingsM15, trendH1, atr_M15);
    const fvgM5 = this.detectFVGM5(data.m5);


    const marketPhase = this.detectMarketPhase(
      trendH1,
      structureH1,
      marketStructureM15,
      isAtSupportH1,
      isAtResistanceH1,
      fibonacciZoneM15,
      data.currentM5.close,
      lastM5Low,
      lastM5High
    );

    return {
      trendH1,
      structureH1,
      trendM15,
      structureM15,
      marketCondition,
      marketPhase,
      isAtSupportH1,
      isAtResistanceH1,
      nearestSupportH1: nearestSupport,
      nearestResistanceH1: nearestResistance,
      nextSupportH1: nextSupport,
      nextResistanceH1: nextResistance,
      marketStructureM15,
      patternM5,
      closestSwingLowM5: lastM5Low,
      closestSwingHighM5: lastM5High,
      atr_M15,
      volumeSpikeM5,
      strongVolumeM5,
      consecutiveCandlesM5,
      fibonacciZoneM15,
      fvgM5,
      triggerCandleM5: {
        open: data.currentM5.open,
        high: data.currentM5.high,
        low: data.currentM5.low,
        close: data.currentM5.close
      }
    };
  }
}

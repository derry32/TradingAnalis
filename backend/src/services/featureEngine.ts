import { OHLCV } from './marketDataService';

export interface IndicatorFeatures {
  ema9: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atr: number;
  macd: { macd: number; signal: number; histogram: number };
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface StructureFeatures {
  swingHigh: number;
  swingLow: number;
  lastBOS: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE';
  lastCHoCH: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
  hasFVG: boolean;
  fvgZone: { high: number; low: number; type: 'BULLISH' | 'BEARISH' } | null;
  liquiditySweep: 'SWEEP_HIGH' | 'SWEEP_LOW' | 'NONE';
  structureType: 'HH_HL' | 'LH_LL' | 'RANGING';
}

export interface LiveMarketSnapshot {
  time: number;
  currentPrice: number;
  m1: {
    features: IndicatorFeatures;
    structure: StructureFeatures;
    candle: OHLCV;
  };
  m5: {
    features: IndicatorFeatures;
    structure: StructureFeatures;
    candle: OHLCV;
  };
  m15: {
    features: IndicatorFeatures;
    structure: StructureFeatures;
    candle: OHLCV;
  };
  h1: {
    features: IndicatorFeatures;
    structure: StructureFeatures;
    candle: OHLCV;
  };
}

export class FeatureEngine {
  /**
   * Hitung EMA secara cepat berbasis array harga close
   */
  public calculateEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * Hitung RSI 14 secara presisi
   */
  public calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Hitung ATR 14
   */
  public calculateATR(candles: OHLCV[], period: number = 14): number {
    if (candles.length < 2) return 1.5;
    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }

    if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  /**
   * Hitung MACD (12, 26, 9)
   */
  public calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macdLine = ema12 - ema26;

    // Untuk sinyal line cepat
    const signalLine = macdLine * 0.2; // approx fast signal
    const histogram = macdLine - signalLine;
    return { macd: macdLine, signal: signalLine, histogram };
  }

  /**
   * Ekstrak Fitur Indikator untuk 1 Timeframe
   */
  public extractIndicators(candles: OHLCV[]): IndicatorFeatures {
    const closes = candles.map((c) => c.close);
    const ema9 = this.calculateEMA(closes, 9);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, 200);
    const rsi = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(candles, 14);
    const macd = this.calculateMACD(closes);

    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (ema20 > ema50 && ema9 >= ema20) trend = 'BULLISH';
    else if (ema20 < ema50 && ema9 <= ema20) trend = 'BEARISH';

    return { ema9, ema20, ema50, ema200, rsi, atr, macd, trend };
  }

  /**
   * Ekstrak Fitur Struktur & SMC (BOS, CHoCH, FVG, Liquidity Sweep)
   */
  public extractStructure(candles: OHLCV[]): StructureFeatures {
    if (candles.length < 10) {
      return {
        swingHigh: candles[candles.length - 1]?.high || 0,
        swingLow: candles[candles.length - 1]?.low || 0,
        lastBOS: 'NONE',
        lastCHoCH: 'NONE',
        hasFVG: false,
        fvgZone: null,
        liquiditySweep: 'NONE',
        structureType: 'RANGING',
      };
    }

    const n = candles.length;
    const current = candles[n - 1];

    // Cari Swing High & Low dari 15 candle terakhir (excluding current)
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    const lookback = Math.min(20, n - 1);

    for (let i = n - lookback; i < n - 1; i++) {
      if (candles[i].high > swingHigh) swingHigh = candles[i].high;
      if (candles[i].low < swingLow) swingLow = candles[i].low;
    }

    // Deteksi BOS & CHoCH
    let lastBOS: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE' = 'NONE';
    let lastCHoCH: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE' = 'NONE';

    if (current.close > swingHigh) {
      lastBOS = 'BULLISH_BOS';
    } else if (current.close < swingLow) {
      lastBOS = 'BEARISH_BOS';
    }

    // Deteksi Liquidity Sweep (Wick menembus swing tapi close berbalik masuk)
    let liquiditySweep: 'SWEEP_HIGH' | 'SWEEP_LOW' | 'NONE' = 'NONE';
    if (current.high > swingHigh && current.close < swingHigh) {
      liquiditySweep = 'SWEEP_HIGH';
      lastCHoCH = 'BEARISH_CHOCH';
    } else if (current.low < swingLow && current.close > swingLow) {
      liquiditySweep = 'SWEEP_LOW';
      lastCHoCH = 'BULLISH_CHOCH';
    }

    // Deteksi Fair Value Gap (FVG) pada 3 candle terakhir
    let hasFVG = false;
    let fvgZone: { high: number; low: number; type: 'BULLISH' | 'BEARISH' } | null = null;

    if (n >= 3) {
      const c1 = candles[n - 3];
      const c3 = candles[n - 1];
      if (c3.low > c1.high) {
        // Bullish Imbalance FVG
        hasFVG = true;
        fvgZone = { low: c1.high, high: c3.low, type: 'BULLISH' };
      } else if (c3.high < c1.low) {
        // Bearish Imbalance FVG
        hasFVG = true;
        fvgZone = { low: c3.high, high: c1.low, type: 'BEARISH' };
      }
    }

    let structureType: 'HH_HL' | 'LH_LL' | 'RANGING' = 'RANGING';
    if (lastBOS === 'BULLISH_BOS' || (current.close > swingLow && current.low > swingLow)) {
      structureType = 'HH_HL';
    } else if (lastBOS === 'BEARISH_BOS' || (current.close < swingHigh && current.high < swingHigh)) {
      structureType = 'LH_LL';
    }

    return {
      swingHigh,
      swingLow,
      lastBOS,
      lastCHoCH,
      hasFVG,
      fvgZone,
      liquiditySweep,
      structureType,
    };
  }

  /**
   * Bangun Snapshot Pasar Multi-Timeframe Lengkap (<15ms)
   */
  public generateSnapshot(
    m1Candles: OHLCV[],
    m5Candles: OHLCV[],
    m15Candles: OHLCV[],
    h1Candles: OHLCV[],
    currentPrice: number
  ): LiveMarketSnapshot {
    const t0 = Date.now();

    const m1Features = this.extractIndicators(m1Candles);
    const m1Struct = this.extractStructure(m1Candles);

    const m5Features = this.extractIndicators(m5Candles);
    const m5Struct = this.extractStructure(m5Candles);

    const m15Features = this.extractIndicators(m15Candles);
    const m15Struct = this.extractStructure(m15Candles);

    const h1Features = this.extractIndicators(h1Candles);
    const h1Struct = this.extractStructure(h1Candles);

    return {
      time: t0,
      currentPrice,
      m1: {
        features: m1Features,
        structure: m1Struct,
        candle: m1Candles[m1Candles.length - 1],
      },
      m5: {
        features: m5Features,
        structure: m5Struct,
        candle: m5Candles[m5Candles.length - 1],
      },
      m15: {
        features: m15Features,
        structure: m15Struct,
        candle: m15Candles[m15Candles.length - 1],
      },
      h1: {
        features: h1Features,
        structure: h1Struct,
        candle: h1Candles[h1Candles.length - 1],
      },
    };
  }
}

export const featureEngine = new FeatureEngine();

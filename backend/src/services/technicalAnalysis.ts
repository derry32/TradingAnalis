import { RSI, MACD, SMA } from 'technicalindicators';
import { OHLCV } from './marketDataService';

export class TechnicalAnalysis {
  private candles: OHLCV[] = [];

  // Parameter default standar
  private rsiPeriod = 14;
  private macdFast = 12;
  private macdSlow = 26;
  private macdSignal = 9;
  private maFastPeriod = 50;
  private maSlowPeriod = 200;

  public addCandle(candle: OHLCV) {
    this.candles.push(candle);
    // Simpan history seperlunya untuk MA200
    if (this.candles.length > 300) {
      this.candles.shift();
    }
  }

  public analyze(): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (this.candles.length < this.maSlowPeriod) {
      return 'NEUTRAL'; // Belum cukup data
    }

    const closes = this.candles.map(c => c.close);

    const rsiResult = RSI.calculate({ period: this.rsiPeriod, values: closes });
    const currentRsi = rsiResult[rsiResult.length - 1];

    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: this.macdFast,
      slowPeriod: this.macdSlow,
      signalPeriod: this.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const currentMacd = macdResult[macdResult.length - 1];

    const maFastResult = SMA.calculate({ period: this.maFastPeriod, values: closes });
    const maSlowResult = SMA.calculate({ period: this.maSlowPeriod, values: closes });
    const currentMaFast = maFastResult[maFastResult.length - 1];
    const currentMaSlow = maSlowResult[maSlowResult.length - 1];

    // Konfirmasi Bullish: RSI > 50, MACD Hist > 0, MA50 > MA200
    // Konfirmasi Bearish: RSI < 50, MACD Hist < 0, MA50 < MA200
    
    let isBullish = true;
    let isBearish = true;

    if (currentRsi <= 50) isBullish = false;
    if (currentRsi >= 50) isBearish = false;

    if (currentMacd && currentMacd.histogram !== undefined) {
      if (currentMacd.histogram <= 0) isBullish = false;
      if (currentMacd.histogram >= 0) isBearish = false;
    } else {
      return 'NEUTRAL';
    }

    if (currentMaFast <= currentMaSlow) isBullish = false;
    if (currentMaFast >= currentMaSlow) isBearish = false;

    if (isBullish) return 'BULLISH';
    if (isBearish) return 'BEARISH';
    
    return 'NEUTRAL';
  }
}

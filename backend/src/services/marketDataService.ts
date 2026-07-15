import WebSocket from 'ws';
import { config } from '../config';

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isDummy?: boolean;
}

export class CandleBuilder {
  public periodMs: number;
  public allCandles: OHLCV[] = [];
  public currentCandle: OHLCV | null = null;
  public onCandleClosed: ((candle: OHLCV) => void) | null = null;

  constructor(periodMinutes: number) {
    this.periodMs = periodMinutes * 60 * 1000;
  }

  public processTick(price: number, volume: number, timestamp: number, isDummy = false) {
    const periodStart = Math.floor(timestamp / this.periodMs) * this.periodMs;
    this.updateCandle(periodStart, price, price, price, price, volume, isDummy);
  }

  public processCandle(lowerCandle: OHLCV) {
    const periodStart = Math.floor(lowerCandle.time / this.periodMs) * this.periodMs;
    this.updateCandle(periodStart, lowerCandle.open, lowerCandle.high, lowerCandle.low, lowerCandle.close, lowerCandle.volume, lowerCandle.isDummy);
  }

  private updateCandle(periodStart: number, open: number, high: number, low: number, close: number, volume: number, isDummy = false) {
    if (!this.currentCandle) {
      this.currentCandle = { time: periodStart, open, high, low, close, volume, isDummy };
    } else if (this.currentCandle.time === periodStart) {
      this.currentCandle.high = Math.max(this.currentCandle.high, high);
      this.currentCandle.low = Math.min(this.currentCandle.low, low);
      this.currentCandle.close = close;
      this.currentCandle.volume += volume;
    } else {
      const closedCandle = { ...this.currentCandle };
      this.allCandles.push(closedCandle);
      
      // Auto purge dummy candles if we have enough real candles
      const realCandlesCount = this.allCandles.filter(c => !c.isDummy).length;
      if (realCandlesCount >= 200) {
        const dummyCount = this.allCandles.filter(c => c.isDummy).length;
        if (dummyCount > 0) {
          console.log(`[MarketData] Reached 200 real candles for ${this.periodMs / 60000}m! Purging ${dummyCount} dummy candles...`);
          this.allCandles = this.allCandles.filter(c => !c.isDummy);
        }
      }

      if (this.allCandles.length > 500) this.allCandles.shift();
      if (this.onCandleClosed) this.onCandleClosed(closedCandle);

      this.currentCandle = { time: periodStart, open, high, low, close, volume, isDummy };
    }
  }

  public loadHistorical(candles: OHLCV[]) {
    this.allCandles = candles;
  }
}

export type MultiTimeframeData = {
  m5: OHLCV[];
  h1: OHLCV[];
  h4: OHLCV[];
  currentM5: OHLCV;
  currentH1: OHLCV;
  currentH4: OHLCV;
};

export class MarketDataService {
  private ws: WebSocket | null = null;
  private onM5Closed: ((data: MultiTimeframeData) => void) | null = null;

  public m1 = new CandleBuilder(1);
  public m5 = new CandleBuilder(5);
  public h1 = new CandleBuilder(60);
  public h4 = new CandleBuilder(240);

  constructor() {
    this.m1.onCandleClosed = (c) => this.m5.processCandle(c);
    this.m5.onCandleClosed = (c) => {
      this.h1.processCandle(c);
      
      if (this.onM5Closed && this.m5.currentCandle && this.h1.currentCandle && this.h4.currentCandle) {
        this.onM5Closed({
          m5: this.m5.allCandles,
          h1: this.h1.allCandles,
          h4: this.h4.allCandles,
          currentM5: this.m5.currentCandle,
          currentH1: this.h1.currentCandle,
          currentH4: this.h4.currentCandle
        });
      }
    };
    this.h1.onCandleClosed = (c) => this.h4.processCandle(c);
  }

  public setOnM5Closed(callback: (data: MultiTimeframeData) => void) {
    this.onM5Closed = callback;
  }

  public async start() {
    if (config.FINNHUB_API_KEY) {
      await this.fetchHistoricalCandles();
      this.connectFinnhub();
    } else {
      console.warn('[MarketData] No API Key found, starting Simulation Mode.');
      this.startSimulation();
    }
  }

  private connectFinnhub() {
    this.ws = new WebSocket(`wss://ws.finnhub.io?token=${config.FINNHUB_API_KEY}`);
    this.ws.on('open', () => {
      console.log('[MarketData] Connected to Finnhub WebSocket.');
      this.ws?.send(JSON.stringify({ 'type': 'subscribe', 'symbol': 'OANDA:XAU_USD' }));
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'trade') {
          parsed.data.forEach((trade: any) => {
            this.m1.processTick(trade.p, trade.v, trade.t);
          });
        }
      } catch (e) {
        console.error('[MarketData] WebSocket Parse Error', e);
      }
    });
  }

  private async fetchHistoricalCandles() {
    console.log('[MarketData] Fetching historical data...');
    // In a real app we would fetch historical data for each timeframe.
    // For MVP, we will just generate fallbacks.
    this.generateFallbackCandles();
  }

  private generateFallbackCandles() {
    console.log('[MarketData] Generating dummy historical candles for all timeframes...');
    const now = Date.now();
    let basePrice = 2400.00;

    // Generate 500 H4 candles to bootstrap the engine properly
    const m5PeriodMs = 5 * 60 * 1000;
    const startMs = Math.floor(now / m5PeriodMs) * m5PeriodMs - (500 * 48 * m5PeriodMs); // 500 H4 candles * 48 M5 per H4
    
    // Actually, feeding 24,000 candles takes a split second in JS.
    let currentPrice = 2300;
    for (let i = 0; i < 24000; i++) {
      const change = (Math.random() - 0.48) * 2; // Slight bullish bias
      currentPrice += change;
      const c: OHLCV = {
        time: startMs + (i * m5PeriodMs),
        open: currentPrice - 0.5,
        high: currentPrice + 2,
        low: currentPrice - 2,
        close: currentPrice,
        volume: 100,
        isDummy: true
      };
      // Feed to M5, which cascades to H1 and H4
      this.m5.processCandle(c); 
    }
    console.log(`[MarketData] Bootstrap done. H4 candles: ${this.h4.allCandles.length}, H1 candles: ${this.h1.allCandles.length}`);
  }

  private startSimulation() {
    this.generateFallbackCandles();
    let basePrice = 2450.00;
    // Fast simulation: 1 tick every 50ms, mimicking 1 minute of real time per tick (for fast forward)
    const tickIntervalMs = 60000; // 1 virtual minute per tick
    let virtualTime = Date.now();
    
    setInterval(() => {
      virtualTime += tickIntervalMs;
      const change = (Math.random() - 0.5) * 5; 
      basePrice += change;
      this.m1.processTick(basePrice, 10, virtualTime);
    }, 50); // Emit tick very fast to test engine quickly
  }
}

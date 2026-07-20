import WebSocket from 'ws';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

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
  m15: OHLCV[];
  h1: OHLCV[];
  currentM5: OHLCV;
  currentM15: OHLCV;
  currentH1: OHLCV;
};

export class MarketDataService {
  private ws: WebSocket | null = null;
  private onM5Closed: ((data: MultiTimeframeData) => void) | null = null;

  public m1 = new CandleBuilder(1);
  public m5 = new CandleBuilder(5);
  public m15 = new CandleBuilder(15);
  public h1 = new CandleBuilder(60);

  constructor() {
    this.m1.onCandleClosed = (c) => this.m5.processCandle(c);
    this.m5.onCandleClosed = (c) => {
      this.m15.processCandle(c);
      this.saveHistory(); // Save real candles to disk whenever M5 closes
      
      if (this.onM5Closed && this.m5.currentCandle && this.m15.currentCandle && this.h1.currentCandle) {
        this.onM5Closed({
          m5: this.m5.allCandles,
          m15: this.m15.allCandles,
          h1: this.h1.allCandles,
          currentM5: this.m5.currentCandle,
          currentM15: this.m15.currentCandle,
          currentH1: this.h1.currentCandle
        });
      }
    };
    this.m15.onCandleClosed = (c) => this.h1.processCandle(c);
  }

  public setOnM5Closed(callback: (data: MultiTimeframeData) => void) {
    this.onM5Closed = callback;
  }

  private isBootstrapped = false;

  public async start() {
    if (config.FINNHUB_API_KEY) {
      this.connectFinnhub();
    } else {
      console.warn('[MarketData] No API Key found, starting Simulation Mode.');
      this.startSimulation();
    }
  }

  private connectFinnhub() {
    this.ws = new WebSocket(`wss://ws.finnhub.io?token=${config.FINNHUB_API_KEY}`);
    
    const fallbackTimeout = setTimeout(() => {
      console.warn('[MarketData] No ticks received from Finnhub within 5s. Falling back to Simulation Mode (Free tier might restrict XAU_USD).');
      if (this.ws) this.ws.close();
      this.startSimulation();
    }, 5000);

    this.ws.on('open', () => {
      console.log('[MarketData] Connected to Finnhub WebSocket.');
      this.ws?.send(JSON.stringify({ 'type': 'subscribe', 'symbol': 'OANDA:XAU_USD' }));
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'trade') {
          clearTimeout(fallbackTimeout); // We got data, clear fallback
          parsed.data.forEach((trade: any) => {
            if (!this.isBootstrapped) {
              this.isBootstrapped = true;
              console.log(`[MarketData] First tick received: ${trade.p}. Bootstrapping history...`);
              this.generateFallbackCandles(trade.p);
            }
            this.m1.processTick(trade.p, trade.v, trade.t);
          });
        }
      } catch (e) {
        console.error('[MarketData] WebSocket Parse Error', e);
      }
    });
  }

  private getHistoryFilePath(): string {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'market_history.json');
  }

  private saveHistory() {
    try {
      const realCandles = this.m5.allCandles.filter(c => !c.isDummy);
      if (realCandles.length > 0) {
        fs.writeFileSync(this.getHistoryFilePath(), JSON.stringify(realCandles));
        console.log(`[MarketData] Saved ${realCandles.length} real M5 candles to disk.`);
      }
    } catch (e) {
      console.error('[MarketData] Failed to save history to disk', e);
    }
  }

  private loadHistory(): OHLCV[] {
    try {
      const filePath = this.getHistoryFilePath();
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[MarketData] Successfully loaded ${parsed.length} real M5 candles from disk.`);
          return parsed;
        }
      }
    } catch (e) {
      console.error('[MarketData] Failed to load history from disk', e);
    }
    return [];
  }

  private generateFallbackCandles(anchorPrice: number = 2400.00) {
    console.log('[MarketData] Generating dummy historical candles for all timeframes...');
    const now = Date.now();
    const savedRealCandles = this.loadHistory();
    const numSaved = savedRealCandles.length;

    // Generate 500 H1 candles to bootstrap the engine properly
    const m5PeriodMs = 5 * 60 * 1000;
    const startMs = Math.floor(now / m5PeriodMs) * m5PeriodMs - (500 * 12 * m5PeriodMs); 
    
    // We generate enough dummies so that dummies + real = 6000 (500 H1 candles * 12 M5 candles)
    const numDummies = Math.max(0, 6000 - numSaved);
    const changes = new Float32Array(numDummies);
    let totalChange = 0;
    for (let i = 0; i < numDummies; i++) {
      changes[i] = (Math.random() - 0.5) * 1.5; // Neutral walk, max $1.5 per M5
      totalChange += changes[i];
    }

    let currentPrice = anchorPrice - totalChange; 
    
    // If we have saved candles, the dummy generation should target the OPEN of the first saved candle
    if (numSaved > 0) {
       currentPrice = savedRealCandles[0].open - totalChange;
    }

    for (let i = 0; i < numDummies; i++) {
      currentPrice += changes[i];
      const c: OHLCV = {
        time: startMs + (i * m5PeriodMs),
        open: currentPrice - 0.2,
        high: currentPrice + 0.8,
        low: currentPrice - 0.8,
        close: currentPrice,
        volume: 100,
        isDummy: true
      };
      this.m5.processCandle(c); 
    }
    
    // Append real candles after dummies
    for (const c of savedRealCandles) {
      this.m5.processCandle(c);
      currentPrice = c.close; // update current price to the last real candle
    }

    console.log(`[MarketData] Bootstrap done. Loaded ${numSaved} real candles. H1 candles: ${this.h1.allCandles.length}, M15: ${this.m15.allCandles.length}. Final price: ${currentPrice.toFixed(2)}`);
  }

  private startSimulation() {
    let basePrice = 2450.00;
    this.generateFallbackCandles(basePrice);
    // Fast simulation: 1 tick every 50ms, mimicking 1 minute of real time per tick (for fast forward)
    const tickIntervalMs = 60000; // 1 virtual minute per tick
    let virtualTime = Date.now();
    
    setInterval(() => {
      virtualTime += tickIntervalMs;
      // Mean reversion towards 2450.00 to prevent crazy drift to 4000+
      const mean = 2450.00;
      const pull = (mean - basePrice) * 0.05;
      const change = (Math.random() - 0.5) * 5 + pull; 
      basePrice += change;
      this.m1.processTick(basePrice, 10, virtualTime);
    }, 50); // Emit tick very fast to test engine quickly
  }
}

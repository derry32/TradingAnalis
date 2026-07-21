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
  public maxCandles: number;

  constructor(periodMinutes: number, maxCandles: number = 500) {
    this.periodMs = periodMinutes * 60 * 1000;
    this.maxCandles = maxCandles;
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

      if (this.allCandles.length > this.maxCandles) this.allCandles.shift();
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
  public m5 = new CandleBuilder(5, 6000); // 6000 M5 candles = 500 hours (enough for 500 H1 candles)
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
    if (config.TWELVEDATA_API_KEY) {
      this.connectTwelveData();
    } else {
      console.warn('[MarketData] No API Key found, starting Simulation Mode.');
      this.startSimulation();
    }
  }

  private simulationInterval: NodeJS.Timeout | null = null;

  private connectTwelveData() {
    this.ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${config.TWELVEDATA_API_KEY}`);
    
    let fallbackTimeout: NodeJS.Timeout | null = setTimeout(() => {
      console.warn('[MarketData] No ticks received from TwelveData within 20s. Falling back to Simulation Mode.');
      this.startSimulation();
      fallbackTimeout = null;
    }, 20000);

    this.ws.on('open', () => {
      console.log('[MarketData] Connected to TwelveData WebSocket.');
      this.ws?.send(JSON.stringify({
        "action": "subscribe",
        "params": {
          "symbols": "XAU/USD"
        }
      }));
    });

    this.ws.on('message', async (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        
        // Handle subscription status or errors
        if (parsed.status === 'error') {
          console.error('[MarketData] TwelveData Error:', parsed.message);
          return;
        }

        // Handle price events
        if (parsed.event === 'price' && parsed.price) {
          if (fallbackTimeout) {
            clearTimeout(fallbackTimeout);
            fallbackTimeout = null;
          }
          if (this.simulationInterval) {
             clearInterval(this.simulationInterval);
             this.simulationInterval = null;
             console.log('[MarketData] Real tick received. Stopping simulation mode.');
          }
          
          if (!this.isBootstrapped) {
            this.isBootstrapped = true;
            console.log(`[MarketData] First tick received: ${parsed.price}. Bootstrapping history...`);
            await this.generateFallbackCandles(parsed.price); // callback is muted inside here
          }
          
          // TwelveData format: price, day_volume (optional), timestamp (unix seconds)
          const volume = parsed.day_volume ? parsed.day_volume / 1000 : 10; // dummy volume if zero
          const timestampMs = parsed.timestamp * 1000;
          this.m1.processTick(parsed.price, volume, timestampMs);
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

  private async generateFallbackCandles(anchorPrice: number = 2400.00) {
    console.log('[MarketData] Bootstrapping historical candles...');
    // Mute the M5 callback during bootstrap to prevent bulk signal spam on restart
    const savedCallback = this.onM5Closed;
    this.onM5Closed = null;
    let savedRealCandles = this.loadHistory();

    // If we have fewer than 5000 candles, try to fetch from API
    if (savedRealCandles.length < 5000 && config.TWELVEDATA_API_KEY) {
       console.log(`[MarketData] Local history only has ${savedRealCandles.length} candles. Fetching 5000 historical candles from TwelveData API to skip waiting 20 days!`);
       try {
         const res = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=5000&apikey=${config.TWELVEDATA_API_KEY}`);
         const json = await res.json();
         if (json.values && json.values.length > 0) {
            // TwelveData returns newest first. We need oldest first.
            const reversed = json.values.reverse();
            const fetchedCandles: OHLCV[] = reversed.map((c: any) => ({
               time: new Date(c.datetime + 'Z').getTime(), // approximate, or use local if timezone is implied
               open: parseFloat(c.open),
               high: parseFloat(c.high),
               low: parseFloat(c.low),
               close: parseFloat(c.close),
               volume: 100, // volume not critical for our strategy
               isDummy: false
            }));
            
            // Merge with existing or replace
            savedRealCandles = fetchedCandles;
            console.log(`[MarketData] Successfully fetched ${fetchedCandles.length} real historical candles from API!`);
         }
       } catch(e) {
         console.error('[MarketData] Failed to fetch historical from API:', e);
       }
    }

    const numSaved = savedRealCandles.length;
    let currentPrice = anchorPrice; 
    
    // Process real candles
    for (const c of savedRealCandles) {
      this.m5.processCandle(c);
      currentPrice = c.close; // update current price to the last real candle
    }
    
    // Save to disk so we don't have to fetch again next time
    this.saveHistory();

    // Restore the callback after bootstrap completes
    this.onM5Closed = savedCallback;
    console.log(`[MarketData] Bootstrap done. Loaded ${numSaved} real candles. H1 candles: ${this.h1.allCandles.length}, M15: ${this.m15.allCandles.length}. Final price: ${currentPrice.toFixed(2)}`);
  }

  private async startSimulation() {
    let basePrice = 4010.00;
    let mean = 4010.00;
    
    // Fetch initial real price from REST API so we don't start at a fake 4010
    const syncRealPrice = async () => {
      try {
        if (!config.TWELVEDATA_API_KEY) return;
        const res = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${config.TWELVEDATA_API_KEY}`);
        const json = await res.json();
        if (json.price) {
           mean = parseFloat(json.price);
           console.log(`[MarketData] Synced Simulation Anchor to Real Price: ${mean}`);
        }
      } catch (e) {
        console.error('[MarketData] Failed to sync real price', e);
      }
    };
    
    await syncRealPrice();
    basePrice = mean; // start at the real price
    
    // Keep syncing the mean every 5 minutes to track real market movements
    setInterval(syncRealPrice, 5 * 60 * 1000);

    await this.generateFallbackCandles(basePrice);
    // Fast simulation: 1 tick every 600ms (100x faster than real-time if we want fast forward, but let's mimic 1 minute per tick)
    const tickIntervalMs = 60000; // 1 virtual minute per tick
    let virtualTime = Date.now();
    
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    
    this.simulationInterval = setInterval(() => {
      virtualTime += tickIntervalMs;
      // Mean reversion towards the real REST API price
      const pull = (mean - basePrice) * 0.05;
      const change = (Math.random() - 0.5) * 5 + pull; 
      basePrice += change;
      this.m1.processTick(basePrice, 10, virtualTime);
    }, 50); // Emit tick very fast to test engine quickly
  }
}

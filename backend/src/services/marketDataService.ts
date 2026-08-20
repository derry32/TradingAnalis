import WebSocket from 'ws';
import { config } from '../config';
import { insertSystemLog } from './database';
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
    } else if (periodStart > this.currentCandle.time) {
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
    } else {
      // periodStart < this.currentCandle.time
      // Ignore late ticks from TwelveData API that arrive after we already forced a new candle
      // console.warn(`[CandleBuilder] Ignored late tick for ${new Date(periodStart).toISOString()} (Current is ${new Date(this.currentCandle.time).toISOString()})`);
    }
  }

  public loadHistorical(candles: OHLCV[]) {
    this.allCandles = candles;
  }
}

export type MultiTimeframeData = {
  m1: OHLCV[];
  m5: OHLCV[];
  m15: OHLCV[];
  h1: OHLCV[];
  currentM1?: OHLCV;
  currentM5: OHLCV;
  currentM15: OHLCV;
  currentH1: OHLCV;
  isStaleData?: boolean;
  lastTickAgeSec?: number;
  lastMessageAgeSec?: number;
};

export class MarketDataService {
  private ws: WebSocket | null = null;
  private onM5Closed: ((data: MultiTimeframeData) => void) | null = null;
  private onM1Closed: ((data: MultiTimeframeData) => void) | null = null;
  private onTickUpdate: ((price: number, timestamp: number) => void) | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private cronTimer: NodeJS.Timeout | null = null;

  public lastTickMs: number = Date.now();
  public lastMessageMs: number = Date.now();
  public lastTickAgeSec: number = 0;
  public lastMessageAgeSec: number = 0;

  public m1 = new CandleBuilder(1, 1000);
  public m5 = new CandleBuilder(5, 6000); // 6000 M5 candles = 500 hours (enough for 500 H1 candles)
  public m15 = new CandleBuilder(15);
  public h1 = new CandleBuilder(60);

  constructor() {
    this.m1.onCandleClosed = (closedM1) => {
      if (this.onM1Closed && this.m5.currentCandle && this.m15.currentCandle && this.h1.currentCandle) {
        this.onM1Closed({
          m1: this.m1.allCandles,
          m5: this.m5.allCandles,
          m15: this.m15.allCandles,
          h1: this.h1.allCandles,
          currentM1: closedM1,
          currentM5: this.m5.currentCandle,
          currentM15: this.m15.currentCandle,
          currentH1: this.h1.currentCandle,
          isStaleData: this.lastMessageAgeSec > 30, // HANYA block jika connection mati > 30s
          lastTickAgeSec: this.lastTickAgeSec,
          lastMessageAgeSec: this.lastMessageAgeSec
        });
      }
    };
    this.m5.onCandleClosed = (closedM5) => {
      if (this.isBootstrapped) {
        this.saveHistory(); // Save real candles to disk whenever M5 closes
      }
      
      if (this.onM5Closed && this.m15.currentCandle && this.h1.currentCandle) {
        this.onM5Closed({
          m1: this.m1.allCandles,
          m5: this.m5.allCandles,
          m15: this.m15.allCandles,
          h1: this.h1.allCandles,
          currentM5: closedM5,          // <-- gunakan candle yang BARU DITUTUP, bukan yang sedang terbuka
          currentM15: this.m15.currentCandle,
          currentH1: this.h1.currentCandle,
          isStaleData: this.lastMessageAgeSec > 30, // HANYA block jika connection mati > 30s
          lastTickAgeSec: this.lastTickAgeSec,
          lastMessageAgeSec: this.lastMessageAgeSec
        });
      }
    };
    this.m15.onCandleClosed = (c) => {};
  }

  public setOnM5Closed(callback: (data: MultiTimeframeData) => void) {
    this.onM5Closed = callback;
  }

  public setOnM1Closed(callback: (data: MultiTimeframeData) => void) {
    this.onM1Closed = callback;
  }

  public setOnTickUpdate(callback: (price: number, timestamp: number) => void) {
    this.onTickUpdate = callback;
  }

  public getCandles(): OHLCV[] {
    return this.m5.allCandles;
  }

  private isBootstrapped = false;
  private isBootstrapping = false;
  private isMt5FeedActive = false;
  private mt5LastTickAgeSec = 0;

  public processMt5Tick(symbol: string, bid: number, ask: number, timeMsc: number) {
    if (symbol !== 'XAUUSD' && symbol !== 'XAU/USD' && symbol !== 'GOLD') return; // sementara limit ke XAUUSD
    
    this.isMt5FeedActive = true;
    
    const now = Date.now();
    this.mt5LastTickAgeSec = (now - timeMsc) / 1000;
    
    // Ignore ticks from the future (clock drift) or too old (>60s shouldn't process historical here if we just want live)
    if (this.mt5LastTickAgeSec < 0) this.mt5LastTickAgeSec = 0;

    const price = bid; // Use Bid as the primary price for candle formation
    const volume = 10; // Dummy volume
    
    this.lastTickMs = now;
    this.lastMessageMs = now; // MT5 poll acts as heartbeat
    
    if (!this.isBootstrapped && !this.isBootstrapping) {
      this.isBootstrapping = true;
      console.log(`[MarketData] MT5 Feed Bootstrapping history from price: ${price}...`);
      this.generateFallbackCandles(price).then(() => {
        this.isBootstrapped = true;
        this.isBootstrapping = false;
      });
    }

    this.processAllTicks(price, volume, timeMsc);
  }

  public async start() {
    if (config.TWELVEDATA_API_KEY) {
      this.connectTwelveData();
    } else {
      const msg = '[MarketData] No API Key found, starting Simulation Mode.';
      console.warn(msg);
      insertSystemLog('WARN', 'MarketData', msg);
      this.startSimulation();
    }
    this.startCronTimer();
  }

  private simulationInterval: NodeJS.Timeout | null = null;
  private lastMinuteFired: number = -1;

  private startCronTimer() {
    if (this.cronTimer) clearInterval(this.cronTimer);
    
    // Inisialisasi lastMinuteFired ke menit saat ini agar tidak langsung fire saat start
    this.lastMinuteFired = new Date().getUTCMinutes();
    
    this.cronTimer = setInterval(() => {
      if (!this.isBootstrapped) return;
      
      const now = Date.now();
      const currentMinute = new Date(now).getUTCMinutes();
      
      // Menggunakan boundary crossing daripada pengecekan == 0 untuk mencegah skip akibat event loop lag
      if (currentMinute !== this.lastMinuteFired) {
         this.lastMinuteFired = currentMinute;
         
         this.lastTickAgeSec = (now - this.lastTickMs) / 1000;
         this.lastMessageAgeSec = (now - this.lastMessageMs) / 1000;
         const lastPrice = this.m1.currentCandle?.close || 0;
         
         if (this.isMt5FeedActive) {
             if (this.mt5LastTickAgeSec > 5) {
                 console.warn(`[MarketData] 🔴 MT5 FEED STALE: Tick age is ${this.mt5LastTickAgeSec.toFixed(1)}s! Blocking signals.`);
                 this.lastMessageAgeSec = 999; // Force stale state
             } else {
                 this.lastMessageAgeSec = 0; // Force healthy state
             }
         } else {
             if (this.lastMessageAgeSec > 30) {
                 console.warn(`[MarketData] 🔴 TWELVEDATA STALE/DISCONNECTED: No WebSocket message for ${this.lastMessageAgeSec.toFixed(1)}s! Blocking signals.`);
             } else if (this.lastTickAgeSec > 10) {
                 console.log(`[MarketData] 🟡 WARNING: Market quiet. No tick for ${this.lastTickAgeSec.toFixed(1)}s, but connection is healthy (${this.lastMessageAgeSec.toFixed(1)}s). Signals ALLOWED.`);
             }
         }
         
         // Inject a dummy tick with the current clock time to force close exactly on schedule
         this.processAllTicks(lastPrice, 0, now, true);
      }
    }, 200); // Check setiap 200ms agar sangat presisi saat perpindahan menit
  }

  private processAllTicks(price: number, volume: number, timestamp: number, isDummy = false) {
     this.m1.processTick(price, volume, timestamp, isDummy);
     this.m5.processTick(price, volume, timestamp, isDummy);
     this.m15.processTick(price, volume, timestamp, isDummy);
     this.h1.processTick(price, volume, timestamp, isDummy);
  }

  private connectTwelveData() {
    this.ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${config.TWELVEDATA_API_KEY}`);

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
      this.lastMessageMs = Date.now();
      try {
        const parsed = JSON.parse(data.toString());
        
        // Handle subscription status or errors
        if (parsed.status === 'error') {
          console.error('[MarketData] TwelveData Error:', parsed.message);
          return;
        }

        // Handle price events
        if (parsed.event === 'price' && parsed.price) {
          if (this.simulationInterval) {
             clearInterval(this.simulationInterval);
             this.simulationInterval = null;
             console.log('[MarketData] Real tick received. Stopping simulation mode.');
          }
          
          if (!this.isBootstrapped && !this.isBootstrapping) {
            this.isBootstrapping = true;
            console.log(`[MarketData] First tick received: ${parsed.price}. Bootstrapping history...`);
            await this.generateFallbackCandles(parsed.price); // callback is muted inside here
            this.isBootstrapped = true;
            this.isBootstrapping = false;
          }
          
          // TwelveData format: price, day_volume (optional), timestamp (unix seconds)
          const volume = parsed.day_volume ? parsed.day_volume / 1000 : 10; // dummy volume if zero
          const timestampMs = parsed.timestamp * 1000;
          
          if (!this.isMt5FeedActive) {
            this.lastTickMs = Date.now();
            this.processAllTicks(parsed.price, volume, timestampMs);
          } else {
            // MT5 Feed is primary, ignore TwelveData tick for engine, just log diagnostic if needed
            // console.log(`[Diagnostic] TwelveData tick: ${parsed.price}`);
          }
        }
      } catch (e) {
        console.error('[MarketData] WebSocket Parse Error', e);
      }
    });

    this.ws.on('close', () => {
      console.warn('[MarketData] TwelveData WebSocket closed! Reconnecting in 5s...');
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws = null;
      }
      setTimeout(() => this.connectTwelveData(), 5000);
    });

    this.ws.on('error', (err) => {
      console.error('[MarketData] TwelveData WebSocket Error:', err);
      this.ws?.close(); // Will trigger 'close' event and reconnect
    });

    // Watchdog: If no message for 5 minutes (or 1 hour on weekends), force reconnect
    const isWeekend = () => {
      const now = new Date();
      const day = now.getUTCDay();
      const hour = now.getUTCHours();
      if (day === 6) return true; // Saturday
      if (day === 0 && hour < 22) return true; // Sunday before 22:00 UTC (Senin 05:00 WIB)
      if (day === 5 && hour >= 22) return true; // Friday after 22:00 UTC (Sabtu 05:00 WIB)
      return false;
    };

    const resetWatchdog = () => {
      if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
      const timeoutMs = isWeekend() ? 60 * 60 * 1000 : 5 * 60 * 1000; // 1 hour on weekend, 5 mins on weekday
      
      this.watchdogTimer = setTimeout(() => {
        console.warn(`[MarketData] Watchdog timeout: No ticks for ${timeoutMs / 60000} minutes! Forcing reconnect...`);
        if (this.ws) this.ws.close();
      }, timeoutMs);
    };
    
    this.ws.on('message', () => resetWatchdog());
    resetWatchdog();
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

  private async generateFallbackCandles(anchorPrice: number = 2400.00): Promise<number> {
    console.log('[MarketData] Bootstrapping historical candles...');
    // Mute the M5 callback during bootstrap to prevent bulk signal spam on restart
    const savedCallback = this.onM5Closed;
    this.onM5Closed = null;
    let savedRealCandles = this.loadHistory();

    // If we have fewer than 5000 candles OR the last cached candle is older than 24 hours, fetch fresh data
    const lastCandleTime = savedRealCandles.length > 0 ? savedRealCandles[savedRealCandles.length - 1].time : 0;
    const cacheIsStale = (Date.now() - lastCandleTime) > 24 * 60 * 60 * 1000;
    const needsFetch = savedRealCandles.length < 1000 || cacheIsStale;
    
    if (needsFetch && config.TWELVEDATA_API_KEY) {
       if (cacheIsStale && savedRealCandles.length >= 1000) {
         console.log(`[MarketData] Local cache is STALE (last candle was ${Math.round((Date.now() - lastCandleTime) / 3600000)}h ago). Force re-fetching fresh data!`);
       } else {
         console.log(`[MarketData] Local history has ${savedRealCandles.length} candles (< 1000). Fetching 5000 historical candles from TwelveData API...`);
       }
       try {
         const res = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=5000&timezone=UTC&apikey=${config.TWELVEDATA_API_KEY}`);
         const json = await res.json();
         if (json.values && json.values.length > 0) {
            // TwelveData returns newest first. We need oldest first.
            const reversed = json.values.reverse();
            const fetchedCandles: OHLCV[] = reversed.map((c: any) => ({
               time: new Date(c.datetime + 'Z').getTime(),
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
    } else {
      console.log(`[MarketData] Cache is fresh (last candle: ${new Date(lastCandleTime).toISOString()}). Using ${savedRealCandles.length} cached candles.`);
    }

    const numSaved = savedRealCandles.length;
    let currentPrice = anchorPrice; 
    
    // Process real candles
    for (const c of savedRealCandles) {
      this.m5.processCandle(c);
      this.m15.processCandle(c);
      this.h1.processCandle(c);
      currentPrice = c.close; // update current price to the last real candle
    }
    
    // Save to disk so we don't have to fetch again next time
    this.saveHistory();

    // Restore the callback after bootstrap completes
    this.onM5Closed = savedCallback;
    console.log(`[MarketData] Bootstrap done. Loaded ${numSaved} real candles. H1 candles: ${this.h1.allCandles.length}, M15: ${this.m15.allCandles.length}. Final price: ${currentPrice.toFixed(2)}`);
    return currentPrice;
  }

  private async startSimulation() {
    let basePrice = 4010.00;
    let mean = 4010.00;
    let isApiFailed = false;
    
    // Fetch initial real price from REST API so we don't start at a fake 4010
    const syncRealPrice = async () => {
      try {
        if (!config.TWELVEDATA_API_KEY) return;
        const res = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${config.TWELVEDATA_API_KEY}`);
        const json = await res.json();
        if (json.price) {
           mean = parseFloat(json.price);
           isApiFailed = false; // success
           console.log(`[MarketData] Synced Simulation Anchor to Real Price: ${mean}`);
        } else {
           isApiFailed = true; // TwelveData returned error/rate limit
        }
      } catch (e) {
        isApiFailed = true;
        console.error('[MarketData] Failed to sync real price', e);
      }
    };
    
    await syncRealPrice();
    basePrice = mean; // start at the real price
    
    // Keep syncing the mean every 5 minutes to track real market movements
    setInterval(syncRealPrice, 5 * 60 * 1000);

    const finalBasePrice = await this.generateFallbackCandles(basePrice);
    if (isApiFailed) {
      // If REST API failed due to rate limits, fallback to the last historical candle price
      basePrice = finalBasePrice;
      mean = finalBasePrice;
      console.log(`[MarketData] /price API failed. Falling back basePrice to last historical price: ${basePrice}`);
    }

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
      this.lastTickMs = Date.now();
      this.lastMessageMs = Date.now();
      this.processAllTicks(basePrice, 10, virtualTime);
    }, 50); // Emit tick very fast to test engine quickly
  }
}

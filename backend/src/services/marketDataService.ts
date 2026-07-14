import WebSocket from 'ws';
import { config } from '../config';

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type PriceCallback = (candle: OHLCV) => void;

export class MarketDataService {
  private ws: WebSocket | null = null;
  private currentCandle: OHLCV | null = null;
  private onCandleClosed: PriceCallback | null = null;
  private candleIntervalMs = config.TIMEFRAME_MINUTES * 60 * 1000;
  private allCandles: OHLCV[] = [];
  
  public setOnCandleClosed(callback: PriceCallback) {
    this.onCandleClosed = callback;
  }

  public getCandles(): OHLCV[] {
    const output = [...this.allCandles];
    if (this.currentCandle) output.push(this.currentCandle);
    return output;
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
      // OANDA:XAU_USD is a typical symbol format for Finnhub forex
      this.ws?.send(JSON.stringify({ 'type': 'subscribe', 'symbol': 'OANDA:XAU_USD' }));
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'trade') {
          const trades = parsed.data;
          trades.forEach((trade: any) => {
            this.processTick(trade.p, trade.v, trade.t);
          });
        }
      } catch (e) {
        console.error('[MarketData] Parsing error', e);
      }
    });

    this.ws.on('close', () => {
      console.log('[MarketData] WebSocket disconnected. Reconnecting in 5s...');
      setTimeout(() => this.connectFinnhub(), 5000);
    });
  }

  private processTick(price: number, volume: number, timestamp: number) {
    const periodStart = Math.floor(timestamp / this.candleIntervalMs) * this.candleIntervalMs;
    
    if (!this.currentCandle) {
      this.currentCandle = {
        time: periodStart, open: price, high: price, low: price, close: price, volume
      };
    } else if (this.currentCandle.time === periodStart) {
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
      this.currentCandle.volume += volume;
    } else {
      // Candle closed
      this.allCandles.push(this.currentCandle);
      if (this.allCandles.length > 500) this.allCandles.shift();
      if (this.onCandleClosed) this.onCandleClosed(this.currentCandle);
      // New candle
      this.currentCandle = {
        time: periodStart, open: price, high: price, low: price, close: price, volume
      };
    }
  }

  private async fetchHistoricalCandles() {
    console.log('[MarketData] Fetching historical data...');
    const to = Math.floor(Date.now() / 1000);
    const from = to - (250 * config.TIMEFRAME_MINUTES * 60);
    const url = `https://finnhub.io/api/v1/forex/candle?symbol=OANDA:XAU_USD&resolution=${config.TIMEFRAME_MINUTES}&from=${from}&to=${to}&token=${config.FINNHUB_API_KEY}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.s === 'ok') {
        const historical: OHLCV[] = [];
        for (let i = 0; i < data.t.length; i++) {
          historical.push({
            time: data.t[i] * 1000,
            open: data.o[i],
            high: data.h[i],
            low: data.l[i],
            close: data.c[i],
            volume: data.v ? data.v[i] : 0
          });
        }
        this.allCandles = historical;
        console.log(`[MarketData] Loaded ${historical.length} historical candles.`);
        if (this.onCandleClosed) {
          historical.forEach(c => this.onCandleClosed!(c));
        }
      } else {
        console.warn('[MarketData] No historical data returned by Finnhub. Using fallback generator...');
        this.generateFallbackCandles();
      }
    } catch (e) {
      console.error('[MarketData] Error fetching historical data', e);
      this.generateFallbackCandles();
    }
  }

  private generateFallbackCandles() {
    console.log('[MarketData] Generating 250 dummy historical candles to bootstrap AI...');
    let basePrice = 2350.00; // Starting a bit lower to create an upward trend
    const historical: OHLCV[] = [];
    const now = Date.now();
    const periodMs = this.candleIntervalMs;
    const startMs = Math.floor(now / periodMs) * periodMs - (250 * periodMs);

    for (let i = 0; i < 250; i++) {
      // Bias upward so AI will detect BULLISH trend immediately
      const change = (Math.random() - 0.3) * 3; 
      basePrice += change;
      
      historical.push({
        time: startMs + (i * periodMs),
        open: basePrice - 1,
        high: basePrice + 2,
        low: basePrice - 2,
        close: basePrice,
        volume: Math.floor(Math.random() * 100) + 50
      });
    }

    this.allCandles = historical;
    if (this.onCandleClosed) {
      historical.forEach(c => this.onCandleClosed!(c));
    }
  }

  private startSimulation() {
    let basePrice = 2400.00;
    
    // Untuk simulasi, kita percepat interval agar tidak menunggu 5 menit sungguhan
    // Untuk testing kita buat 1 candle tertutup setiap 5 detik
    const simIntervalMs = 5000; 
    
    setInterval(() => {
      const timestamp = Date.now();
      const change = (Math.random() - 0.5) * 5; // Fluktuasi XAU
      basePrice += change;
      
      const periodStart = Math.floor(timestamp / simIntervalMs) * simIntervalMs;
      
      if (!this.currentCandle) {
        this.currentCandle = { time: periodStart, open: basePrice, high: basePrice, low: basePrice, close: basePrice, volume: 10 };
      } else if (this.currentCandle.time === periodStart) {
        this.currentCandle.high = Math.max(this.currentCandle.high, basePrice);
        this.currentCandle.low = Math.min(this.currentCandle.low, basePrice);
        this.currentCandle.close = basePrice;
        this.currentCandle.volume += 5;
      } else {
        if (this.onCandleClosed) this.onCandleClosed(this.currentCandle);
        this.currentCandle = { time: periodStart, open: basePrice, high: basePrice, low: basePrice, close: basePrice, volume: 10 };
      }
    }, 1000); 
  }
}

import axios from 'axios';
import { config } from '../config';

export interface MacroState {
  dxy: number;
  us10y: number;
  trendDxy: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trendYield: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  lastUpdated: number;
}

export class MacroDataService {
  private static instance: MacroDataService;
  private state: MacroState = {
    dxy: 0,
    us10y: 0,
    trendDxy: 'NEUTRAL',
    trendYield: 'NEUTRAL',
    lastUpdated: 0
  };

  private constructor() {}

  public static getInstance(): MacroDataService {
    if (!MacroDataService.instance) {
      MacroDataService.instance = new MacroDataService();
    }
    return MacroDataService.instance;
  }

  public getMacroState(): MacroState {
    return this.state;
  }

  public async fetchMacroData(): Promise<MacroState> {
    if (!config.TWELVEDATA_API_KEY) {
      console.warn('[MacroData] API Key missing, returning neutral macro state.');
      return this.state;
    }

    try {
      console.log('[MacroData] Fetching DXY and US10Y from TwelveData...');
      
      // Menggunakan API TwelveData. 
      // Jika DXY premium, maka TwelveData akan mereturn error, kita handle graceful fallback.
      const [dxyRes, yieldRes] = await Promise.allSettled([
        axios.get(`https://api.twelvedata.com/price?symbol=DXY&apikey=${config.TWELVEDATA_API_KEY}`),
        axios.get(`https://api.twelvedata.com/price?symbol=US10Y&apikey=${config.TWELVEDATA_API_KEY}`)
      ]);

      let newDxy = this.state.dxy;
      let newUs10y = this.state.us10y;

      if (dxyRes.status === 'fulfilled' && dxyRes.value.data.price) {
        newDxy = parseFloat(dxyRes.value.data.price);
      } else {
        console.warn('[MacroData] Failed to fetch DXY (possibly premium or rate limited).');
      }

      if (yieldRes.status === 'fulfilled' && yieldRes.value.data.price) {
        newUs10y = parseFloat(yieldRes.value.data.price);
      } else {
        console.warn('[MacroData] Failed to fetch US10Y (possibly premium or rate limited).');
      }

      // Simple trend detection: If it went up from last recorded state, BULLISH, else BEARISH.
      // Jika ini adalah fetch pertama (state == 0), kita buat NEUTRAL dulu.
      if (this.state.dxy > 0 && newDxy > 0) {
        this.state.trendDxy = newDxy > this.state.dxy ? 'BULLISH' : (newDxy < this.state.dxy ? 'BEARISH' : 'NEUTRAL');
      }
      if (this.state.us10y > 0 && newUs10y > 0) {
        this.state.trendYield = newUs10y > this.state.us10y ? 'BULLISH' : (newUs10y < this.state.us10y ? 'BEARISH' : 'NEUTRAL');
      }

      this.state.dxy = newDxy;
      this.state.us10y = newUs10y;
      this.state.lastUpdated = Date.now();

      console.log(`[MacroData] Updated -> DXY: ${newDxy} (${this.state.trendDxy}), US10Y: ${newUs10y} (${this.state.trendYield})`);
      return this.state;
    } catch (e: any) {
      console.error('[MacroData] Exception fetching macro data:', e.message);
      return this.state;
    }
  }
}

export const macroData = MacroDataService.getInstance();

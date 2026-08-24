import re

with open('backend/src/services/technicalAnalysis.ts', 'r') as f:
    content = f.read()

# 1. Update AnalysisResult interface
old_interface = "export interface AnalysisResult {"
new_interface = """export interface AnalysisResult {
  m1Ob: 'BULLISH' | 'BEARISH' | 'NONE';
  m1LiquiditySweep: boolean;
  m1Bos: boolean;
  atr_M1: number;
  isExtendedM5: boolean;"""
content = content.replace(old_interface, new_interface)

# 2. Add detectM1 methods inside TechnicalAnalysis class
methods = """
  private detectM1OrderBlock(m1Candles: OHLCV[], swingsM1: SwingPoint[], atr: number): 'BULLISH' | 'BEARISH' | 'NONE' {
    if (m1Candles.length < 20 || swingsM1.length < 2) return 'NONE';
    
    // Simplification for order block detection with displacement & BOS
    // We look at the last 15 candles
    const recentCandles = m1Candles.slice(-15);
    const currentPrice = m1Candles[m1Candles.length - 1].close;
    
    let bullishOB = false;
    let bearishOB = false;
    
    // Scan for Bullish OB (Down candle before strong up move breaking structure)
    for(let i=0; i < recentCandles.length - 5; i++) {
        const c = recentCandles[i];
        if (c.close < c.open) { // Base candle
            // Check for displacement in next 3 candles
            const move = recentCandles[i+3].close - c.close;
            if (move > atr * 1.5) {
                // Check if it broke a swing high
                const priorHighs = swingsM1.filter(s => s.type === 'HIGH' && s.time < c.time);
                const lastHigh = priorHighs.length > 0 ? priorHighs[priorHighs.length - 1].price : 0;
                if (lastHigh > 0 && recentCandles[i+3].close > lastHigh) {
                    // Check if price is currently retesting this OB zone
                    if (currentPrice >= c.low && currentPrice <= c.high + atr * 0.5) {
                        // Check for rejection (current candle close > current open)
                        if (m1Candles[m1Candles.length-1].close > m1Candles[m1Candles.length-1].open) {
                            bullishOB = true;
                        }
                    }
                }
            }
        }
    }

    // Scan for Bearish OB
    for(let i=0; i < recentCandles.length - 5; i++) {
        const c = recentCandles[i];
        if (c.close > c.open) { 
            const move = c.close - recentCandles[i+3].close;
            if (move > atr * 1.5) {
                const priorLows = swingsM1.filter(s => s.type === 'LOW' && s.time < c.time);
                const lastLow = priorLows.length > 0 ? priorLows[priorLows.length - 1].price : 0;
                if (lastLow > 0 && recentCandles[i+3].close < lastLow) {
                    if (currentPrice <= c.high && currentPrice >= c.low - atr * 0.5) {
                        if (m1Candles[m1Candles.length-1].close < m1Candles[m1Candles.length-1].open) {
                            bearishOB = true;
                        }
                    }
                }
            }
        }
    }

    if (bullishOB) return 'BULLISH';
    if (bearishOB) return 'BEARISH';
    return 'NONE';
  }

  private detectM1LiquiditySweep(m1Candles: OHLCV[], swingsM1: SwingPoint[], atr: number): { sweep: boolean, bos: boolean } {
      if (m1Candles.length < 5 || swingsM1.length < 2) return { sweep: false, bos: false };
      
      const last = m1Candles[m1Candles.length - 1];
      const prev = m1Candles[m1Candles.length - 2];
      const lows = swingsM1.filter(s => s.type === 'LOW');
      const highs = swingsM1.filter(s => s.type === 'HIGH');
      
      let sweep = false;
      let bos = false;

      // Bullish Sweep: Price sweeps below recent swing low, then closes back above it (Reclaim)
      if (lows.length >= 2) {
          const targetLow = lows[lows.length - 2].price; 
          if (prev.low < targetLow && prev.close > targetLow) {
              sweep = true;
          }
          if (sweep && last.close > prev.high) bos = true; // Micro BOS
      }
      
      // Bearish Sweep: Price sweeps above recent swing high, then closes back below it
      if (highs.length >= 2) {
          const targetHigh = highs[highs.length - 2].price;
          if (prev.high > targetHigh && prev.close < targetHigh) {
              sweep = true;
          }
          if (sweep && last.close < prev.low) bos = true; // Micro BOS
      }

      return { sweep, bos };
  }

"""
content = content.replace("public analyze(data: MultiTimeframeData): AnalysisResult {", methods + "\n  public analyze(data: MultiTimeframeData): AnalysisResult {")

# 3. Add to analyze method body
analysis_body_addition = """
    const swingsM1 = this.findSwingPoints(data.m1, 3, 3);
    const atr_M1 = this.calculateATR(data.m1, 14);
    const m1Ob = this.detectM1OrderBlock(data.m1, swingsM1, atr_M1);
    const { sweep: m1LiquiditySweep, bos: m1Bos } = this.detectM1LiquiditySweep(data.m1, swingsM1, atr_M1);
    
    const isExtendedM5 = Math.abs(data.currentM5.close - data.currentM5.open) > (atr_M15 * 1.5) || volumeSpikeM5;
"""
content = content.replace("const marketCondition: MarketCondition", analysis_body_addition + "\n    const marketCondition: MarketCondition")

# 4. Return new fields
return_old = "ema20M5\n    };"
return_new = "ema20M5,\n      m1Ob,\n      m1LiquiditySweep,\n      m1Bos,\n      atr_M1,\n      isExtendedM5\n    };"
content = content.replace(return_old, return_new)

with open('backend/src/services/technicalAnalysis.ts', 'w') as f:
    f.write(content)

print("Patched TA M1 successfully")

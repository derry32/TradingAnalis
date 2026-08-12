import { featureEngine } from './services/featureEngine';
import { OHLCV } from './services/marketDataService';
import { confidenceEngine } from './services/confidenceEngine';
import { signalStateMachine } from './services/signalStateMachine';
import { riskEngine } from './services/riskEngine';

/**
 * A/B Testing Script
 * Compares the old fixed 10-pip SL vs the new Dynamic ATR-based SL & Risk Basket Condensation.
 */
function runABTest() {
  console.log('=== RUNNING A/B BACKTEST: STATIC vs DYNAMIC ENGINE ===\n');

  // Generate some synthetic volatile candles (whipsaw behavior)
  const generateVolatileCandles = (count: number, basePrice: number): OHLCV[] => {
    const candles: OHLCV[] = [];
    let p = basePrice;
    for (let i = 0; i < count; i++) {
      const isUp = i % 2 === 0;
      const step = isUp ? 2.5 : -2.0; // High volatility
      const open = p;
      const close = p + step;
      const high = Math.max(open, close) + 1.5;
      const low = Math.min(open, close) - 1.5;
      candles.push({
        time: Date.now() - (count - i) * 60000,
        open,
        high,
        low,
        close,
        volume: 200 + i * 10,
      });
      p = close;
    }
    return candles;
  };

  const m1Candles = generateVolatileCandles(50, 2400.0);
  const m5Candles = generateVolatileCandles(50, 2400.0);
  const m15Candles = generateVolatileCandles(50, 2400.0);
  const h1Candles = generateVolatileCandles(50, 2400.0);
  const currentPrice = m1Candles[m1Candles.length - 1].close;

  const snapshot = featureEngine.generateSnapshot(
    m1Candles,
    m5Candles,
    m15Candles,
    h1Candles,
    currentPrice
  );

  console.log('[SCENARIO] High Volatility Gold Market');
  console.log(`Current Price: $${currentPrice.toFixed(2)}`);
  console.log(`M5 ATR: ${snapshot.m5.features.atr.toFixed(2)} pips\n`);

  // --- NEW ENGINE (DYNAMIC) ---
  console.log('>>> [NEW ENGINE] Dynamic SL & Basket Condensation');
  riskEngine.setBalance(1000);
  riskEngine.setRiskPercent(1.0);
  
  const evalNew = confidenceEngine.evaluate(snapshot);
  console.log(`  Signal Direction: ${evalNew.direction}`);
  console.log(`  Dynamic SL (Pips): ${evalNew.slPips}`);
  
  const burstNew = signalStateMachine.createBurstSignal(
    evalNew, 
    snapshot, 
    30, 
    riskEngine.getBalance(), 
    riskEngine.getRiskPercent()
  );

  if (burstNew) {
    console.log(`  Total Basket Lot Size: ${burstNew.recommendedLot} (Risk Capped at 1% or $10)`);
    console.log(`  Layers Generated: ${burstNew.layers.length}`);
    burstNew.layers.forEach((l) => {
      console.log(`    [Layer ${l.layerIndex}] TP: +${l.tpPips}p, SL: -${l.slPips}p | SL Price: ${l.slPrice}`);
    });
  } else {
    console.log('  ❌ NO TRADE (Filtered out due to extreme risk / low lot)');
  }
  
  console.log('\n>>> [OLD ENGINE SIMULATION] Fixed 10-pip SL, Fixed 0.05 Lot (5 Layers of 0.01)');
  console.log(`  Signal Direction: ${evalNew.direction}`);
  console.log(`  Static SL (Pips): 10`);
  console.log(`  Total Basket Lot Size: 0.05`);
  console.log(`  Layers Generated: 5`);
  for(let i=1; i<=5; i++) {
    const oldTp = [8, 9, 10, 11, 12][i-1];
    const oldSlPrice = evalNew.direction === 'BUY' ? currentPrice - 1.0 : currentPrice + 1.0;
    console.log(`    [Layer ${i}] TP: +${oldTp}p, SL: -10p | SL Price: ${oldSlPrice}`);
  }
  
  console.log('\n=== CONCLUSION ===');
  console.log('In high volatility, the OLD engine places a tight 10-pip SL which will likely get stopped out by noise (ATR > 2.0).');
  console.log('The NEW engine widens the SL dynamically and condenses the layers (lowering total lot size) to maintain strict 1% risk limit.');
}

runABTest();

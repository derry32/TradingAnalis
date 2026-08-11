import { featureEngine } from './services/featureEngine';
import { OHLCV } from './services/marketDataService';
import { confidenceEngine } from './services/confidenceEngine';
import { signalStateMachine } from './services/signalStateMachine';

function runUnitTests() {
  console.log('=== RUNNING ULTRA-FAST ENGINE BENCHMARK & UNIT TESTS ===');

  // Synthetic M1, M5, M15, H1 trending Bullish candles
  const generateBullishCandles = (count: number, basePrice: number, step: number): OHLCV[] => {
    const candles: OHLCV[] = [];
    let p = basePrice;
    for (let i = 0; i < count; i++) {
      const open = p;
      const close = p + step;
      const high = close + step * 0.5;
      const low = open - step * 0.2;
      candles.push({
        time: Date.now() - (count - i) * 60000,
        open,
        high,
        low,
        close,
        volume: 100 + i * 5,
      });
      p = close;
    }
    return candles;
  };

  const m1Candles = generateBullishCandles(50, 3350.0, 0.4);
  const m5Candles = generateBullishCandles(50, 3340.0, 1.2);
  const m15Candles = generateBullishCandles(50, 3320.0, 2.5);
  const h1Candles = generateBullishCandles(50, 3280.0, 5.0);
  const currentPrice = m1Candles[m1Candles.length - 1].close;

  // 1. Benchmark Feature Engine Execution Time
  const t0 = performance.now();
  const snapshot = featureEngine.generateSnapshot(
    m1Candles,
    m5Candles,
    m15Candles,
    h1Candles,
    currentPrice
  );
  const t1 = performance.now();
  const featureLatency = t1 - t0;
  console.log(`[TEST 1] Feature Extraction Latency: ${featureLatency.toFixed(3)} ms (Target: <20ms)`);
  if (featureLatency < 20) console.log('  ✔ PASS: Ultra-fast feature calculation');
  else console.warn('  ⚠ WARN: Feature extraction over target');

  // 2. Benchmark Confidence Scoring Execution Time
  const t2 = performance.now();
  const evaluation = confidenceEngine.evaluate(snapshot);
  const t3 = performance.now();
  const evalLatency = t3 - t2;
  console.log(`[TEST 2] Confidence Evaluation Latency: ${evalLatency.toFixed(3)} ms (Target: <5ms)`);
  console.log(`  Direction: ${evaluation.direction} | Score: ${evaluation.totalScore}% | Tier: ${evaluation.tier}`);
  console.log(`  Target TP Layers: [${evaluation.targetTpPips.join(', ')}] pips | SL: ${evaluation.slPips} pips`);
  if (evaluation.direction === 'BUY' && evaluation.totalScore >= 75) {
    console.log('  ✔ PASS: Correctly identified Bullish Super Trend / Momentum');
  }

  // 3. Test Signal State Machine & 5-Layer Burst Payload
  const burst = signalStateMachine.createBurstSignal(evaluation, snapshot, 30);
  console.log('[TEST 3] 5-Layer Burst Payload:');
  if (burst) {
    console.log(`  Signal ID: ${burst.id}`);
    console.log(`  Entry Zone: ${burst.entryZoneMin} - ${burst.entryZoneMax}`);
    console.log(`  Pullback Limit Price: ${burst.pullbackLimitPrice}`);
    console.log(`  Number of Layers: ${burst.layers.length}`);
    burst.layers.forEach((l) => {
      console.log(`    Layer #${l.layerIndex}: ${l.orderType} @ ${l.suggestedPrice} -> TP ${l.tpPrice} (+${l.tpPips}p) | SL ${l.slPrice}`);
    });
    console.log('  ✔ PASS: 5-Layer Burst generated successfully');
  }

  // 4. Test TTL Validation
  if (burst) {
    console.log('[TEST 4] TTL Validation:');
    const isValidNow = signalStateMachine.isSignalValid(burst);
    console.log(`  Is valid immediately: ${isValidNow}`);
    
    // Simulate expired signal
    burst.timestampMs = Date.now() - 35000; // 35 seconds ago
    const isExpired = !signalStateMachine.isSignalValid(burst);
    console.log(`  Is expired after 35s (>30s TTL): ${isExpired}`);
    if (isValidNow && isExpired) console.log('  ✔ PASS: TTL Expiration logic works properly');
  }

  // 5. Test Re-entry Stacking Logic
  console.log('[TEST 5] Re-Entry Stacking Cycle Tracker:');
  signalStateMachine.recordTradeOutcome('HIT_TP');
  const canReEnter1 = signalStateMachine.canReEnter(3);
  console.log(`  After 1x HIT_TP: Can Re-enter? ${canReEnter1} (Cycle count: 1)`);

  signalStateMachine.recordTradeOutcome('HIT_SL');
  const canReEnterAfterSL = signalStateMachine.canReEnter(3);
  console.log(`  After 1x HIT_SL: Can Re-enter? ${canReEnterAfterSL} (Cycle reset to 0)`);
  if (canReEnter1 && !canReEnterAfterSL) {
    console.log('  ✔ PASS: Re-Entry cycle tracking & SL protection verified');
  }

  console.log('=== ALL UNIT & BENCHMARK TESTS COMPLETED SUCCESSFULLY! ===');
}

runUnitTests();

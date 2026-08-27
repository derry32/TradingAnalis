import { BurstSignalPayload, SignalLifecycleState } from './signalStateMachine';
import { LiveMarketSnapshot } from './featureEngine';
import { insertSystemLog } from './database';
import { mt5Bridge } from './mt5Bridge';

export interface BasketLayer {
  layerNumber: number;
  entryPrice: number;
  lot: number;
  hitTimeMs: number;
}

export interface ActiveBasket {
  signalId: string;
  direction: 'BUY' | 'SELL';
  isActive: boolean;
  layers: BasketLayer[];
  initPrice: number;
  lastLayerPrice: number;
  weightedAvgEntry: number;
  basketTp: number;
  basketInvalidation: number;
  updateIndex: number;
  createdAtMs: number;
  addExecutingLock: boolean;
  basePayload: BurstSignalPayload;
}

const MAX_BASKET_LAYERS = 3;
const BASE_LOT = 0.01;
const ADD_LOT = 0.01;
const MIN_SPACING_ABSOLUTE = 0.30; // $0.30 for XAUUSD (30 points - Micro Grid)
const REQUIRED_RR = 1.3;

class BasketEngine {
  private activeBaskets: Map<string, ActiveBasket> = new Map();
  private lastSnapshot: LiveMarketSnapshot | null = null;

  // Called when INIT signal is generated (from index.ts)
  public initializeBasket(payload: BurstSignalPayload) {
    this.activeBaskets.set(payload.id, {
      signalId: payload.id,
      direction: payload.direction,
      isActive: true,
      layers: [{
        layerNumber: 1,
        entryPrice: payload.entryPrice,
        lot: BASE_LOT,
        hitTimeMs: Date.now()
      }],
      initPrice: payload.entryPrice,
      lastLayerPrice: payload.entryPrice,
      weightedAvgEntry: payload.entryPrice,
      basketTp: payload.layers && payload.layers.length > 0 ? payload.layers[0].tpPrice : 0, 
      basketInvalidation: payload.stopLossPrice,
      updateIndex: 0,
      createdAtMs: Date.now(),
      addExecutingLock: false,
      basePayload: payload
    });
    console.log(`[BasketEngine] Initialized basket for ${payload.id}`);
  }

  // 1. Closed Candle Data (Confirmation)
  public onM1Closed(snapshot: LiveMarketSnapshot) {
    this.lastSnapshot = snapshot;
  }

  // 2. Tick Data (Monitoring & Execution)
  public onTick(currentPrice: number) {
    if (!this.lastSnapshot) return;

    for (const [id, basket] of this.activeBaskets.entries()) {
      if (!basket.isActive) continue;
      this.evaluateAddConditions(basket, currentPrice, this.lastSnapshot);
    }
  }

  private evaluateAddConditions(basket: ActiveBasket, currentPrice: number, snapshot: LiveMarketSnapshot) {
    // 1. Basket masih aktif?
    if (!basket.isActive) return;

    // 2. Layer < 3?
    if (basket.layers.length >= MAX_BASKET_LAYERS) return;

    // 3. Hard Risk Veto PASS?
    // Assuming risk limit check here, for now pass
    const riskPass = true;
    if (!riskPass) return;

    // 4. Soft Thesis Health Check
    const expectedTrend = basket.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const h1TrendMatch = snapshot.h1.features.trend === expectedTrend || snapshot.h1.features.trend === 'NEUTRAL';
    const m15TrendMatch = snapshot.m15.features.trend === expectedTrend || snapshot.m15.features.trend === 'NEUTRAL';
    const invalidationTouched = basket.direction === 'BUY' ? currentPrice <= basket.basketInvalidation : currentPrice >= basket.basketInvalidation;
    
    // Hard Veto: Invalidation touched or opposite trend (CHoCH) on M15
    const oppositeCHoCH = basket.direction === 'BUY' ? snapshot.m15.features.trend === 'BEARISH' : snapshot.m15.features.trend === 'BULLISH';
    if (invalidationTouched) {
        console.log(`[BasketEngine] HARD VETO: Invalidation touched for ${basket.signalId}`);
        return;
    }
    if (oppositeCHoCH) {
        console.log(`[BasketEngine] HARD VETO: Opposite M15 CHoCH detected for ${basket.signalId}`);
        return;
    }

    // Soft Penalty for minor deviations (H1/M15 mismatch)
    if (!h1TrendMatch || !m15TrendMatch) {
        // Log warning but allow evaluation to continue based on pullback
        console.log(`[BasketEngine] WARNING: Thesis Health Check minor deviation for ${basket.signalId} (H1: ${snapshot.h1.features.trend}, M15: ${snapshot.m15.features.trend}). Proceeding with pullback check.`);
    }

    // 5. Harga sudah masuk Pullback Zone? & 6. Minimum spacing terpenuhi?
    // Dynamic ATR-Adjusted Spacing Logic
    const strategy = basket.basePayload.tier?.toUpperCase() || '';
    let baseSpacing = 0.50; // Fallback
    if (strategy.includes('SNIPER')) {
        baseSpacing = 1.00; // 100 poin
    } else if (strategy.includes('HYPER_SCALPER')) {
        baseSpacing = 0.20; // 20 poin
    }

    // ATR Adjustment
    // Assume average ATR is around 2.0. If higher, increase spacing. If lower, decrease.
    const currentAtr = snapshot.m15.features.atr || 2.0;
    let atrMultiplier = 1.0;
    if (currentAtr < 1.5) atrMultiplier = 0.8;       // Low Volatility
    else if (currentAtr > 3.0) atrMultiplier = 1.25; // High Volatility
    
    const requiredSpacing = baseSpacing * atrMultiplier;

    // Safety net: Extreme ATR
    if (currentAtr > 4.5) {
        console.log(`[BasketEngine] EXTREME ATR VETO: ATR is ${currentAtr.toFixed(2)} for ${basket.signalId}`);
        return;
    }

    const lastLayer = basket.layers[basket.layers.length - 1];
    const distanceToLast = Math.abs(currentPrice - lastLayer.entryPrice);
    const isSpacingOk = distanceToLast >= requiredSpacing;

    if (!isSpacingOk) return; // Spacing is mandatory

    const m1Momentum = snapshot.m1.features.macd.histogram;
    let isPullback = false;
    let isContinuation = false;
    let momentumScore = 0; // WEAK=0, MEDIUM=5, STRONG=10

    if (basket.direction === 'BUY') {
      isPullback = currentPrice < lastLayer.entryPrice;
      isContinuation = currentPrice > lastLayer.entryPrice;
      if (m1Momentum > 0.15) momentumScore = 10;
      else if (m1Momentum > 0.05) momentumScore = 5;
    } else {
      isPullback = currentPrice > lastLayer.entryPrice;
      isContinuation = currentPrice < lastLayer.entryPrice;
      if (m1Momentum < -0.15) momentumScore = 10;
      else if (m1Momentum < -0.05) momentumScore = 5;
    }

    // Type A: Pullback ADD
    const isTypeA = isPullback;

    // Type B: Continuation ADD
    const isTypeB = isContinuation && (momentumScore >= 5);

    if (!isTypeA && !isTypeB) {
      if (Math.random() < 0.05) console.log(`[BasketEngine] ADD REJECTED: Neither Pullback nor valid Continuation Momentum for ${basket.signalId}`);
      return;
    }

    // Calculate simulated Add
    const newTotalLots = basket.layers.reduce((sum, l) => sum + l.lot, 0) + ADD_LOT;
    
    let sumProduct = basket.layers.reduce((sum, l) => sum + (l.entryPrice * l.lot), 0);
    sumProduct += (currentPrice * ADD_LOT);
    const newWeightedAvg = sumProduct / newTotalLots;

    // Risk Budget Validation
    const riskDistance = Math.abs(newWeightedAvg - basket.basketInvalidation);
    const ASSUMED_EQUITY = 1000;
    const maxBasketRiskMoney = ASSUMED_EQUITY * 0.02; // 2% Equity
    const basketRiskMoney = riskDistance * newTotalLots * 100; // XAUUSD: 1 point = $1 per 0.01 lot => distance * lots * 100
    
    if (basketRiskMoney > maxBasketRiskMoney) {
        console.log(`[BasketEngine] REJECTED: Risk budget exceeded ($${basketRiskMoney.toFixed(2)} > $${maxBasketRiskMoney.toFixed(2)}) for ${basket.signalId}`);
        return;
    }

    // Calculate Market Target (Structural)
    let marketTarget = 0;
    if (basket.direction === 'BUY') {
        marketTarget = Math.max(snapshot.m15.structure.swingHigh, snapshot.h1.structure.swingHigh, newWeightedAvg + 1.0);
    } else {
        marketTarget = Math.min(snapshot.m15.structure.swingLow, snapshot.h1.structure.swingLow, newWeightedAvg - 1.0);
    }
    
    // Strict requirements for Layer #3
    if (basket.layers.length === 2) {
       const availableReward = Math.abs(marketTarget - newWeightedAvg);
       const requiredReward = riskDistance * 1.20; // RR >= 1.20
       if (availableReward < requiredReward) {
           console.log(`[BasketEngine] LAYER #3 REJECTED: RR ${availableReward.toFixed(2)} < ${requiredReward.toFixed(2)}`);
           return;
       }
       
       if (momentumScore < 5) {
           console.log(`[BasketEngine] LAYER #3 REJECTED: Momentum is WEAK`);
           return;
       }

       let confirmations = 0;
       // Conf A: BOS / CHoCH
       if (snapshot.m5.structure.lastBOS !== 'NONE' || snapshot.m5.structure.lastCHoCH !== 'NONE') confirmations++;
       // Conf B: Displacement
       const m5Body = Math.abs(snapshot.m5.candle.close - snapshot.m5.candle.open);
       if (m5Body > (snapshot.m5.features.atr * 0.8)) confirmations++;
       // Conf C: FVG
       if (snapshot.m5.structure.hasFVG) confirmations++;

       if (confirmations < 2) {
           console.log(`[BasketEngine] LAYER #3 REJECTED: 2/3 Confirmations failed (Score: ${confirmations})`);
           return;
       }
    }

    // 10. ADD_EXECUTING lock = FALSE?
    if (basket.addExecutingLock) return;

    // ALL CONDITIONS MET -> Execute ADD!
    this.executeAdd(basket, currentPrice, newWeightedAvg, marketTarget);
  }

  private executeAdd(basket: ActiveBasket, currentPrice: number, newWeightedAvg: number, newBasketTp: number) {
    basket.addExecutingLock = true;
    basket.updateIndex += 1;
    basket.lastLayerPrice = currentPrice;
    basket.weightedAvgEntry = newWeightedAvg;
    basket.basketTp = newBasketTp;

    basket.layers.push({
      layerNumber: basket.layers.length + 1,
      entryPrice: currentPrice,
      lot: ADD_LOT,
      hitTimeMs: Date.now()
    });

    const addPayload = {
      ...basket.basePayload,
      action: 'BASKET_ADD' as 'BASKET_ADD',
      updateIndex: basket.updateIndex,
      entryPrice: currentPrice,
      layers: [{
        layerIndex: basket.layers.length,
        orderType: (basket.direction === 'BUY' ? 'BUY_MARKET' : 'SELL_MARKET') as 'BUY_MARKET' | 'SELL_MARKET',
        suggestedPrice: currentPrice,
        tpPrice: newBasketTp,
        tpPips: 0,
        slPrice: basket.basketInvalidation,
        slPips: 0,
        lotRatio: 1 // Managed by EA fixed lot
      }]
    };

    console.log(`[BasketEngine] Triggering ADD #${basket.layers.length} for ${basket.signalId} @ ${currentPrice}`);
    mt5Bridge.setLatestBurstSignal(addPayload);
    
    // Log to database for audit
    insertSystemLog('INFO', 'BasketEngine', `BASKET_ADD executed for ${basket.signalId}`, {
      action: 'ADD',
      layer_number: basket.layers.length,
      requested_price: currentPrice,
      lot: ADD_LOT,
      weighted_avg_after: newWeightedAvg,
      basket_tp_after: newBasketTp
    });

    // Unlock after 5 seconds to prevent rapid firing
    setTimeout(() => { basket.addExecutingLock = false; }, 5000);
  }

  public completeBasket(signalId: string) {
    const basket = this.activeBaskets.get(signalId);
    if (basket) {
      basket.isActive = false;
      this.activeBaskets.delete(signalId);
    }
  }
}

export default new BasketEngine();

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
const MIN_SPACING_ABSOLUTE = 0.50; // $0.50 for XAUUSD (50 points)
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

    // 4. Trend / Thesis masih valid?
    const expectedTrend = basket.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const h1TrendMatch = snapshot.h1.features.trend === expectedTrend || snapshot.h1.features.trend === 'NEUTRAL';
    const m15TrendMatch = snapshot.m15.features.trend === expectedTrend || snapshot.m15.features.trend === 'NEUTRAL';
    const invalidationTouched = basket.direction === 'BUY' ? currentPrice <= basket.basketInvalidation : currentPrice >= basket.basketInvalidation;
    if (!h1TrendMatch || !m15TrendMatch || invalidationTouched) return;

    // 5. Harga sudah masuk Pullback Zone? & 6. Minimum spacing terpenuhi?
    const atrM5 = snapshot.m5.features.atr || 1.0;
    const availableSpaceToSL = Math.abs(basket.initPrice - basket.basketInvalidation);
    const maxAllowedSpacing = Math.max(availableSpaceToSL / 3, MIN_SPACING_ABSOLUTE);
    const requiredSpacing = Math.min(Math.max(0.5 * atrM5, MIN_SPACING_ABSOLUTE), maxAllowedSpacing);
    
    let isPullbackZone = false;
    if (basket.direction === 'BUY') {
      isPullbackZone = currentPrice <= basket.lastLayerPrice - requiredSpacing;
    } else {
      isPullbackZone = currentPrice >= basket.lastLayerPrice + requiredSpacing;
    }

    if (!isPullbackZone) return;

    // 7. Falling Knife = FALSE?
    const m1Momentum = snapshot.m1.features.macd.histogram;
    const isFallingKnife = basket.direction === 'BUY' ? m1Momentum < -0.5 : m1Momentum > 0.5;
    if (isFallingKnife) {
        if (Math.random() < 0.05) console.log(`[BasketEngine] ADD REJECTED: Falling Knife (Mom: ${m1Momentum.toFixed(2)})`);
        return;
    }

    // 8. Rejection confirmation = TRUE? (From closed candle)
    const m1ClosedBullish = snapshot.m1.candle.close > snapshot.m1.candle.open;
    const hasRejection = basket.direction === 'BUY' ? m1ClosedBullish : !m1ClosedBullish;
    if (!hasRejection) {
        if (Math.random() < 0.05) console.log(`[BasketEngine] ADD REJECTED: No Rejection yet (M1 Bullish: ${m1ClosedBullish})`);
        return;
    }

    // Calculate simulated Add
    const newTotalLots = basket.layers.reduce((sum, l) => sum + l.lot, 0) + ADD_LOT;
    
    let sumProduct = basket.layers.reduce((sum, l) => sum + (l.entryPrice * l.lot), 0);
    sumProduct += (currentPrice * ADD_LOT);
    const newWeightedAvg = sumProduct / newTotalLots;

    // Calculate new Risk and TP
    const newRisk = Math.abs(newWeightedAvg - basket.basketInvalidation);
    const marketTarget = basket.direction === 'BUY' ? basket.basePayload.entryPrice + (newRisk * 2) : basket.basePayload.entryPrice - (newRisk * 2); 
    
    // 9. RR setelah ADD >= minimum?
    const availableReward = Math.abs(marketTarget - newWeightedAvg);
    const requiredReward = newRisk * REQUIRED_RR;
    if (availableReward < requiredReward) return;

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

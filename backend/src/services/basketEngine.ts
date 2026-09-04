import { BurstSignalPayload } from './signalStateMachine';
import { LiveMarketSnapshot } from './featureEngine';
import { insertSystemLog } from './database';
import { mt5Bridge } from './mt5Bridge';
import { config } from '../config';

/**
 * ============================================================
 * AURUMAI BASKET ENGINE V3
 * ============================================================
 *
 * Philosophy:
 *
 * INIT #1
 *   ↓
 * Basket Monitor
 *   ↓
 * ADD #2  → relaxed confirmation
 *   ↓
 * ADD #3  → strict confirmation
 *   ↓
 * Basket Exit / Invalidation
 *
 * Rules:
 * - Maximum 3 positions
 * - No martingale
 * - Same lot size for every layer
 * - ADD based on market confirmation
 * - Minimum spacing = 0.5 ATR M5
 * - Minimum basket RR = config.MIN_BASKET_RR
 * - Basket risk hard limit = config.BASKET_RISK_HARD_LIMIT
 * - INIT threshold handled by signalGenerator
 * - ADD #2 / #3 thresholds handled here
 * ============================================================
 */

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

  /**
   * Latest calculated ADD score.
   */
  lastAddScore: number;

  /**
   * Prevents repeatedly evaluating the same market state.
   */
  lastEvaluationMs: number;
}

/**
 * ============================================================
 * INTERNAL CONSTANTS
 * ============================================================
 */

const MAX_BASKET_LAYERS =
  Number(config.MAX_POSITIONS) || 3;

const BASE_LOT = 0.01;

/**
 * Every basket layer uses the same lot.
 *
 * #1 = 0.01
 * #2 = 0.01
 * #3 = 0.01
 *
 * NO MARTINGALE.
 */
const ADD_LOT = 0.01;

/**
 * ADD minimum spacing.
 *
 * V3:
 * 0.5 × ATR M5
 */
const MIN_SPACING_ATR_MULT =
  Number(config.MIN_SPACING_ATR_MULT) || 0.5;

/**
 * Basket RR.
 */
const MIN_BASKET_RR =
  Number(config.MIN_BASKET_RR) || 1.3;

/**
 * ADD thresholds.
 */
const ADD_2_THRESHOLD =
  Number(config.ADD_2_THRESHOLD) || 75;

const ADD_3_THRESHOLD =
  Number(config.ADD_3_THRESHOLD) || 80;

/**
 * Risk limits.
 */
const DEFAULT_BASKET_RISK =
  Number(config.BASKET_RISK_DEFAULT) || 1.5;

const HARD_BASKET_RISK =
  Number(config.BASKET_RISK_HARD_LIMIT) || 2.0;

/**
 * ATR extreme protection.
 *
 * XAUUSD M5:
 * ATR >= 25 → extreme.
 */
const EXTREME_ATR =
  Number(config.ATR_REGIME_HIGH_MAX) || 25;

/**
 * Basket state monitoring.
 */
const EVALUATION_COOLDOWN_MS = 500;

class BasketEngine {
  private activeBaskets: Map<string, ActiveBasket> = new Map();

  private lastSnapshot: LiveMarketSnapshot | null = null;

  /**
   * Current account equity.
   *
   * This is intentionally configurable from outside.
   * If not updated, fallback = 1000.
   */
  private accountEquity = 1000;

  /**
   * ==========================================================
   * RISK CONTEXT
   * ==========================================================
   *
   * index.ts / risk endpoint can call:
   *
   * basketEngine.setAccountEquity(equity)
   */
  public setAccountEquity(equity: number) {
    if (!Number.isFinite(equity) || equity <= 0) {
      console.warn(
        `[BasketEngine] Invalid equity received: ${equity}`
      );
      return;
    }

    this.accountEquity = equity;

    console.log(
      `[BasketEngine] Account equity updated: $${equity.toFixed(2)}`
    );
  }

  /**
   * ==========================================================
   * INITIALIZE BASKET
   * ==========================================================
   *
   * Called after signalGenerator approves INIT #1.
   */
  public initializeBasket(payload: BurstSignalPayload) {
    if (!payload?.id) {
      console.error(
        '[BasketEngine] Cannot initialize basket: missing signal ID'
      );
      return;
    }

    /**
     * Prevent duplicate basket.
     */
    const existing = this.activeBaskets.get(payload.id);

    if (existing?.isActive) {
      console.warn(
        `[BasketEngine] Basket already active: ${payload.id}`
      );
      return;
    }

    const entryPrice = Number(payload.entryPrice);
    const stopLoss = Number(payload.stopLossPrice);

    if (
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(stopLoss)
    ) {
      console.error(
        `[BasketEngine] Invalid INIT price data for ${payload.id}`,
        {
          entryPrice,
          stopLoss
        }
      );

      return;
    }

    const initialTp =
      payload.layers &&
        payload.layers.length > 0
        ? Number(payload.layers[0].tpPrice)
        : this.calculateFallbackTarget(
          payload.direction,
          entryPrice,
          stopLoss
        );

    const now = Date.now();

    const basket: ActiveBasket = {
      signalId: payload.id,

      direction: payload.direction,

      isActive: true,

      layers: [
        {
          layerNumber: 1,
          entryPrice,
          lot: BASE_LOT,
          hitTimeMs: now
        }
      ],

      initPrice: entryPrice,

      lastLayerPrice: entryPrice,

      weightedAvgEntry: entryPrice,

      basketTp: initialTp,

      basketInvalidation: stopLoss,

      updateIndex: 0,

      createdAtMs: now,

      addExecutingLock: false,

      basePayload: payload,

      lastAddScore: 0,

      lastEvaluationMs: 0
    };

    this.activeBaskets.set(payload.id, basket);

    console.log(
      `[BasketEngine] INIT #1 created | ${payload.direction} | ${payload.id} | Entry=${entryPrice}`
    );

    insertSystemLog(
      'INFO',
      'BasketEngine',
      `Basket INIT #1 created for ${payload.id}`,
      {
        action: 'INIT',
        signal_id: payload.id,
        direction: payload.direction,
        entry_price: entryPrice,
        lot: BASE_LOT,
        basket_tp: initialTp,
        basket_invalidation: stopLoss
      }
    );
  }

  /**
   * ==========================================================
   * CLOSED CANDLE
   * ==========================================================
   *
   * M1 candle can update latest market snapshot.
   */
  public onM1Closed(snapshot: LiveMarketSnapshot) {
    this.lastSnapshot = snapshot;
  }

  /**
   * Optional generic snapshot update.
   */
  public updateSnapshot(snapshot: LiveMarketSnapshot) {
    this.lastSnapshot = snapshot;
  }

  /**
   * ==========================================================
   * TICK MONITOR
   * ==========================================================
   */
  public onTick(currentPrice: number) {
    if (!Number.isFinite(currentPrice)) {
      return;
    }

    if (!this.lastSnapshot) {
      return;
    }

    for (const basket of this.activeBaskets.values()) {
      if (!basket.isActive) {
        continue;
      }

      this.evaluateAddConditions(
        basket,
        currentPrice,
        this.lastSnapshot
      );
    }
  }

  /**
   * ==========================================================
   * MAIN ADD EVALUATION
   * ==========================================================
   */
  private evaluateAddConditions(
    basket: ActiveBasket,
    currentPrice: number,
    snapshot: LiveMarketSnapshot
  ) {
    /**
     * --------------------------------------------------------
     * 0. EXECUTION LOCK
     * --------------------------------------------------------
     */
    if (basket.addExecutingLock) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 1. COOLDOWN
     * --------------------------------------------------------
     */
    const now = Date.now();

    if (
      now - basket.lastEvaluationMs <
      EVALUATION_COOLDOWN_MS
    ) {
      return;
    }

    basket.lastEvaluationMs = now;

    /**
     * --------------------------------------------------------
     * 2. MAX POSITION CHECK
     * --------------------------------------------------------
     */
    if (basket.layers.length >= MAX_BASKET_LAYERS) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 3. MARKET DATA VALIDATION
     * --------------------------------------------------------
     */
    if (!snapshot.m5 || !snapshot.m15 || !snapshot.h1) {
      return;
    }

    const m5 = snapshot.m5;
    const m15 = snapshot.m15;
    const h1 = snapshot.h1;

    /**
     * --------------------------------------------------------
     * 4. ATR REGIME
     * --------------------------------------------------------
     *
     * IMPORTANT:
     * ADD spacing uses M5 ATR.
     */
    const m5Atr = Number(m5.features.atr);

    if (!Number.isFinite(m5Atr) || m5Atr <= 0) {
      return;
    }

    /**
     * Extreme volatility = no ADD.
     */
    if (m5Atr >= EXTREME_ATR) {
      this.logThrottled(
        `[BasketEngine] EXTREME ATR VETO | ${basket.signalId} | M5 ATR=${m5Atr.toFixed(2)}`
      );

      return;
    }

    /**
     * --------------------------------------------------------
     * 5. INVALIDATION
     * --------------------------------------------------------
     */
    const invalidationTouched =
      basket.direction === 'BUY'
        ? currentPrice <= basket.basketInvalidation
        : currentPrice >= basket.basketInvalidation;

    if (invalidationTouched) {
      console.log(
        `[BasketEngine] HARD VETO | Invalidation touched | ${basket.signalId}`
      );

      return;
    }

    /**
     * --------------------------------------------------------
     * 6. DIRECTION HEALTH
     * --------------------------------------------------------
     */
    const expectedTrend =
      basket.direction === 'BUY'
        ? 'BULLISH'
        : 'BEARISH';

    const oppositeTrend =
      basket.direction === 'BUY'
        ? 'BEARISH'
        : 'BULLISH';

    const h1Trend = h1.features.trend;
    const m15Trend = m15.features.trend;

    /**
     * H1 opposite = hard veto.
     */
    if (h1Trend === oppositeTrend) {
      this.logThrottled(
        `[BasketEngine] HARD VETO | H1 opposite trend | ${basket.signalId}`
      );

      return;
    }

    /**
     * M15 opposite = hard veto.
     *
     * This protects the basket against actual structural reversal.
     */
    if (m15Trend === oppositeTrend) {
      this.logThrottled(
        `[BasketEngine] HARD VETO | M15 opposite trend | ${basket.signalId}`
      );

      return;
    }

    /**
     * Neutral is allowed in V3 RELAXED.
     */
    const h1Aligned =
      h1Trend === expectedTrend;

    const m15Aligned =
      m15Trend === expectedTrend;

    /**
     * --------------------------------------------------------
     * 7. SPACING
     * --------------------------------------------------------
     *
     * Minimum spacing:
     *
     * 0.5 × ATR M5
     */
    const requiredSpacing =
      m5Atr * MIN_SPACING_ATR_MULT;

    const lastLayer =
      basket.layers[basket.layers.length - 1];

    const distanceFromLast =
      Math.abs(
        currentPrice - lastLayer.entryPrice
      );

    if (distanceFromLast < requiredSpacing) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 8. PULLBACK / CONTINUATION
     * --------------------------------------------------------
     */
    const isPullback =
      basket.direction === 'BUY'
        ? currentPrice < lastLayer.entryPrice
        : currentPrice > lastLayer.entryPrice;

    const isContinuation =
      basket.direction === 'BUY'
        ? currentPrice > lastLayer.entryPrice
        : currentPrice < lastLayer.entryPrice;

    /**
     * --------------------------------------------------------
     * 9. MOMENTUM
     * --------------------------------------------------------
     */
    const macdHistogram =
      Number(m5.features.macd?.histogram ?? 0);

    let momentumScore = 0;

    if (basket.direction === 'BUY') {
      if (macdHistogram > 0.15) {
        momentumScore = 10;
      } else if (macdHistogram > 0.05) {
        momentumScore = 5;
      }
    } else {
      if (macdHistogram < -0.15) {
        momentumScore = 10;
      } else if (macdHistogram < -0.05) {
        momentumScore = 5;
      }
    }

    /**
     * --------------------------------------------------------
     * 10. STRUCTURE CONFIRMATION
     * --------------------------------------------------------
     */
    let structureScore = 0;

    if (
      (basket.direction === 'BUY' && (
        m5.structure.lastBOS === 'BULLISH_BOS' ||
        m5.structure.lastCHoCH === 'BULLISH_CHOCH'
      )) ||
      (basket.direction === 'SELL' && (
        m5.structure.lastBOS === 'BEARISH_BOS' ||
        m5.structure.lastCHoCH === 'BEARISH_CHOCH'
      ))
    ) {
      structureScore += 10;
    }

    /**
     * M15 structure.
     */
    if (
      (basket.direction === 'BUY' && (
        m15.structure.lastBOS === 'BULLISH_BOS' ||
        m15.structure.lastCHoCH === 'BULLISH_CHOCH'
      )) ||
      (basket.direction === 'SELL' && (
        m15.structure.lastBOS === 'BEARISH_BOS' ||
        m15.structure.lastCHoCH === 'BEARISH_CHOCH'
      ))
    ) {
      structureScore += 5;
    }

    /**
     * --------------------------------------------------------
     * 11. DISPLACEMENT
     * --------------------------------------------------------
     */
    let displacementScore = 0;

    const m5Body = Math.abs(
      m5.candle.close - m5.candle.open
    );

    if (m5Body >= m5Atr * 0.8) {
      displacementScore = 10;
    } else if (m5Body >= m5Atr * 0.5) {
      displacementScore = 5;
    }

    /**
     * --------------------------------------------------------
     * 12. FVG
     * --------------------------------------------------------
     */
    const fvgScore =
      m5.structure.hasFVG ? 5 : 0;

    /**
     * --------------------------------------------------------
     * 13. MARKET PHASE
     * --------------------------------------------------------
     *
     * V3 relaxed:
     * Neutral market is NOT automatically rejected.
     */
    let trendScore = 0;

    if (h1Aligned) {
      trendScore += 10;
    }

    if (m15Aligned) {
      trendScore += 10;
    }

    /**
     * --------------------------------------------------------
     * 14. PULLBACK BONUS
     * --------------------------------------------------------
     */
    let setupScore = 0;

    if (isPullback) {
      /**
       * Pullback is the preferred ADD setup.
       */
      setupScore += 15;
    }

    if (isContinuation && momentumScore >= 5) {
      /**
       * Continuation is allowed,
       * but requires momentum.
       */
      setupScore += 10;
    }

    /**
     * --------------------------------------------------------
     * 15. CALCULATE ADD SCORE
     * --------------------------------------------------------
     *
     * Maximum theoretical:
     *
     * trend        20
     * momentum     10
     * structure    15
     * displacement 10
     * FVG           5
     * setup        15
     *
     * = 75
     *
     * Plus base signal quality can contribute.
     *
     * We normalize into 0–100.
     */
    const baseScore = this.extractBaseScore(
      basket.basePayload
    );

    let rawScore =
      trendScore +
      momentumScore +
      structureScore +
      displacementScore +
      fvgScore +
      setupScore;

    /**
     * Base signal contribution.
     */
    if (baseScore > 0) {
      rawScore +=
        Math.max(0, Math.min(25, baseScore * 0.25));
    }

    const addScore = Math.min(
      100,
      Math.round(rawScore)
    );

    basket.lastAddScore = addScore;

    /**
     * --------------------------------------------------------
     * 16. ADD TYPE VALIDATION
     * --------------------------------------------------------
     */
    const validPullback =
      isPullback;

    const validContinuation =
      isContinuation &&
      momentumScore >= 5;

    if (
      !validPullback &&
      !validContinuation
    ) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 17. REQUIRED SCORE BY LAYER
     * --------------------------------------------------------
     */
    const nextLayer =
      basket.layers.length + 1;

    const requiredScore =
      nextLayer === 2
        ? ADD_2_THRESHOLD
        : ADD_3_THRESHOLD;

    if (addScore < requiredScore) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 18. WEIGHTED AVERAGE
     * --------------------------------------------------------
     */
    const newTotalLots =
      basket.layers.reduce(
        (sum, layer) => sum + layer.lot,
        0
      ) + ADD_LOT;

    let sumProduct =
      basket.layers.reduce(
        (sum, layer) =>
          sum +
          layer.entryPrice * layer.lot,
        0
      );

    sumProduct +=
      currentPrice * ADD_LOT;

    const newWeightedAvg =
      sumProduct / newTotalLots;

    /**
     * --------------------------------------------------------
     * 19. CALCULATE STRUCTURAL TARGET
     * --------------------------------------------------------
     */
    const marketTarget =
      this.calculateStructuralTarget(
        basket.direction,
        newWeightedAvg,
        basket.basketInvalidation,
        snapshot
      );

    if (!Number.isFinite(marketTarget)) {
      return;
    }

    /**
     * --------------------------------------------------------
     * 20. RR VALIDATION
     * --------------------------------------------------------
     */
    const riskDistance =
      Math.abs(
        newWeightedAvg -
        basket.basketInvalidation
      );

    if (riskDistance <= 0) {
      return;
    }

    const rewardDistance =
      Math.abs(
        marketTarget -
        newWeightedAvg
      );

    const basketRR =
      rewardDistance /
      riskDistance;

    if (basketRR < MIN_BASKET_RR) {
      console.log(
        `[BasketEngine] ADD #${nextLayer} rejected | RR=${basketRR.toFixed(2)} < ${MIN_BASKET_RR}`
      );

      return;
    }

    /**
     * --------------------------------------------------------
     * 21. BASKET RISK
     * --------------------------------------------------------
     */
    const basketRiskPercent =
      this.calculateBasketRiskPercent(
        newWeightedAvg,
        basket.basketInvalidation,
        newTotalLots
      );

    /**
     * Hard limit.
     */
    if (
      basketRiskPercent >
      HARD_BASKET_RISK
    ) {
      console.log(
        `[BasketEngine] HARD RISK VETO | ${basket.signalId} | Risk=${basketRiskPercent.toFixed(2)}%`
      );

      return;
    }

    /**
     * Default basket risk warning.
     *
     * We don't hard reject at DEFAULT_BASKET_RISK.
     * The hard veto remains HARD_BASKET_RISK.
     */
    if (
      basketRiskPercent >
      DEFAULT_BASKET_RISK
    ) {
      console.log(
        `[BasketEngine] Risk warning | ${basket.signalId} | Risk=${basketRiskPercent.toFixed(2)}%`
      );
    }

    /**
     * --------------------------------------------------------
     * 22. LAYER #3 STRICT FILTER
     * --------------------------------------------------------
     */
    if (nextLayer === 3) {
      const layer3Passed =
        this.validateLayer3(
          basket,
          snapshot,
          momentumScore,
          displacementScore,
          structureScore,
          basketRR
        );

      if (!layer3Passed) {
        return;
      }
    }

    /**
     * --------------------------------------------------------
     * 23. EXECUTE ADD
     * --------------------------------------------------------
     */
    this.executeAdd(
      basket,
      currentPrice,
      newWeightedAvg,
      marketTarget,
      addScore,
      basketRR,
      basketRiskPercent
    );
  }

  /**
   * ==========================================================
   * LAYER #3 STRICT VALIDATION
   * ==========================================================
   */
  private validateLayer3(
    basket: ActiveBasket,
    snapshot: LiveMarketSnapshot,
    momentumScore: number,
    displacementScore: number,
    structureScore: number,
    basketRR: number
  ): boolean {
    /**
     * RR must satisfy global minimum.
     */
    if (basketRR < MIN_BASKET_RR) {
      return false;
    }

    /**
     * Layer #3 requires at least medium momentum.
     */
    if (momentumScore < 5) {
      console.log(
        `[BasketEngine] ADD #3 rejected | Weak momentum`
      );

      return false;
    }

    /**
     * M5 confirmations.
     */
    let confirmations = 0;

    /**
     * Confirmation A:
     * BOS / CHoCH.
     */
    if (
      snapshot.m5.structure.lastBOS !== 'NONE' ||
      snapshot.m5.structure.lastCHoCH !== 'NONE'
    ) {
      confirmations++;
    }

    /**
     * Confirmation B:
     * Displacement.
     */
    if (displacementScore >= 5) {
      confirmations++;
    }

    /**
     * Confirmation C:
     * FVG.
     */
    if (snapshot.m5.structure.hasFVG) {
      confirmations++;
    }

    /**
     * Confirmation D:
     * Higher timeframe structure.
     */
    if (structureScore >= 15) {
      confirmations++;
    }

    /**
     * Layer #3 requires 2/4.
     */
    if (confirmations < 2) {
      console.log(
        `[BasketEngine] ADD #3 rejected | Confirmations=${confirmations}/4`
      );

      return false;
    }

    return true;
  }

  /**
   * ==========================================================
   * EXECUTE ADD
   * ==========================================================
   */
  private executeAdd(
    basket: ActiveBasket,
    currentPrice: number,
    newWeightedAvg: number,
    newBasketTp: number,
    addScore: number,
    basketRR: number,
    basketRiskPercent: number
  ) {
    /**
     * Double execution protection.
     */
    if (basket.addExecutingLock) {
      return;
    }

    basket.addExecutingLock = true;

    const layerNumber =
      basket.layers.length + 1;

    basket.updateIndex += 1;

    basket.lastLayerPrice =
      currentPrice;

    basket.weightedAvgEntry =
      newWeightedAvg;

    basket.basketTp =
      newBasketTp;

    basket.layers.push({
      layerNumber,
      entryPrice: currentPrice,
      lot: ADD_LOT,
      hitTimeMs: Date.now()
    });

    const orderType =
      basket.direction === 'BUY'
        ? 'BUY_MARKET'
        : 'SELL_MARKET';

    const addPayload = {
      ...basket.basePayload,

      action: 'BASKET_ADD' as const,

      updateIndex:
        basket.updateIndex,

      entryPrice:
        currentPrice,

      basketTarget:
        newBasketTp,

      basketInvalidation:
        basket.basketInvalidation,

      layers: [
        {
          layerIndex:
            layerNumber,

          orderType:
            orderType as
            | 'BUY_MARKET'
            | 'SELL_MARKET',

          suggestedPrice:
            currentPrice,

          tpPrice:
            newBasketTp,

          tpPips: 0,

          slPrice:
            basket.basketInvalidation,

          slPips: 0,

          lotRatio: 1
        }
      ]
    };

    console.log(
      `[BasketEngine] ADD #${layerNumber} EXECUTED | ${basket.direction} | ${basket.signalId}`
    );

    console.log(
      `[BasketEngine] Entry=${currentPrice.toFixed(2)} | Avg=${newWeightedAvg.toFixed(2)} | TP=${newBasketTp.toFixed(2)} | Score=${addScore} | RR=${basketRR.toFixed(2)} | Risk=${basketRiskPercent.toFixed(2)}%`
    );

    /**
     * Send execution command to MT5.
     */
    mt5Bridge.setLatestBurstSignal(
      addPayload
    );

    /**
     * Audit log.
     */
    insertSystemLog(
      'INFO',
      'BasketEngine',
      `BASKET_ADD #${layerNumber} executed for ${basket.signalId}`,
      {
        action: 'BASKET_ADD',

        signal_id:
          basket.signalId,

        layer_number:
          layerNumber,

        direction:
          basket.direction,

        requested_price:
          currentPrice,

        lot:
          ADD_LOT,

        weighted_avg_after:
          newWeightedAvg,

        basket_tp_after:
          newBasketTp,

        add_score:
          addScore,

        basket_rr:
          basketRR,

        basket_risk_percent:
          basketRiskPercent
      }
    );

    /**
     * Unlock after ACK safety window.
     *
     * Actual MT5 state machine remains responsible
     * for execution confirmation.
     */
    setTimeout(() => {
      const current =
        this.activeBaskets.get(
          basket.signalId
        );

      if (current) {
        current.addExecutingLock = false;
      }
    }, Number(config.ACK_TIMEOUT_MS) || 5000);
  }

  /**
   * ==========================================================
   * STRUCTURAL TARGET
   * ==========================================================
   *
   * Find the nearest meaningful target in the trade direction.
   *
   * BUY:
   *   nearest swing high ABOVE average
   *
   * SELL:
   *   nearest swing low BELOW average
   *
   * If no valid structural target exists:
   * fallback = minimum RR target.
   */
  private calculateStructuralTarget(
    direction: 'BUY' | 'SELL',
    avgEntry: number,
    invalidation: number,
    snapshot: LiveMarketSnapshot
  ): number {
    const riskDistance =
      Math.abs(
        avgEntry - invalidation
      );

    const minimumReward =
      riskDistance *
      MIN_BASKET_RR;

    if (direction === 'BUY') {
      const candidates = [
        Number(snapshot.m5.structure.swingHigh),
        Number(snapshot.m15.structure.swingHigh),
        Number(snapshot.h1.structure.swingHigh)
      ].filter(
        value =>
          Number.isFinite(value) &&
          value > avgEntry
      );

      /**
       * Nearest valid resistance.
       */
      if (candidates.length > 0) {
        return Math.min(...candidates);
      }

      return (
        avgEntry +
        minimumReward
      );
    }

    const candidates = [
      Number(snapshot.m5.structure.swingLow),
      Number(snapshot.m15.structure.swingLow),
      Number(snapshot.h1.structure.swingLow)
    ].filter(
      value =>
        Number.isFinite(value) &&
        value < avgEntry
    );

    /**
     * Nearest valid support.
     */
    if (candidates.length > 0) {
      return Math.max(...candidates);
    }

    return (
      avgEntry -
      minimumReward
    );
  }

  /**
   * ==========================================================
   * FALLBACK TARGET FOR INIT
   * ==========================================================
   */
  private calculateFallbackTarget(
    direction: 'BUY' | 'SELL',
    entry: number,
    stopLoss: number
  ): number {
    const riskDistance =
      Math.abs(
        entry - stopLoss
      );

    if (direction === 'BUY') {
      return (
        entry +
        riskDistance *
        MIN_BASKET_RR
      );
    }

    return (
      entry -
      riskDistance *
      MIN_BASKET_RR
    );
  }

  /**
   * ==========================================================
   * BASKET RISK
   * ==========================================================
   *
   * XAUUSD:
   *
   * 1.00 lot = 100 oz
   * 0.01 lot = 1 oz
   *
   * Therefore:
   *
   * risk money =
   * price distance × lot × 100
   */
  private calculateBasketRiskPercent(
    avgEntry: number,
    invalidation: number,
    totalLots: number
  ): number {
    if (
      this.accountEquity <= 0 ||
      totalLots <= 0
    ) {
      return 999;
    }

    const riskDistance =
      Math.abs(
        avgEntry -
        invalidation
      );

    const riskMoney =
      riskDistance *
      totalLots *
      100;

    return (
      riskMoney /
      this.accountEquity
    ) *
      100;
  }

  /**
   * ==========================================================
   * EXTRACT BASE SIGNAL SCORE
   * ==========================================================
   *
   * Supports several possible payload naming conventions
   * without forcing changes to BurstSignalPayload.
   */
  private extractBaseScore(
    payload: BurstSignalPayload
  ): number {
    const data =
      payload as any;

    const possibleScores = [
      data.score,
      data.confidence,
      data.aiScore,
      data.signalScore
    ];

    for (const value of possibleScores) {
      const parsed =
        Number(value);

      if (
        Number.isFinite(parsed) &&
        parsed > 0
      ) {
        return Math.min(
          100,
          parsed
        );
      }
    }

    return 0;
  }

  /**
   * ==========================================================
   * COMPLETE BASKET
   * ==========================================================
   */
  public completeBasket(
    signalId: string
  ) {
    const basket =
      this.activeBaskets.get(
        signalId
      );

    if (!basket) {
      return;
    }

    basket.isActive = false;

    this.activeBaskets.delete(
      signalId
    );

    console.log(
      `[BasketEngine] Basket completed: ${signalId}`
    );

    insertSystemLog(
      'INFO',
      'BasketEngine',
      `Basket completed for ${signalId}`,
      {
        action: 'BASKET_COMPLETE',

        signal_id:
          signalId,

        total_layers:
          basket.layers.length,

        weighted_avg:
          basket.weightedAvgEntry,

        basket_tp:
          basket.basketTp,

        invalidation:
          basket.basketInvalidation
      }
    );
  }

  /**
   * ==========================================================
   * GET BASKET
   * ==========================================================
   */
  public getBasket(
    signalId: string
  ): ActiveBasket | undefined {
    return this.activeBaskets.get(
      signalId
    );
  }

  /**
   * ==========================================================
   * GET ALL ACTIVE BASKETS
   * ==========================================================
   */
  public getActiveBaskets(): ActiveBasket[] {
    return Array.from(
      this.activeBaskets.values()
    );
  }

  /**
   * ==========================================================
   * HAS ACTIVE BASKET
   * ==========================================================
   */
  public hasActiveBasket(
    direction?: 'BUY' | 'SELL'
  ): boolean {
    for (const basket of this.activeBaskets.values()) {
      if (!basket.isActive) {
        continue;
      }

      if (!direction) {
        return true;
      }

      if (
        basket.direction === direction
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * ==========================================================
   * GET BASKET COUNT
   * ==========================================================
   */
  public getBasketLayerCount(
    signalId: string
  ): number {
    const basket =
      this.activeBaskets.get(
        signalId
      );

    return basket
      ? basket.layers.length
      : 0;
  }

  /**
   * ==========================================================
   * DEBUG SNAPSHOT
   * ==========================================================
   */
  public getStatus() {
    return {
      active_baskets:
        this.activeBaskets.size,

      account_equity:
        this.accountEquity,

      max_positions:
        MAX_BASKET_LAYERS,

      add_2_threshold:
        ADD_2_THRESHOLD,

      add_3_threshold:
        ADD_3_THRESHOLD,

      min_basket_rr:
        MIN_BASKET_RR,

      min_spacing_atr:
        MIN_SPACING_ATR_MULT,

      basket_risk_default:
        DEFAULT_BASKET_RISK,

      basket_risk_hard_limit:
        HARD_BASKET_RISK
    };
  }

  /**
   * ==========================================================
   * THROTTLED LOG
   * ==========================================================
   */
  private logThrottled(
    message: string
  ) {
    /**
     * Avoid flooding terminal on every tick.
     */
    if (
      Math.random() < 0.02
    ) {
      console.log(message);
    }
  }
}

export default new BasketEngine();
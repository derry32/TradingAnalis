# Basket Scalping Engine — Design Spec
**Date:** 2026-08-24  
**Author:** Collaborative (Derry + AurumAI)  
**Status:** Draft — awaiting user approval

---

## 1. Overview

### Problem with Current Burst Layer System
The current `ExecuteBurstSignal()` opens **5 orders simultaneously** at signal entry. One bad timing = 5x loss simultaneously. This caused AURUM-980430 (-731k) and is a structural weakness, not an AI weakness.

### The Basket Engine Philosophy
> "I have a directional thesis. I will build positions gradually as market confirms continuation — not because price moved against me, but because the setup improves."

Target: **small price movement × structured position building = basket profit**  
This is NOT martingale. This is **Structured Pullback Scaling**.

---

## 2. Core Architecture

```
Direction Engine (H1+M15+M5)
         ↓
    Setup Valid?
         ↓
   INIT ENTRY (#1)
         ↓
    Basket Monitor
    ┌────┴────┐
    │         │
  ADD?    Exit?
    │         │
    ↓         ↓
  ADD #2/3   CLOSE ALL
    ↓
  Recalculate
  Average Price + TP
```

### Components

| Component | Responsibility |
|---|---|
| **Direction Engine** | H1/M15/M5 analysis → BUY / SELL / WAIT |
| **Basket Engine (NEW)** | Init entry, ADD logic, average price, basket TP/SL, exit |
| **Risk Engine (ENHANCED)** | Max basket lots, max open positions, max drawdown, news/session filter |
| **Execution Layer (EA)** | Order execution via MQL5 native API |
| **Basket Monitor (EA)** | Polling: check TP/invalidation every tick/timer |

---

## 3. Basket State Machine

```
IDLE → RUNNING → [WAIT_ADD | EXIT]
```

### States
- **IDLE**: No active basket. Wait for signal.
- **RUNNING**: At least 1 position open. Monitor continuously.
- **WAIT_ADD**: Pullback zone reached, checking conditions for ADD.
- **EXIT**: All conditions for close met. Close all positions → IDLE.

---

## 4. Init Entry (Position #1)

Triggered by backend signal (same as current). Requirements:
- Backend AI score ≥ threshold (current system)
- Session filter: London / NY / Overlap only
- No existing basket in same direction
- ATR > 0.5 (volatility alive)

On init:
- Open 1 order at market (BUY or SELL)
- Set: `avg_price = entry_price`, `total_lots = lot`, `max_add = 3`
- Calculate initial Basket TP and Basket Invalidation (see Section 6)
- Start Basket Monitor

**Lot size**: Fixed base lot per add position. Same lot for each position. No martingale scaling.

---

## 5. ADD Position Logic (Position #2 and #3)

### ADD #2 — 6 Mandatory Conditions (ALL must pass)

| # | Condition | Check |
|---|---|---|
| 1 | **Thesis Valid** | H1 trend + M15 structure unchanged from init |
| 2 | **Pullback Zone** | Price reached M5 OB / FVG / EMA20 / S/R support zone |
| 3 | **No Falling Knife** | Bearish momentum on M1 must have STOPPED |
| 4 | **Confirmation** | M1 or M5 BOS/CHoCH bullish + rejection candle |
| 5 | **Basket Risk Budget** | (floating_loss + new_position_risk) < MAX_BASKET_RISK |
| 6 | **Min Spacing** | Distance from prev entry ≥ 0.5x ATR M5 |

### ADD #3 — Stricter requirements

All of ADD #2 conditions, plus:
- M5 structure still intact (not just M1)
- Stronger confirmation (M5 displacement or volume spike)
- Room to basket TP must still give ≥ 1.3R after ADD #3's risk is included
- Basket risk budget must be < 70% of MAX_BASKET_RISK (more buffer required)

### Lot size per ADD
```
Position #1 = 1x base_lot
Position #2 = 1x base_lot (same, NOT doubled)
Position #3 = 1x base_lot (same, NOT doubled)
```
No martingale. Total maximum lot = 3x base_lot.

---

## 6. Basket TP Calculation

### Step 1 — Weighted Average Entry
```
Avg = Σ(price × lot) / Σ(lot)
```

### Step 2 — Determine Basket Invalidation
```
BUY: Below lowest structural support (M5/M15) that thesis depends on
SELL: Above highest structural resistance
```
This is the "if wrong" price.

### Step 3 — Calculate Basket Risk
```
Basket Risk = |Avg Entry - Basket Invalidation| × Total Lots × 100
```

### Step 4 — Find Market Target
Find nearest valid opposing liquidity/structure:
- For BUY: nearest valid resistance (M5 → M15 → H1 in priority)
- For SELL: nearest valid support
- Must be > Avg Entry (BUY) or < Avg Entry (SELL)

### Step 5 — Check Minimum RR
```
Available Reward = |Market Target - Avg Entry|
Required Reward  = Basket Risk × MinRR (1.3x default)

If Available Reward < Required Reward:
   → DO NOT ADD MORE
   → Consider early exit or hold with conservative TP
```

### Step 6 — Set Basket TP
```
TP = Market Target (structure-based)
   with minimum floor of: Avg Entry ± (Basket Risk × 1.3)
```

**TP recalculated after every ADD.**

---

## 7. Basket Exit Conditions

| Condition | Action |
|---|---|
| Price ≥ Basket TP (BUY) / ≤ Basket TP (SELL) | CLOSE ALL — Basket TP |
| M15 CHoCH opposite direction | CLOSE ALL — Structural Invalidation |
| Major support/resistance break (thesis invalid) | CLOSE ALL — Thesis Failure |
| Floating loss ≥ MAX_BASKET_RISK | CLOSE ALL — Emergency Cut |
| High impact news within 15 mins | CLOSE ALL — News Protection |
| Session end (optional, configurable) | CLOSE ALL — Time Stop |

**Partial close**: Not in v1. All-in / all-out. Simplicity first.

---

## 8. Risk & Safety Layers

| Parameter | Default | Description |
|---|---|---|
| `max_add` | 3 | Max positions per basket |
| `max_basket_risk` | 2% equity | Max total floating + potential loss |
| `base_lot` | Dynamic by signal confidence | Same lot for every position in basket |
| `min_rr` | 1.3 | Minimum reward:risk before entry/add |
| `max_drawdown` | 5% daily | Stop all trading for the day |
| `news_buffer_mins` | 15 | No new basket within X mins of high-impact news |
| `min_spacing` | 0.5 ATR M5 | Min distance between consecutive entries |

---

## 9. What Changes vs Current System

### Backend (Node.js)
- `technicalAnalysis.ts`: Add basket-relevant outputs — M5 OB zones, FVG zones, pullback zone detection
- `signalGenerator.ts`: Signal now outputs `direction + thesis_summary + basket_invalidation_hint`
- **NEW**: `basketEngine.ts` service — manages basket state, ADD logic, TP calculation
- `index.ts`: Hook M1 closed callback to basket engine's ADD check

### EA (MQL5)
- Remove `ExecuteBurstSignal()` (5-order simultaneous open)
- **NEW**: `BasketManager` — tracks open positions, avg price, basket TP
- **NEW**: `CheckBasketAdd()` — called on M1 close, evaluates ADD conditions
- **NEW**: `CloseBasket()` — close all positions in active basket
- Retain: `CheckSmartExits()`, `CheckAndReportClosedPositions()`, `GetTodayRealizedLoss()`

### Database (Supabase)
- Add `basket_sessions` table: basket_id, direction, init_time, avg_price, total_lots, tp_price, invalidation_price, result
- Extend `signal_layers`: add `basket_id` FK, `add_reason`, `avg_at_add`

---

## 10. Phased Rollout

### Phase 1 (MVP — 1 week)
- Single position only (no ADD yet)
- Basket TP + Basket Invalidation close logic
- Replace 5-order simultaneous open with 1-order init
- Validate: does 1 order + structure-based TP perform better than 5 burst?

### Phase 2 (ADD Logic — week 2)
- Implement ADD #2 with full 6-condition check
- Max 2 positions per basket
- Observe: does ADD #2 improve or worsen expectancy?

### Phase 3 (Full Basket — week 3+)
- Enable ADD #3 with stricter conditions
- 3 positions max
- Full basket monitoring with all exit conditions

---

## 11. Open Questions (Resolved)

| Question | Decision |
|---|---|
| Relationship to burst layer? | Replace entirely. Burst layer removed in v1. |
| ADD trigger? | Structure-based: Thesis valid + Pullback zone + Confirmation + Risk budget |
| Basket TP calculation? | Dynamic structure-based, recalculated every ADD, minimum 1.3R |
| Lot sizing? | Fixed base_lot per ADD, no martingale (1x, 1x, 1x) |
| Max positions? | Start with 3, evaluate after Phase 2 data |
| Partial close? | No, all-in/all-out in v1 |

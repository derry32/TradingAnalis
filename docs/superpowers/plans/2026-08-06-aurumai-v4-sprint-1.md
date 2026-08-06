# AurumAI EA v4.1 (Sprint 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Sprint 1 of AurumAI v4.1 Trade Execution Framework in `mt5/AurumAI_Executor.mq5`, introducing Adaptive Break Even, Dynamic Partial TP, Tiered ATR Trailing Stop, Dynamic Time Stop, Daily Risk Guard, and OnTick/OnTimer separation.

**Architecture:** 
- Pure Native MQL5 without external includes.
- `OnTick()` executes high-frequency risk & exit management (Adaptive BE, Partial TP, Tiered Trailing).
- `OnTimer()` (1-sec interval) handles low-frequency operations (REST API signal polling, Dynamic Time Stop, Daily Risk Guard reset/evaluation, housekeeping).
- ATR(14, M5) calculation using native `iATR` handle and `CopyBuffer`.

**Tech Stack:** MQL5, MetaTrader 5, GitHub Actions CI/CD compiler, Docker Wine VNC.

---

## File Structure

- **Modify:** `mt5/AurumAI_Executor.mq5` (The main MT5 EA file containing the full trade engine)
- **CI Workflow:** `.github/workflows/compile_ea.yml` (Automated native Windows compiler on git push)

---

### Task 1: Add Sprint 1 Inputs, Global State & Native ATR Indicator Handle

**Files:**
- Modify: `mt5/AurumAI_Executor.mq5:10-50`

- [ ] **Step 1: Define Sprint 1 input parameters & global variables**
  Add inputs:
  - `InpBEMultiplier` (1.2): Trigger BE = MAX(1R, ATR * multiplier)
  - `InpPartialR` (1.5): Trigger Partial TP = 1.5 * R
  - `InpTrailingStartR` (2.0): Trigger Trailing = 2.0 * R
  - `InpTrailingATR2R` (2.0), `InpTrailingATR3R` (1.5), `InpTrailingATR4R` (1.0)
  - `InpTimeStopMinR` (0.5), `InpTSAtrSmall` (1.5), `InpTSAtrLarge` (5.0)
  - `InpTSMinsSmall` (20), `InpTSMinsNormal` (30), `InpTSMinsLarge` (45)
  - `InpDailyMaxLossPct` (3.0)
  Add state globals:
  - `int g_atrHandle = INVALID_HANDLE;`
  - `datetime g_signalOpenTime = 0;`
  - `double g_initialR = 0.0;`
  - `double g_signalConf = 70.0;`
  - `bool g_beDone = false;`
  - `bool g_partialDone = false;`
  - `double g_lastTrailingSL = 0.0;`
  - `double g_dailyStartBalance = 0.0;`
  - `int g_currentDay = -1;`
  - `bool g_dailyGuardBlocked = false;`

- [ ] **Step 2: Initialize `g_atrHandle` in `OnInit()` and release in `OnDeinit()`**
  In `OnInit()`: `g_atrHandle = iATR(_Symbol, PERIOD_M5, 14);`
  In `OnDeinit()`: `if(g_atrHandle != INVALID_HANDLE) IndicatorRelease(g_atrHandle);`

- [ ] **Step 3: Add native helper `GetATR(ENUM_TIMEFRAMES tf = PERIOD_M5)`**
  ```mql5
  double GetATR(ENUM_TIMEFRAMES tf = PERIOD_M5)
  {
     if(g_atrHandle == INVALID_HANDLE)
        g_atrHandle = iATR(_Symbol, tf, 14);
     double atr[1];
     ArraySetAsSeries(atr, true);
     if(CopyBuffer(g_atrHandle, 0, 0, 1, atr) > 0)
        return atr[0];
     return 2.0; // safe fallback for Gold (200 pts)
  }
  ```

- [ ] **Step 4: Commit state & helper additions**
  Check `.agent/config.yml` for `auto_commit`.
  `git add mt5/AurumAI_Executor.mq5 && git commit -m "feat(ea): add Sprint 1 inputs, ATR helper, and state tracking"`

---

### Task 2: Implement Adaptive Break Even & Dynamic Partial TP

**Files:**
- Modify: `mt5/AurumAI_Executor.mq5:150-250`

- [ ] **Step 1: Implement `CheckAdaptiveBreakEven()`**
  Calculate current favorable distance in points/dollars.
  Compare with `trigger = MathMax(g_initialR, GetATR(PERIOD_M5) * InpBEMultiplier)`.
  If profit >= trigger and `!g_beDone`:
  - For all positions with `InpMagic`: modify SL to `open_price + (spread * _Point)` (for BUY) or `open_price - (spread * _Point)` (for SELL).
  - Set `g_beDone = true;`
  - Log `[BE] Signal %s | SL moved to %.2f (trigger=%.2f)`.

- [ ] **Step 2: Implement `CheckDynamicPartialTP()`**
  If profit >= `InpPartialR * g_initialR` and `!g_partialDone`:
  - Determine close percentage based on `g_signalConf`:
    - `>= 90.0`: close 20% of open positions (at least 1 position)
    - `75.0 - 89.9`: close 40% of open positions
    - `< 75.0`: close 60% of open positions
  - Execute partial closes via `TRADE_ACTION_DEAL`.
  - Set `g_partialDone = true;`
  - Log `[PARTIAL_TP] Signal %s | conf=%.1f%% -> closed %d/%d positions`.

- [ ] **Step 3: Commit Adaptive BE & Dynamic Partial TP**
  `git add mt5/AurumAI_Executor.mq5 && git commit -m "feat(ea): implement adaptive break even and confidence-based partial TP"`

---

### Task 3: Implement Tiered ATR Trailing Stop

**Files:**
- Modify: `mt5/AurumAI_Executor.mq5:200-280`

- [ ] **Step 1: Implement `CheckTieredTrailingStop()`**
  Calculate current profit in R: `rProfit = (currentProfit / g_initialR)`.
  If `rProfit < InpTrailingStartR` (2.0R): return.
  Determine ATR multiplier:
  - If `rProfit >= 4.0`: multiplier = `InpTrailingATR4R` (1.0)
  - Else if `rProfit >= 3.0`: multiplier = `InpTrailingATR3R` (1.5)
  - Else: multiplier = `InpTrailingATR2R` (2.0)
  
  Calculate candidate SL:
  - For BUY: `newSL = bid - (GetATR(PERIOD_M5) * multiplier)`
  - For SELL: `newSL = ask + (GetATR(PERIOD_M5) * multiplier)`

  Apply only if `newSL` improves existing SL:
  - For BUY: `if(newSL > currentSL + (2 * _Point)) modify SL to newSL;`
  - For SELL: `if(newSL < currentSL - (2 * _Point)) modify SL to newSL;`
  - Log `[TRAILING-%dR] Signal %s | SL moved to %.2f (gap=%.2f)`.

- [ ] **Step 2: Commit Tiered ATR Trailing Stop**
  `git add mt5/AurumAI_Executor.mq5 && git commit -m "feat(ea): implement tiered ATR trailing stop"`

---

### Task 4: Implement Dynamic Time Stop & Daily Risk Guard

**Files:**
- Modify: `mt5/AurumAI_Executor.mq5:150-350`

- [ ] **Step 1: Implement `CheckDynamicTimeStop()`**
  In `OnTimer()` or position management:
  If positions exist and `g_signalOpenTime > 0`:
  - `int elapsedMins = (int)((TimeCurrent() - g_signalOpenTime) / 60);`
  - Determine threshold:
    - `atr < InpTSAtrSmall` (1.5) -> `maxMins = InpTSMinsSmall` (20)
    - `atr > InpTSAtrLarge` (5.0) -> `maxMins = InpTSMinsLarge` (45)
    - Else -> `maxMins = InpTSMinsNormal` (30)
  - If `elapsedMins >= maxMins` AND `currentProfit < (InpTimeStopMinR * g_initialR)`:
    - `CloseAllPositions("Time Stop triggered (" + IntegerToString(elapsedMins) + "m)");`
    - Log `[TIME_STOP] Signal %s closed after %dm (profit %.2f < threshold)`.

- [ ] **Step 2: Implement `CheckDailyRiskGuard()`**
  - Track day change:
    ```mql5
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    if(dt.day != g_currentDay)
    {
       g_currentDay = dt.day;
       g_dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
       g_dailyGuardBlocked = false;
    }
    ```
  - Calculate daily loss:
    `double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);`
    `double dailyLossPct = (g_dailyStartBalance - currentEquity) / g_dailyStartBalance * 100.0;`
    `if(dailyLossPct >= InpDailyMaxLossPct) { g_dailyGuardBlocked = true; }`
  - In signal entry check: if `g_dailyGuardBlocked`, skip opening new positions.

- [ ] **Step 3: Commit Dynamic Time Stop & Daily Risk Guard**
  `git add mt5/AurumAI_Executor.mq5 && git commit -m "feat(ea): implement dynamic time stop and daily risk guard"`

---

### Task 5: Refactor Execution Pipeline into `OnTick()` and `OnTimer()`

**Files:**
- Modify: `mt5/AurumAI_Executor.mq5:350-469`

- [ ] **Step 1: Wire `OnTick()` for High-Frequency Exit & Risk Management**
  ```mql5
  void OnTick()
  {
     if(!g_ready) return;
     if(CountPositions() > 0)
     {
        CheckAdaptiveBreakEven();
        CheckDynamicPartialTP();
        CheckTieredTrailingStop();
     }
  }
  ```

- [ ] **Step 2: Wire `OnTimer()` for Polling & Periodic Checks**
  ```mql5
  void OnTimer()
  {
     if(!g_ready) return;
     CheckDailyRiskGuard();
     if(CountPositions() > 0)
     {
        CheckDynamicTimeStop();
     }
     PollBackendSignals();
  }
  ```

- [ ] **Step 3: Update `PollBackendSignals()` with `g_signalOpenTime`, `g_initialR`, and `g_signalConf` capture**
  When orders are executed:
  - `g_signalOpenTime = TimeCurrent();`
  - `g_initialR = MathAbs(executedPrice - sl);`
  - `g_signalConf = conf;`
  - `g_beDone = false;`
  - `g_partialDone = false;`

- [ ] **Step 4: Commit Execution Pipeline refactoring**
  `git add mt5/AurumAI_Executor.mq5 && git commit -m "refactor(ea): separate OnTick high-frequency exit logic from OnTimer REST polling"`

---

### Task 6: Compile, Deploy, and Verify via GitHub Actions & Live MT5

**Files:**
- Modify: `SPRINT_TRACKER.md`
- Test: `.github/workflows/compile_ea.yml`

- [ ] **Step 1: Push changes to GitHub origin main to trigger Windows CI/CD compile**
  `git push origin main`

- [ ] **Step 2: Verify GitHub Actions compile job status**
  Confirm compile output has 0 errors and 0 warnings, generating `AurumAI_Executor.ex5`.

- [ ] **Step 3: Update MT5 on VPS and verify live logs**
  Verify live EA startup log in MT5 Experts tab:
  `[Aurum AI] v4.10 (Sprint 1) Started`
  `[Adaptive BE] [Dynamic Partial TP] [Tiered Trailing] [Daily Guard] ACTIVE`

- [ ] **Step 4: Update `SPRINT_TRACKER.md`**
  Update Sprint Tracker with Sprint 1 completion status.

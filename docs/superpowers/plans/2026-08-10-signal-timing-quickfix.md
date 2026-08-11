# Signal Timing & Forced Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghilangkan delay 90 detik saat pergantian candle (memperbaiki bug agregasi M1 ke M5 dan menambahkan eksekusi timer presisi `:00` dengan Stale Data Guard).

**Architecture:** M5, M15, dan H1 candle builder akan menerima `tick` secara langsung (parallel) alih-alih menunggu *closed candle* dari time frame di bawahnya (yang menyebabkan delay statis 1 menit secara tersembunyi). Timer Cron akan berjalan setiap 1 detik untuk menginjeksi *boundary tick* pada saat detik `:00` untuk memicu penutupan paksa tepat waktu. `lastTickAge` akan dihitung dan disisipkan ke data agar signal engine bisa memblokir sinyal dengan data basi.

**Tech Stack:** Node.js, TypeScript

---

### Task 1: Fix Timeframe Aggregation and Add Types

**Files:**
- Modify: `backend/src/services/marketDataService.ts`

- [ ] **Step 1: Update `MultiTimeframeData` types**
Modify `MultiTimeframeData` interface to include Stale Data Guard properties.

```typescript
export type MultiTimeframeData = {
  m1: OHLCV[];
  m5: OHLCV[];
  m15: OHLCV[];
  h1: OHLCV[];
  currentM1?: OHLCV;
  currentM5: OHLCV;
  currentM15: OHLCV;
  currentH1: OHLCV;
  isStaleData?: boolean;
  lastTickAgeSec?: number;
};
```

- [ ] **Step 2: Update `MarketDataService` constructor to decouple CandleBuilders**
Remove the `processCandle` chaining in the constructor. The candles will be fed ticks directly.
```typescript
  constructor() {
    this.m1.onCandleClosed = (closedM1) => {
      if (this.onM1Closed && this.m5.currentCandle && this.m15.currentCandle && this.h1.currentCandle) {
        this.onM1Closed({
          m1: this.m1.allCandles,
          m5: this.m5.allCandles,
          m15: this.m15.allCandles,
          h1: this.h1.allCandles,
          currentM1: closedM1,
          currentM5: this.m5.currentCandle,
          currentM15: this.m15.currentCandle,
          currentH1: this.h1.currentCandle,
          isStaleData: this.lastTickAgeSec > 5,
          lastTickAgeSec: this.lastTickAgeSec
        });
      }
    };
    this.m5.onCandleClosed = (closedM5) => {
      if (this.isBootstrapped) {
        this.saveHistory();
      }
      
      if (this.onM5Closed && this.m15.currentCandle && this.h1.currentCandle) {
        this.onM5Closed({
          m1: this.m1.allCandles,
          m5: this.m5.allCandles,
          m15: this.m15.allCandles,
          h1: this.h1.allCandles,
          currentM5: closedM5,
          currentM15: this.m15.currentCandle,
          currentH1: this.h1.currentCandle,
          isStaleData: this.lastTickAgeSec > 5,
          lastTickAgeSec: this.lastTickAgeSec
        });
      }
    };
    this.m15.onCandleClosed = (c) => {}; 
  }
```

- [ ] **Step 3: Modify `ws.on('message')` to feed ticks parallel**
In `connectTwelveData` under `// Handle price events`, update the `processTick` call.
Also add class properties `public lastTickMs: number = Date.now();` and `public lastTickAgeSec: number = 0;` at the top of the class.

```typescript
          const volume = parsed.day_volume ? parsed.day_volume / 1000 : 10;
          const timestampMs = parsed.timestamp * 1000;
          
          this.lastTickMs = Date.now();
          this.processAllTicks(parsed.price, volume, timestampMs);
```

Add the helper method inside `MarketDataService`:
```typescript
  private processAllTicks(price: number, volume: number, timestamp: number, isDummy = false) {
     this.m1.processTick(price, volume, timestamp, isDummy);
     this.m5.processTick(price, volume, timestamp, isDummy);
     this.m15.processTick(price, volume, timestamp, isDummy);
     this.h1.processTick(price, volume, timestamp, isDummy);
  }
```

Update `generateFallbackCandles()` to feed all decoupled builders:
```typescript
    // Process real candles
    for (const c of savedRealCandles) {
      this.m5.processCandle(c);
      this.m15.processCandle(c);
      this.h1.processCandle(c);
      currentPrice = c.close; 
    }
```

- [ ] **Step 4: Commit (if auto_commit enabled)**
Check `.agent/config.yml` for `auto_commit` setting.
If `auto_commit: true`:
```bash
git add backend/src/services/marketDataService.ts
git commit -m "fix: decouple candle builders to eliminate 1 minute delay"
```
If `auto_commit: false`: skip commit and staging. Print: "Skipping commit (auto_commit: false)."

### Task 2: Implement Time-based Forced Close

**Files:**
- Modify: `backend/src/services/marketDataService.ts`

- [ ] **Step 1: Add Cron Timer method**
Add these methods to `MarketDataService`:
```typescript
  private cronTimer: NodeJS.Timeout | null = null;

  private startCronTimer() {
    if (this.cronTimer) clearInterval(this.cronTimer);
    
    this.cronTimer = setInterval(() => {
      if (!this.isBootstrapped) return;
      
      const now = Date.now();
      const seconds = new Date(now).getUTCSeconds();
      
      // Inject boundary tick exactly at 00 seconds
      if (seconds === 0) {
         this.lastTickAgeSec = (now - this.lastTickMs) / 1000;
         const lastPrice = this.m1.currentCandle?.close || 0;
         
         if (this.lastTickAgeSec > 5) {
             console.warn(`[MarketData] STALE DATA GUARD: last tick was ${this.lastTickAgeSec.toFixed(1)}s ago! Marking data as STALE.`);
         } else if (this.lastTickAgeSec > 2) {
             console.warn(`[MarketData] WARNING: last tick was ${this.lastTickAgeSec.toFixed(1)}s ago.`);
         }
         
         // Inject a dummy tick with the current clock time to force close exactly on schedule
         this.processAllTicks(lastPrice, 0, now, true);
      }
    }, 1000);
  }
```

- [ ] **Step 2: Start the timer**
Call `this.startCronTimer()` at the end of the `start()` method.
```typescript
  public async start() {
    if (config.TWELVEDATA_API_KEY) {
      this.connectTwelveData();
    } else {
      // ...
    }
    this.startCronTimer();
  }
```

- [ ] **Step 3: Commit (if auto_commit enabled)**
Check `.agent/config.yml` for `auto_commit` setting.
If `auto_commit: true`:
```bash
git add backend/src/services/marketDataService.ts
git commit -m "feat: implement precise time-based forced close via cron timer"
```
If `auto_commit: false`: skip commit and staging. Print: "Skipping commit (auto_commit: false)."

### Task 3: Enforce Stale Data Guard in Main Engine

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Check `isStaleData` in M1 Event**
In `marketData.setOnM1Closed((data) => {`, add the Stale Data Guard check before creating the burst signal.
```typescript
  if (evaluation.direction !== 'WAIT' && evaluation.totalScore >= 65 && !isGuardActive) {
    if (data.isStaleData) {
       console.log(`[StaleDataGuard] ⛔ Sinyal ${evaluation.direction} diblokir! Data basi (tick terakhir ${data.lastTickAgeSec?.toFixed(1)}s lalu).`);
       return;
    }
    // 4. Create 5-Layer Burst Signal Payload with TTL (30s)
```

- [ ] **Step 2: Check `isStaleData` in M5 Event**
In `marketData.setOnM5Closed((data) => {`, add the check before inserting/sending the signal.
```typescript
        if (shouldSend && signal.type !== 'WAIT') {
          if (data.isStaleData) {
             console.log(`[StaleDataGuard] ⛔ Sinyal ${signal.type} diblokir! Data basi (tick terakhir ${data.lastTickAgeSec?.toFixed(1)}s lalu).`);
             continue;
          }
```

- [ ] **Step 3: Commit (if auto_commit enabled)**
Check `.agent/config.yml` for `auto_commit` setting.
If `auto_commit: true`:
```bash
git add backend/src/index.ts
git commit -m "feat: enforce stale data guard to prevent trading on lagged data"
```
If `auto_commit: false`: skip commit and staging. Print: "Skipping commit (auto_commit: false)."

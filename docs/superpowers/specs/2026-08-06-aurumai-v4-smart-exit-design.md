# AurumAI EA v4.1 — Trade Execution Framework

**Date:** 2026-08-06 (Revised)
**Author:** Brainstorming Session
**Scope:** Pure MQL5 EA upgrade (no backend changes required)
**File:** `mt5/AurumAI_Executor.mq5`
**Rating:** Arsitektur ⭐⭐⭐⭐⭐ | Risk Management ⭐⭐⭐⭐⭐ | Scalping Logic ⭐⭐⭐⭐½ | Maintainability ⭐⭐⭐⭐⭐

---

## 1. Background

Robot `v3.2` memiliki masalah:
- Posisi sering floating profit lalu kena SL — logika exit statis (hanya TP atau SL)
- Tidak ada adaptive exit berdasarkan kondisi market saat itu
- Tidak ada kemampuan mengambil profit dari retracement

**Goal:** Bangun **Trade Execution Framework** berbasis data, bukan aturan kaku. Implementasi bertahap (3 sprint) agar setiap kelompok fitur bisa divalidasi dengan backtest sebelum lanjut.

---

## 2. Arsitektur Final v4.1

```
Backend AI Signal (BUY/SELL)
          │
          ▼
   Signal Engine (existing: 3 Market + 2 Limit)
          │
          ▼
   ┌──────────────────────────────────────────────┐
   │           OnTick() — HIGH FREQUENCY          │
   │  1. Risk Guard (daily loss, volatility)      │
   │  2. Smart Exit Engine                        │
   │     ├── Adaptive Break Even                  │
   │     ├── Dynamic Partial TP (confidence-based)│
   │     ├── Tiered ATR Trailing                  │
   │     ├── Momentum Exit (CHoCH + Volume/ADX)   │
   │     └── Opportunity Cost Engine ⭐            │
   │  3. Micro Scalping Engine (Sprint 3)         │
   └──────────────────────────────────────────────┘
          │
   ┌──────────────────────────────────────────────┐
   │           OnTimer() — LOW FREQUENCY (1s)     │
   │  1. Fetch backend signal + Confidence check  │
   │  2. Dynamic Time Stop check                  │
   │  3. Cooldown Manager check                   │
   │  4. Daily Risk Guard check                   │
   │  5. Logging & cleanup                        │
   └──────────────────────────────────────────────┘
```

**Reasoning:** Exit management berjalan di `OnTick` (tinggi frekuensi, XAUUSD bisa bergerak $5 dalam 1 detik). Polling backend, time-based checks, dan housekeeping di `OnTimer`.

---

## 3. Implementasi Bertahap

### ✅ Sprint 1 — Core Protection (WAJIB, implement sekarang)
Target: **kurangi trade yang balik dari profit ke SL**

| Fitur | Deskripsi |
|---|---|
| Adaptive Break Even | Trigger = MAX(1R, ATR×1.2) |
| Dynamic Partial TP | Berdasarkan confidence AI |
| Tiered ATR Trailing | Makin profit, makin rapat |
| Dynamic Time Stop | Berdasarkan ATR volatility |
| Daily Risk Guard | Stop trading jika daily loss ≥ X% |
| Logger lengkap | Setiap aksi tercatat di Experts |

### 🔜 Sprint 2 — Exit Quality
Target: **tingkatkan kualitas exit**

| Fitur | Deskripsi |
|---|---|
| Momentum Exit | CHoCH + Volume/ADX confirmation |
| Opportunity Cost Engine | Close early jika kondisi lebih baik |
| Session & Volatility Filter | London/NY/Overlap, pause saat news |
| Trade Cooldown Manager | Pause setelah beruntun loss |
| Volatility Explosion Guard | Pause saat ATR atau spread meledak |

### 🔮 Sprint 3 — Revenue Enhancement
Target: **tambah profit dari retracement** (setelah Sprint 1 & 2 validated)

| Fitur | Deskripsi |
|---|---|
| Micro Scalping Engine | Counter-scalp saat posisi utama BE |
| Adaptive Counter Logic | Guard 5 wajib + min 2 dari 4 opsional |

---

## 4. Sprint 1: Smart Exit Engine (Detail)

### 4.1 Adaptive Break Even
- **Formula:** `trigger = MAX(1R, ATR_14(M5) × 1.2)`
- **Aksi:** SL semua posisi sinyal ini → `open_price + spread`
- **Reasoning:** Jika SL=10$ tapi ATR=2$, BE terlalu lambat. Jika SL=1$ tapi ATR=3$, BE terlalu cepat. Formula ini adaptif terhadap volatility aktual.

### 4.2 Dynamic Partial TP (Confidence-based)
Saat profit ≥ `InpPartialR` (default 1.5R), close sebagian posisi berdasarkan confidence AI terakhir:

| Confidence Backend | % Posisi yang di-Close |
|---|---|
| ≥ 90% | 20% (AI masih sangat yakin, biarkan jalan) |
| 75–89% | 40% (Yakin tapi tidak pasti) |
| < 75% | 60% (AI kurang yakin, amankan lebih banyak) |

### 4.3 Tiered ATR Trailing Stop
Aktif setelah profit ≥ 2R. Jarak trailing makin rapat seiring profit naik:

| Profit Level | Jarak Trailing |
|---|---|
| ≥ 2R | ATR_14 × 2.0 (longgar, kasih napas) |
| ≥ 3R | ATR_14 × 1.5 |
| ≥ 4R | ATR_14 × 1.0 (rapat, lock profit maksimal) |

SL hanya boleh bergerak ke arah yang menguntungkan (naik untuk BUY, turun untuk SELL).

### 4.4 Dynamic Time Stop
Bukan waktu tetap, tapi adaptif berdasarkan volatility ATR saat entry:

| ATR M5 saat Entry | Time Stop |
|---|---|
| Kecil (< 1.5 pips) | 20 menit (market flat, keluar cepat) |
| Normal (1.5–5 pips) | 30 menit |
| Tinggi (> 5 pips) | 45 menit (market trending, beri kesempatan) |

**Guard:** Time Stop hanya trigger jika profit < `InpTimeStopMinR` (default 0.5R). Jika sudah profit cukup, biarkan trailing yang handle.

### 4.5 Daily Risk Guard
- **Trigger:** Total realized loss hari ini (UTC) ≥ `InpDailyMaxLossPct` (default: 3%)
- **Aksi:** EA stop membuka posisi baru hari ini. Posisi yang sudah open tetap dikelola Smart Exit.
- **Reset:** Setiap hari baru (00:00 UTC)

### 4.6 Logger
Setiap aksi menghasilkan entry log di Experts tab:
```
[BE] Signal XAU-xxx | SL moved to 3350.00 (trigger: MAX(1R=$8, ATR×1.2=$6) = $8)
[PARTIAL_TP] Signal XAU-xxx | conf=82% → close 40% (3/7 pos) at profit $14.2
[TRAILING-2R] Signal XAU-xxx | SL now 3358.00 (ATR×2.0)
[TRAILING-4R] Signal XAU-xxx | SL now 3362.50 (ATR×1.0)
[TIME_STOP] Signal XAU-xxx | 31min, ATR=normal, profit $0.3 < 0.5R → close
[DAILY_GUARD] Daily loss 3.1% reached — no new positions today
```

---

## 5. Sprint 2: Exit Quality (Detail)

### 5.1 Momentum Exit
- **Trigger:** CHoCH bearish di M5 (swing low ditembus) **DAN** salah satu dari:
  - Volume candle terakhir < rata-rata volume 10 candle × 0.7 (volume melemah)
  - ADX_14 turun ≥ 3 poin dalam 3 candle terakhir
- **Guard:** Hanya aktif jika posisi sudah minimal Break Even
- **Aksi:** Close semua posisi sinyal ini

### 5.2 Opportunity Cost Engine ⭐
Engine baru yang mengevaluasi apakah **lebih baik close posisi sekarang dan tunggu signal baru**.

**Trigger:** semua kondisi berikut terpenuhi:
- Posisi sedang profit (any amount)
- Backend mengembalikan confidence baru yang **menurun > 15 poin** dari confidence signal awal
- ATR menurun (momentum melambat)
- Ada resistance/swing high M5 dalam jarak 0.5R ke depan

**Aksi:** Close semua posisi sinyal ini dan log:
```
[OPP_COST] Signal XAU-xxx | conf dropped 87→64, resistance near, exit early at +$9.2
```

### 5.3 Session & Volatility Filter
Aktif untuk semua operasi (entry baru dan counter scalping):

| Session | Status | Note |
|---|---|---|
| Asia (00:00–07:00 GMT) | OFF default | Bisa diaktifkan via input |
| London (07:00–12:00 GMT) | ON | Normal sizing |
| London-NY Overlap (12:00–16:00 GMT) | HIGH PRIORITY | Bisa naikkan lot 20–30% (opsional, via input) |
| New York (16:00–22:00 GMT) | ON | Normal sizing |
| Roll Over (22:00–00:00 GMT) | OFF | Likuiditas rendah |

### 5.4 Volatility Explosion Guard
- **Trigger ATR:** ATR saat ini > ATR rata-rata 20 candle × 3.0 (300% spike)
- **Trigger Spread:** Spread > `InpMaxSpread × 5`
- **Aksi:** Pause semua entry baru selama `InpVolatilityPauseMin` (default: 5 menit)
- **Note:** Posisi yang sudah open tetap dikelola

### 5.5 Trade Cooldown Manager
- **Trigger:** Berturut-turut mengalami N kali loss (default: `InpCooldownAfterLoss = 3`)
- **Aksi:** Pause entry baru selama `InpCooldownMinutes` (default: 30 menit)
- **Reset:** Reset counter setelah ada 1 trade profit

---

## 6. Sprint 3: Micro Scalping Engine (Detail)

### 6.1 Guard System (Berlapis)

**Wajib SEMUA terpenuhi:**
| Guard | Detail |
|---|---|
| Break Even | SL posisi utama ≥ open price |
| H1 Trend | EMA20 > EMA50 di H1 (untuk BUY), sebaliknya untuk SELL |
| ATR Range | `InpCounterMinATR` < ATR_14(M5) < `InpCounterMaxATR` |
| Spread | Spread < `InpMaxSpread` |
| Cooldown | ≥ 5 candle M5 (25 menit) sejak counter terakhir |

**Minimal 2 dari 4 berikut:**
| Guard | Detail |
|---|---|
| Candle Reversal | Bearish Engulfing atau Pin Bar di M5 |
| CHoCH/BOS | Swing low M5 sebelumnya ditembus |
| EMA20 Cross | Harga tutup di bawah EMA20 M5 |
| Liquidity Sweep | Equal High/Low tersapu sebelum reversal |

### 6.2 Entry & Sizing Counter

Lot sizing tiered berdasarkan urutan counter hari ini:
| Counter ke- | Lot |
|---|---|
| 1st | main_lot × 0.25 |
| 2nd | main_lot × 0.15 |
| 3rd | main_lot × 0.10 |

**TP counter:** `MIN(ATR_14(M5) × 0.8, jarak ke resistance terdekat)`
**SL counter:** `MAX(ATR_14(M5) × 0.5, high candle reversal + spread)`

**Limits:**
- Max counter posisi aktif: `InpMaxCounter` (default: 2)
- Max counter per hari: `InpMaxDailyCounter` (default: 8)
- Tidak ada revenge trade — jika counter kena SL, tunggu cooldown

---

## 7. New Input Parameters

```mql5
//=== Sprint 1: Smart Exit ===
input double InpBEMultiplier      = 1.2;  // BE trigger = MAX(1R, ATR×multiplier)
input double InpPartialR          = 1.5;  // Partial TP trigger (× R)
input double InpTrailingStartR    = 2.0;  // Start trailing (× R)
// ATR Trailing multipliers per level
input double InpTrailingATR2R     = 2.0;  // Trailing jarak saat 2R
input double InpTrailingATR3R     = 1.5;  // Trailing jarak saat 3R
input double InpTrailingATR4R     = 1.0;  // Trailing jarak saat 4R
// Dynamic Time Stop
input double InpTimeStopMinR      = 0.5;  // Min profit R untuk hindari Time Stop
input double InpTSAtrSmall        = 1.5;  // ATR threshold: kecil (pips)
input double InpTSAtrLarge        = 5.0;  // ATR threshold: besar (pips)
input int    InpTSMinsSmall       = 20;   // Time Stop jika ATR kecil
input int    InpTSMinsNormal      = 30;   // Time Stop jika ATR normal
input int    InpTSMinsLarge       = 45;   // Time Stop jika ATR besar
// Daily Guard
input double InpDailyMaxLossPct   = 3.0;  // Max daily loss % sebelum stop

//=== Sprint 2: Exit Quality ===
input bool   InpEnableMomentumExit = true; // Aktifkan Momentum Exit
input bool   InpEnableOppCost      = true; // Aktifkan Opportunity Cost Engine
input double InpOppCostConfDrop    = 15.0; // Min confidence drop untuk trigger
input bool   InpEnableSessionFilter= true; // Aktifkan session filter
input bool   InpEnableAsiaSession  = false;// Izinkan trading di Asia session
input bool   InpEnableOverlapBoost = false;// Naikkan lot saat London-NY overlap
input double InpOverlapBoostPct    = 20.0; // % kenaikan lot saat overlap
input double InpVolExplosionMul    = 3.0;  // ATR spike multiplier untuk pause
input int    InpVolatilityPauseMins= 5;    // Pause duration saat volatility explosion
input int    InpCooldownAfterLoss  = 3;    // Berturut-turut loss sebelum cooldown
input int    InpCooldownMinutes    = 30;   // Durasi cooldown (menit)

//=== Sprint 3: Micro Scalping ===
input bool   InpEnableCounter      = false;// Aktifkan Micro Scalping (OFF by default sampai Sprint 3)
input int    InpMaxCounter         = 2;    // Max counter posisi aktif
input int    InpMaxDailyCounter    = 8;    // Max counter per hari
input int    InpCounterCooldownBar = 5;    // Cooldown (candle M5)
input double InpCounterMinATR      = 1.0;  // Min ATR untuk counter (pips)
input double InpCounterMaxATR      = 15.0; // Max ATR untuk counter (pips)
```

---

## 8. Verification Plan per Sprint

### Sprint 1 Verification (Demo, minimal 50 trade)
- [ ] SL geser ke BEP setelah trigger MAX(1R, ATR×1.2) terpenuhi
- [ ] Partial TP: confidence 90% → close 20%, confidence 80% → close 40%, confidence 70% → close 60%
- [ ] Trailing gap berkurang saat profit naik (2R→ATR×2, 3R→ATR×1.5, 4R→ATR×1)
- [ ] Time Stop: 20min saat ATR kecil, 30min normal, 45min ATR besar
- [ ] Daily Guard: stop entry baru setelah loss 3%
- [ ] Semua aksi ada log entry di Experts tab

### Sprint 2 Verification (Demo, minimal 50 trade tambahan)
- [ ] Momentum Exit hanya trigger jika CHoCH + volume/ADX confirmation
- [ ] Opportunity Cost Engine close lebih awal saat confidence turun >15 poin
- [ ] Tidak ada entry counter saat session Roll Over (22:00–00:00 GMT)
- [ ] Pause 5 menit saat ATR spike 300%
- [ ] Cooldown aktif setelah 3x loss berturut-turut

### Sprint 3 Verification (Demo, minimal 100 trade counter)
- [ ] Counter tidak terbuka saat posisi utama masih floating loss
- [ ] Counter tidak terbuka saat H1 trend berlawanan
- [ ] Guard: minimal 2 dari 4 opsional harus terpenuhi
- [ ] Lot counter: 25% → 15% → 10% sesuai urutan
- [ ] Max 2 counter aktif, max 8 per hari

---

## 9. Metrics untuk Evaluasi antar Sprint

Setelah setiap sprint, compare metrics vs baseline (v3.2):

| Metric | Target |
|---|---|
| Win Rate | ≥ 55% |
| Profit Factor | ≥ 1.5 |
| Expectancy per Trade | Positif |
| Max Drawdown | ≤ 10% |
| Average Holding Time | 8–30 menit |
| Trades yang balik dari profit→SL | Turun >50% vs v3.2 |

---

## 10. Out of Scope

- Tidak ada perubahan pada backend/API
- Tidak ada perubahan pada logic entry utama (tetap 3 Market + 2 Limit)
- Multi-pair support
- Backtest engine (gunakan MT5 Strategy Tester)

# AurumAI EA v4.0 — Smart Exit + Micro Scalping Engine

**Date:** 2026-08-06  
**Author:** Brainstorming Session  
**Scope:** Pure MQL5 EA upgrade (no backend changes required)  
**File:** `mt5/AurumAI_Executor.mq5`

---

## 1. Background

Robot saat ini (`v3.2`) memiliki masalah:
- Posisi sering sempat floating profit tapi akhirnya kena SL karena tidak ada logika exit yang adaptif
- EA hanya tahu dua kondisi: **TP kena** atau **SL kena** — tidak ada middle-ground
- Tidak ada kemampuan mengambil profit dari retracement selama posisi utama masih berjalan

Tujuan upgrade ini: **lindungi profit lebih awal, dan tambah income dari retracement via Micro Scalping Engine**

---

## 2. Arsitektur

```
Backend AI Signal (BUY/SELL)
          │
          ▼
   EA Entry Engine (existing)
   3 Market + 2 Limit Pullback layers
          │
          ▼
   ┌──────────────────────────────────┐
   │       OnTick() — HIGH FREQ       │
   │  1. Risk Guard (SL check)        │
   │  2. Smart Exit Engine            │
   │     ├── Break Even               │
   │     ├── Partial TP               │
   │     ├── ATR Trailing Stop        │
   │     └── Momentum Exit (CHoCH)    │
   │  3. Micro Scalping Engine        │
   │     └── (guarded, see §4)        │
   └──────────────────────────────────┘
          │
   ┌──────────────────────────────────┐
   │       OnTimer() — LOW FREQ (1s)  │
   │  1. Fetch backend signal         │
   │  2. Time Stop check              │
   │  3. AI Confidence drop check     │
   │  4. News/Session guard check     │
   │  5. Logging & cleanup            │
   └──────────────────────────────────┘
```

**Reasoning:** Exit management (breakeven, trailing, counter) dijalankan di `OnTick` agar tidak telat saat XAUUSD bergerak cepat. Polling backend dan housekeeping tetap di `OnTimer`.

---

## 3. Smart Exit Engine

Dievaluasi tiap tick, **berurutan** (prioritas dari atas ke bawah):

### 3.1 Break Even
- **Trigger:** Profit per posisi ≥ +1R (1R = jarak SL asli)
- **Aksi:** Modify SL semua posisi sinyal ini menjadi `open_price + spread`
- **Note:** Tidak ada posisi yang bisa rugi lagi setelah ini

### 3.2 Partial TP (40%)
- **Trigger:** Total equity gain dari sinyal ini ≥ +1.5R
- **Aksi:** Close 40% dari total posisi yang ada (pilih posisi dengan profit terbesar)
- **Note:** 60% sisanya dibiarkan berjalan

### 3.3 ATR Trailing Stop
- **Trigger:** Total equity gain dari sinyal ini ≥ +2R
- **Aksi:** Setiap tick, SL digeser ke `current_price - (ATR_14 × 1.5)` (untuk BUY)
- **Note:** SL hanya boleh naik, tidak boleh turun

### 3.4 Momentum Exit (Structure-based)
- **Trigger (untuk BUY):** Terdeteksi CHoCH bearish di M5 (swing low sebelumnya ditembus)
- **Trigger (untuk SELL):** Terdeteksi CHoCH bullish di M5
- **Aksi:** Close semua posisi sinyal ini
- **Guard:** Hanya aktif jika posisi sudah minimal Break Even

### 3.5 Time Stop
- **Trigger:** Posisi sudah terbuka > `InpTimeStopMinutes` (default: 25 menit) DAN profit < `InpTimeStopMinProfit` (default: 0.5R)
- **Aksi:** Close semua posisi sinyal ini
- **Note:** Berjalan di `OnTimer` bukan `OnTick` (tidak butuh resolusi tinggi)

### 3.6 Confidence Drop Exit
- **Trigger:** Backend `/api/mt5/signals/latest` mengembalikan signal baru dengan confidence yang berbeda arah, atau status `NO_SIGNAL` sementara posisi masih floating negatif
- **Aksi:** Close semua posisi jika floating loss > 0.5R dan server sudah tidak support signal ini
- **Note:** Berjalan di `OnTimer`

---

## 4. Micro Scalping Engine

Mesin ini **hanya aktif** setelah **SEMUA** guard berikut terpenuhi:

### Guard List (semua harus ✅)

| # | Guard | Detail |
|---|---|---|
| 1 | Main position sudah Break Even | SL posisi utama sudah di entry price atau lebih tinggi |
| 2 | Main position masih floating profit | Equity gain dari sinyal ini > 0 |
| 3 | H1 Trend masih searah | EMA20 vs EMA50 di H1 masih konfirmasi arah sinyal utama |
| 4 | Candle Reversal terkonfirmasi | Bearish Engulfing atau Pin Bar di M5 (untuk counter-SELL saat posisi BUY) |
| 5 | CHoCH atau BOS kecil | Swing low M5 sebelumnya ditembus |
| 6 | EMA20 cross | Harga menutup di bawah EMA20 M5 (untuk counter-SELL) |
| 7 | ATR dalam rentang | `InpCounterMinATR` < ATR_14(M5) < `InpCounterMaxATR` (cegah flat/news) |
| 8 | Spread normal | Spread < `InpMaxSpread` |
| 9 | Session aktif | Hanya London (07:00–16:00 GMT) atau New York (13:00–22:00 GMT) |
| 10 | Cooldown | Minimal 5 candle M5 (25 menit) sejak counter terakhir |
| 11 | Max counter aktif | Counter posisi terbuka saat ini < `InpMaxCounter` (default: 2) |
| 12 | Max daily counter | Total counter hari ini < `InpMaxDailyCounter` (default: 8) |
| 13 | Liquidity sweep (opsional) | Idealnya terdeteksi sweep Equal High/Low sebelum reversal |

### Entry Counter

- **Lot:** `main_lot × InpCounterLotRatio` (default: 0.25 = 25% dari lot utama), dibulatkan ke 0.01
- **TP counter:** `MIN(ATR_14 × 0.8, jarak ke swing high/resistance terdekat)`
- **SL counter:** `MAX(ATR_14 × 0.5, high candle reversal)` (untuk counter-SELL)

### Setelah Counter Close

- Reset cooldown counter
- Posisi utama tetap berjalan — tidak dipengaruhi sama sekali
- Jika counter kena SL: catat dan lanjut, **tidak ada revenge trade**

---

## 5. New Input Parameters

```mql5
//--- Smart Exit
input double InpBreakevenR     = 1.0;   // Break Even setelah profit X*R
input double InpPartialR       = 1.5;   // Partial TP setelah profit X*R
input double InpPartialPct     = 40.0;  // % posisi yang di-close saat Partial TP
input double InpTrailingR      = 2.0;   // Mulai Trailing setelah profit X*R
input double InpTrailingATRMul = 1.5;   // Jarak trailing = ATR × multiplier
input int    InpTimeStopMins   = 25;    // Time Stop (menit)
input double InpTimeStopMinR   = 0.5;   // Min profit R untuk hindari Time Stop

//--- Micro Scalping
input bool   InpEnableCounter      = true;  // Aktifkan Micro Scalping
input double InpCounterLotRatio    = 0.25;  // Lot counter = main lot × ratio
input int    InpMaxCounter         = 2;     // Max counter posisi aktif
input int    InpMaxDailyCounter    = 8;     // Max counter per hari
input int    InpCounterCooldownBar = 5;     // Cooldown (candle M5)
input double InpCounterMinATR      = 1.0;   // Min ATR untuk counter (pips)
input double InpCounterMaxATR      = 15.0;  // Max ATR untuk counter (pips)
```

---

## 6. Priority Order (OnTick Execution)

```
1. Risk Guard — ada posisi? hitung R saat ini
2. Break Even check
3. Partial TP check
4. ATR Trailing update
5. Momentum Exit (CHoCH) check
6. Micro Scalping guard evaluation
7. Micro Scalping entry (jika semua guard ✅)
```

Jika step 4 (Momentum Exit) di-trigger, Micro Scalping **tidak dieksekusi** di tick yang sama.

---

## 7. Verification Plan

### Demo Testing (sebelum live)
- Run di XAUUSD M5 demo account
- Minimal 5 sinyal BUY/SELL diobservasi
- Verifikasi: SL geser ke BEP setelah profit 1R
- Verifikasi: Partial close 40% setelah profit 1.5R
- Verifikasi: Counter tidak terbuka saat posisi utama masih rugi
- Verifikasi: Counter tidak terbuka saat H1 trend berlawanan
- Verifikasi: Time Stop bekerja setelah 25 menit

### Log Verification
Setiap aksi Smart Exit dan Micro Scalping harus menghasilkan log di Experts tab:
```
[BREAKEVENR] Signal XAU-xxx | SL moved to 3350.00
[PARTIAL_TP] Signal XAU-xxx | Closed 2/5 positions at profit $12.4
[TRAILING] Signal XAU-xxx | SL now 3358.00
[TIME_STOP] Signal XAU-xxx | 26min, profit $0.8 < threshold
[COUNTER] BUY→counter-SELL | lot=0.01 TP=3356.50 SL=3358.20
[COUNTER_GUARD_FAIL] H1 trend bearish — counter blocked
```

---

## 8. Out of Scope (untuk versi ini)

- Tidak ada perubahan pada backend/API
- Tidak ada perubahan pada logic entry utama (tetap 3 Market + 2 Limit)
- Liquidity Sweep filter (Equal High/Low detection) — nice to have, bukan blocker
- Multi-pair support

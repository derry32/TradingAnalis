# Signal Quality Fix Design
**Date**: 2026-09-14  
**Status**: DRAFT — Awaiting approval

## Latar Belakang

Analisis 367 sinyal September 2026 menunjukkan:

| Metrik | Nilai |
|--------|-------|
| Win Rate Keseluruhan | 48% (143 TP / 297 settled) |
| Net Profit Semua Layer | **-8.77 juta** |
| Sinyal Countertrend | **125/367 = 34%** |
| SNIPER Win Rate | **4% (1 TP / 24 trades)** |
| Avg Confidence saat Rugi | 72% |

Kesimpulan: **Masalah ada di kualitas sinyal AI (signalGenerator.ts)**, bukan di eksekusi robot MT5. Robot mengeksekusi apa yang dikirim backend — masalahnya backend terlalu banyak nembak sinyal yang harusnya tidak lewat.

---

## Root Cause #1 — Countertrend lolos threshold 60

**File**: `signalGenerator.ts` line 1991-2014  
**Problem**: Threshold minimum cuma 60, tidak membedakan between sinyal WITH H1 atau AGAINST H1. Sinyal BUY di kondisi `BEARISH Trend / HH_HL` bisa dapat skor 60+ dari komponen lain (FVG, RSI, BOS) meskipun H1 berlawanan.  
**Evidence**: 125 dari 367 sinyal adalah countertrend — sebagian besar HIT_SL.

## Root Cause #2 — SNIPER pakai threshold sama dengan SCALPER

**File**: `signalGenerator.ts` line 1991-2014  
**Problem**: `activeStrategy === 'SNIPER'` dan `'HYPER_SCALPER'` keduanya pakai `baseThreshold = 60`. SNIPER adalah trade jangka lebih panjang (hold 4 jam), butuh setup jauh lebih solid.  
**Evidence**: SNIPER WR = 4%. 15 dari 24 trade EXPIRED (tidak pernah dieksekusi MT5 = sinyal palsu), 8 HIT_SL.

## Root Cause #3 — Threshold global terlalu rendah

**File**: `signalGenerator.ts` line 1991-1997  
**Problem**: `INITIAL_ENTRY_THRESHOLD` di config default ke 60. Dari data, banyak sinyal skor 60-69 yang hasilnya negatif. Naikan ke 70 untuk HYPER_SCALPER.  
**Evidence**: Avg confidence pada losing trades = 72% → artinya banyak yang lolos di 60-75 range tapi tetap kalah.

---

## Perubahan yang Diusulkan

### Fix 1 — Hard H1 Countertrend Block
**File**: `backend/src/services/signalGenerator.ts`  
**Section**: Step 8 (THRESHOLD), sebelum loop `BUILD CANDIDATES` (sekitar line 2026)

Tambahkan gate baru:
```
Jika (trendH1 === 'BEARISH' && direction === 'BUY') ||
    (trendH1 === 'BULLISH' && direction === 'SELL'):
  → Hanya lewat jika score >= 85 (reversal setup kuat)
  → Jika score < 85 → return WAIT dengan reason countertrend
```

Ini mengeliminasi ~125 sinyal countertrend berkualitas rendah per bulan.

### Fix 2 — SNIPER Strict Threshold + Dual Alignment
**File**: `backend/src/services/signalGenerator.ts`  
**Section**: Step 8 (THRESHOLD)

```
Jika activeStrategy === 'SNIPER':
  effectiveThreshold = 75  (bukan 60)
  
  // Plus: H1 + M15 harus searah
  Jika (trendH1 !== direction-aligned && trendM15 !== direction-aligned):
    → return WAIT "SNIPER butuh konfirmasi H1+M15"
```

SNIPER cuma boleh nembak kalau ada 2 timeframe besar yang selaras.

### Fix 3 — Naikan Base Threshold HYPER_SCALPER
**File**: `backend/src/services/signalGenerator.ts`  
**Section**: `baseThreshold` calculation (line ~1991)

```
Sebelum: baseThreshold = Math.max(60, configuredThreshold)
Sesudah:
  if SNIPER    → baseThreshold = Math.max(75, configuredThreshold)
  if SCALPER   → baseThreshold = Math.max(70, configuredThreshold)
```

---

## File yang Tersentuh

| File | Perubahan |
|------|-----------|
| `backend/src/services/signalGenerator.ts` | 3 gate baru (semua di `generate()` function) |

**TIDAK ada perubahan ke**:
- `confidenceEngine.ts` (Path A sudah bagus, threshold sudah 85 countertrend)
- `signalStateMachine.ts` (layer logic Path A sudah capped 2-3)
- `basketEngine.ts` (eksekusi OK, masalah bukan di sini)
- `AurumAI_Executor.mq5` (EA robot bukan sumber masalah)

---

## Estimasi Impact

Berdasarkan data September:

| | Sebelum | Estimasi Sesudah |
|---|---|---|
| Sinyal/bulan | 367 | ~200-220 (lebih selektif) |
| Countertrend | 34% | <5% |
| SNIPER fired | 24 | ~5-8 (high qual only) |
| Win Rate | 48% | Target 58-62% |

Trade-off: **Lebih sedikit sinyal, tapi kualitas jauh lebih tinggi.** Expected value positif per trade.

---

## Verification Plan

1. Deploy ke VPS
2. Monitor log 24 jam: `grep "COUNTERTREND BLOCKED\|SNIPER BLOCKED" logs`  
3. Cek `/api/history` setelah 3 hari: target WR ≥ 55%
4. Rollback mudah: hanya 1 file berubah

---

## Open Questions

Tidak ada — semua sudah jelas dari data.

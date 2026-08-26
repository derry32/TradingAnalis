# Basket Engine & Smart Exits Update (2026-08-26)

## 1. Context & Motivation
Sinyal `BasketEngine` saat ini memiliki aturan yang terlalu kaku sehingga sering menahan eksekusi Layer 2 dan Layer 3 (Micro-Grid Scalping). Selain itu, fitur pengaman `Break-Even (Smart Exits)` pada MT5 meletakkan Stop Loss tepat di harga Entry yang mengakibatkan terjadinya kerugian kecil (-500 IDR) akibat spread dan komisi broker. Terakhir, secara arsitektur, `BasketEngine` sebelumnya hanya diaktifkan untuk sinyal M1 Burst, sehingga sinyal dari M5 (baik SNIPER maupun HYPER_SCALPER) tidak mendapatkan fitur multi-layer.

## 2. Proposed Changes

### A. Break-Even Profit Offset (Smart Exits)
- **Komponen:** `AurumAI_Executor.mq5`
- **Perubahan:** Memodifikasi `CheckSmartExits()` agar ketika jarak harga mencapai trigger Break-Even (default +6.0 Pips), SL tidak dipindahkan ke `g_signalOpenPx` (Entry), melainkan ke `g_signalOpenPx ± 2.0 Pips` (disesuaikan dengan arah BUY/SELL).
- **Tujuan:** Memastikan penutupan di titik aman akan menghasilkan keuntungan bersih sebesar 2 Pips untuk menutupi komisi broker dan memberikan sisa profit kecil, menghilangkan bug minus -500 IDR.

### B. Unified Basket Engine Routing
- **Komponen:** Backend `index.ts` & `mt5Bridge.ts`
- **Perubahan:** Mengarahkan seluruh aliran sinyal (M1 Burst, M5 HYPER_SCALPER, dan M5 SNIPER) ke dalam pengawasan `BasketEngine`.
- **Tujuan:** Membuat semua sinyal yang dihasilkan oleh AI berhak mendapatkan eksekusi 3-Layer Averaging jika kondisi pasar berbalik (*pullback*).

### C. Relaxed Micro-Grid Constraints
- **Komponen:** `basketEngine.ts`
- **Perubahan:**
  1. Menghapus validasi absolut kesamaan tren H1/M15 untuk penambahan layer.
  2. Lapisan layer tambahan akan tereksekusi murni berdasarkan jarak mundur (*pullback spacing*) selama batasan Invalidation S/R belum tersentuh.
- **Tujuan:** Menjadikan sistem Averaging jauh lebih agresif dalam menangkap harga diskon.

### D. Dynamic Spacing Logic
- **Komponen:** `basketEngine.ts`
- **Perubahan:** Jarak antar layer tidak lagi tetap (statis). Sistem akan membaca tipe strategi dari sinyal:
  - **HYPER_SCALPER (M1 & M5):** Jarak tembak Layer 2 adalah mundur 20 poin ($0.20).
  - **SNIPER (M5):** Jarak tembak Layer 2 adalah mundur 100 poin ($1.00).
- **Tujuan:** Menyelaraskan lebar nafas *pullback* dengan profil risiko dari masing-masing strategi.

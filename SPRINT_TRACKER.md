# Sprint Tracker & Product Backlog
**Proyek:** Platform Analisis & Sinyal Trading XAU/USD (Aurum AI)
**Versi:** 1.0 (MVP)

---

## 🎯 Saat Ini: SPRINT 1 (MVP Foundation)
**Status:** Selesai (Completed)
**Fokus:** Membangun fondasi utama arsitektur, mesin analisis (mock/simulasi), dan antarmuka dasar.

### Backlog Sprint 1 (Telah Diselesaikan)
| ID | Tipe | Judul | Deskripsi Singkat | Status |
|----|------|-------|-------------------|--------|
| T-01 | Setup | Setup Monorepo & Backend | Inisialisasi struktur direktori, Node.js, Express, dan TypeScript. | ✅ Selesai |
| T-02 | Setup | Setup Frontend Next.js | Inisialisasi Next.js dengan TailwindCSS dan konfigurasi awal. | ✅ Selesai |
| T-03 | Feature | Market Data Ingestion | Membuat service untuk menarik data harga XAU/USD (dengan mode simulasi). | ✅ Selesai |
| T-04 | Feature | News Ingestion | Membuat service untuk menarik berita ekonomi fundamental (mode mock). | ✅ Selesai |
| T-05 | Core | Technical Analysis Engine | Kalkulasi indikator RSI, MACD, dan SMA menggunakan pustaka `technicalindicators`. | ✅ Selesai |
| T-06 | Core | AI Sentiment Analysis | Integrasi OpenAI API untuk memproses sentimen berita ekonomi. | ✅ Selesai |
| T-07 | Core | Signal & Risk Generator | Algoritma penggabungan teknikal & fundamental + kalkulasi Risk 1:2. | ✅ Selesai |
| T-08 | Feature | Telegram Bot Integration | Setup Node Telegram Bot API untuk pengiriman sinyal real-time. | ✅ Selesai |
| T-09 | Feature | Web Dashboard UI | Membangun antarmuka utama menggunakan TailwindCSS. | ✅ Selesai |
| T-10 | Feature | Charting Integration | Menanamkan Lightweight Charts dari TradingView ke Dashboard. | ✅ Selesai |

---

## 🚀 SPRINT 2 (Database & Data Integration)
**Status:** Selesai (Completed)
**Fokus:** Mengganti data simulasi/mock menjadi data asli (API), perbaikan stabilitas, dan penyimpanan database.

### Backlog Sprint 2 (Telah Diselesaikan)
| ID | Tipe | Judul | Deskripsi Singkat | Status |
|----|------|-------|-------------------|--------|
| B-01 | Integration | Real API: Finnhub | Menghubungkan WebSocket dan REST API asli untuk data harga XAU/USD tanpa simulasi. | ✅ Selesai |
| B-03 | Database | Setup PostgreSQL | Menggunakan Supabase untuk menyimpan histori sinyal agar tidak hilang saat server *restart*. | ✅ Selesai |

## 🚀 SPRINT 3 (Real-Time Chart & Historical Ingestion)
**Status:** Selesai (Completed)
**Fokus:** Memastikan grafik di frontend bergerak *real-time* dan AI dapat langsung menghasilkan sinyal tanpa menunggu 16 jam.

### Backlog Sprint 3 (Telah Diselesaikan)
| ID | Tipe | Judul | Deskripsi Singkat | Status |
|----|------|-------|-------------------|--------|
| C-01 | Core | Historical Data Ingestion | Menarik 200 *candle* historis dari Finnhub saat startup backend. | ✅ Selesai |
| C-02 | API | Candles API Endpoint | Membuat endpoint `/api/candles` untuk melayani data grafik utuh. | ✅ Selesai |
| C-03 | UI | Real-Time Charting | Menghapus dummy data di Frontend dan menghubungkan grafik ke endpoint API backend. | ✅ Selesai |
| C-04 | UI | Advanced TV Widget | Mengganti *lightweight-charts* dengan *Advanced TradingView Widget* (lengkap dengan Countdown & Volume). | ✅ Selesai |

## 🚀 SPRINT 4 (AI Trading Engine V2.0)
**Status:** ✅ Selesai (Completed)
**Fokus:** Perombakan arsitektur kecerdasan buatan menjadi *Decision Tree* untuk menyesuaikan kondisi pasar secara dinamis.

### Backlog Sprint 4 (V2.0 Blueprint)
| ID | Tipe | Judul | Deskripsi Singkat | Status |
|----|------|-------|-------------------|--------|
| V2-1 | Core | Phase 1: Decision Tree & Dynamics | Pemisahan strategi Trending/Sideways, Dynamic Confidence, dan Session Aggressiveness. | ✅ Selesai |
| V2-2 | Core | Phase 2: Advanced Price Action | Deteksi Momentum Candle (Marubozu), Breakout Confirmation (Vol+ATR), dan Liquidity Grab. | ✅ Selesai |
| V2-3 | Core | Phase 3: State & Opportunity Mode | Cooldown berbasis siklus trade (TP/SL/Expired) dan fitur sinyal kuning (Opportunity Mode). | ✅ Selesai |
| V2-4 | Core | Fibonacci Retracement Golden Zone | Deteksi otomatis level 50% & 61.8% (Golden Ratio) di M15 sebagai konfirmator & bypass PA NONE. Skor +30 jika valid. | ✅ Selesai |
| V2-5 | Core | Hyper Scalper 24H (Buka Sesi Asia) | Membuka sesi Sydney & Tokyo untuk mode Hyper Scalper agar AI bisa berburu peluang sepanjang hari. | ✅ Selesai |

---

## 🚀 SPRINT 5 (Scale Up Mode — Risk & Money Management)
**Status:** ✅ Selesai (Completed)
**Fokus:** Menerapkan filosofi *Tangga 4: Scale Up Mode* (Sekolah Trading) ke dalam mesin AI. Tujuan utama adalah stabilitas & konsistensi, bukan profit besar sesaat.

### Product Backlog (Prioritas Utama — Scale Up Philosophy)
| ID | Tipe | Judul | Deskripsi Singkat | Prioritas |
|----|------|-------|-------------------|-----------|
| S5-A | Core | Drawdown Guard (Circuit Breaker) | AI otomatis *pause* mengirim sinyal jika dalam 1 hari sudah hit SL lebih dari 2x. Prinsip: "Jangan hancurkan akun karena ego kecil". | ✅ Selesai |
| S5-B | Feature | Capital-Based Risk Engine | User memasukkan saldo modal di Dashboard. AI menghitung otomatis ukuran risiko per trade agar tidak melebihi 1-2% dari total modal. *Professional Risk Management*. | ✅ Selesai |
| S5-C | UI | Monthly Performance Tracker | Halaman baru di website menampilkan: total profit bulan ini, total pips, win-rate, drawdown terbesar, dan *expectancy*. Memudahkan evaluasi apakah AI sudah konsisten di standar 5-10% per bulan. | ✅ Selesai |
| S5-D | System | System Health Dashboard | Integrasi UI Widget dan notifikasi Toasts untuk memantau error kritis (*API down, Drawdown, dll*) secara *real-time* lewat WebSocket Supabase. | ✅ Selesai |
| S5-E | System | Frontend Internal Proxy | Konfigurasi Next.js Rewrites untuk mem-bypass error CORS dan pemblokiran Firewall saat browser memanggil `/api/status`. | ✅ Selesai |

### Product Backlog (Prioritas Menengah — Strategy Tweaks)
| ID | Tipe | Judul | Deskripsi Singkat | Prioritas |
|----|------|-------|-------------------|-----------|
| B-01A| Core | AI Strategy: Momentum Based Entry | Longgarkan syarat Price Action (M5) agar AI bisa masuk murni berdasarkan momentum EMA & Volume. | 🟠 Tinggi |
| B-01B| Core | AI Strategy: Lower Threshold | Turunkan standar minimal skor AI (Sniper 70, Scalper 60) untuk meningkatkan frekuensi sinyal. | 🟠 Tinggi |
| B-02 | Integration | Real API: Marketaux / News | Menghubungkan API Berita Finansial asli untuk mendapatkan *feed* berita harian. | 🟠 Tinggi |
| B-04 | Feature | Telegram Channel Broadcast | Sinyal AI kini otomatis disiarkan (*broadcast*) ke Telegram Channel (-1003949398310). | ✅ Selesai |
| B-05 | Feature | Advanced Risk Settings | UI di Dashboard untuk mengatur Risk:Reward Ratio dan Max SL Pips secara dinamis. | 🟡 Menengah |
| B-06 | Testing | Unit & Integration Test | Menambahkan Jest untuk *unit testing* logika Signal Generator dan Technical Analysis. | 🟡 Menengah |
| B-07 | DevOps | Dockerization | Membuat `Dockerfile` dan `docker-compose.yml` untuk mempermudah *deployment*. | 🟡 Menengah |

---

## 🚀 SPRINT 6 (Ultra-Fast Dual-Track Real-Time Engine & 5-Layer Burst Scalper)
**Status:** ✅ Selesai (Completed)
**Fokus:** Mengadopsi arsitektur *Deterministic Quant Core + Generative Edge* dan *Dual-Track Real-Time Pipeline* untuk mengeliminasi kelambatan entry (meninggalkan polling M5 close 300 detik) dan mengeksekusi *5-Layer Burst Scalping* (target akumulasi 40–50 pips).

### 📐 Arsitektur Dual-Track Real-Time Pipeline:
```
Real-Time Market Data (M1 Ingestion & Tick Stream)
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ ⚡ CRITICAL PATH (< 100ms Target | Aktual: ~2.94ms)    │
│  1. Incremental Feature Extraction (2.13ms)             │
│     (EMA, RSI, ATR, MACD, Swing, BOS, CHoCH, Liquidity) │
│  2. Deterministic Quant Confidence Scoring (0.81ms)     │
│     (100-Point Scoring Matrix, Zero-LLM Blocking)       │
│  3. Signal State Machine & 5-Layer Burst Generator      │
│     (TTL 30s Guard, Entry Zone, Anti-Chasing Fibo Limit)│
│  4. Instant Push to MT5 Bridge & Telegram Alert         │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ 🧠 ASYNC AI PATH (Background / Non-Blocking)            │
│  - Downstream LLM Explainer & Education Reason          │
│  - Asynchronous DB Persistence & Logging                │
└─────────────────────────────────────────────────────────┘
```

### Backlog Sprint 6 (Telah Diselesaikan)
| ID | Tipe | Judul | Deskripsi Singkat | Status |
|----|------|-------|-------------------|--------|
| M-01 | Core | Incremental Feature Engine | Perhitungan rolling indikator (EMA 9/20/50/200, RSI 14, ATR 14, MACD) & scanner struktur SMC (Swing, BOS, CHoCH, FVG) per tick M1 (<2.13ms). | ✅ Selesai |
| M-02 | Core | Deterministic Quant Scoring | Matriks kuantitatif 100-poin non-blocking (Trend 20%, Structure 20%, Momentum 15%, Liquidity 15%, Volatility 10%, Pattern 10%, R:R 10%) dengan klasifikasi Tier (<65% WAIT, 65-74% Quick Scalp, 75-84% Momentum, >=85% Super Trend). | ✅ Selesai |
| M-03 | Core | Signal State Machine & TTL Guard | Manajemen siklus sinyal dengan masa kedaluwarsa ketat 30 detik (TTL), deteksi zona toleransi harga, dan kalkulator level Limit Pullback Fibo 50-61.8%. | ✅ Selesai |
| M-04 | Core | M1 Intrabar Fast Trigger | Hooking callback `onM1Closed` untuk menangkap peluang di menit ke-1 atau ke-2 awal pergerakan candle tanpa menunggu penutupan M5 (300 detik). | ✅ Selesai |
| M-05 | Core | 5-Layer Burst Scalper | Generator payload 5 layer serentak dengan micro-TP bertingkat (8, 9, 10, 11, 12 pips) dan SL mikro ketat 10 pips untuk mengunci total 40–50 pips profit instan. | ✅ Selesai |
| M-06 | Core | Safe Trend Re-Entry Stacking | Pelacak status siklus re-entry bertingkat (hingga 3x siklus) jika trade sebelumnya sukses `HIT_TP` dan tren masih berlanjut kuat. Otomatis reset saat `HIT_SL`. | ✅ Selesai |
| M-07 | MT5 | AurumAI_Executor.mq5 v4.20 | Upgrade EA MT5 dengan dukungan eksekusi 5 layer, konversi otomatis ke 5 Pending Limit jika harga melompat >15 pips (*Anti-Chasing*), validasi TTL, dan integrasi remote reset guard. | ✅ Selesai |
| M-08 | Testing | Latency Benchmark & Unit Test | Verifikasi benchmark internal (<2.94ms) dan rangkaian unit test untuk feature extraction, quant scoring, TTL expiration, serta re-entry cycle tracker. | ✅ Selesai |

---

## 🚀 SPRINT 7 (Quant Engine v2.1 — Adaptive Risk, Feedback Engine & E2E Telemetry)
**Status:** 📋 Backlog (Menunggu Observasi Live Market Saat Pasar Buka)
**Fokus:** Mengintegrasikan umpan balik hasil trading (*Trade Outcome Feedback Engine*), kalkulasi Stop Loss adaptif berbasis volatilitas ATR & struktur pasar, mitigasi false breakout dengan klasifikasi sinyal *Early vs Confirmed*, serta pencatatan latensi *End-to-End* ($T_0 \rightarrow T_6$).

### Backlog Sprint 7 (Rencana Implementasi Lanjutan)
| ID | Tipe | Judul | Deskripsi Singkat | Prioritas |
|----|------|-------|-------------------|-----------|
| Q-01 | Core | Dynamic Volatility & Structural SL | Mengganti SL kaku 12 pips dengan formula dinamis `SL = min(25p, max(ATR * 1.2, Structural Swing + buffer))` untuk mencegah *premature stop-out* akibat noise wajar XAUUSD. | 🔴 Sangat Tinggi |
| Q-02 | Core | Early vs Confirmed Signal Tiering | Membedakan sinyal `EARLY` (M1 Intrabar running, min Conf 85%, Lot 60%) dan `CONFIRMED` (M1 Close, min Conf 75%, Lot 100%) untuk kecepatan tanpa membayar mahal pada false breakout. | 🔴 Sangat Tinggi |
| Q-03 | Core | Dual-Axis Quality Decay & Price Extension | Menolak/membatalkan sinyal seketika jika harga live melonjak keluar dari `Entry Zone` (*Price Extension Invalidation*) meskipun usia sinyal baru beberapa detik. | 🟠 Tinggi |
| Q-04 | Core | Trade Outcome Feedback Engine | Menyimpan data kuantitatif komprehensif saat trade ditutup (MFE, MAE, holding time, slippage, distribusi layer TP/SL, cycle re-entry) ke tabel `trade_telemetry` untuk evaluasi statistik berkelanjutan. | 🔴 Sangat Tinggi |
| Q-05 | Core | (PHASE 2) End-to-End (E2E) Latency Telemetry | Menghitung total latensi dari waktu event market ($T_0$), ekstraksi feature ($T_1$), kalkulasi skoring ($T_2$), push sinyal ($T_3$), terima EA ($T_4$), kirim order ($T_5$), hingga broker fill ($T_6$). Memvalidasi kecepatan eksekusi Phase 1. | 🟠 Tinggi |
| Q-06 | MT5 | MT5 MFE/MAE & Telemetry Exporter | Peningkatan EA MT5 untuk merekam *peak profit* (MFE), *max adverse floating* (MAE), microsecond timestamps, dan mengirim laporan JSON Telemetry otomatis ke backend saat posisi selesai. | 🔴 Sangat Tinggi |
| Q-07 | Core | (PHASE 1) Time-based Forced Close | ✅ **Selesai**: Menghilangkan delay statis (90 detik & 1 menit M5) dengan menyuntikkan boundary tick (dummy) pada detik `:00` secara paralel ke semua CandleBuilder. Dilengkapi dengan pelindung *Stale Data Guard* (`lastTickAgeSec`). | ✅ Selesai |
| Q-08 | Arch | (PHASE 3) MT5 Tick-Driven Signal Pulling | Perombakan arsitektur akhir di mana MT5 menjadi penentu "KAPAN" dan "HARGA BERAPA" eksekusi dilakukan lewat event `isNewBar()` (Backend beralih menggunakan Signal Cache pasif). | 🟡 Menengah |

---

## 💡 Masa Depan: SPRINT 8 (Ekosistem Lanjutan & Monetisasi)
**Status:** Perencanaan Panjang (Icebox)

| ID | Tipe | Judul | Deskripsi Singkat |
|----|------|-------|-------------------|
| I-00 | Core | Mode Zikk Sniper (MTF Top-Down) | Tambah mode strategi ke-3 berbasis SOP Zikk: 4 anak tangga analisis (D1→H4→H1→M5). *High win-rate, low frequency.* Butuh data TF D1 & H4. |
| I-01 | Feature | MetaTrader EA Integration | ✅ **Selesai (v4.20)**: REST Bridge `/api/mt5` + 5-Layer Burst Scalper `AurumAI_Executor.mq5` (Anti-Chasing Limit Pullback, 30s TTL, Re-Entry Stacking). |
| I-02 | Feature | Payment Gateway | Integrasi Midtrans / Stripe untuk sistem berlangganan (Subscription) sinyal VIP. |
| I-03 | Feature | Multi-Pair Support | Mengembangkan analisis untuk mata uang lain (EUR/USD, GBP/USD, dll). |
| I-04 | Core | Multi-Timeframe Analysis | AI menganalisis keselarasan tren pada M5, H1, dan D1 sebelum memberikan sinyal. |
| SEC-01 | Security | Telegram Bot Token Rotation & Alert Resolution | Revoke token bot lama via `@BotFather` (`/revoke`), masukkan token baru ke `.env` VPS, dan resolve alert GitHub Secret Scanning. |

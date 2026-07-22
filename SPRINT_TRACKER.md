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

## 💡 Masa Depan: SPRINT 6 (Fase 2 — Strategi Lanjutan & Monetisasi)
**Status:** Perencanaan Panjang (Icebox)

| ID | Tipe | Judul | Deskripsi Singkat |
|----|------|-------|-------------------|
| I-00 | Core | Mode Zikk Sniper (MTF Top-Down) | Tambah mode strategi ke-3 berbasis SOP Zikk: 4 anak tangga analisis (D1→H4→H1→M5). *High win-rate, low frequency.* Butuh data TF D1 & H4. |
| I-01 | Feature | MetaTrader EA Integration | Membuat *Expert Advisor* (EA) yang otomatis mengeksekusi *Buy/Sell* langsung ke MT4/MT5 berdasarkan sinyal. |
| I-02 | Feature | Payment Gateway | Integrasi Midtrans / Stripe untuk sistem berlangganan (Subscription) sinyal VIP. |
| I-03 | Feature | Multi-Pair Support | Mengembangkan analisis untuk mata uang lain (EUR/USD, GBP/USD, dll). |
| I-04 | Core | Multi-Timeframe Analysis | AI menganalisis keselarasan tren pada M5, H1, dan D1 sebelum memberikan sinyal. |

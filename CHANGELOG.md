# Changelog & Update Historis

Semua pembaruan, peningkatan fitur, dan perbaikan bug pada proyek **Trading Analis** akan didokumentasikan di file ini.

## [1.3.2] - System Health & UI Proxy Hotfix
### Ditambahkan
- **System Health Dashboard:** Penambahan widget status lampu indikator (*Healthy/Warning/Critical*) dan notifikasi melayang (*Toasts* bergaya *Cyberpunk*) pada Frontend untuk memberitahukan error kritis secara instan.
- **Real-time Logging (WebSockets):** Backend kini menyimpan log sistem ke tabel `system_logs` di Supabase. Frontend menggunakan fitur Realtime Supabase (WebSocket) untuk menarik *log* ini secara *live* tanpa perlu memuat ulang halaman.
- **Halaman Log Dedikasi:** Menambahkan rute halaman khusus `/logs` untuk memeriksa riwayat log sistem secara detail.
### Diperbaiki
- **UI Next.js Internal Proxy:** Memperbaiki insiden di mana tombol UI "Sniper" & "Scalper" membeku dan data hilang akibat pemblokiran CORS / Firewall dari *browser* ketika pengguna mengakses server. Konfigurasi `rewrites()` di `next.config.ts` diterapkan agar seluruh pemanggilan `/api` diproksi langsung di level internal Next.js.
- **Perbaikan RLS Database:** Memperbarui parameter `Row Level Security` (RLS) di Supabase untuk mengizinkan Backend menulis ke tabel `system_logs`.

## [1.3.1] - Hotfix & Historical Data Upgrade
### Ditambahkan
- **Instant Historical Bootstrap:** Integrasi dengan Twelve Data `/time_series` REST API. Server kini mampu menyedot 5000 *candle* historis (setara 17 hari masa lalu) secara instan dalam 1 kali tarikan API gratis saat server menyala. Hal ini sepenuhnya melenyapkan kebutuhan pembuatan data *dummy* sehingga mesin AI (seperti EMA 50) 100% menggunakan data *real market* sejak detik pertama.
- **Extended Memory Capacity:** Kapasitas memori lokal `market_history.json` ditingkatkan drastis dari 500 menjadi 6000 *candle* M5. Sistem kini menggunakan algoritma FIFO (*Sliding Window*) untuk menampung riwayat 20 hari secara abadi dan mandiri, menghemat kuota API eksternal.

### Diperbaiki
- **Bug Fix Stuck Status "IN PROGRESS":** Memperbaiki anomali di mana *Trade Signal* tertahan dengan status "IN PROGRESS" meskipun sudah kadaluarsa atau menyentuh SL/TP. Masalah ini diakibatkan oleh sistem Row Level Security (RLS) Supabase yang diam-diam memblokir operasi UPDATE. Solusi diterapkan dengan menanamkan *Service Role Key* (hak akses dewa) ke dalam sistem *backend*.
- **Bug Fix Zona Waktu (Signal ID):** Penamaan *Signal ID* (contoh: `XAU-20260720...`) kini murni menggunakan zona waktu Jakarta (WIB), tidak lagi menggunakan format UTC yang menyebabkan tanggal berganti lebih lambat dari waktu lokal.
- **Bug Fix Bulk Signal Spam:** Menonaktifkan (*mute*) callback `onM5Closed` selama proses *bootstrap* (memuat ribuan *candle* riwayat), sehingga mencegah mesin AI mengirim puluhan sinyal kedaluwarsa secara membabi-buta setiap kali server di-*restart*.
- **Hapus Peringatan Sesi Kaku:** Menghapus tampilan *hardcoded* "Sesi Tidak Valid" untuk sesi Tokyo di halaman depan, sehingga antarmuka UI kini bisa menampilkan analisis aktual dari AI untuk *Scalper* di sesi Asia.

## [1.3.0] - Sprint 5 (Scale Up Mode — Risk & Money Management)
### Ditambahkan
- **Drawdown Guard (Circuit Breaker):** AI kini dilengkapi dengan sistem pengaman psikologi. Jika dalam 1 hari sudah menyentuh Stop Loss (SL) sebanyak 2 kali, AI akan otomatis masuk ke mode PAUSE dan memblokir semua sinyal baru. Hal ini mencegah *revenge trading* dan melindungi *equity* secara ketat.
- **Capital-Based Risk Engine:** Integrasi sistem manajemen risiko kelas profesional. Pengguna kini dapat memasukkan total saldo modal dan persentase risiko (misal: 1%). AI akan secara otomatis menghitung dan menyarankan *Lot Size* yang tepat setiap kali ada sinyal, berdasarkan perhitungan jarak SL aktual.
- **Monthly Performance Tracker:** Halaman dasbor baru (`/performance`) yang khusus melacak stabilitas bulanan AI. Meliputi 6 metrik utama (Total Pips, Win Rate, Max Drawdown Streak, Expectancy, Total Sinyal, Avg Durasi) yang dihitung langsung dari basis data Supabase untuk evaluasi standar konsistensi 5-10% per bulan.
### Diperbaiki
- **Bug Fix Race Condition Database:** Memperbaiki insiden di mana sinyal yang langsung mengenai SL sesaat setelah diterbitkan gagal terekam di riwayat karena *ID database* belum di-*fetch* (asynchronous lag).
- **Bug Fix Perhitungan Pips SL:** Memperbaiki kalkulasi pips saat status `HIT_SL` pada posisi BUY yang sebelumnya sering terbalik/positif. Kini kerugian (SL) selalu bernilai negatif dengan presisi matematika yang benar.


## [1.2.0] - Sprint 4 (Institutional Grade AI Upgrade & UI Pro Max)
### Ditambahkan
- **Dynamic Session Weighting:** Mengubah mesin AI menjadi sistem skoring dinamis (*Dynamic Score*) yang mampu membaca karakter tiap sesi pasar (Sydney, Tokyo, London, New York, dan Golden Overlap). AI akan memprioritaskan pantulan S/R di Asia, dan agresif memburu *Breakout* saat volatilitas tinggi (London/NY).
- **H4 Deprecated:** Menghapus sepenuhnya ketergantungan pada grafik H4 (yang dianggap terlalu lambat/terlambat). Kini sistem mengandalkan H1 sebagai *Kompas Tren* dan M15 sebagai *Detektor Struktur* (mencari konfirmasi patahan BOS/CHoCH).
- **Dual Target Profit (TP1 & TP2):** Sistem kini mengalkulasi dua batas Target Profit. TP1 untuk keamanan (Rasio 1:2) dan TP2 untuk memaksimalkan *swing* (Rasio 1:3).
- **Institutional UI/UX Redesign:** Merombak total *Frontend* menggunakan panduan *Pro Max*. Emoji yang terlihat amatiran telah diganti seluruhnya dengan vektor **Lucide Icons**. Tema beralih ke *Neo-Dark Mode* (Deep Space #0B0F19) dipadukan dengan efek *Glassmorphism*, *hover animation*, dan fon *Plus Jakarta Sans* agar tampil kelas atas.
- **Strict "WAIT" Mechanism:** AI tidak akan lagi memaksakan sinyal jika probabilitas (*confidence score*) di bawah 50 poin atau tidak ada *Price Action* yang jelas di M5. Sistem lebih disiplin membuang sinyal "sampah" dan mempertahankan modal (Equity).
- **Cooldown Optimization:** Menurunkan sistem penahan (*Cooldown*) dari 30 menit menjadi 15 menit, memastikan AI memiliki waktu yang cukup untuk berburu hingga 5 target sinyal dalam satu sesi.
- **Bug Fix JSON Parsing:** Memperbaiki insiden malfungsi visual di Web Frontend akibat perubahan penamaan *camelCase* (`entryPrice`) dan lolosnya karakter baris-baru (`\n`) secara *literal* di basis data PostgreSQL Supabase.

## [1.1.1] - Sprint 3 (Price Action & Multi-Timeframe Engine)
### Ditambahkan
- **Multi-Timeframe Aggregator:** Mengubah mesin pendeteksi harga untuk mampu mengolah data *tick* secara *real-time* dan menjahit (membangun) *candle* M1, M5, H1, dan H4 di dalam memori, untuk mengakali keterbatasan API gratis Finnhub.
- **Price Action Engine:** Membuang indikator lagging lawas (MACD, RSI, SMA200) dan menggantinya dengan mesin penganalisa **Price Action (Struktur Harga) murni** sesuai SOP.
- **Swing Point Detection (Closed Candles):** Mesin kini secara eksklusif menggunakan lilin yang **sudah tertutup (Closed Candle)** dalam mendeteksi *Swing High* dan *Swing Low* untuk menghindari fenomena *repainting* (sinyal palsu saat lilin berjalan).
- **H4 Trend & H1 Retracement:** Menggunakan struktur harga *Higher High/Higher Low* di H4 untuk deteksi tren mutlak, dan memetakan area pantulan Support/Resistance berbasis *Swing* terdekat di H1.
- **M5 Entry Execution:** Menunggu reaksi penolakan harga (Engulfing / Pin Bar) di M5 ketika harga menyentuh area H1.
- **Dynamic Stop Loss:** Sistem *Stop Loss* kini dinamis (ditarik tepat di bawah *Swing Low* / di atas *Swing High* M5 terdekat ditambah *buffer*). Membuang fitur SL statis 30 pips lama.
- **Risk Mitigation:** Membatalkan sinyal (*pass/ignore*) jika jarak *Stop Loss* melebihi batas rasional yang aman (contoh: batas > $10) untuk mencegah *margin call*.

## [1.1.0] - Sprint 3 (Real-Time Chart & UI Promax)
### Ditambahkan
- **Data Historis (Fallback):** Menambahkan sistem _fallback_ generator untuk membuat data lilin (candle) masa lalu agar AI Technical Analysis bisa langsung memproduksi sinyal tanpa harus menunggu 16 jam pengumpulan data.
- **Grafik TradingView Profesional:** Mengganti `lightweight-charts` dengan **Advanced TradingView Widget** sehingga dashboard kini memiliki fitur grafik setara institusional (penghitung mundur M5, alat gambar, dll). Zona waktu telah diatur permanen ke Asia/Jakarta (WIB).
- **Perombakan Layout Dashboard:** Memperlebar batas halaman maksimal ke `1400px`. Grafik ditarik menjulang ke atas (tinggi 710px), sementara kartu *AI Sentiment* dan *Technical* dipindahkan rapi ke kolom sebelah kanan.
- **Tingkat Probabilitas Sinyal:** Sinyal kini tidak hanya menampilkan BUY/SELL, tetapi juga menampilkan tingkat kekuatan/kepercayaan diri AI (misal: **HIGH BUY** atau **LOW BUY**) berdasarkan skor sentimen berita.
- **AI Market Session Awareness:** Mesin AI kini bisa mengenali Sesi Pasar (Sesi Asia, Sesi London, Sesi New York, dan *Golden Overlap*). AI akan otomatis menurunkan probabilitas (*LOW*) di Sesi Asia yang tenang, dan menaikkan probabilitas (*HIGH*) di sesi *Golden Overlap* yang volatil.
- **Kartu Sesi Aktif:** Menambahkan panel "Active Session" di sudut kanan atas Dashboard agar pengguna tahu sesi pasar apa yang sedang berlangsung secara *real-time*.
- **Pembersihan Data Dummy:** Menambahkan sistem deteksi otomatis (auto-purge). Saat *backend* sudah berhasil mengumpulkan 200 data *candle* sungguhan dari market secara *real-time*, sistem akan secara otomatis menghapus ke-250 data *candle dummy* masa lalu agar analisa AI menjadi 100% akurat menggunakan data pasar sesungguhnya.

## [1.0.1] - Sprint 2 (Database Integration)
### Ditambahkan
- Integrasi `@supabase/supabase-js` ke dalam *backend* sebagai penyimpanan permanen.
- Semua sinyal yang diproduksi AI sekarang disimpan secara permanen ke dalam tabel `signals` di Supabase PostgreSQL.
- Pembaruan *endpoint* `/api/signals` agar langsung menarik riwayat sinyal dari *database* (mencegah hilangnya data saat server di-*restart*).
- Integrasi utilitas `agy-superpowers` (.agent/) untuk alur kerja pengembangan lanjutan tingkat lanjut.

## [1.0.0] - Sprint 1 (MVP Foundation)
### Ditambahkan
- Inisialisasi *Backend* menggunakan Node.js, Express, dan TypeScript.
- Inisialisasi *Frontend* menggunakan Next.js dan TailwindCSS.
- Pembuatan Mesin Analisis Teknikal (Indikator RSI, MACD, dan SMA 200).
- Pembuatan Mesin Analisis Sentimen Berita menggunakan integrasi OpenAI GPT.
- Logika Penghasil Sinyal (*Signal Generator*) dengan kalkulasi rasio Risk/Reward 1:2.
- Integrasi Telegram Bot untuk memberikan notifikasi sinyal instan ke *handphone*.
- Pembuatan antarmuka *Dashboard* interaktif.

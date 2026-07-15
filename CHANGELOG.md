# Changelog

Semua perubahan penting pada Aurum AI Trading Platform akan didokumentasikan di file ini.

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

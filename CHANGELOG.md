# Changelog

Semua perubahan penting pada Aurum AI Trading Platform akan didokumentasikan di file ini.

## [1.1.0] - Sprint 3 (Real-Time Chart & UI Promax)
### Ditambahkan
- **Data Historis (Fallback):** Menambahkan sistem _fallback_ generator untuk membuat data lilin (candle) masa lalu agar AI Technical Analysis bisa langsung memproduksi sinyal tanpa harus menunggu 16 jam pengumpulan data.
- **Grafik TradingView Profesional:** Mengganti `lightweight-charts` dengan **Advanced TradingView Widget** sehingga dashboard kini memiliki fitur grafik setara institusional (penghitung mundur M5, alat gambar, dll). Zona waktu telah diatur permanen ke Asia/Jakarta (WIB).
- **Perombakan Layout Dashboard:** Memperlebar batas halaman maksimal ke `1400px`. Grafik ditarik menjulang ke atas (tinggi 710px), sementara kartu *AI Sentiment* dan *Technical* dipindahkan rapi ke kolom sebelah kanan.
- **Tingkat Probabilitas Sinyal:** Sinyal kini tidak hanya menampilkan BUY/SELL, tetapi juga menampilkan tingkat kekuatan/kepercayaan diri AI (misal: **HIGH BUY** atau **LOW BUY**) berdasarkan skor sentimen berita.
- **AI Market Session Awareness:** Mesin AI kini bisa mengenali Sesi Pasar (Sesi Asia, Sesi London, Sesi New York, dan *Golden Overlap*). AI akan otomatis menurunkan probabilitas (*LOW*) di Sesi Asia yang tenang, dan menaikkan probabilitas (*HIGH*) di sesi *Golden Overlap* yang volatil.
- **Kartu Sesi Aktif:** Menambahkan panel "Active Session" di sudut kanan atas Dashboard agar pengguna tahu sesi pasar apa yang sedang berlangsung secara *real-time*.

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

# Changelog

## [1.3.2] - Hotfix (MT5 Burst Layer Tracking)
### Diperbaiki
- **Bug Fix MT5 Layer Drop (Burst Scalper):** Memperbaiki sistem pelacakan *close order* pada Robot EA MT5. Sebelumnya, MT5 menutup kelima layer secara bersamaan (karena kena TP), namun karena komentar (*comment*) pada tiket *closing* kosong, EA gagal mengekstrak Signal ID sehingga hanya 1 dari 5 tiket yang dikirim ke *backend*. 
  - **Solusi:** Menghapus fungsi *event-based* `OnTradeTransaction` yang tidak *reliable* dan menggantinya dengan sistem **History Polling** di fungsi `OnTimer`. EA kini memindai riwayat *close deal* setiap 1 detik, melacak kembali tiket *opening* aslinya untuk memastikan Signal ID (`AURUM-XXXXXX`) selalu terbaca, lalu mengirim kelima layer dengan presisi 100% ke dasbor web tanpa risiko hilang.
- **Recovery Data AURUM-920596:** Melakukan injeksi skrip manual (`fix_layers_920596.ts`) untuk memasukkan 4 tiket layer yang sebelumnya tidak tercatat karena *bug drop layer* di atas. Total profit sinyal tersebut kini akurat (Rp 197.118,12) untuk kelima layernya.

## [1.3.1] - Hotfix (Data & Logic Calibration)
### Diperbaiki
- **Bug Fix MT5 Status "IN PROGRESS" Stagnant:** Memperbaiki insiden di mana sinyal gagal memperbarui status menjadi `HIT_TP` atau `HIT_SL` pada UI web karena robot (EA) macet/terblokir oleh antrean fungsi *WebRequest*. Solusi diimplementasikan melalui sistem antrean asinkron (Queue System) di fungsi `OnTimer` pada `AurumAI_Executor.mq5` agar tidak mengganggu *Thread* utama eksekusi MT5.
- **Data Kalibrasi Sinyal Gagal:** Melakukan penyesuaian (sinkronisasi manual) pada *database* untuk sinyal `AURUM-820251` dan `AURUM-161256` yang sebelumnya nyangkut berhari-hari. 
- **Bug Fix ATR Volatility Blocking:** Memperbaiki sistem *bootstrapping* di `CandleBuilder` (Backend). Sebelumnya, saat *restart* server, sinkronisasi *array* riwayat lilin (M15 dan H1) gagal terbentuk sehingga indikator ATR bernilai `0`. Hal ini menyebabkan AI mengira pasar "mati" dan menge-blok (*Veto*) semua sinyal. Sistem sudah diperbaiki dengan fungsi `clear()` sehingga lilin M15/H1 (hingga ratusan lilin) terbentuk sempurna dan ATR berfungsi normal.
- **Bug Fix Threshold Skoring (Sniper vs Scalper):** Memperbaiki *hardcode* batasan skor probabilitas pada `signalGenerator.ts`. Sebelumnya AI memberlakukan skor ketat (65 poin) untuk kedua strategi. Kini telah dikembalikan sesuai desain awal: mode **SNIPER** mewajibkan minimal 65 Poin (60 jika ada *News*), sedangkan **HYPER SCALPER** hanya butuh minimal 55 Poin (50 jika ada *News*) karena berfokus pada momentum *timeframe* kecil.

Semua pembaruan, peningkatan fitur, dan perbaikan bug pada proyek **Trading Analis** akan didokumentasikan di file ini.

## [1.9.7] - 2026-08-22
### Ditambahkan
- **Multi-Layer / Burst Scalper Tracking (Option C):** Merombak sistem pelacakan profit MT5 agar mendukung eksekusi multi-tiket (*Burst Layer*) untuk satu sinyal AI.
  - **Database:** Menambahkan tabel relasional `signal_layers` di Supabase untuk mencatat riwayat eksekusi setiap nomor tiket (Ticket Number), status (TP/SL), dan profit individual.
  - **Aggregated Profit:** Sistem `backend` kini tidak lagi menimpa profit (*overwrite*), melainkan menjumlahkan/mengagregasi seluruh profit dari beberapa tiket yang terikat pada satu *Signal ID*, memberikan laporan akumulasi bersih di dasbor.
  - **Expandable UI:** Halaman *History* di web *frontend* (mode Robot MT5) kini mendukung tampilan *dropdown/expandable* pada *Signal ID*. Pengguna dapat mengklik ID untuk melihat rincian setiap layer/tiket yang dieksekusi oleh EA lengkap dengan waktu *Hit TP/SL*.
- **Fitur Ekspor Excel:** Menambahkan tombol **Export Excel** di halaman *History* agar pengguna bisa mengunduh riwayat performa AI dan Robot MT5 ke dalam format `.csv`.

## [1.9.6] - 2026-08-20
### Ditambahkan
- **Adaptive Entry Logging (Option A+):** Memodifikasi sistem penolakan sinyal pada *Signal Generator*. Sistem kini mampu membedakan antara "Setup Jelek" dan "Setup Bagus Tapi Lokasi Jelek". Jika *Confidence Score* terbukti sangat tinggi ($\ge 85$) namun jarak *Stop Loss* melampaui batas aman ($> \$5.50$), AI tidak akan membuang sinyal dengan alasan *Stop Loss* lebar secara generik. Melainkan, AI secara cerdas akan memberikan aksi spesifik `WAIT FOR PULLBACK`, memberikan instruksi visual bahwa market sedang mengalami momentum kuat namun belum memberikan harga "diskon" yang aman untuk masuk.

### Diperbaiki
- **EA Time Stop Logic & Docker Compilation Issue:**
  - Memisahkan logika hold time pada `AurumAI_Executor.mq5` dari `InpMaxHoldMinutes` menjadi `InpPendingExpireMinutes` (untuk *Pending Order*) dan `InpPositionExpireMinutes` (untuk *Active Positions*). Hal ini memberikan "ruang gerak" pada trade yang sudah tereksekusi agar dapat menyentuh S/R sesungguhnya tanpa ditutup paksa terlalu dini oleh *timer* 5 menit.
  - Memperbaiki kendala kritis kompilasi MetaEditor (F7) di KasmVNC VPS yang menimpa balik (*revert*) file MQ5. Menginvestigasi dan menemukan bahwa MT5 berjalan terisolasi di dalam *Docker Container* (`ai-mt5-vnc`). Pembaruan file berhasil dipaksakan dengan melakukan *file copy* langsung ke dalam kontainer dan men-terminasi `wineserver`, memaksa MetaEditor memuat versi terbaru dan mengompilasi `AurumAI_Executor.ex5` dengan sukses.

## [1.9.5] - 2026-08-18
### Ditambahkan
- **Pending Order Engine (Async State Machine):** Merombak total arsitektur eksekusi order (terutama mode PULLBACK). Sinyal tidak lagi langsung ditembak via Market Order, melainkan dimasukkan ke state `ARMED`. Engine akan memantau live price hingga harga benar-benar menyentuh *Entry Zone*, melakukan `REVALIDATING` terhadap struktur harga terbaru, lalu mengeksekusi ke *Market* jika masih valid (menyelesaikan masalah nyangkut sebelum zona entri).
- **True RR & H1 Structure Guard:** Menambahkan lapisan pelindung *True Risk-to-Reward*. Bot kini secara aktif memetakan jarak antara *Entry Zone* dengan S/R H1 terdekat (Hambatan Aktual). Jika ruang lari (*available room*) terlalu sempit (True RR < 1.3), maka setup PULLBACK akan langsung di-VETO.
- **Extreme Premium/Discount VETO:** Melarang keras *trend-following* di pucuk ekstrem. Robot tidak akan mengeksekusi sinyal BUY apabila harga berada di zona *Premium* absolut (>80%) dari struktur harga besar, begitu pun larangan mutlak SELL di zona *Discount* absolut (<20%).

### Diperbaiki
- **Artificial SL Capping Bug:** Menyelesaikan teka-teki tingginya kekalahan telak (`104 BUY SL`). Sebelumnya, apabila jarak *Swing Low* terlalu jauh, kode memaksakan SL rekaan / buatan. Hal ini menyebabkan SL sangat rawan tersentuh fluktuasi minor. Kini sistem murni bergantung pada S/R Struktural; jika jarak struktural SL terlalu jauh (riskDist > 5.5), setup lebih baik DIBUANG (*REJECT*) ketimbang memaksakan SL buatan.

## [1.8.0] - Anti-Slippage & Smart Fakeout Engine (v4.50)
### Ditambahkan
- **Anti-Falling Knife & Shooting Rocket Filter:** Pelindung (*VETO guard*) untuk mencegah AI menangkap "pisau jatuh". Walaupun tren makro (H1/M15) sedang kuat (misal: Bullish), jika momentum jangka pendek (M1/M5) sedang dibanting berlawanan (harga jatuh di bawah EMA20 dan MACD merah tajam), AI akan menjatuhkan penalti ekstrim (-50 poin) untuk menahan sinyal hingga badai mikro mereda.
- **Smart Fakeout Detection (Pre-News):** Logika pencegahan jebakan pancingan Ritail (Classic Fakeout / Buy The Rumor, Sell The News) menjelang rilis berita *High-Impact*. Jika teknikal terindikasi dipompa (*pump*) berlawanan dengan arah makro sesaat sebelum berita keluar, AI akan memprioritaskan fundamental makro dan mengabaikan jebakan teknikal.
- **100% Binary Pre-News Execution:** Sinyal `WAIT` telah dihapus sepenuhnya dari mesin *Pre-News*. Kini AI akan mengeksekusi secara biner (BUY atau SELL) pada momen *News* dengan batas toleransi probabilitas >50%.
## [1.9.4] - 2026-08-14
### Diperbaiki
- **Kalibrasi Ekstrem Volatility (GATE 1):** Mengubah threshold ATR dari 4.5 menjadi 15.0. Akar masalahnya adalah ATR dihitung dalam satuan harga XAUUSD (bukan *pips*), sehingga nilai 4.5 (= 45 *pips*) terlalu sering tersentuh saat market sedang bergejolak dan mengakibatkan **semua sinyal terblokir**. Threshold 15.0 (= 150 *pips*) lebih realistis untuk kondisi ekstrem sesungguhnya (seperti CPI/NFP crash).
- **Bug Stale Trade Cooldown:** Menambahkan `expiry check` pada saat server melakukan *resume* posisi trading yang sedang berjalan. Trade lama yang sudah melebihi batas waktu (Sniper >4 jam, Scalper >1.5 jam) akan otomatis dilewati dan ditandai sebagai `EXPIRED`, sehingga tidak lagi memblokir sinyal baru secara permanen.

## [1.9.3] - 2026-08-14
### Ditambahkan
- **Fast Crash Regime Detector:** Menambahkan fungsi `detectCrashRegime()` yang murni membaca M1+M5 (tidak bergantung H1/M15 yang lambat). Crash Mode aktif jika minimal 3 dari 4 kondisi M1 terpenuhi: Price breakdown dual EMA, MACD acceleration, M1 BOS, dan displacement candle kuat.
- **Crash Mode Scoring:** Saat Crash Mode aktif, engine menggunakan bobot scoring yang berbeda — H1 bias dihilangkan, M1 structure & momentum dinaikkan. M1 BOS diterima sebagai early confirmation tanpa menunggu M5 BOS. Threshold 60 (lebih ketat dari Normal 55, tapi jauh lebih mudah dari Counter-Trend 75).
- **RSI Context-Aware:** RSI < 32 tidak lagi otomatis memberi skor 0 saat Crash Mode. Sebaliknya, RSI oversold ekstrem dianggap sebagai konfirmasi bearish momentum kuat (+5).
- **Decision Trace Log:** Setiap M1 evaluation kini mencetak log `[CE] Dir=X Score=X Mode=X Crash={B:X/4 U:X/4}` untuk memudahkan diagnosis tanpa harus menebak-nebak.

### Diperbaiki  
- **Extension Guard dikembalikan ke 2.0x ATR:** Perubahan ke 4.0x pada v1.9.2 terbukti prematur. Root cause sebenarnya ada di scoring architecture, bukan di guard threshold.

## [1.9.2] - 2026-08-14
### Diperbaiki
- **Extension Guard Dilonggarkan (2.0x → 4.0x ATR):** Batas pelindung *anti-chasing* yang sebelumnya terlalu ketat (2.0x ATR) kini dinaikkan menjadi 4.0x ATR. Hal ini memungkinkan robot berani menembak SELL saat *Crash* atau *Breakout* momentum yang sangat masif, di mana harga terjun cepat jauh melampaui EMA20 sebelum robot sempat masuk.

## [1.9.1] - 2026-08-14
### Diperbaiki
- **Telegram Spam Fix:** Mencabut hak akses `signalGenerator` (mesin M5 lama) untuk mengirim pesan sinyal ke Telegram Bot. Hal ini menyelesaikan kebingungan *User* di mana Telegram terus menembakkan sinyal BUY saat harga anjlok (mesin lama tidak punya *Regime Shift*). Kini Telegram hanya menyiarkan sinyal murni dan valid dari `ConfidenceEngine`.

## [1.9.0] - 2026-08-13
### Ditambahkan
- **Regime-Based Decision Engine:** Menambahkan dua mesin penilai terpisah, `Normal Score` (threshold 55) dan `Counter-Trend Score` (threshold 75). Robot kini berani masuk posisi melawan arus (*Counter-Trend*) dengan syarat momentum mikro yang diuji jauh lebih ketat tanpa memerlukan persetujuan tren makro (H1/M15).
- **Extension Guard (Anti-Chasing):** Menambahkan pelindung jarak ekstrem. Apabila jarak harga saat ini terlalu melar menembus 2.0x ATR dari EMA20 M5, seluruh sinyal agresif akan dibatalkan (diubah ke mode `WAIT`) demi mencegah perilaku *Sell the Bottom* maupun *Buy the Top*.

### Diperbaiki
- **Anti-Falling Knife & Shooting Rocket (Kritis):** Merombak total logika pendeteksi pergeseran rezim dadakan. Pelindung ini kini murni melacak perubahan *Breakout* harga sesungguhnya (Price vs EMA20) dan pergeseran *Market Structure/Momentum* secara instan, tidak lagi mengandalkan silangan EMA yang berkarakteristik lambat (*lagging*). Sinyal "BUY melulu" saat harga sedang jatuh drastis telah resmi teratasi.

## [1.8.0] - 2026-08-13
- **MT5 EA Anti-Slippage SL/TP Fix (Kritis):** Memperbaiki celah *slippage* parah saat volatilitas tinggi (seperti *news*) di mana EA masih memakai harga SL statis dari kalkulasi awal *backend*. Kini EA MT5 mandiri 100% mengkalkulasi ulang SL/TP secara dinamis diukur murni dari harga eksekusi final (`livePrice`). Efek domino kerugian bengkak akibat *slippage* telah dihentikan total karena jarak rasio *Risk/Reward* selalu dipertahankan.
- **MT5 Bridge Payload Sync Fix:** Menyelesaikan *bug* di mana *backend* gagal menempelkan variabel `slPips` ke *payload* MT5, yang membuat EA kembali ke *fallback* (SL statis basi).
- **Spam Notifikasi Telegram (News Engine):** Menyempurnakan *State Management* (LOCKED, PREPARE) agar notifikasi hitung mundur tidak lagi dikirim secara *spam* puluhan kali per detik oleh *chron job*.
## [1.7.0] - Dynamic Risk & Volatility Engine (v4.40)
### Ditambahkan
- **Dynamic Risk Engine (Capital-Based Lot Sizing):** Modul baru (`riskEngine.ts`) terdedikasi untuk manajemen uang. AI sekarang menghitung ukuran lot (lot size) yang sangat presisi berdasarkan jarak Stop Loss (SL) aktual dan persentase risiko maksimum (misal: 1% dari modal) sehingga total kerugian dalam dolar selalu konstan (terbatas).
- **Volatility Regimes (Pendeteksi Badai):** AI kini sanggup membaca rezim volatilitas market lewat indikator ATR M5 (LOW, NORMAL, HIGH, EXTREME). Apabila pasar sedang di fase `EXTREME` (ATR >= 4.5), robot akan otomatis memblokir semua sinyal (*NO TRADE*) untuk menghindari risiko sapuan harga (*whipsaw*).
- **Dynamic Stop Loss & Target Profit (R-Multiples):** 
  - **Dynamic SL:** Tidak lagi statis 10 pips. Jarak SL sekarang dihitung cerdas dari nilai `MAX(ATR x 1.2, Jarak Swing Invalidation)` dan dibatasi pada batas aman 25 pips maksimum.
  - **Dynamic TP:** Jarak Take Profit tak lagi statis (8-12 pips) melainkan terskala otomatis dalam rasio R-Multiples mengikuti jarak SL (1R, 1.2R, 1.5R, 2R, 2.5R Runner).
- **Basket Condensation (Peringkas Layer):** Resolusi dari masalah limit minimum lot MT5 (0.01). Apabila total anggaran risiko menghasilkan perhitungan lot tanggung (misal: 0.03 lot) yang tidak bisa dibagi rata ke 5 layer (0.006 lot = invalid di MT5), sistem akan otomatis "meringkas" order menjadi 3 layer saja (masing-masing 0.01 lot) dan memprioritaskan penyebaran pada TP1, TP3, dan TP5 tanpa membulatkan ke atas (*no over-risking*).
- **A/B Backtesting Simulator:** Penambahan kerangka kerja uji skrip (`test_engine_v2.ts`) yang memungkinkan developer membandingkan perilaku mesin lama (SL statis) dan mesin baru (SL dinamis) pada simulasi data harga yang bergejolak keras.

## [1.6.0] - Pre-News Prediction Engine & Signal Timing Reform (v4.30)
### Ditambahkan
- **Pre-News Prediction Engine (Institutional Anticipatory Model):**
  - **Arsitektur Proaktif (T=0 Execution):** AI kini dipisah menjadi dua mesin: `Normal Quant Engine` (teknikal/reaktif) dan `Pre-News Engine` (fundamental/proaktif). Engine baru ini mengeksekusi order instan tepat pada detik rilis berita (T=0) tanpa menunggu *candle close*.
  - **Smart Macro Ingestion (DXY & US10Y):** Integrasi data US Dollar Index dan US 10-Year Yield untuk memperkirakan letusan fundamental. Menggunakan algoritma *Lazy Loading* (hanya bangun pada T-30, T-15, dan T-5) untuk menjaga kuota API *free tier* TwelveData (menghabiskan <20 credit per bulan).
  - **Probabilistic Forecast Scoring:** Engine memprediksi arah bukan dengan tebak-tebakan, melainkan kalkulasi probabilitas matematis (korelasi terbalik Yield/DXY terhadap Gold, dipadukan dengan struktur H1 & M15).
  - **4-Stage News State Machine:** `PREPARE` (T-30), `LOCKED` (T-5), `EXECUTE` (T=0), dan `IDLE`.
- **NFP & CPI Promotion:** Status berita Non-Farm Payroll, CPI, dan Inflasi dinaikkan ke level `EXTREME`, memaksa `Normal Quant Engine` masuk mode *Lock* dan menyerahkan kendali sepenuhnya pada `Pre-News Engine`.
- **Smart Institutional Re-Entry Guard (Anti-Overtrading):**
  - **Hybrid Dynamic Pullback:** Mencegah robot menembak posisi *Averaging* secara membabi buta. Sinyal tambahan (Entry #2 dan #3) HANYA diizinkan jika harga telah terkoreksi minimal sejauh `MAX(5 pips, ATR_M5 * 0.25)` dari posisi sebelumnya.
  - **Anti-Chasing Protection:** Robot dilarang keras membeli di harga yang lebih mahal dari sebelumnya (Buy) atau menjual di harga yang lebih murah (Sell). Memastikan *Averaging* selalu mendapatkan harga "diskon".
  - **Risk Budget Normalization:** Exposure dibatasi secara proporsional. Entry #1 dialokasikan 52.6% lot, Entry #2 dialokasikan 31.6%, dan Entry #3 dialokasikan 15.8%. Total keseluruhan risiko dibatasi secara ketat maksimal 100% per siklus sinyal (menghindari risiko bengkak berlipat ganda).

### Diperbaiki
- **Stale Data Guard (2-Level Validation):** Memperbaiki sistem pelindung data macet yang sebelumnya terlalu agresif (langsung memblokir sinyal jika telat 5 detik). Kini dipisah menjadi 2 level: Peringatan (usia harga > 10 detik) dan Pemblokiran ketat (koneksi mati > 30 detik). Sinyal M5 kini berhasil lolos persis di detik `:00`.
- **Server Clock Drift Resolution (70s Delay Fix):** Menyelesaikan anomali sinyal yang terasa telat 70-80 detik di layar pengguna. Investigasi membuktikan *latency* bukan berasal dari *bottleneck* algoritma, melainkan murni akibat jam internal VPS (NTP OS) yang tertinggal 75 detik dari jam dunia. Diperbaiki dengan instalasi `chrony` di VPS host.
- **Signal Timing Bug (90-Second Delay Fix):** Mengganti sistem penutupan *candle* yang bergantung pada *tick arrival* (Tick-driven) menjadi sistem *Polling* berbasis jam internal server yang berjalan setiap 200ms. *Candle* M1 kini dipaksa tutup persis di detik `:00` tanpa peduli apakah broker mengirimkan *tick* tepat waktu atau tidak, menyelesaikan masalah sinyal yang sering *delay* hingga 1 menit.
- **Time-Travel Bug Fix:** Memperbaiki insiden di mana WebSocket yang macet dan mengirim data *tick* usang (masa lalu) berhasil "membatalkan" *candle* yang sudah sah ditutup oleh sistem. Filter waktu kini mengabaikan *tick* yang *timestamp*-nya tertinggal.

## [1.5.0] - Ultra-Fast Real-Time Engine & 5-Layer Burst Scalper (v4.20)
### Ditambahkan
- **Dual-Track Real-Time Architecture (Critical Path < 100ms):**
  - Pemisahan total antara jalur eksekusi kritis (*Critical Path*) dan jalur penjelasan AI (*Async AI Path*).
  - Jalur kritis memproses sinyal, memeriksa risiko, dan mengirim instruksi ke Robot MT5 & Telegram dalam **~2.94 ms** tanpa terblokir oleh latency LLM eksternal.
  - LLM hanya dipanggil di latar belakang (*background worker*) untuk merilis narasi analisa edukatif tanpa menunda pembukaan order.
- **M1 Intrabar Fast Trigger:**
  - Evaluasi sinyal kini berjalan secara dinamis setiap penutupan lilin **M1** (`onM1Closed`) dan *real-time tick*, mengeliminasi keterlambatan 300 detik (*lag* menunggu M5 selesai).
  - AI mengeksekusi order di awal momentum (menit ke-1 atau ke-2) saat harga baru mulai bergerak, bukan di pucuk/lembah saat pergerakan sudah selesai.
- **5-Layer Burst Scalping (Akumulasi 40–50 Pips):**
  - Alih-alih membuka 1 order dengan TP jauh (50 pips) yang rawan terkena pembalikan arah, robot membuka **5 layer serentak** dengan target mikro bertingkat: **8, 9, 10, 11, 12 pips** ($0.8 – $1.2 pergerakan Gold).
  - Saat harga bergerak sedikit sesuai arah tren, seluruh 5 layer langsung menyentuh TP serentak dan mengunci total **40 s/d 50 pips profit** dalam hitungan menit.
- **Anti-Chasing Price Guard & Auto-Limit Pullback:**
  - Sistem pengaman anti-FOMO (*Anti-Chasing*): Jika harga pasar live telah bergerak melompat $> 15\text{ pips}$ ($1.5) dari harga ideal, robot secara otomatis membatalkan *Market Order* di pucuk dan memasang **5 Pending Limit Orders** di area *Golden Zone Retracement* (Fibo 50%–61.8%).
- **Signal TTL Guard (30 Detik):**
  - Setiap sinyal kini memiliki masa berlaku ketat (*Time-To-Live*) selama **30 detik**. Robot MT5 akan langsung menolak (*drop*) sinyal basi yang terlambat diterima demi melindungi *equity*.
- **Safe Trend Re-Entry Stacking (Maksimal 3 Siklus):**
  - Jika 5 layer sebelumnya sukses **HIT TP** dan tren M5/M15 masih berlanjut kuat (*Super Trend $\ge 85\%$*), robot diizinkan melakukan **Re-Entry Stacking** untuk menangkap 5 layer berikutnya.
  - Siklus re-entry dibatasi maksimal 3 siklus berturut-turut dan otomatis di-reset ke 0 jika terkena Stop Loss untuk memproteksi akumulasi keuntungan.
- **Deterministic 100-Point Scoring Matrix & Feature Engine:**
  - Perhitungan indikator EMA (9, 20, 50, 200), RSI 14, ATR 14, MACD, swing high/low, BOS, CHoCH, dan FVG dihitung secara *incremental* dalam $\approx 2.13\text{ ms}$.
  - Matriks penilaian matematis 100-poin non-blocking ($<0.81\text{ ms}$) mengklasifikasikan kekuatan sinyal ke 4 tingkatan (*Tiering*): `<65%` (WAIT), `65-74%` (Quick Scalp), `75-84%` (Momentum Scalp), `≥85%` (Super Trend).
- **AurumAI_Executor.mq5 (v4.20):**
  - Peningkatan robot MT5 dengan dukungan eksekusi 5 layer, validasi TTL, guard anti-chasing, dynamic micro-SL, dan pelacakan status re-entry.

## [1.4.0] - Hyper Scalper V2 (7-Stage Institutional Smart Money Engine)
### Ditambahkan
- **7-Stage Institutional Smart Money Engine:** Merombak total mesin strategi scalper AI menjadi arsitektur multi-tahap berbasis standar trading institusional:
  - **Tahap 1 (Market Structure H1):** Deteksi struktur Higher Highs/Higher Lows (`HH_HL`) untuk tren Bullish dan Lower Highs/Lower Lows (`LH_LL`) untuk tren Bearish pada H1, serta penentuan batas Support/Resistance yang presisi di kondisi Sideways.
  - **Tahap 2 (Market Phase Detection):** Klasifikasi 4 fase pergerakan pasar (`TRENDING`, `PULLBACK`, `RANGE`, `BREAKOUT`). AI secara ketat masuk status `WAIT` jika fase pasar tidak terdefinisi (`UNKNOWN`).
  - **Tahap 3 (Hard Filters & 3-Tier Room to Target):**
    - *Emergency ATR Filter:* Memblokir entry jika volatilitas mati ($ATR < 1.0$) atau terlalu liar ($ATR > 10.0$).
    - *News Lockout Filter:* Wajib menunggu jika ada High-Impact News dalam $\le 20$ menit.
    - *Momentum Exhaustion Guard:* Membatalkan entry jika harga sudah bergerak $\ge 8$ candle berturut-turut satu arah tanpa koreksi untuk menghindari beli di pucuk / jual di dasar.
    - *3-Tier Room to Target:* Prioritas 1 ($\ge 1.8 \times \text{SL} \rightarrow$ Full Confidence), Prioritas 2 ($1.5\text{x} - 1.8\text{x} \text{SL} \rightarrow$ Penalti 5–10 poin), dan Prioritas 3 ($< 1.5 \times \text{SL} \rightarrow$ **Wajib WAIT**).
  - **Tahap 4 (Entry Trigger M5):** Konfirmasi Price Action M5 minimal satu pola valid (*Bullish/Bearish Engulfing*, *Pin Bar*, *Marubozu*, *Break & Retest*, *Liquidity Grab Sweep*, atau *Golden Ratio Fibonacci 0.5–0.618*).
  - **Tahap 5 & 6 (Institutional Volume & Confluence):** Validasi volume spike yang didukung *Strong Institutional Candle* (Body $\ge 60\%$ total range dan close di dekat level ekstrem).
  - **Tahap 7 (100-Point Scoring Matrix & Dynamic SL):**
    - Matriks skoring baru: Trend H1 (25p), Structure H1 (20p), BOS/CHoCH M15 (15p), S/R Key Level (15p), Trigger M5 (10p), Volume (10p), MTF Alignment (5p).
    - Batas kelulusan (*Passing Threshold*): Minimal **50 Poin** untuk merilis sinyal aktif.
    - *Dynamic Stop Loss:* Dihitung berdasarkan `Swing Low/High M5 + ATR Buffer` (menghapus batas kaku 30-pip cap).
    - Rasio Target Profit: TP1 = **1:1.8** dan TP2 = **1:2.5**.
- **Setup Type & Market Phase Classification:** Sinyal kini dilengkapi label klasifikasi setup (`📈 Trend Continuation`, `🪤 Liquidity Grab`, `⚡ Breakout Momentum`, `🔄 S/R Bounce`, `📊 Fibonacci Confluence`) dan fase pasar (`TRENDING`, `PULLBACK`, `RANGE`, `BREAKOUT`).
- **Telegram & Dashboard UI Badges:** Menambahkan lencana Setup Type dan Market Phase di notifikasi Telegram, kartu sinyal real-time, dan tabel riwayat trade.

### Diperbaiki
- **Optimasi Historical Data Bootstrap:** Memperbaiki sistem penyimpanan history saat inisialisasi server sehingga tidak memicu ribuan penulisan disk berulang (*I/O loop*), membuat server booting instan dalam hitungan detik.
- **Stop Loss Safety & Risk Calculation:** Mengatasi masalah SL statis dengan kalkulasi dinamis yang adaptif terhadap volatilitas XAUUSD.

## [1.3.8] - Signal Card UI/UX Pro Max Redesign & Overflow Fix
### Diperbaiki
- **Header & Time/Win Overflow Fix:** Memperbaiki masalah layout di mana elemen jam (`10:46`) dan progress bar (`WIN: 90%`) menabrak/melewati batas border kanan kartu sinyal. Header kini dibagi menjadi 2 baris hierarkis yang rapi (Baris 1: Action Badge & Time, Baris 2: Signal ID & Win Probability Bar) dengan properti `min-w-0` dan `shrink-0`.
- **Entry Zone Wrapping Fix:** Mengubah kotak target harga menjadi layout modern. Rentang Entry (`4053.83 - 4055.83`) kini mendapatkan blok *full-width* tersendiri di bagian atas sehingga tidak akan pernah terpotong/patah menjadi 2 baris lagi.
- **Symmetric Target Pillars (SL / TP1 / TP2):** Tiga pilar target (SL, TP1, TP2) kini tersusun simetris dalam format 3 kolom berimbang dengan warna kontras tinggi dan aksen border semi-transparan.

## [1.3.7] - Weekend Market Closure Detection
### Diperbaiki
- **Weekend Signaling Bug:** Menambahkan logika penandaan *weekend* berdasarkan waktu penutupan Forex (Sabtu 04:00 WIB hingga Senin 04:00 WIB). Sebelumnya AI tetap memproses data harga hari Jumat yang tidak berubah, lalu memberikan sinyal di hari Sabtu pagi karena tidak mengenali pergantian hari libur. Sekarang AI otomatis masuk status `WAIT` dengan alasan "Market sedang libur/tutup di akhir pekan" selama rentang waktu ini.

## [1.3.6] - Sideways Logic Optimization & Dynamic S/R
### Diperbaiki
- **Dynamic S/R Proximity Threshold:** Memperbaiki sistem deteksi Support/Resistance (S/R) yang sebelumnya statis di angka $5. Untuk pair volatil seperti XAUUSD, jarak $5 terlalu sempit. Kini jarak pantulan (proximity) S/R bersifat dinamis mengikuti nilai Volatilitas (`Math.max(ATR * 1.5, 5)`). AI kini tidak akan melewatkan setup di mana harga memantul belasan pips dari ujung Support/Resistance akibat tingginya pergerakan market.
- **Sideways Threshold Adjustment:** Menurunkan batas minimal skor (`Confidence Threshold`) spesifik hanya untuk mode `SIDEWAYS` bagi agen Hyper Scalper dan Sniper. Di saat tren `NEUTRAL`, batas minimal skor diturunkan 10-15 poin, dan skor bonus dari *Volume Spike* dikunci stabil pada 20 poin. Ini membuat AI tetap mampu memberikan sinyal pada *choppy market* (seperti sesi Asia) asalkan ada konfirmasi Price Action dan Volume Spike.

## [1.3.5] - Sideways Support/Resistance Bugfix
### Diperbaiki
- **Sideways Scoring Bug:** Memperbaiki *bug* logika fatal pada `checkRetracementH1()` yang menyebabkan AI tidak pernah mendapatkan bonus +40 poin (*Support/Resistance Bounce*) saat tren sedang `NEUTRAL` (Sideways). 
- **Smarter S/R Detection:** Sistem `AnalysisResult` sekarang secara presisi mendeteksi `isAtSupportH1` dan `isAtResistanceH1` secara terpisah, sehingga AI hanya akan mengambil posisi BUY di *Support* dan SELL di *Resistance* pada saat market *choppy*. Hal ini membuat metode Scalper (Min Skor 70) dan Sniper (Min Skor 90) kembali aktif berburu di fase Sideways.

## [1.3.4] - Ultra FOMC Breakout Mode & ATR Tuning
### Ditambahkan
- **Ultra FOMC Breakout Mode:** Mengubah sistem pertahanan pasif menjadi agresif khusus pada berita tingkat `EXTREME`. AI kini otomatis mem-bypass *Emergency Lock* dan aktif berburu peluang di fase `DURING` (Menit ke 0-30) dan `STABILIZATION` (Menit ke 30-60) pasca berita.
- **Wider Breakout SL:** Untuk mengantisipasi *whipsaw* / slippage ekstrem selama FOMC Breakout, AI memperlebar jaring Stop Loss secara otomatis dari 2x ATR menjadi **3x ATR**.

### Diperbaiki
- **ATR Threshold Re-calibration:** Melonggarkan batas `EMERGENCY MODE` dari `ATR > 5.0` menjadi `ATR > 10.0`. Ini mengatasi masalah di mana AI terlalu pemilih/takut (*locked out*) saat sesi market New York yang normal (namun memiliki pergerakan Gold yang cukup liar di rentang 8.0). Scalper dan Sniper kini kembali aktif secara reguler.

## [1.3.3] - Smart News Mode (Institusional 4-Fase)
### Ditambahkan
- **News Severity Level Tracker:** AI sekarang tidak memukul rata semua berita. Ia bisa membedakan tingkat keparahan (*Severity*) dari berita: `EXTREME` (FOMC/Powell/Rate), `HIGH` (NFP/CPI), dan `MEDIUM` (PPI).
- **4 Mode State Machine:** AI memiliki 4 mode dinamis: `NORMAL`, `NEWS`, `FOMC`, dan `EMERGENCY`. 
- **EMERGENCY MODE:** Sistem pengaman otomatis (*Circuit Breaker*) lapis kedua yang memblokir perdagangan jika deteksi ATR (Volatilitas M15) menembus batas 5.0 (kondisi spread ekstrem / slippage gila di luar kalender).
- **Strategi FOMC 4-Fase:** Khusus berita tingkat `EXTREME`, AI akan mengeksekusi strategi 4-Fase:
  - Fase 1 (`PRE`): Pause 60 menit sebelum rilis.
  - Fase 2 (`DURING`): Lock mode selama 30 menit pasca rilis (menghindari whipsaw).
  - Fase 3 (`STABILIZATION`): Wait confirmation 30-60 menit.
  - Fase 4 (`POST_FOMC_BREAKOUT`): Mode berburu tren ekstrem dari 60 hingga 180 menit setelah berita. 
- **Super Strict Breakout Filter:** Saat menjalankan `POST_FOMC_BREAKOUT`, AI memperlebar jaring SL menjadi **2x ATR** untuk menghindari sisa fluktuasi kasar, dan memasang target TP minimum di **1:3 Risk to Reward**, dilengkapi filter wajib konfirmasi *Volume Spike* dan *BOS*.


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

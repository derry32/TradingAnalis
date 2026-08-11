# Signal Timing & Execution Architecture Design

## 1. Goal
Menghilangkan delay 90 detik saat pergantian candle yang saat ini terjadi akibat ketergantungan `CandleBuilder` backend pada tick pertama dari candle baru via TwelveData.
Lebih dari sekadar mempercepat pengiriman sinyal, desain ini mereformasi arsitektur menjadi sistem yang lebih *robust* dengan prinsip utama:
> **Backend menentukan "WHAT to trade", sedangkan MT5 menentukan "WHEN & AT WHAT PRICE to execute".**

## 2. Phase 1 — Time-based Forced Close (Quick Fix)
Mengubah mekanisme close candle di backend untuk menghilangkan bottleneck "menunggu tick baru".
- **Mekanisme:** Menggunakan internal timer (synced to `:00` seconds) untuk "memaksa" penutupan candle pada saat batas waktu terlampaui.
- **Close Source:** Harga penutupan menggunakan `LAST_KNOWN_TICK`.
- **Stale Data Guard:** Backend harus menghitung usia dari tick terakhir (`lastTickAge`) saat timer memicu penutupan.
  - `lastTickAge <= 2 sec`: Data segar (Normal). Sinyal dapat dikirim.
  - `lastTickAge 2–5 sec`: Warning (Log).
  - `lastTickAge > 5 sec`: Data basi (STALE). Sinyal dengan `CONFIRMED` tidak akan dieksekusi/dikeluarkan karena ada risiko harga penutupan sudah sangat berbeda dengan broker.

*Hasil akhir Phase 1: Keterlambatan sinyal 90 detik hilang, namun tetap aman dari ilusi data basi.*

## 3. Phase 2 — Latency Validation
Setelah Phase 1 diterapkan, sistem akan dilengkapi metrik untuk mengukur dan memvalidasi latensi pada setiap titik kritis dari *pipeline* eksekusi:
- **Candle Boundary → Signal Generated**: Target < 100 ms internal processing.
- **Signal Generated → Signal Received by MT5**: Target < 100 ms bridge transfer.
- **MT5 → Broker Fill**: Memonitor slippage dan *actual execution time*.

## 4. Phase 3 — MT5 Tick-Driven Execution (Final Architecture)
Transformasi menuju arsitektur akhir di mana MT5 menjadi *Source of Truth* untuk urusan *timing* dan *pricing*.
- **Signal Cache & Polling:** Backend memproduksi analisis dan menerbitkan "Sinyal Pending/Siap" (Status: `READY`) ke Signal Cache.
  ```json
  {
    "signalId": "AURUM-731417",
    "symbol": "XAUUSD",
    "direction": "BUY",
    "entryZone": { "low": 3369.50, "high": 3370.75 },
    "ttl": 30,
    "status": "READY"
  }
  ```
- **Event-Driven di MT5:** EA MT5 (menggunakan `isNewBar()` atau event `OnTick()`) akan mendeteksi formasi candle broker yang sesungguhnya.
- **Validasi Eksekusi Lokal:** Saat EA mendeteksi candle baru terbentuk, EA memeriksa jembatan (MT5 Bridge) untuk melihat sinyal `READY` dari backend.
  - *Apakah sinyal masih dalam batas TTL?*
  - *Apakah harga bid/ask broker saat ini masih berada di `entryZone`?*
  - *Apakah spread tidak melebar (normal)?*
- Jika validasi lokal MT5 lulus, EA mengeksekusi order. Jika harga sudah lari jauh (Price Chase), EA mengabaikan sinyal (Expired).
- **Keuntungan:** Keputusan eksekusi dijamin 100% menggunakan data waktu, spread, dan slippage aktual broker tanpa ketergantungan latensi WebSocket TwelveData.

# 🤖 Panduan Lengkap Memasang Aurum AI EA di MetaTrader 5 (MT5)

Expert Advisor (EA) ini menghubungkan MetaTrader 5 kamu secara langsung ke backend VPS **Aurum AI Quant Engine** untuk eksekusi otomatis (*Market Order* maupun *Limit Order*).

---

## 📋 Prasyarat:
1. **Aplikasi MetaTrader 5 (MT5)** sudah terpasang di MacBook / Windows / VPS.
2. Sudah login ke **Akun Demo Broker** (wajib Akun Demo selama masa uji coba).

---

## 🚀 Langkah 1: Pasang File EA ke MetaTrader 5

1. Buka aplikasi **MetaTrader 5**.
2. Di menu atas, klik **`File`** ➡️ **`Open Data Folder`** *(Buka Folder Data)*.
3. Buka folder:  
   👉 **`MQL5`** ➡️ **`Experts`**
4. Copy file **`AurumAI_Executor.mq5`** dari project ini ke dalam folder `Experts` tersebut.
5. Kembali ke MetaTrader 5, buka panel **Navigator** (tekan `Ctrl + N` atau `Cmd + N`).
6. Klik kanan pada bagian **`Expert Advisors`** ➡️ klik **`Refresh`**.
7. File **`AurumAI_Executor`** sekarang akan muncul di daftar!

---

## 🌐 Langkah 2: Izinkan WebRequest & Algorithmic Trading

1. Di menu atas MT5, klik **`Tools`** ➡️ **`Options`** (atau tekan `Ctrl + O` / `Cmd + ,`).
2. Masuk ke tab **`Expert Advisors`** (atau **`Experts`**).
3. Beri centang:
   - ✅ **`Allow algorithmic trading`**
   - ✅ **`Allow WebRequest for listed URL:`**
4. Di daftar URL, tambahkan URL backend VPS kita:
   ```text
   http://43.156.79.235:3002
   ```
5. Klik **`OK`**.
6. Pastikan tombol **`Algo Trading`** di toolbar atas MT5 menyala berwarna **Hijau (Aktif)**.

---

## 📈 Langkah 3: Pasang EA ke Grafik XAU/USD

1. Buka grafik **`XAUUSD`** (Gold) dengan Timeframe **`M5` (5 Menit)**.
2. Seret (*Drag & Drop*) file **`AurumAI_Executor`** dari panel Navigator ke atas chart grafik.
3. Di jendela pengaturan yang muncul:
   - Masuk ke tab **`Common`** ➡️ pastikan **`Allow Algo Trading`** tercentang.
   - Masuk ke tab **`Inputs`** ➡️ cek pengaturan berikut:
     - `InpApiUrl`: `http://43.156.79.235:3002`
     - `InpApiToken`: `aurum_secret_bridge_token_2026`
     - `InpFixedLot`: `0.01` (aman untuk demo)
     - `InpMaxSpreadPoints`: `400` (maksimal spread 40 pips)
     - `InpDemoOnlyGuard`: `true` (pengaman demo)
4. Klik **`OK`**.

---

## 🎯 Indikator Bahwa EA Sudah Berjalan:
- Di pojok kanan atas chart XAUUSD akan muncul ikon topi/robot kecil berwarna **Biru/Hijau**.
- Di tab **`Experts`** (di panel bawah/Toolbox), akan muncul pesan:
  ```text
  🚀 [Aurum AI] MT5 Autonomous Executor Started!
  🟢 [Aurum AI Server Status] Connected OK: {"status":"ONLINE", ...}
  ```

Selamat! Setiap kali AI di backend mengeluarkan sinyal baru (baik *Instant Buy/Sell* ataupun *Pullback Limit*), MT5 kamu akan mengeksekusi ordermya secara otomatis 24/7! 🎉

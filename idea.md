# 💡 Ide & Backlog: Dynamic TP Berdasarkan Confidence (Skor)

**Status:** High Priority Backlog
**Kategori:** Core Trading Logic
**Sumber:** Brainstorming Session (17 Agustus 2026)

## 📌 Latar Belakang (Status Quo)
Saat ini Take Profit (TP) di `signalGenerator.ts` dihitung secara **statis** berdasarkan perkalian *Risk* (Stop Loss):
- **Hyper Scalper:** TP1 = 1:1.3 | TP2 = 1:2.0
- **Sniper:** TP1 = 1:1.8 | TP2 = 1:2.5

**Kelemahan:** Sinyal dengan probabilitas pas-pasan (misal Skor 66) dipaksa mengejar target sejauh sinyal super solid (Skor 95). Akibatnya, sinyal lemah rawan terkena *reversal* sebelum menyentuh target TP.

---

## 🎯 Solusi yang Diusulkan

Kita perlu mengubah sistem target TP menjadi **Dinamis** berdasarkan kecerdasan buatan, di mana AI menyesuaikan seberapa jauh dia menahan posisi (*hold*) berdasarkan seberapa solid sinyal tersebut:

### Opsi 1: Skema Risk-Reward Berjenjang (Berdasarkan Bintang/Skor)
Menerapkan *multiplier* TP yang langsung terikat pada skor akhir matriks:
* **⭐⭐⭐⭐⭐ Very High (Skor 90 - 100)** -> Tren sangat kuat / Momentum Gajah
  * TP1 = 1 : 1.5
  * TP2 = 1 : 3.0 (Tahan posisi untuk *home-run*)
* **⭐⭐⭐⭐ High (Skor 80 - 89)** -> Tren sehat
  * TP1 = 1 : 1.3
  * TP2 = 1 : 2.0
* **⭐⭐⭐ Medium (Skor 65 - 79)** -> *Setup* standar, rawan *false breakout*
  * TP1 = 1 : 1.0 (Fokus *Hit n Run* cepat)
  * TP2 = 1 : 1.5

### Opsi 2: Kombinasi Volatilitas (ATR) + Skor
Alih-alih murni mengalikan jarak SL, TP1 diukur dari pergerakan normal (*ATR M15*):
- **Jika Skor < 80:** TP1 dipatok sejauh **1x ATR** (Target konservatif dan realistis).
- **Jika Skor > 80:** TP1 dipatok **2x ATR**.

### Opsi 3: Capping Berdasarkan Fase Market (Range vs Trend)
Walaupun sinyal mendapat skor tinggi (95 Poin), namun jika AI mendeteksi bahwa *Market Phase* sedang berada pada fase **RANGE (Sideways)**:
- TP2 akan di-potong paksa (*capped*) secara dinamis agar berhenti tepat di area *Resistance / Support* terdekat.
- Ini mencegah skenario di mana harga memantul balik karena menabrak "atap/lantai" dari rentang *sideways* tersebut.

## 🚀 Rencana Implementasi
1. Ubah logika *multiplier* TP1 dan TP2 di `signalGenerator.ts`.
2. Evaluasi kondisi *Market Phase* untuk menerapkan batas *Capping* (*Opsi 3*).
3. Lakukan pengujian di jam sibuk (*London/NY Overlap*) untuk melihat efektivitas pengambilan TP lebih awal pada sinyal berisiko.

---

# 💡 Ide & Backlog: The Machine Gun (Time-Spread Burst) Basket
**Status:** Disimpan dari Sesi Brainstorming (26 Agustus 2026)

## 📌 Latar Belakang
User ingin profit besar dan cepat seperti Phase 1 (5 layer langsung), tetapi tanpa risiko 5 posisi dieksekusi di 1 harga yang sama secara kaku.

## 🎯 Solusi yang Diusulkan
- **Frekuensi Sinyal:** Turunkan batas minimal skor AI di backend agar sinyal muncul tiap 5-15 menit sekali.
- **Cara 3 Entry:** Begitu sinyal valid, EA buka Entry 1. Kalau dalam 10 detik ke depan trennya masih searah (belum kena TP), EA tembak Entry 2, lalu 10 detik kemudian nembak Entry 3.
- **Tradeoff:** Hampir pasti dapet 3 entry di setiap sinyal (profit besar jika kena TP). Tapi jika market whipsaw tiba-tiba, floating minusnya besar (mirip Phase 1).

**Kesimpulan Sementara:** Disimpan sebagai cadangan jika sistem *Micro-Grid Scalping* dirasa masih kurang agresif.

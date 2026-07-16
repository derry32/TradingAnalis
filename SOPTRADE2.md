## new more SOP

1. AI Workflow (WAJIB) ✅

Ini harus tetap ada.

Tick Data
      │
      ▼
Build Candle (H1 → M15 → M5)
      │
      ▼
Trend Analysis
      │
      ▼
Market Condition
      │
      ▼
Support & Resistance
      │
      ▼
EMA
      │
      ▼
Price Action
      │
      ▼
Volume
      │
      ▼
ATR
      │
      ▼
Session Filter
      │
      ▼
News Filter
      │
      ▼
Risk Reward
      │
      ▼
Confidence Score
      │
      ▼
BUY / SELL / WAIT

Ini adalah inti AI.

2. Confidence Scoring (WAJIB) ✅

Karena H4 sudah dihapus, ubah menjadi:

Faktor	Bobot
Trend H1	25
Konfirmasi M15 (BOS/CHoCH)	20
Support & Resistance H1	15
Price Action M5	15
EMA Filter	10
Volume	5
Risk Reward ≥1:2	5
News Filter	3
ATR	1
Session	1
Total	100
3. Probability Level (WAJIB) ✅

Ini juga harus ada.

Confidence	Probability
90–100	⭐⭐⭐⭐⭐ Very High
80–89	⭐⭐⭐⭐ High
65–79	⭐⭐⭐ Medium
<65	⭐ Low
4. Signal Rule (WAJIB) ✅
Very High
↓

Kirim

High
↓

Kirim

Medium
↓

Kirim

Low
↓

Kirim
+
Warning

WAIT
↓

Tidak ada setup
5. WAIT Signal (WAJIB) ✅

Ini menurut saya sangat penting.

Misalnya:

Signal

WAIT

Reason

• Sideways

• RR < 1:2

• Tidak ada BOS

• News 10 menit lagi

• Confidence belum cukup

Ini membuat AI tidak memaksa BUY/SELL.

6. Cooldown (WAJIB) ✅

Ini juga penting.

Kalau tidak ada cooldown nanti AI spam notifikasi.

Misalnya:

Signal SELL

↓

Sudah terkirim

↓

Jangan kirim lagi

↓

Sampai

✔ BOS baru

✔ Area baru

✔ Confidence berubah

✔ TP

✔ SL

✔ Signal Expired

✔ Setup Baru
7. Output Signal (WAJIB) ✅

Saya akan gabungkan semua.

Signal ID

Signal Type

BUY / SELL / WAIT

Probability

Confidence

Market Condition

Session

Entry

SL

TP1

TP2

Signal Valid Time

Estimated TP Time

Time Stop Loss

Reason

Warning

Status

Ini jauh lebih rapi.

8. Contoh Output (Opsional) ⭐

Saya tetap akan memasukkan satu contoh.

Misalnya:

Signal

SELL

Probability

Very High

Confidence

94%

Entry

4050

SL

4058

TP1

4034

TP2

4026

Reason

✔ H1 Bearish

✔ BOS M15

✔ EMA20 < EMA50

✔ Bearish Engulfing

✔ London Session

Satu contoh sudah cukup. Tidak perlu contoh High, Medium, Low sekaligus karena hanya membuat dokumen lebih panjang.

9. Dynamic Session (WAJIB) ⭐⭐⭐

Ini justru menurut saya lebih penting daripada contoh-contoh tadi.

Misalnya:

Sydney

↓

Prioritas Support Resistance

Tokyo

↓

Prioritas Pullback

London

↓

Prioritas Breakout

London + NY

↓

Prioritas Momentum

News

↓

News Mode
10. News Mode (WAJIB)

Tetap dipakai.

Karena Gold sangat dipengaruhi:

CPI
PPI
NFP
FOMC
Interest Rate
Powell Speech

Menurut saya, struktur final AI Agent sebaiknya seperti ini
AI Workflow
Multi Timeframe Analysis
Market Structure
Market Condition
Support & Resistance
Price Action
EMA Filter
Volume
ATR
Session Engine
News Mode
Risk Management
Confidence Scoring
Probability Classification
Signal Rules (BUY/SELL/WAIT)
Cooldown Mechanism
Signal Expiry
Estimated TP Time
Time Stop Loss
Output Signal Format

## Target Frekuensi Sinyal
- **Sydney:** 1-2 sinyal maksimal
- **Tokyo:** 2-4 sinyal
- **London:** 2-5 sinyal
- **New York:** 2-5 sinyal


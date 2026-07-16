AI Agent Role: Gold Trading Expert

AI Agent bertindak sebagai analis trading XAUUSD profesional yang mampu menganalisis kondisi pasar secara real-time dan menghasilkan 3–10 sinyal trading berkualitas per hari berdasarkan kombinasi analisis teknikal, price action, market structure, dan manajemen risiko.

Core Capabilities
Market Structure Analysis
Mengidentifikasi Higher High (HH), Higher Low (HL), Lower High (LH), Lower Low (LL).
Mendeteksi Break of Structure (BOS) dan Change of Character (CHoCH).
Menentukan arah tren utama.
Multi-Timeframe Analysis
H4 → Menentukan trend utama.
H1 → Menentukan area Support & Resistance berdasarkan Swing High/Swing Low.
M5 → Menentukan timing entry berdasarkan price action.
Support & Resistance Detection
Mengidentifikasi zona Support dan Resistance dari Swing High dan Swing Low.
Menggunakan zona, bukan hanya satu garis harga.
Price Action Recognition
Bullish Engulfing
Bearish Engulfing
Pin Bar
Hammer
Shooting Star
Doji
Break & Retest
Rejection Candle
Fake Breakout
Trend Confirmation
Menggunakan EMA (20, 50, 200) sebagai filter tambahan.
Membedakan Trending, Sideways, Retracement, dan Reversal.
Risk Management
Menghasilkan signal hanya jika Risk : Reward minimal 1:2.
Menentukan Entry, Stop Loss, dan Take Profit secara otomatis.
Menghindari entry jika risk terlalu besar.
Fundamental Filter
Mempertimbangkan berita berdampak tinggi seperti CPI, PPI, NFP, FOMC, Interest Rate, dan Powell Speech.
Mengurangi confidence atau menunda signal menjelang berita besar.
Session Analysis
Mengenali sesi Asia, London, New York, dan London-New York Overlap.
Menyesuaikan ekspektasi volatilitas berdasarkan sesi perdagangan.
Volatility Analysis
Menggunakan ATR atau volatilitas historis.
Menghindari signal ketika pasar terlalu sempit atau terlalu ekstrem.
Signal Validation
Memvalidasi setiap signal menggunakan kombinasi seluruh indikator dan kondisi pasar.
Tidak memaksa menghasilkan signal jika kondisi pasar tidak memenuhi syarat.
Signal Classification

Setiap signal harus memiliki tingkat confidence.

Confidence	Probability
90–100%	⭐⭐⭐⭐⭐ Very High
80–89%	⭐⭐⭐⭐ High
65–79%	⭐⭐⭐ Medium
<65%	⭐ Low

Semua kategori tetap dikirim kepada pengguna, namun kategori Low Probability harus disertai peringatan bahwa risikonya lebih tinggi.

Signal Output

Setiap signal harus menghasilkan informasi berikut:

Signal (BUY / SELL / WAIT)
Probability Level
Confidence Score (%)
Entry Price
Stop Loss
Take Profit
Risk : Reward
Trend (Bullish/Bearish)
Timeframe Analisis
Alasan (Reason) mengapa signal muncul
Timestamp
Signal Generation Rules
Menghasilkan sekitar 3–10 signal per hari, bergantung pada kondisi pasar.
Tidak menghasilkan signal apabila tidak ada setup yang memenuhi kriteria.
Menghindari duplikasi signal pada area harga yang sama.
Mengutamakan kualitas dibanding kuantitas.
AI Decision Flow
Real-time Tick Data
        │
        ▼
Build Candle (M5 → H1 → H4)
        │
        ▼
Market Structure Analysis
(HH, HL, LH, LL, BOS, CHoCH)
        │
        ▼
Support & Resistance Detection
        │
        ▼
Trend Confirmation (EMA)
        │
        ▼
Price Action Analysis
        │
        ▼
Volatility & Session Analysis
        │
        ▼
Fundamental News Filter
        │
        ▼
Risk Management (RR ≥ 1:2)
        │
        ▼
Confidence Scoring (0–100)
        │
        ▼
BUY / SELL / WAIT
        │
        ▼
Probability Level
(Very High / High / Medium / Low)
        │
        ▼
Generate Signal + Entry + SL + TP + Reason

Spesifikasi ini sudah cukup lengkap untuk dijadikan dasar pengembangan AI Agent yang menganalisis XAUUSD secara real-time dan menghasilkan sinyal trading yang konsisten, transparan, dan mudah dievaluasi melalui proses backtesting maupun monitoring performa.
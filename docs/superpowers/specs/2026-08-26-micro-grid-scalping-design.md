# Spesifikasi Desain: Micro-Grid Scalping Engine (Opsi C)
**Tanggal:** 26 Agustus 2026
**Penulis:** Kolaborasi (Derry + AurumAI)
**Status:** Draf — Menunggu persetujuan user

---

## 1. Ringkasan Masalah & Solusi

### Akar Masalah
Sistem Basket (Phase 2) yang berjalan saat ini butuh harga mundur (*pullback*) cukup jauh (sekitar 0.5x ATR atau 20-30 pips) untuk memicu tambahan layer (ADD). Kalau sinyalnya sangat akurat (zero drawdown), harga langsung nyentuh TP cuma bawa 1 layer. Efeknya? Sinyal udah nunggu lama (30-60 menit), tapi profit uangnya dikit banget. User butuh frekuensi trading yang lebih rapat dan jumlah layer yang lebih banyak supaya *cuan* maksimal, tapi tetap nggak mau barbar kayak Phase 1 (5 layer langsung di 1 titik).

### Solusi: Micro-Grid Scalping (Opsi C)
Daripada nunggu harga mundur sampai 20 pips, sistem Basket bakal dibikin **super sensitif**. Kita akan pakai pergerakan harga sekecil 3-5 pips (*micro-wiggles*) untuk langsung nembak Layer 2 dan Layer 3. Ini ngejamin hampir setiap sinyal bakal ngebuka 2-3 layer, ngasih profit jauh lebih besar, tapi tetap aman karena harganya disebar tipis-tipis (nggak nyangkut di satu harga yang persis sama).

---

## 2. Perubahan Inti Arsitektur

### A. Frekuensi Sinyal (Backend)
- **Saat Ini:** Filter sangat ketat. Sinyal butuh skor tinggi (70-80+) dan nunggu semua indikator sejajar sempurna.
- **Rencana:** Menurunkan batas minimal skor masuk (contoh: jadi 60-65) supaya sinyal bisa muncul jauh lebih sering (tiap 5-15 menit).
- **File yang Diubah:** `backend/src/services/signalGenerator.ts`

### B. Micro-Spacing untuk Nambah Layer (Backend)
- **Saat Ini:** Jarak minimal untuk nambah layer (`requiredSpacing`) diatur di angka 0.5x ATR (lumayan jauh).
- **Rencana:** Menurunkan angka `MIN_SPACING_ABSOLUTE` jadi **3 pips**. Aturan nambah layer diubah: Begitu harga mundur 3 pips aja dari harga rata-rata, ATAU kalau momentum lagi gila-gilaan searah, layer baru langsung ditembak (Micro-Pyramiding).
- **File yang Diubah:** `backend/src/services/basketEngine.ts`

### C. Eksekusi Robot (EA MT5)
- EA MT5 nggak butuh banyak rombakan karena udah dirancang bisa nerima tembakan `BASKET_ADD` berkali-kali dari backend. 

---

## 3. Aturan Main Micro-Grid

1. **Layer 1 (Tembakan Awal):** Langsung eksekusi begitu dapet sinyal valid dari backend (Skor > 60).
2. **Layer 2 (Tambahan ke-1):** Tereksekusi jika harga mundur ≥ 3 pips dari Layer 1, ATAU jika sudah lewat 15 detik dan momentum masih kuat searah.
3. **Layer 3 (Tambahan ke-2):** Tereksekusi jika harga mundur ≥ 3 pips dari harga rata-rata yang baru, ATAU 15 detik kemudian momentum masih ngegas.

*Catatan: Batas maksimal peluru tetap di-lock di 3 layer per sinyal biar akun nggak meledak.*

---

## 4. Profil Risiko vs Keuntungan

| Metrik | Sistem Phase 2 (Sekarang) | Sistem Micro-Grid Scalping (Baru) |
|--------|----------------|---------------------|
| **Frekuensi Sinyal** | Jarang (Tiap 30-60 menit) | Sering (Tiap 5-15 menit) |
| **Jumlah Layer / Trade** | Mayoritas cuma 1 | Pasti 2 sampai 3 layer |
| **Risiko Drawdown** | Sangat Rendah | Menengah (Medium) |
| **Potensi Profit** | Receh (Kecil) | Gacor (Tinggi) |

Dengan pakai sistem *Micro-Grid*, kita berani ambil sedikit risiko *drawdown* tambahan dibanding Phase 2 murni, tapi frekuensi trading dan hasil profitnya bakal naik drastis.

---

## 5. Rencana Eksekusi Teknis

1. **Tahap 1:** Edit `signalGenerator.ts` buat nurunin batas skor masuk sinyal `MOMENTUM_SCALP` dan `COUNTER_TREND`.
2. **Tahap 2:** Edit `basketEngine.ts` buat masukin rumus sensitivitas 3 pips (*Micro-Grid*).
3. **Tahap 3:** Lempar (Deploy) *update* kodingannya ke VPS dan restart *backend* Docker-nya supaya langsung jalan.

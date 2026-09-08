# Spesifikasi Desain: Fix Ghost Signal & Penyetaraan TP

**Tanggal:** 2026-09-08  
**Author:** Agent Derry  
**Status:** Disetujui oleh user

---

## Masalah 1 — Ghost Signal (Sinyal Hantu)

### Akar Masalah
Di `index.ts` (handler M1 close), `insertSignal()` langsung dipanggil begitu sinyal burst dibuat — **sebelum** MT5 mengkonfirmasi eksekusi. Kalau MT5 menolak sinyal (TTL habis, spread terlalu besar, demo guard, dll), sinyal tetap tersimpan di Supabase sebagai hantu — kelihatan di UI tapi tidak pernah benar-benar dieksekusi.

### Solusi: Simpan ke DB Setelah ACK dari MT5
Sinyal hanya disimpan ke database setelah MT5 mengirim konfirmasi ACK (`status: OPENED`) lewat endpoint `/api/mt5/ack`.

**Perubahan alur:**
```
SEBELUM: createBurstSignal → insertSignal → mt5Bridge.set → [MT5 bisa menolak]
SESUDAH: createBurstSignal → mt5Bridge.set → [MT5 ACK masuk] → insertSignal
```

**Detail:**
- `mt5Bridge` menyimpan buffer sementara `pendingSignalBuffer: Map<signalId, legacySignal>` untuk sinyal yang menunggu ACK.
- Saat ACK masuk (`status: OPENED`), handler di `index.ts` memanggil `insertSignal(pendingSignalBuffer.get(signalId))`.
- Kalau tidak ada ACK (TTL habis), buffer tidak pernah ditulis ke DB — tidak ada ghost.
- Notifikasi Telegram tetap langsung dikirim — tidak menunggu ACK.
- Sinyal berbasis M5 (`SNIPER`/`HYPER_SCALPER` dari `setOnM5Closed`) **tidak diubah** — alurnya sudah berbeda dan insert sudah terjadi setelah trade state terbentuk.

---

## Masalah 2 — TP Layer 2 Terlalu Jauh, Sering Kena SL

### Akar Masalah
Di `signalStateMachine.ts`, sinyal 2 layer selalu menetapkan:
- Layer 1 → TP2 (1.2R dari SL)
- Layer 2 → TP5 (2.5R dari SL)

TP5 di 2.5R jarang tercapai sebelum harga berbalik, sehingga Layer 2 malah kena SL.

`targetTpPips` dari `confidenceEngine.ts`:
```
[slPips*1.0, slPips*1.2, slPips*1.5, slPips*2.0, slPips*2.5]
  TP1         TP2         TP3          TP4          TP5
```

### Solusi: Pembagian TP Berdasarkan Tingkat Kepercayaan (Confidence)

**Aturan:**
| Confidence | Pemetaan TP 2 layer | Pemetaan TP 3 layer |
|---|---|---|
| < 90% | Kedua layer → TP2 (1.2R) | TP1, TP2, TP3 (1.0R, 1.2R, 1.5R) |
| ≥ 90% | Layer1 → TP2, Layer2 → TP4 (2.0R) | TP1, TP3, TP5 (tidak berubah) |

**Alasan:**
- Sebagian besar sinyal skornya 60–89 (QUICK_SCALP / MOMENTUM_SCALP). TP lebih dekat = lebih banyak menang, ekuitas lebih stabil.
- Sinyal ≥ 90% (SUPER_TREND) jarang tapi berkualitas tinggi — layak mengincar target lebih jauh.
- Sinyal 1 layer (pakai TP3) dan 4-5 layer tidak berubah.

---

## File yang Diubah

| File | Perubahan |
|---|---|
| `backend/src/services/mt5Bridge.ts` | Tambah `pendingSignalBuffer` + `setPendingSignal()` + `popPendingSignal()` |
| `backend/src/index.ts` | Hapus `insertSignal` dari handler M1, pindah ke handler `/api/mt5/ack` saat `OPENED` |
| `backend/src/services/signalStateMachine.ts` | Logika pemilihan TP index berdasarkan confidence |

---

## Kriteria Sukses

1. Tidak ada ghost signal di Supabase setelah deploy — setiap entri DB punya tiket MT5 yang cocok.
2. Win rate sinyal 2 layer meningkat (TP2 lebih sering kena dibanding TP5 sebelumnya).
3. Telegram tetap langsung kirim notifikasi (tidak menunggu ACK).
4. Sinyal 3 layer dan 1 layer tidak rusak.

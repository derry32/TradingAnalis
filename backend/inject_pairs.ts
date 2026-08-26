import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!.replace('/rest/v1/', ''),
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * ⚠️ SCRIPT INJECT MANUAL (UNTUK GAMBAR 2 & 3, DAN GAMBAR 4 & 5)
 * 
 * Bos, masukin ID Sinyal (dari web) dan Profit (dari MT5 history) di bawah ini.
 */
const missingTrades = [
  // Pasangan Gambar 2 (Web) & Gambar 3 (MT5 History)
  {
    signalId: "AURUM-840002", // <-- GANTI DENGAN ID DI GAMBAR 2
    profit: -48544.29,             // <-- GANTI DENGAN PROFIT DI GAMBAR 3 (contoh: 152.50 atau -45.00)
    ticket: 275788884           // <-- GANTI DENGAN TICKET MT5 DI GAMBAR 3 (atau bebas)
  },

  // Pasangan Gambar 4 (Web) & Gambar 5 (MT5 History)
  {
    signalId: "AURUM-320091", // <-- GANTI DENGAN ID DI GAMBAR 4
    profit: 7972.60,             // <-- GANTI DENGAN PROFIT DI GAMBAR 5
    ticket: 275716047           // <-- GANTI DENGAN TICKET MT5 DI GAMBAR 5 (atau bebas)
  }
];

async function runInjection() {
  console.log('Mulai inject data pasangan manual...');

  for (const trade of missingTrades) {
    if (trade.signalId.includes('XXXXXX') || trade.signalId.includes('YYYYYY')) {
      console.log(`Lewati ${trade.signalId} (Belum diisi bos)`);
      continue;
    }

    // Cari UUID aslinya di database berdasarkan displayId (AURUM-XXXXXX)
    const { data: signals, error } = await supabase.from('signals').select('*').order('timestamp', { ascending: false }).limit(200);

    if (error || !signals) {
      console.error('Gagal ambil data sinyal');
      continue;
    }

    let targetDbId = null;
    let targetSignal = null;

    for (const sig of signals) {
      try {
        const reasonObj = typeof sig.reason === 'string' ? JSON.parse(sig.reason) : sig.reason;
        if (reasonObj.id === trade.signalId) {
          targetDbId = sig.id;
          targetSignal = sig;
          break;
        }
      } catch (e) { }
    }

    if (!targetDbId) {
      console.error(`Gagal: Sinyal ${trade.signalId} tidak ditemukan di Web DB!`);
      continue;
    }

    const status = trade.profit > 0 ? 'HIT_TP' : 'HIT_SL';

    // Inject ke signal_layers (Biar history layer-nya ada)
    const { error: layerErr } = await supabase.from('signal_layers').insert({
      signal_id: targetDbId,
      ticket: trade.ticket,
      status: status,
      profit: trade.profit,
      hit_time: new Date().toISOString()
    });
    
    if (layerErr) {
        console.error(`Error layer ${trade.signalId}:`, layerErr);
    }

    // Update parent signals
    const reasonObj = typeof targetSignal.reason === 'string' ? JSON.parse(targetSignal.reason) : targetSignal.reason;
    reasonObj.finalStatus = status;
    reasonObj.totalProfit = trade.profit;
    reasonObj.accuracy = status === 'HIT_TP' ? 100 : 0;
    
    // Asumsi per pips = profit / lot (simplifikasi)
    reasonObj.pips = trade.profit; 

    const { error: sigErr } = await supabase.from('signals').update({
      reason: JSON.stringify(reasonObj)
    }).eq('id', targetDbId);
    
    if (sigErr) {
        console.error(`Error update signal ${trade.signalId}:`, sigErr);
    } else {
        console.log(`✅ BERHASIL INJECT PASANGAN: ${trade.signalId} -> Status: ${status}, Profit: ${trade.profit}`);
    }
  }

  console.log('Selesai!');
}

runInjection();

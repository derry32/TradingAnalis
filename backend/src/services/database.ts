import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Inisialisasi klien Supabase
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export async function insertSignal(signal: any) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    console.warn('[DB] Supabase not configured. Skipping DB insert.');
    return;
  }
  
  const payload = {
    type: signal.type,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit1, // Map takeProfit1 to the old take_profit column
    reason: JSON.stringify({
      text: signal.reason,
      tp2: signal.takeProfit2,
      probability: signal.probabilityLabel,
      confidence: signal.confidenceScore,
      condition: signal.marketCondition,
      session: signal.session,
      validTime: signal.validTime,
      estTpTime: signal.estimatedTpTime,
      id: signal.id,
      strategy: signal.strategy
    }),
    timestamp: signal.timestamp
  };

  const { error } = await supabase.from('signals').insert([payload]);

  if (error) {
    console.error('[DB] Error inserting signal:', error);
  } else {
    console.log('[DB] Signal saved to Supabase.');
  }
}

export async function fetchRecentSignals(limit: number = 50) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    return [];
  }
  
  // Hitung batas waktu mulai hari ini (Jam 00:00 WIB = Jam 17:00 UTC hari sebelumnya)
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + 7); // Geser ke WIB sementara
  now.setUTCHours(0, 0, 0, 0); // Set ke jam 00:00 tengah malam
  now.setUTCHours(now.getUTCHours() - 7); // Kembalikan ke UTC untuk filter database
  const startOfDayISO = now.toISOString();

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .gte('timestamp', startOfDayISO) // Hanya ambil sinyal hari ini
    .order('timestamp', { ascending: false }) // Ambil yang paling baru
    .limit(limit);

  if (error) {
    console.error('[DB] Error fetching signals:', error);
    return [];
  }

  // Petakan kembali format kolom snake_case ke camelCase untuk frontend
  return data.map((row: any) => ({
    id: row.id,
    type: row.type,
    entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss),
    takeProfit: Number(row.take_profit),
    reason: row.reason,
    timestamp: row.timestamp
  }));
}

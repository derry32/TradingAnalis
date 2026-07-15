import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Inisialisasi klien Supabase
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export async function insertSignal(signal: any) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    console.warn('[DB] Supabase not configured. Skipping DB insert.');
    return;
  }
  
  const { error } = await supabase.from('signals').insert([{
    type: signal.type,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    reason: signal.reason,
    timestamp: signal.timestamp
  }]);

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
  
  const { data, error } = await supabase
    .from('signals')
    .select('*')
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

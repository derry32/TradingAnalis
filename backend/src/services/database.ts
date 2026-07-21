import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Inisialisasi klien Supabase
const supabaseUrl = config.SUPABASE_URL ? config.SUPABASE_URL.replace('/rest/v1/', '') : '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

export async function insertSignal(signal: any) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    console.warn('[DB] Supabase not configured. Skipping DB insert.');
    return null;
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
      strategy: signal.strategy,
      entryZone: signal.entryZone
    }),
    timestamp: signal.timestamp
  };

  const { data, error } = await supabase.from('signals').insert([payload]).select();

  if (error) {
    console.error('[DB] Error inserting signal:', error);
    return null;
  } else {
    console.log('[DB] Signal saved to Supabase.');
    return data && data.length > 0 ? data[0].id : null;
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

export async function updateSignalStatus(dbId: number | string, status: string, hitTime: string, durationMins: number, accuracy: number, pips: number) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return;
  
  const { data, error } = await supabase.from('signals').select('reason').eq('id', dbId).single();
  if (error || !data) return;
  
  let reasonObj: any = {};
  try {
    reasonObj = JSON.parse(data.reason);
  } catch(e) {}
  
  reasonObj.finalStatus = status;
  reasonObj.hitTime = hitTime;
  reasonObj.duration = durationMins;
  reasonObj.accuracy = accuracy;
  reasonObj.pips = pips;
  
  await supabase.from('signals').update({ reason: JSON.stringify(reasonObj) }).eq('id', dbId);
}

export async function fetchSignalsByDate(startDate: string, endDate: string) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return [];
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .gte('timestamp', startDate)
    .lte('timestamp', endDate)
    .order('timestamp', { ascending: false });
    
  if (error) {
    console.error('[DB] Error fetching signals by date:', error);
    return [];
  }
  
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

export async function fetchMonthlyStats(year: number, month: number) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return null;

  // Build date range for the month
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString();

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .gte('timestamp', start)
    .lt('timestamp', end)
    .order('timestamp', { ascending: true });

  if (error || !data) return null;

  let totalSignals = 0, hitTP = 0, hitSL = 0, totalPips = 0;
  let maxStreak = 0, currentStreak = 0;
  let durations: number[] = [];

  for (const row of data) {
    let ext: any = {};
    try { ext = JSON.parse(row.reason); } catch (_) {}

    if (!ext.finalStatus) continue; // Skip sinyal yang masih aktif/belum selesai
    totalSignals++;

    const pips = ext.pips || 0;
    const dur = ext.duration || 0;
    totalPips += pips;
    if (dur > 0) durations.push(dur);

    if (ext.finalStatus === 'HIT_TP') {
      hitTP++;
      currentStreak = 0;
    } else if (ext.finalStatus === 'HIT_SL') {
      hitSL++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    }
  }

  const winRate = totalSignals > 0 ? Math.round((hitTP / totalSignals) * 100) : 0;
  const avgWinPips = hitTP > 0 ? totalPips / hitTP : 0;
  const avgLossPips = hitSL > 0 ? Math.abs(totalPips - (avgWinPips * hitTP)) / hitSL : 0;
  const expectancy = hitTP > 0 || hitSL > 0
    ? (winRate / 100 * Math.abs(avgWinPips)) - ((1 - winRate / 100) * Math.abs(avgLossPips))
    : 0;
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  return {
    year, month,
    totalSignals,
    hitTP,
    hitSL,
    totalPips: Math.round(totalPips),
    winRate,
    maxDrawdownStreak: maxStreak,
    expectancy: Math.round(expectancy * 10) / 10,
    avgDurationMins: avgDuration
  };
}

export async function fetchActiveSignals() {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return [];

  // Ambil sinyal dalam 24 jam terakhir
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .gte('timestamp', past24h)
    .order('timestamp', { ascending: false });

  if (error || !data) return [];

  const activeSignals = [];
  for (const row of data) {
    let ext: any = {};
    try { ext = JSON.parse(row.reason); } catch (_) {}

    // Jika finalStatus kosong/null, berarti masih IN PROGRESS
    if (!ext.finalStatus) {
      activeSignals.push({
        id: row.id,
        type: row.type,
        entryPrice: Number(row.entry_price),
        stopLoss: Number(row.stop_loss),
        takeProfit1: Number(row.take_profit),
        reason: ext,
        timestamp: row.timestamp
      });
    }
  }

  return activeSignals;
}

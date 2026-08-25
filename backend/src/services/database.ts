import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Inisialisasi klien Supabase
const supabaseUrl = config.SUPABASE_URL ? config.SUPABASE_URL.replace('/rest/v1/', '') : '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

export async function insertSystemLog(level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL', source: string, message: string, metadata: any = {}) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return;
  try {
    const { error } = await supabase.from('system_logs').insert([{
      level,
      source,
      message,
      metadata
    }]);
    if (error) console.error('[DB] Failed to insert system log:', error.message);
  } catch (err: any) {
    console.error('[DB] Error inserting system log:', err.message);
  }
}

export async function insertSignal(signal: any) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    console.warn('[DB] Supabase not configured. Skipping DB insert.');
    return null;
  }

  if (!config.TWELVEDATA_API_KEY) {
    console.warn('[DB] Running in Simulation Mode (No TwelveData API Key). Skipping DB insert to prevent saving fake signals.');
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
      entryZone: signal.entryZone,
      executionType: signal.executionType,
      setupType: signal.setupType,
      marketPhase: signal.marketPhase
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

export async function updateSignalStatusByInternalId(internalId: string, status: string, hitTime: string, profit: number) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return;
  
  // Search for the signal in the last 2 days
  const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('signals')
    .select('id, reason, timestamp')
    .gte('timestamp', past48h)
    .order('timestamp', { ascending: false });

  if (error || !data) return;

  for (const row of data) {
    let reasonObj: any = {};
    try {
      reasonObj = JSON.parse(row.reason);
    } catch(e) {}
    
    if (reasonObj.id === internalId) {
      reasonObj.finalStatus = status;
      reasonObj.hitTime = hitTime;
      reasonObj.duration = Math.floor((new Date().getTime() - new Date(row.timestamp).getTime()) / 60000);
      reasonObj.pips = profit; // Save the actual profit amount in pips/money field
      reasonObj.accuracy = status === 'HIT_TP' ? 100 : 0;
      
      await supabase.from('signals').update({ reason: JSON.stringify(reasonObj) }).eq('id', row.id);
      console.log(`[DB] Signal ${internalId} updated to ${status} with profit ${profit}`);
      break;
    }
  }
}

export async function processSignalLayer(internalId: string, ticket: number, profit: number, tradeStats?: { mfePips?: number; maePips?: number; timeToMfeSec?: number; timeToMaeSec?: number }) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return;
  
  // 1. Find the parent signal
  const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('signals')
    .select('id, reason, timestamp')
    .gte('timestamp', past48h)
    .order('timestamp', { ascending: false });
    
  if (error || !data) return;
  
  let targetRow = null;
  let reasonObj: any = {};
  for (const row of data) {
    try { reasonObj = JSON.parse(row.reason); } catch(e) {}
    if (reasonObj.id === internalId) {
      targetRow = row;
      break;
    }
  }
  
  if (!targetRow) return;
  
  const status = profit > 0 ? 'HIT_TP' : 'HIT_SL';
  
  // 2. Insert into signal_layers
  const { error: insertErr } = await supabase.from('signal_layers').insert({
    signal_id: targetRow.id,
    ticket: ticket,
    status: status,
    profit: profit,
    hit_time: new Date().toISOString()
  });
  
  if (insertErr && insertErr.code !== '23505') {
     console.error('[DB] Error inserting signal layer:', insertErr);
  }
  
  // 3. Sum profits from signal_layers
  const { data: layers } = await supabase.from('signal_layers').select('profit').eq('signal_id', targetRow.id);
  const totalProfit = layers && layers.length > 0 ? layers.reduce((acc, curr) => acc + Number(curr.profit), 0) : profit;
  const finalStatus = totalProfit > 0 ? 'HIT_TP' : 'HIT_SL';
  const hitTimeWIB = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
  
  // 4. Update parent
  reasonObj.finalStatus = finalStatus;
  reasonObj.hitTime = hitTimeWIB;
  reasonObj.duration = Math.floor((new Date().getTime() - new Date(targetRow.timestamp).getTime()) / 60000);
  reasonObj.pips = totalProfit; // aggregated total
  reasonObj.accuracy = finalStatus === 'HIT_TP' ? 100 : 0;
  if (tradeStats) {
    reasonObj.mfePips = tradeStats.mfePips;
    reasonObj.maePips = tradeStats.maePips;
    reasonObj.timeToMfeSec = tradeStats.timeToMfeSec;
    reasonObj.timeToMaeSec = tradeStats.timeToMaeSec;
  }
  
  await supabase.from('signals').update({ reason: JSON.stringify(reasonObj) }).eq('id', targetRow.id);
  console.log(`[DB] Signal ${internalId} processed layer ticket ${ticket}. Total Profit: ${totalProfit}`);
}


export async function fetchSignalsByDate(startDate: string, endDate: string) {
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) return [];
  const { data, error } = await supabase
    .from('signals')
    .select('*, signal_layers(*)')
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
    timestamp: row.timestamp,
    layers: row.signal_layers || []
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
  let totalGrossProfit = 0, totalGrossLoss = 0;
  let maxStreak = 0, currentStreak = 0;
  let durations: number[] = [];

  for (const row of data) {
    let ext: any = {};
    try { ext = JSON.parse(row.reason); } catch (_) {}

    if (!ext.finalStatus) continue; // Skip sinyal yang masih aktif/belum selesai
    totalSignals++;

    const pips = ext.pips || 0;
    const dur = ext.duration || 0;
    totalPips += pips; // In IDR/Money context, this is actually net profit
    
    if (pips > 0) totalGrossProfit += pips;
    if (pips < 0) totalGrossLoss += Math.abs(pips);

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
  const avgWinPips = hitTP > 0 ? totalGrossProfit / hitTP : 0;
  const avgLossPips = hitSL > 0 ? totalGrossLoss / hitSL : 0;
  const expectancy = hitTP > 0 || hitSL > 0
    ? (winRate / 100 * avgWinPips) - ((1 - winRate / 100) * avgLossPips)
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
    totalGrossProfit: Math.round(totalGrossProfit),
    totalGrossLoss: Math.round(totalGrossLoss),
    totalNetProfit: Math.round(totalPips),
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

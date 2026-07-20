'use client';

import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3002';
const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

interface MonthlyStats {
  year: number; month: number;
  totalSignals: number; hitTP: number; hitSL: number;
  totalPips: number; winRate: number; maxDrawdownStreak: number;
  expectancy: number; avgDurationMins: number;
}

interface CapitalInfo {
  balance: number; riskPercent: number; suggestedLot: number; slPips: number;
}

interface DrawdownStatus {
  active: boolean; dailySLCount: number; maxDailySL: number; resetDate: string;
}

function getBadge(winRate: number, totalSignals: number) {
  if (totalSignals === 0) return { label: 'Belum Ada Data', color: '#6b7280', bg: '#1f2937' };
  if (winRate >= 60) return { label: '🟢 Konsisten', color: '#10b981', bg: '#052e16' };
  if (winRate >= 40) return { label: '🟡 Perlu Perbaikan', color: '#f59e0b', bg: '#1c1400' };
  return { label: '🔴 Under Control', color: '#ef4444', bg: '#1c0404' };
}

export default function PerformancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [capital, setCapital] = useState<CapitalInfo | null>(null);
  const [drawdown, setDrawdown] = useState<DrawdownStatus | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [riskInput, setRiskInput] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  
  // Converter States
  const [useConverter, setUseConverter] = useState(false);
  const [idrInput, setIdrInput] = useState('');
  const [exchangeRate, setExchangeRate] = useState('16000');
  const [accountType, setAccountType] = useState<'STANDARD' | 'CENT'>('STANDARD');

  useEffect(() => {
    if (useConverter && idrInput && exchangeRate) {
      const idr = parseFloat(idrInput);
      const rate = parseFloat(exchangeRate);
      if (idr > 0 && rate > 0) {
        const usd = idr / rate;
        const balance = accountType === 'CENT' ? usd * 100 : usd;
        setBalanceInput(balance.toFixed(2));
      }
    }
  }, [idrInput, exchangeRate, accountType, useConverter]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, capRes, ddRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/performance?year=${year}&month=${month}`),
        fetch(`${BACKEND_URL}/api/risk/capital`),
        fetch(`${BACKEND_URL}/api/risk/drawdown-status`)
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (capRes.ok) {
        const cap = await capRes.json();
        setCapital(cap);
        setBalanceInput(cap.balance > 0 ? String(cap.balance) : '');
        setRiskInput(String(cap.riskPercent));
      }
      if (ddRes.ok) setDrawdown(await ddRes.json());
    } catch (_) {}
    setLoading(false);
  }, [year, month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveCapital = async () => {
    setSaving(true);
    await fetch(`${BACKEND_URL}/api/risk/capital`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: parseFloat(balanceInput) || 0, riskPercent: parseFloat(riskInput) || 1 })
    });
    await fetchAll();
    setSaving(false);
  };

  const resetDrawdown = async () => {
    await fetch(`${BACKEND_URL}/api/risk/reset-drawdown`, { method: 'POST' });
    setResetMsg('✅ Drawdown Guard berhasil direset!');
    await fetchAll();
    setTimeout(() => setResetMsg(''), 3000);
  };

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const badge = stats ? getBadge(stats.winRate, stats.totalSignals) : null;
  const suggestedLot = capital ? (parseFloat(balanceInput) > 0
    ? (parseFloat(balanceInput) * (parseFloat(riskInput) / 100) / (capital.slPips)).toFixed(2)
    : '0.00') : '0.00';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a0f 0%, #0d1117 50%, #0a0f0a 100%)', color: '#e5e7eb', fontFamily: "'Inter', sans-serif", padding: '24px 16px' }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <a href="/" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>← Dashboard</a>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f9fafb', margin: '0 0 4px' }}>📊 Performance Tracker</h1>
        <p style={{ color: '#6b7280', margin: 0, fontSize: 14 }}>Pantau konsistensi AI sesuai standar Tangga 4: Scale Up Mode</p>

        {/* Month Navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 20, marginBottom: 24 }}>
          <button onClick={prevMonth} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '8px 16px', cursor: 'pointer', fontSize: 16 }}>‹</button>
          <span style={{ fontSize: 20, fontWeight: 600, color: '#f9fafb', minWidth: 180, textAlign: 'center' }}>{MONTH_NAMES[month - 1]} {year}</span>
          <button onClick={nextMonth} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '8px 16px', cursor: 'pointer', fontSize: 16 }}>›</button>
          {badge && (
            <span style={{ marginLeft: 'auto', padding: '6px 16px', borderRadius: 20, background: badge.bg, color: badge.color, fontWeight: 600, fontSize: 14, border: `1px solid ${badge.color}40` }}>
              {badge.label}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Memuat data...</div>
        ) : (
          <>
            {/* 6 Metric Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { icon: '📈', label: 'Total Profit Pips', value: stats ? (stats.totalPips > 0 ? '+' + stats.totalPips : stats.totalPips) : '—', color: (stats?.totalPips ?? 0) >= 0 ? '#10b981' : '#ef4444' },
                { icon: '🎯', label: 'Win Rate', value: stats ? stats.winRate + '%' : '—', color: (stats?.winRate ?? 0) >= 60 ? '#10b981' : (stats?.winRate ?? 0) >= 40 ? '#f59e0b' : '#ef4444' },
                { icon: '📉', label: 'Max Drawdown Streak', value: stats ? stats.maxDrawdownStreak + 'x SL berturut' : '—', color: (stats?.maxDrawdownStreak ?? 0) <= 2 ? '#10b981' : '#ef4444' },
                { icon: '💰', label: 'Expectancy', value: stats ? (stats.expectancy > 0 ? '+' + stats.expectancy : stats.expectancy) + ' pips' : '—', color: (stats?.expectancy ?? 0) > 0 ? '#10b981' : '#ef4444' },
                { icon: '📊', label: 'Total Sinyal', value: stats ? stats.hitTP + 'TP / ' + stats.hitSL + 'SL / ' + stats.totalSignals + ' total' : '—', color: '#60a5fa' },
                { icon: '⏳', label: 'Rata-rata Durasi', value: stats ? stats.avgDurationMins + ' menit' : '—', color: '#a78bfa' },
              ].map((m, i) => (
                <div key={i} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{m.icon}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Drawdown Guard Widget */}
            <div style={{ background: '#111827', border: `1px solid ${drawdown?.active ? '#ef444440' : '#1f2937'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#f9fafb', marginBottom: 4 }}>
                    🛡️ Drawdown Guard {drawdown?.active ? '— ⛔ AKTIF' : '— ✅ AMAN'}
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>
                    {drawdown ? `${drawdown.dailySLCount} / ${drawdown.maxDailySL} SL hari ini` : '—'}
                    {drawdown?.active && <span style={{ color: '#ef4444', marginLeft: 8 }}>Sinyal diblokir hingga besok atau reset manual.</span>}
                  </div>
                  {resetMsg && <div style={{ color: '#10b981', fontSize: 13, marginTop: 4 }}>{resetMsg}</div>}
                </div>
                {drawdown?.active && (
                  <button onClick={resetDrawdown} style={{ background: '#ef4444', border: 'none', borderRadius: 8, color: 'white', padding: '8px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    Reset Manual
                  </button>
                )}
              </div>
              {/* Progress bar */}
              <div style={{ marginTop: 12, background: '#1f2937', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${drawdown ? (drawdown.dailySLCount / drawdown.maxDailySL) * 100 : 0}%`, background: drawdown?.active ? '#ef4444' : '#f59e0b', borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
            </div>

            {/* Capital Risk Engine */}
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#f9fafb' }}>💰 Capital Risk Engine</div>
                <label style={{ fontSize: 13, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={useConverter} onChange={e => setUseConverter(e.target.checked)} />
                  Gunakan Konverter Rupiah
                </label>
              </div>

              {useConverter && (
                <div style={{ background: '#1f2937', padding: 16, borderRadius: 8, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Modal (Rupiah)</label>
                    <input type="number" value={idrInput} onChange={e => setIdrInput(e.target.value)} placeholder="Misal: 15000000" style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '8px 12px', fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Kurs (IDR/USD)</label>
                    <input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '8px 12px', fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Tipe Akun</label>
                    <select value={accountType} onChange={e => setAccountType(e.target.value as 'STANDARD' | 'CENT')} style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '8px 12px', fontSize: 14 }}>
                      <option value="STANDARD">Standard (USD)</option>
                      <option value="CENT">Micro/Cent (USC)</option>
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Saldo Modal {useConverter && accountType === 'CENT' ? '(USC Cent)' : '(USD)'}</label>
                  <input
                    type="number" value={balanceInput} onChange={e => { setBalanceInput(e.target.value); setUseConverter(false); }}
                    placeholder="Contoh: 1000"
                    style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', padding: '10px 12px', fontSize: 15, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Risk per Trade: <b style={{ color: '#f9fafb' }}>{riskInput}%</b></label>
                  <input
                    type="range" min="0.1" max="3" step="0.1" value={riskInput} onChange={e => setRiskInput(e.target.value)}
                    style={{ width: '100%', marginTop: 10 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ background: '#0d2818', border: '1px solid #10b98130', borderRadius: 8, padding: '10px 20px' }}>
                  <span style={{ color: '#6b7280', fontSize: 13 }}>📦 Lot Disarankan: </span>
                  <span style={{ color: '#10b981', fontWeight: 700, fontSize: 18 }}>{suggestedLot}</span>
                  <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 6 }}>lot {useConverter && accountType === 'CENT' ? '(Cent)' : ''}</span>
                </div>
                <button onClick={saveCapital} disabled={saving} style={{ background: '#2563eb', border: 'none', borderRadius: 8, color: 'white', padding: '10px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

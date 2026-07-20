'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft, 
  TrendingUp, 
  Target, 
  Activity, 
  DollarSign, 
  BarChart2, 
  Clock, 
  ShieldAlert, 
  ShieldCheck, 
  Wallet, 
  Package,
  ChevronLeft,
  ChevronRight,
  Calculator
} from 'lucide-react';
import Link from 'next/link';

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
  if (totalSignals === 0) return { label: 'Belum Ada Data', color: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-700' };
  if (winRate >= 60) return { label: 'Konsisten', color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-500/30' };
  if (winRate >= 40) return { label: 'Perlu Perbaikan', color: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-500/30' };
  return { label: 'Under Control', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-500/30' };
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
    setResetMsg('Drawdown Guard berhasil direset!');
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
    <div className="min-h-screen bg-cyber-bg text-gray-200 font-sans p-4 md:p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyber-panel via-cyber-bg to-[#05080f] scanlines">
      
      {/* Header Container */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Link href="/" className="flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={16} className="mr-1" /> Dashboard
          </Link>
        </div>
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-blue-500" size={28} />
            Performance Tracker
          </h1>
          <p className="text-gray-400 text-sm">
            Pantau konsistensi AI sesuai standar Tangga 4: Scale Up Mode
          </p>
        </div>

        {/* Month Navigator */}
        <div className="flex items-center justify-between bg-cyber-panel/60 border border-cyber-border backdrop-blur-md rounded-2xl p-4 mb-8 relative z-10">
          <div className="flex items-center gap-4">
            <button onClick={prevMonth} className="p-2 rounded-lg bg-cyber-bg text-gray-400 hover:bg-cyber-border hover:text-white transition-all">
              <ChevronLeft size={20} />
            </button>
            <span className="text-xl font-bold text-white min-w-[140px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button onClick={nextMonth} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
          
          {badge && (
            <div className={`px-4 py-1.5 rounded-full text-xs font-bold border ${badge.bg} ${badge.color} ${badge.border} flex items-center gap-1.5`}>
              <span className={`w-2 h-2 rounded-full ${badge.color.replace('text', 'bg')}`}></span>
              {badge.label}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: <TrendingUp size={22} className={(stats?.totalPips ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"} />, label: 'Total Profit Pips', value: stats ? (stats.totalPips > 0 ? '+' + stats.totalPips : stats.totalPips) : '—', color: (stats?.totalPips ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { icon: <Target size={22} className="text-blue-500" />, label: 'Win Rate', value: stats ? stats.winRate + '%' : '—', color: (stats?.winRate ?? 0) >= 60 ? 'text-emerald-400' : (stats?.winRate ?? 0) >= 40 ? 'text-amber-400' : 'text-red-400' },
                { icon: <Activity size={22} className="text-purple-500" />, label: 'Max Drawdown', value: stats ? stats.maxDrawdownStreak + 'x SL Streak' : '—', color: (stats?.maxDrawdownStreak ?? 0) <= 2 ? 'text-emerald-400' : 'text-red-400' },
                { icon: <DollarSign size={22} className="text-amber-500" />, label: 'Expectancy', value: stats ? (stats.expectancy > 0 ? '+' + stats.expectancy : stats.expectancy) + ' pips' : '—', color: (stats?.expectancy ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400' },
                { icon: <BarChart2 size={22} className="text-cyan-500" />, label: 'Total Sinyal', value: stats ? stats.hitTP + 'TP / ' + stats.hitSL + 'SL' : '—', color: 'text-white' },
                { icon: <Clock size={22} className="text-indigo-500" />, label: 'Rata-rata Durasi', value: stats ? stats.avgDurationMins + ' menit' : '—', color: 'text-white' },
              ].map((m, i) => (
                <div key={i} className="bg-gray-900/50 border border-gray-800/80 rounded-2xl p-5 hover:bg-gray-800/60 hover:scale-[1.02] hover:border-gray-700/80 transition-all duration-300">
                  <div className="mb-3 p-2 bg-cyber-bg w-fit rounded-lg">{m.icon}</div>
                  <div className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">{m.label}</div>
                  <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Drawdown Guard Widget */}
            <div className={`relative overflow-hidden rounded-2xl border p-6 transition-colors duration-500 ${drawdown?.active ? 'bg-red-950/20 border-red-900/50' : 'bg-gray-900/50 border-gray-800/80'}`}>
              
              {/* Background Glow */}
              {drawdown?.active && (
                <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/10 blur-3xl rounded-full -mr-20 -mt-20 pointer-events-none"></div>
              )}

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-lg font-bold text-white mb-1">
                    {drawdown?.active ? <ShieldAlert className="text-red-500" size={24} /> : <ShieldCheck className="text-emerald-500" size={24} />}
                    Drawdown Guard
                    <span className={`text-xs px-2 py-0.5 rounded-full ml-2 ${drawdown?.active ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {drawdown?.active ? 'AKTIF' : 'AMAN'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">
                    {drawdown ? `${drawdown.dailySLCount} / ${drawdown.maxDailySL} Stop Loss harian tersentuh.` : 'Memuat data...'}
                    {drawdown?.active && <span className="text-red-400 block mt-1">Sinyal diblokir hingga besok untuk melindungi modal.</span>}
                  </p>
                  {resetMsg && <div className="text-emerald-400 text-sm mt-2 flex items-center gap-1"><ShieldCheck size={14}/> {resetMsg}</div>}
                </div>
                
                {drawdown?.active && (
                  <button 
                    onClick={resetDrawdown} 
                    className="whitespace-nowrap px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-red-900/20 focus:ring-2 focus:ring-red-500/50 outline-none"
                  >
                    Reset Manual (Bypass)
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="mt-5 bg-gray-800/80 rounded-full h-2 w-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-700 ease-out rounded-full ${drawdown?.active ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${drawdown ? (drawdown.dailySLCount / drawdown.maxDailySL) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Capital Risk Engine */}
            <div className="bg-cyber-panel border border-cyber-border rounded-2xl p-6 relative z-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3 text-lg font-bold text-white">
                  <div className="p-2 bg-blue-900/30 rounded-lg">
                    <Wallet className="text-blue-400" size={24} />
                  </div>
                  Capital Risk Engine
                </div>
                
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors group">
                  <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${useConverter ? 'bg-blue-600 border-blue-500' : 'bg-gray-800 border-gray-700 group-hover:border-gray-600'}`}>
                    {useConverter && <ShieldCheck size={14} className="text-white" />}
                  </div>
                  <input type="checkbox" className="hidden" checked={useConverter} onChange={e => setUseConverter(e.target.checked)} />
                  Gunakan Konverter Rupiah
                </label>
              </div>

              {/* Converter Panel */}
              {useConverter && (
                <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-5 mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Modal Deposit (Rupiah)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">Rp</span>
                      <input 
                        type="number" 
                        value={idrInput} 
                        onChange={e => setIdrInput(e.target.value)} 
                        placeholder="15000000" 
                        className="w-full bg-gray-900/80 border border-gray-700 rounded-lg text-white pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all placeholder-gray-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Kurs Broker (IDR/USD)</label>
                    <div className="relative">
                      <Calculator className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                      <input 
                        type="number" 
                        value={exchangeRate} 
                        onChange={e => setExchangeRate(e.target.value)} 
                        className="w-full bg-gray-900/80 border border-gray-700 rounded-lg text-white pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Tipe Akun Trading</label>
                    <select 
                      value={accountType} 
                      onChange={e => setAccountType(e.target.value as 'STANDARD' | 'CENT')} 
                      className="w-full bg-gray-900/80 border border-gray-700 rounded-lg text-white px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="STANDARD">Standard (USD)</option>
                      <option value="CENT">Micro/Cent (USC)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Risk Settings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">
                    Saldo Aktif {useConverter && accountType === 'CENT' ? '(USC Cent)' : '(USD)'}
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                    <input
                      type="number" 
                      value={balanceInput} 
                      onChange={e => { setBalanceInput(e.target.value); setUseConverter(false); }}
                      placeholder="1000"
                      className="w-full bg-gray-800/80 border border-gray-700 rounded-xl text-white pl-9 pr-4 py-3 text-lg font-medium focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all placeholder-gray-600"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-gray-400">Risk per Trade</label>
                    <span className="text-sm font-bold text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded-md">{riskInput}%</span>
                  </div>
                  <input
                    type="range" min="0.1" max="3" step="0.1" 
                    value={riskInput} 
                    onChange={e => setRiskInput(e.target.value)}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 mt-4"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 mt-2 font-medium">
                    <span>0.1% (Safe)</span>
                    <span>1.5% (Normal)</span>
                    <span>3% (Aggressive)</span>
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-gray-800/50">
                <div className="flex items-center gap-4 bg-emerald-900/10 border border-emerald-900/30 px-5 py-3 rounded-xl w-full sm:w-auto">
                  <div className="p-2 bg-emerald-900/40 rounded-lg">
                    <Package className="text-emerald-400" size={20} />
                  </div>
                  <div>
                    <div className="text-[11px] text-emerald-500/70 font-semibold uppercase tracking-wider mb-0.5">Lot Disarankan</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-emerald-400">{suggestedLot}</span>
                      <span className="text-xs font-medium text-emerald-500/70">lot {useConverter && accountType === 'CENT' ? '(Cent)' : ''}</span>
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={saveCapital} 
                  disabled={saving} 
                  className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 focus:ring-2 focus:ring-blue-500/50 outline-none disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> Menyimpan...</>
                  ) : (
                    'Simpan Pengaturan'
                  )}
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

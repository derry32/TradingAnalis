'use client';

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Link from 'next/link';
import {
  RadioTower, Clock, AlertTriangle, TrendingUp, TrendingDown,
  Activity, BarChart2, Target, Zap, ArrowLeft,
  Lock, Play, CheckCircle2, Circle, ShieldAlert,
} from 'lucide-react';

interface NewsEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
  parsedDate?: number;
}

interface ActiveContext {
  event: NewsEvent;
  severity: 'EXTREME' | 'HIGH' | 'MEDIUM';
  phase: 'PRE' | 'DURING' | 'STABILIZATION' | 'POST';
}

interface LockedPrediction {
  buyProbability: number;
  sellProbability: number;
  bias: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  reasons: string[];
}

interface NewsStatus {
  weeklySchedule: NewsEvent[];
  activeContext: ActiveContext | null;
  engineState: 'IDLE' | 'PREPARE' | 'LOCKED' | 'EXECUTE';
  lockedPrediction: LockedPrediction | null;
  nextEvent: NewsEvent | null;
}

function useCountdown(targetDate: string | null) {
  const [timeLeft, setTimeLeft] = useState<string>('--:--:--');

  useEffect(() => {
    if (!targetDate) { setTimeLeft('--:--:--'); return; }
    const tick = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('00:00:00'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

const ENGINE_STATE_CONFIG = {
  IDLE:    { label: 'IDLE',    color: 'text-gray-400',   bg: 'bg-gray-800/60',   border: 'border-gray-700',   icon: Circle },
  PREPARE: { label: 'PREPARE', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', icon: Activity },
  LOCKED:  { label: 'LOCKED',  color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', icon: Lock },
  EXECUTE: { label: 'EXECUTE', color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    icon: Play },
};

const SEVERITY_CONFIG = {
  EXTREME: { label: 'EXTREME', color: 'text-red-400',    bg: 'bg-red-900/40',    border: 'border-red-600' },
  HIGH:    { label: 'HIGH',    color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700' },
  MEDIUM:  { label: 'MEDIUM',  color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800' },
};

function getNewsSeverity(title: string): 'EXTREME' | 'HIGH' | 'MEDIUM' {
  const t = title.toLowerCase();
  if (t.includes('fomc') || t.includes('powell') || t.includes('fed rate') ||
      t.includes('interest rate') || t.includes('federal funds') ||
      t.includes('nfp') || t.includes('non-farm') || t.includes('cpi') || t.includes('inflation')) {
    return 'EXTREME';
  }
  if (t.includes('ppi') || t.includes('unemployment') || t.includes('retail sales')) return 'HIGH';
  return 'MEDIUM';
}

function formatWIB(dateStr: string) {
  return new Date(dateStr).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isPast(dateStr: string) {
  return new Date(dateStr).getTime() < Date.now();
}

function isUpcoming(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now();
  return diff > 0 && diff <= 60 * 60 * 1000; // within 60 min
}

export default function NewsPage() {
  const [data, setData] = useState<NewsStatus | null>(null);
  const [countryFilter, setCountryFilter] = useState<'ALL' | 'USD' | 'CHF'>('ALL');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await axios.get<NewsStatus>(`${apiUrl}/api/news/status`);
      setData(res.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  const countdown = useCountdown(data?.nextEvent?.date ?? null);

  const engineCfg = ENGINE_STATE_CONFIG[data?.engineState ?? 'IDLE'];
  const EngineIcon = engineCfg.icon;

  const filteredSchedule = (data?.weeklySchedule ?? []).filter(e =>
    countryFilter === 'ALL' ? true : e.country === countryFilter
  );

  return (
    <div className="min-h-screen bg-cyber-bg text-gray-100 p-6 font-sans">
      {/* Header */}
      <header className="max-w-[1200px] mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-gray-500 hover:text-gray-300 transition-colors text-xs">
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl cyber-card-glow flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <RadioTower size={20} className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">News Center</h1>
              <p className="text-[10px] text-cyan-400/70 uppercase tracking-widest">Economic Calendar · Pre-News Engine</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/history" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-all cyber-card-glow">
            <Activity size={13} /> Tracker
          </Link>
          <Link href="/performance" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-all cyber-card-glow">
            <BarChart2 size={13} /> Performa
          </Link>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto space-y-6">

        {/* Top row: Engine State + Next Event */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Engine Status Card */}
          <div className={`cyber-card-glow rounded-2xl p-6 border ${engineCfg.border} ${engineCfg.bg} backdrop-blur-xl`}>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2">
              <ShieldAlert size={12} /> Pre-News Engine
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-3 h-3 rounded-full ${data?.engineState === 'IDLE' ? 'bg-gray-600' : 'bg-current animate-pulse'} ${engineCfg.color}`} />
              <span className={`text-2xl font-bold tracking-wider ${engineCfg.color}`}>{engineCfg.label}</span>
              <EngineIcon size={18} className={engineCfg.color} />
            </div>

            {data?.activeContext && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <p className="text-xs text-gray-400 mb-1">Active Event:</p>
                <p className="text-sm font-semibold text-gray-200">{data.activeContext.event.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${SEVERITY_CONFIG[data.activeContext.severity].color} ${SEVERITY_CONFIG[data.activeContext.severity].border} ${SEVERITY_CONFIG[data.activeContext.severity].bg}`}>
                    {data.activeContext.severity}
                  </span>
                  <span className="text-[10px] text-gray-500">Phase: {data.activeContext.phase}</span>
                </div>
              </div>
            )}

            {data?.engineState === 'IDLE' && (
              <p className="text-xs text-gray-600 mt-2">Menunggu event High Impact dalam 60 menit ke depan.</p>
            )}
          </div>

          {/* Next Event Spotlight */}
          <div className="cyber-card-glow rounded-2xl p-6 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2">
              <Clock size={12} /> Next High-Impact Event
            </p>
            {data?.nextEvent ? (
              <>
                <p className="text-lg font-bold text-gray-100 mb-1">{data.nextEvent.title}</p>
                <p className="text-xs text-gray-500 mb-3">{formatWIB(data.nextEvent.date)} WIB · {data.nextEvent.country}</p>
                <div className="text-3xl font-mono font-bold text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.6)] mb-4">
                  {countdown}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-black/20 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Forecast</p>
                    <p className="text-sm font-bold text-gray-200">{data.nextEvent.forecast || 'N/A'}</p>
                  </div>
                  <div className="bg-black/20 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Previous</p>
                    <p className="text-sm font-bold text-gray-200">{data.nextEvent.previous || 'N/A'}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                    (() => {
                      const s = getNewsSeverity(data.nextEvent.title);
                      return `${SEVERITY_CONFIG[s].color} ${SEVERITY_CONFIG[s].border} ${SEVERITY_CONFIG[s].bg}`;
                    })()
                  }`}>
                    {getNewsSeverity(data.nextEvent.title)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Tidak ada event High Impact dalam waktu dekat.</p>
            )}
          </div>
        </div>

        {/* Locked Prediction Card — only when LOCKED or EXECUTE */}
        {data?.lockedPrediction && (data.engineState === 'LOCKED' || data.engineState === 'EXECUTE') && (
          <div className="cyber-card-glow rounded-2xl p-6 border border-orange-700/50 bg-orange-900/10 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-widest text-orange-400/80 mb-4 flex items-center gap-2">
              <Lock size={12} /> Locked Prediction
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Bias */}
              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase mb-2">Directional Bias</p>
                <div className={`text-4xl font-bold flex items-center justify-center gap-2 ${data.lockedPrediction.bias === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {data.lockedPrediction.bias === 'BUY' ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                  {data.lockedPrediction.bias}
                </div>
                <p className="text-xs text-gray-500 mt-1">Confidence: {data.lockedPrediction.confidence}%</p>
              </div>
              {/* Probability Bars */}
              <div className="space-y-3">
                <p className="text-[10px] text-gray-500 uppercase mb-2">Probability</p>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-emerald-400">BUY</span>
                    <span className="text-emerald-400">{data.lockedPrediction.buyProbability}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${data.lockedPrediction.buyProbability}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-rose-400">SELL</span>
                    <span className="text-rose-400">{data.lockedPrediction.sellProbability}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${data.lockedPrediction.sellProbability}%` }} />
                  </div>
                </div>
              </div>
              {/* Reasons */}
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-2">Confluence</p>
                <ul className="space-y-1">
                  {data.lockedPrediction.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <CheckCircle2 size={12} className="text-cyan-500 mt-0.5 flex-shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Weekly Schedule Table */}
        <div className="cyber-card-glow rounded-2xl backdrop-blur-xl overflow-hidden">
          <div className="p-5 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-2">
              <Target size={15} className="text-cyan-400" />
              <span className="text-sm font-bold text-gray-200">Jadwal Minggu Ini</span>
              <span className="text-[10px] text-gray-500 ml-1">USD + CHF · High Impact</span>
            </div>
            <div className="flex items-center gap-1 text-[10px]">
              {(['ALL', 'USD', 'CHF'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setCountryFilter(f)}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${countryFilter === f ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-600 text-sm">Memuat jadwal...</div>
          ) : filteredSchedule.length === 0 ? (
            <div className="p-12 text-center text-gray-600 text-sm">Tidak ada event untuk filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-gray-500 uppercase tracking-wider text-[10px]">
                    <th className="p-4 text-left">Waktu (WIB)</th>
                    <th className="p-4 text-left">Event</th>
                    <th className="p-4 text-left">Country</th>
                    <th className="p-4 text-left">Severity</th>
                    <th className="p-4 text-right">Forecast</th>
                    <th className="p-4 text-right">Previous</th>
                    <th className="p-4 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedule.map((event, i) => {
                    const severity = getNewsSeverity(event.title);
                    const sevCfg = SEVERITY_CONFIG[severity];
                    const past = isPast(event.date);
                    const upcoming = isUpcoming(event.date);
                    return (
                      <tr
                        key={i}
                        className={`border-b border-white/5 transition-colors ${
                          upcoming
                            ? 'bg-cyan-900/10 hover:bg-cyan-900/20'
                            : past
                            ? 'opacity-40 hover:opacity-60'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="p-4 font-mono text-gray-300 whitespace-nowrap">
                          {formatWIB(event.date)}
                          {upcoming && <span className="ml-2 text-cyan-400 animate-pulse">▶</span>}
                        </td>
                        <td className="p-4 text-gray-200 max-w-[220px]">
                          <p className="font-semibold truncate">{event.title}</p>
                        </td>
                        <td className="p-4">
                          <span className={`font-bold ${event.country === 'USD' ? 'text-blue-400' : 'text-red-300'}`}>
                            {event.country}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${sevCfg.color} ${sevCfg.border} ${sevCfg.bg}`}>
                            {severity}
                          </span>
                        </td>
                        <td className="p-4 text-right text-gray-300 font-mono">{event.forecast || '—'}</td>
                        <td className="p-4 text-right text-gray-400 font-mono">{event.previous || '—'}</td>
                        <td className="p-4">
                          {past ? (
                            <span className="text-gray-600 text-[10px]">PASSED</span>
                          ) : upcoming ? (
                            <span className="text-cyan-400 font-bold text-[10px] animate-pulse">UPCOMING</span>
                          ) : (
                            <span className="text-gray-500 text-[10px]">SCHEDULED</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { 
  ArrowLeft, Crosshair, Zap, CheckCircle2, 
  XCircle, Clock, Target, TrendingUp,
  Activity, BarChart2, Calendar
} from 'lucide-react';
import Link from 'next/link';

export default function HistoryPage() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'ALL' | 'CUSTOM'>('TODAY');
  const [customDate, setCustomDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const fetchHistory = async (filterType: string, dateVal?: string) => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      
      const now = new Date();
      let start = new Date();
      let end = new Date();
      
      if (filterType === 'TODAY') {
        start.setHours(0, 0, 0, 0);
      } else if (filterType === 'WEEK') {
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
      } else if (filterType === 'MONTH') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
      } else if (filterType === 'ALL') {
        start = new Date('2020-01-01');
      } else if (filterType === 'CUSTOM' && dateVal) {
        start = new Date(dateVal);
        start.setHours(0, 0, 0, 0);
        end = new Date(dateVal);
        end.setHours(23, 59, 59, 999);
      }

      const startStr = start.toISOString();
      const endStr = filterType === 'CUSTOM' ? end.toISOString() : now.toISOString();

      const res = await axios.get(`${apiUrl}/api/history?start=${startStr}&end=${endStr}`);
      setSignals(res.data);
    } catch (e) {
      console.error('Failed to fetch history', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(filter, customDate);
  }, [filter, customDate]);

  // Compute Statistics
  const stats = useMemo(() => {
    let totalWin = 0;
    let totalLoss = 0;
    let perfectTrades = 0;

    signals.forEach(sig => {
      let ext: any = {};
      try { ext = JSON.parse(sig.reason) || {}; } catch(e) {}
      
      if (ext.finalStatus === 'HIT_TP') {
        totalWin++;
        if (ext.accuracy === 100) perfectTrades++;
      } else if (ext.finalStatus === 'HIT_SL') {
        totalLoss++;
      }
    });

    const completed = totalWin + totalLoss;
    const winRate = completed > 0 ? (totalWin / completed) * 100 : 0;

    return {
      winRate: winRate.toFixed(1),
      perfectTrades,
      totalSignals: signals.length
    };
  }, [signals]);

  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 p-6 font-sans selection:bg-emerald-500/30">
      <div className="max-w-[1400px] mx-auto">
        
        {/* Header & Filter */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="p-2 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors">
              <ArrowLeft size={20} className="text-gray-400" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400 flex items-center gap-2">
                <Activity size={24} className="text-blue-500" />
                Performance Tracker
              </h1>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-1">AI Signal History & Accuracy Analytics</p>
            </div>
          </div>

          {/* Date Filters */}
          <div className="flex items-center bg-gray-900/60 p-1.5 rounded-xl border border-gray-800/80 backdrop-blur-md">
            {['TODAY', 'WEEK', 'MONTH', 'ALL', 'CUSTOM'].map((f) => (
              <button 
                key={f}
                onClick={() => setFilter(f as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${filter === f ? 'bg-blue-600/90 text-white shadow-lg shadow-blue-500/20 border border-blue-500/50' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {f === 'ALL' ? <Calendar size={14} /> : <Clock size={14} />} 
                {f === 'TODAY' ? 'Hari Ini' : f === 'WEEK' ? 'Minggu Ini' : f === 'MONTH' ? 'Bulan Ini' : f === 'CUSTOM' ? 'Custom' : 'Semua'}
              </button>
            ))}
          </div>
          
          {filter === 'CUSTOM' && (
             <div className="flex items-center bg-gray-900/60 p-1.5 rounded-xl border border-gray-800/80 backdrop-blur-md">
                <input 
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-transparent text-gray-200 text-sm font-bold border-none outline-none px-3"
                />
             </div>
          )}
        </header>

        {/* Global Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-[#111827]/80 backdrop-blur-md border border-emerald-500/30 rounded-xl p-5 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <Target size={12} className="text-emerald-500" /> Overall Win Rate
            </p>
            <p className="text-3xl font-bold text-emerald-400">{stats.winRate}%</p>
          </div>
          <div className="bg-[#111827]/80 backdrop-blur-md border border-gray-800 rounded-xl p-5 shadow-lg">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-gray-400" /> Perfect Trades (100%)
            </p>
            <p className="text-3xl font-bold text-gray-200">{stats.perfectTrades}</p>
          </div>
          <div className="bg-[#111827]/80 backdrop-blur-md border border-gray-800 rounded-xl p-5 shadow-lg">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <BarChart2 size={12} className="text-gray-400" /> Total Signals
            </p>
            <p className="text-3xl font-bold text-gray-200">{stats.totalSignals}</p>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-[#111827]/90 backdrop-blur-xl border border-gray-800/50 rounded-2xl shadow-2xl overflow-hidden relative">
          <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"></div>
          
          <div className="overflow-x-auto min-h-[400px]">
            {loading ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                 <Zap size={32} className="animate-pulse mb-2 text-blue-500/50" />
                 <p className="text-sm font-medium tracking-widest uppercase">Menganalisis Data...</p>
               </div>
            ) : signals.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                 <Target size={32} className="mb-2 opacity-30" />
                 <p className="text-sm font-medium tracking-widest uppercase">Tidak ada sinyal di rentang waktu ini</p>
               </div>
            ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-900/50 border-b border-gray-800 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                  <th className="p-4 pl-6">Signal ID</th>
                  <th className="p-4">Strategy & Zone</th>
                  <th className="p-4">Action</th>
                  <th className="p-4">Win Probability</th>
                  <th className="p-4">Targets (E / TP / SL)</th>
                  <th className="p-4">Hit Time & Duration</th>
                  <th className="p-4 pr-6 text-right">Trade Accuracy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50 text-sm">
                {signals.map((sig, idx) => {
                  let ext: any = {};
                  try { ext = JSON.parse(sig.reason) || {}; } catch(e) {}
                  
                  const isBuy = sig.type === 'BUY';
                  const isHitTP = ext.finalStatus === 'HIT_TP';
                  const isHitSL = ext.finalStatus === 'HIT_SL';
                  const isExpired = ext.finalStatus === 'EXPIRED';
                  const isActive = !isHitTP && !isHitSL && !isExpired;

                  return (
                  <tr key={idx} className="hover:bg-gray-800/30 transition-colors group">
                    <td className="p-4 pl-6 align-top">
                      <div className="font-mono text-xs text-gray-300 font-medium mb-1">{ext.id || '-'}</div>
                      {sig.timestamp && (
                        <div className="text-[10px] text-gray-500 flex items-center gap-1">
                           <Clock size={10} /> {new Date(sig.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
                        </div>
                      )}
                    </td>
                    
                    <td className="p-4 align-top">
                      <div className="flex items-center gap-1.5 mb-1 text-gray-200 font-bold text-xs">
                        {ext.strategy === 'SNIPER' ? <Crosshair size={12} className="text-blue-400" /> : <Zap size={12} className="text-rose-400" />}
                        {ext.strategy === 'SNIPER' ? 'Sniper' : 'Scalper'}
                      </div>
                      <span className="text-[10px] text-gray-500">{ext.session || '-'}</span>
                    </td>

                    <td className="p-4 align-top">
                      <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold tracking-widest ${isBuy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                        {isBuy ? '🟢 BUY' : '🔴 SELL'}
                      </span>
                    </td>

                    <td className="p-4 align-top">
                      <div className="font-bold text-gray-200">{ext.confidence || 50}%</div>
                      <div className="text-[10px] text-gray-500">{ext.probability || '-'}</div>
                    </td>

                    <td className="p-4 align-top">
                      <div className="font-mono text-xs text-gray-300 mb-1">
                        <span className="text-gray-500">E:</span> {sig.entryPrice?.toFixed(2)}
                      </div>
                      <div className="font-mono text-[10px]">
                        <span className="text-emerald-400">TP: {sig.takeProfit?.toFixed(2)}</span>
                        <span className="text-gray-600 mx-1">/</span>
                        <span className="text-rose-400">SL: {sig.stopLoss?.toFixed(2)}</span>
                      </div>
                    </td>

                    <td className="p-4 align-top">
                      {isActive ? (
                        <span className="text-gray-500">-</span>
                      ) : (
                        <>
                          <div className="text-gray-300 text-xs mb-1 flex items-center gap-1">
                            <Clock size={12} className="text-gray-500" /> {ext.hitTime}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            ({ext.duration} Mins)
                          </div>
                        </>
                      )}
                    </td>

                    <td className="p-4 pr-6 align-top text-right">
                      {isHitSL ? (
                        <div>
                          <span className="text-rose-500 font-bold text-lg">0%</span>
                          <p className="text-[9px] text-rose-500/50 mt-0.5">FAILED</p>
                        </div>
                      ) : isExpired ? (
                        <div>
                          <span className="text-gray-500 font-bold text-lg">0%</span>
                          <p className="text-[9px] text-gray-500 mt-0.5">EXPIRED</p>
                        </div>
                      ) : isActive ? (
                        <div>
                          <span className="text-gray-400 font-bold text-lg">~50%</span>
                          <p className="text-[9px] text-gray-500 mt-0.5">IN PROGRESS</p>
                        </div>
                      ) : (
                        <div>
                          <span className={`font-bold text-lg ${ext.accuracy === 100 ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : 'text-emerald-400'}`}>
                            {ext.accuracy}%
                          </span>
                          {ext.accuracy === 100 ? (
                            <p className="text-[9px] text-yellow-500/80 mt-0.5 font-bold uppercase tracking-widest flex items-center justify-end gap-1">
                              <Zap size={10} /> Perfect
                            </p>
                          ) : (
                            <p className="text-[9px] text-rose-400/80 mt-0.5">
                              -{((ext.duration || 0) - 20) * 0.5}% Penalty
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                  </tr>
                );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

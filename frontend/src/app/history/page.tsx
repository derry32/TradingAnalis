'use client';

import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { 
  ArrowLeft, Crosshair, Zap, CheckCircle2, 
  XCircle, Clock, Target, TrendingUp,
  Activity, BarChart2, Calendar, Download
} from 'lucide-react';
import Link from 'next/link';

export default function HistoryPage() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'ALL' | 'CUSTOM'>('TODAY');
  const [customDate, setCustomDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState<'AI' | 'ROBOT'>('AI');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (id: string) => {
    if (!id) return;
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const exportExcel = () => {
    const headers = ['Signal ID', 'Time', 'Type', 'Strategy', 'Entry', 'TP', 'SL', 'Status', 'Profit', 'Hit Time', 'Duration (Mins)'];
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";
    
    signals.forEach(sig => {
      let ext: any = {};
      try { ext = JSON.parse(sig.reason) || {}; } catch(e) {}
      const isBuy = sig.type === 'BUY';
      const raw = ext.entryZone || (sig.entryPrice ? sig.entryPrice.toFixed(2) : '-');
      const match = raw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
      const entryPrice = match ? match[1]?.trim() : raw;
      const profit = ext.pips !== undefined ? ext.pips : '';
      
      const row = [
        ext.id || '-',
        new Date(sig.timestamp).toLocaleString('id-ID'),
        isBuy ? 'BUY' : 'SELL',
        ext.strategy,
        entryPrice,
        sig.takeProfit,
        sig.stopLoss,
        ext.finalStatus || 'ACTIVE',
        profit,
        ext.hitTime || '',
        ext.duration || ''
      ];
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trading_history_${filter}_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
    let totalGrossProfit = 0;
    let totalGrossLoss = 0;

    signals.forEach(sig => {
      let ext: any = {};
      try { ext = JSON.parse(sig.reason) || {}; } catch(e) {}
      
      const pips = ext.pips || 0;
      if (pips > 0) totalGrossProfit += pips;
      if (pips < 0) totalGrossLoss += Math.abs(pips);

      if (ext.finalStatus === 'HIT_TP') {
        totalWin++;
        if (ext.accuracy === 100) perfectTrades++;
      } else if (ext.finalStatus === 'HIT_SL') {
        totalLoss++;
      }
    });

    const completed = totalWin + totalLoss;
    const winRate = completed > 0 ? (totalWin / completed) * 100 : 0;
    const totalNetProfit = totalGrossProfit - totalGrossLoss;

    return {
      winRate: winRate.toFixed(1),
      perfectTrades,
      totalSignals: signals.length,
      totalGrossProfit,
      totalGrossLoss,
      totalNetProfit
    };
  }, [signals]);

  return (
    <div className="min-h-screen bg-cyber-bg text-gray-100 p-6 font-sans selection:bg-cyber-neon/30 scanlines">
      <div className="max-w-[1400px] mx-auto">
        
        {/* Header & Filter */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="p-2 cyber-card-glow rounded-lg hover:bg-cyber-bg transition-colors">
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

          <div className="flex flex-col items-end gap-3">
            {/* View Mode Toggle & Export */}
            <div className="flex items-center gap-3">
              <div className="flex bg-gray-900/50 p-1 rounded-xl border border-gray-800/50 relative z-10">
                <button onClick={() => setViewMode('AI')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'AI' ? 'bg-blue-600/90 text-white shadow-lg shadow-blue-500/20' : 'text-gray-400 hover:text-gray-200'}`}>Sinyal AI</button>
                <button onClick={() => setViewMode('ROBOT')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${viewMode === 'ROBOT' ? 'bg-emerald-600/90 text-white shadow-lg shadow-emerald-500/20' : 'text-gray-400 hover:text-gray-200'}`}>
                  Robot MT5
                </button>
              </div>
              <button 
                onClick={exportExcel}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-bold text-gray-200 transition-colors relative z-10"
              >
                <Download size={14} className="text-blue-400" /> Export
              </button>
            </div>

            {/* Date Filters */}
          <div 
            className="flex items-center cyber-card-glow p-1.5 rounded-xl backdrop-blur-md overflow-x-auto max-w-[calc(100vw-3rem)] md:max-w-full relative z-10"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {['TODAY', 'WEEK', 'MONTH', 'ALL', 'CUSTOM'].map((f) => (
              <button 
                key={f}
                onClick={() => setFilter(f as any)}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${filter === f ? 'bg-cyber-purple/90 text-white shadow-lg shadow-cyber-purple/20 border border-cyber-purple/50 drop-shadow-[0_0_5px_rgba(139,92,246,0.8)]' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {f === 'ALL' ? <Calendar size={14} /> : <Clock size={14} />} 
                {f === 'TODAY' ? 'Hari Ini' : f === 'WEEK' ? 'Minggu Ini' : f === 'MONTH' ? 'Bulan Ini' : f === 'CUSTOM' ? 'Custom' : 'Semua'}
              </button>
            ))}
          </div>
          
          {filter === 'CUSTOM' && (
             <div className="flex items-center cyber-card-glow p-1.5 rounded-xl backdrop-blur-md relative z-10">
                <input 
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-transparent text-gray-200 text-sm font-bold border-none outline-none px-3"
                />
             </div>
          )}
          </div>
        </header>

        {/* Global Statistics */}
        <div className={`grid grid-cols-1 md:grid-cols-3 ${viewMode === 'ROBOT' ? 'lg:grid-cols-6 grid-cols-2' : ''} gap-4 mb-8`}>
          <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-[0_0_15px_rgba(0,255,157,0.1)] relative z-10">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <Target size={12} className="text-cyber-neon drop-shadow-[0_0_5px_rgba(0,255,157,0.8)]" /> Overall Win Rate
            </p>
            <p className={`${viewMode === 'ROBOT' ? 'text-2xl' : 'text-3xl'} font-bold text-cyber-neon drop-shadow-[0_0_5px_rgba(0,255,157,0.8)]`}>{stats.winRate}%</p>
          </div>
          <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-lg relative z-10">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-gray-400" /> Perfect Trades
            </p>
            <p className={`${viewMode === 'ROBOT' ? 'text-2xl' : 'text-3xl'} font-bold text-gray-200`}>{stats.perfectTrades}</p>
          </div>
          <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-lg relative z-10">
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
              <BarChart2 size={12} className="text-gray-400" /> Total Signals
            </p>
            <p className={`${viewMode === 'ROBOT' ? 'text-2xl' : 'text-3xl'} font-bold text-gray-200`}>{stats.totalSignals}</p>
          </div>
          
          {viewMode === 'ROBOT' && (
            <>
              <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-lg relative z-10">
                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
                  <TrendingUp size={12} className="text-emerald-400" /> Total Profit
                </p>
                <p className="text-lg font-bold text-emerald-400">{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(stats.totalGrossProfit)}</p>
              </div>
              <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-lg relative z-10">
                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
                  <TrendingUp size={12} className="text-rose-400" /> Total Loss
                </p>
                <p className="text-lg font-bold text-rose-400">{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(stats.totalGrossLoss)}</p>
              </div>
              <div className="cyber-card-glow backdrop-blur-md rounded-xl p-5 shadow-lg relative z-10">
                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
                  <Activity size={12} className={stats.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'} /> Net Profit
                </p>
                <p className={`text-lg font-bold ${stats.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {stats.totalNetProfit > 0 ? '+' : ''}{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(stats.totalNetProfit)}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Data Table */}
        <div className="cyber-card-glow backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden relative z-10">
          <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-cyber-purple/20 to-transparent"></div>
          
          <div className="overflow-x-auto min-h-[400px]">
            {loading ? (
               <div className="flex flex-col gap-3 p-6">
                 {[1,2,3,4,5].map(i => (
                   <div key={i} className="w-full h-16 bg-gray-800/40 rounded-xl animate-pulse"></div>
                 ))}
               </div>
            ) : signals.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                 <Target size={32} className="mb-2 opacity-30" />
                 <p className="text-sm font-medium tracking-widest uppercase">Tidak ada sinyal di rentang waktu ini</p>
               </div>
            ) : (
            <>
            <table className="hidden md:table w-full text-left border-collapse relative z-10">
              <thead>
                <tr className="bg-cyber-panel/50 border-b border-cyber-border text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                  <th className="p-4 pl-6">Signal ID</th>
                  <th className="p-4">Strategy & Zone</th>
                  <th className="p-4">Action</th>
                  <th className="p-4">Win Probability</th>
                  <th className="p-4">Targets (E / TP / SL)</th>
                  <th className="p-4">Hit Time & Duration</th>
                  <th className="p-4 pr-6 text-right">{viewMode === 'ROBOT' ? 'Profit / Loss' : 'Trade Accuracy'}</th>
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
                  <React.Fragment key={idx}>
                  <tr className="hover:bg-gray-800/40 hover:translate-x-1 transition-all duration-300 group relative border-l-2 border-transparent hover:border-blue-500">
                    <td className="p-4 pl-6 align-top">
                      <div 
                        className={`font-mono text-xs text-gray-300 font-medium mb-1 ${viewMode === 'ROBOT' ? 'cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1' : ''}`}
                        onClick={() => viewMode === 'ROBOT' && toggleRow(ext.id)}
                      >
                        {ext.id || '-'}
                        {viewMode === 'ROBOT' && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">Layers {expandedRows[ext.id] ? '▲' : '▼'}</span>
                        )}
                      </div>
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
                      {ext?.setupType && (
                        <div className="text-[10px] text-amber-400/90 font-medium mt-1">
                          {ext.setupType}
                        </div>
                      )}
                    </td>

                    <td className="p-4 align-top">
                      <div className="font-bold text-gray-200">{ext.confidence || 50}%</div>
                      <div className="text-[10px] text-gray-500">{ext.probability || '-'}</div>
                    </td>

                    <td className="p-4 align-top">
                      <div className="flex flex-col gap-1.5">
                        {(() => {
                          const raw = ext.entryZone || (sig.entryPrice ? sig.entryPrice.toFixed(2) : '-');
                          const match = raw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
                          const priceDisplay = match ? match[1]?.trim() : raw;
                          const badgeTag = match && match[2] ? match[2].trim() : null;

                          return (
                            <div className="flex flex-wrap items-center gap-1.5 max-w-[200px]">
                              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-800/80 border border-gray-700/60">
                                <span className="text-[9px] font-bold text-gray-400">ENTRY</span>
                                <span className="font-mono text-xs font-semibold text-gray-200">{priceDisplay}</span>
                              </div>
                              {badgeTag && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-medium">
                                  {badgeTag}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-1.5">
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                            <span className="text-[9px] font-bold text-emerald-500/70">TP</span>
                            <span className="font-mono text-[10px] text-emerald-400">{sig.takeProfit?.toFixed(2)}</span>
                          </div>
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                            <span className="text-[9px] font-bold text-rose-500/70">SL</span>
                            <span className="font-mono text-[10px] text-rose-400">{sig.stopLoss?.toFixed(2)}</span>
                          </div>
                        </div>
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
                      {viewMode === 'ROBOT' ? (
                        <div>
                          {ext.finalStatus === 'HIT_TP' || ext.finalStatus === 'HIT_SL' ? (
                            ext.pips > 0 ? (
                               <span className="font-bold text-lg text-emerald-400">+{Number(ext.pips).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                            ) : ext.pips < 0 ? (
                               <span className="font-bold text-lg text-rose-500">{Number(ext.pips).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                            ) : (
                               <span className="font-bold text-lg text-gray-400">0</span>
                            )
                          ) : (
                            <span className="text-gray-500 font-bold text-lg">-</span>
                          )}
                          <p className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-widest">
                            {ext.pips > 0 ? 'PROFIT' : ext.pips < 0 ? 'LOSS' : (ext.finalStatus === 'HIT_TP' ? 'PROFIT' : ext.finalStatus === 'HIT_SL' ? 'LOSS' : ext.finalStatus === 'EXPIRED' ? 'EXPIRED' : 'IN PROGRESS')}
                          </p>
                        </div>
                      ) : (
                        isHitSL ? (
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
                            <p className="text-[9px] text-gray-500 mt-0.5">{ext.finalStatus === 'EXPIRED' ? 'EXPIRED' : 'IN PROGRESS'}</p>
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
                        )
                      )}
                    </td>

                  </tr>
                  {viewMode === 'ROBOT' && expandedRows[ext.id] && sig.layers && sig.layers.length > 0 && (
                    <tr className="bg-gray-800/20 border-b border-gray-800/30">
                      <td colSpan={7} className="p-4 pl-6">
                        <div className="flex flex-col gap-2 bg-gray-900/50 p-3 rounded-lg border border-gray-800/50">
                          <p className="text-xs text-gray-400 font-bold mb-1">Rincian Entry (Layers)</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {sig.layers.map((layer: any, lIdx: number) => (
                              <div key={lIdx} className="flex items-center justify-between p-2 bg-gray-800/40 rounded border border-gray-700/30">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-500 font-mono">#{layer.ticket}</span>
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${layer.status === 'HIT_TP' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{layer.status === 'HIT_TP' ? 'PROFIT' : 'LOSS'}</span>
                                </div>
                                <div className="text-right">
                                  {layer.profit > 0 ? (
                                    <span className="text-xs font-bold text-emerald-400">+{Number(layer.profit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  ) : (
                                    <span className="text-xs font-bold text-rose-500">{Number(layer.profit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  )}
                                  <div className="text-[9px] text-gray-500">{new Date(layer.hit_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
                })}
              </tbody>
            </table>

            {/* Mobile View */}
            <div className="md:hidden flex flex-col divide-y divide-gray-800/50">
              {signals.map((sig, idx) => {
                  let ext: any = {};
                  try { ext = JSON.parse(sig.reason) || {}; } catch(e) {}
                  
                  const isBuy = sig.type === 'BUY';
                  const isHitTP = ext.finalStatus === 'HIT_TP';
                  const isHitSL = ext.finalStatus === 'HIT_SL';
                  const isExpired = ext.finalStatus === 'EXPIRED';
                  const isActive = !isHitTP && !isHitSL && !isExpired;

                  return (
                    <React.Fragment key={idx}>
                    <div className="p-4 flex flex-col gap-4 hover:bg-gray-800/30 transition-colors">
                      {/* Header Row */}
                      <div className="flex items-center justify-between">
                         <div>
                            <div 
                              className={`font-mono text-xs text-gray-300 font-medium mb-1 ${viewMode === 'ROBOT' ? 'cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1' : ''}`}
                              onClick={() => viewMode === 'ROBOT' && toggleRow(ext.id)}
                            >
                              {ext.id || '-'}
                              {viewMode === 'ROBOT' && (
                                <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">Layers {expandedRows[ext.id] ? '▲' : '▼'}</span>
                              )}
                            </div>
                            {sig.timestamp && (
                              <div className="text-[10px] text-gray-500 flex items-center gap-1">
                                 <Clock size={10} /> {new Date(sig.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
                              </div>
                            )}
                         </div>
                         <div className="text-right">
                            <div className="flex items-center justify-end gap-1.5 mb-1 text-gray-200 font-bold text-xs">
                              {ext.strategy === 'SNIPER' ? <Crosshair size={12} className="text-blue-400" /> : <Zap size={12} className="text-rose-400" />}
                              {ext.strategy === 'SNIPER' ? 'Sniper' : 'Scalper'}
                            </div>
                            <span className="text-[10px] text-gray-500">{ext.session || '-'}</span>
                         </div>
                      </div>

                      {/* Main Action & Accuracy Row */}
                      <div className="flex items-center justify-between bg-gray-900/40 p-3 rounded-lg border border-gray-800/50">
                         <div className="flex items-center gap-3">
                            <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold tracking-widest ${isBuy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                              {isBuy ? '🟢 BUY' : '🔴 SELL'}
                            </span>
                            <div>
                               <div className="font-bold text-gray-200 text-xs">{ext.confidence || 50}%</div>
                               <div className="text-[9px] text-gray-500">WIN PROBABILITY</div>
                            </div>
                         </div>
                         <div className="text-right">
                           {viewMode === 'ROBOT' ? (
                              <div>
                                {ext.finalStatus === 'HIT_TP' || ext.finalStatus === 'HIT_SL' ? (
                                  ext.pips > 0 ? (
                                     <span className="font-bold text-sm text-emerald-400">+{Number(ext.pips).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  ) : ext.pips < 0 ? (
                                     <span className="font-bold text-sm text-rose-500">{Number(ext.pips).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  ) : (
                                     <span className="font-bold text-sm text-gray-400">0</span>
                                  )
                                ) : (
                                  <span className="text-gray-500 font-bold text-sm">-</span>
                                )}
                                <p className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-widest">
                                  {ext.pips > 0 ? 'PROFIT' : ext.pips < 0 ? 'LOSS' : (ext.finalStatus === 'HIT_TP' ? 'PROFIT' : ext.finalStatus === 'HIT_SL' ? 'LOSS' : ext.finalStatus === 'EXPIRED' ? 'EXPIRED' : 'IN PROGRESS')}
                                </p>
                              </div>
                           ) : (
                             isHitSL ? (
                               <div>
                                 <span className="text-rose-500 font-bold text-sm">0%</span>
                                 <p className="text-[9px] text-rose-500/50 mt-0.5">FAILED</p>
                               </div>
                             ) : isExpired ? (
                               <div>
                                 <span className="text-gray-500 font-bold text-sm">0%</span>
                                 <p className="text-[9px] text-gray-500 mt-0.5">EXPIRED</p>
                               </div>
                             ) : isActive ? (
                               <div>
                                 <span className="text-gray-400 font-bold text-sm">~50%</span>
                                 <p className="text-[9px] text-gray-500 mt-0.5">{ext.finalStatus === 'EXPIRED' ? 'EXPIRED' : 'IN PROGRESS'}</p>
                               </div>
                             ) : (
                               <div>
                                 <span className={`font-bold text-sm ${ext.accuracy === 100 ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : 'text-emerald-400'}`}>
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
                             )
                           )}
                         </div>
                      </div>

                      {/* Targets Row */}
                      <div className="flex flex-col gap-2">
                        {(() => {
                          const raw = ext.entryZone || (sig.entryPrice ? sig.entryPrice.toFixed(2) : '-');
                          const match = raw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
                          const priceDisplay = match ? match[1]?.trim() : raw;
                          const badgeTag = match && match[2] ? match[2].trim() : null;

                          return (
                            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-gray-800/80 border border-gray-700/60">
                              <span className="text-[10px] font-bold text-gray-400">ENTRY</span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs font-semibold text-gray-200">{priceDisplay}</span>
                                {badgeTag && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-medium">
                                    {badgeTag}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-2 w-full">
                          <div className="inline-flex items-center justify-between px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 flex-1">
                            <span className="text-[10px] font-bold text-emerald-500/70">TP</span>
                            <span className="font-mono text-[11px] text-emerald-400">{sig.takeProfit?.toFixed(2)}</span>
                          </div>
                          <div className="inline-flex items-center justify-between px-2 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 flex-1">
                            <span className="text-[10px] font-bold text-rose-500/70">SL</span>
                            <span className="font-mono text-[11px] text-rose-400">{sig.stopLoss?.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Row (Time) */}
                      {!isActive && (
                        <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1 border-t border-gray-800/50 pt-2">
                           <div className="flex items-center gap-1"><Clock size={10} /> Hit Time: {ext.hitTime}</div>
                           <div>Duration: {ext.duration} Mins</div>
                        </div>
                      )}
                    </div>
                    {viewMode === 'ROBOT' && expandedRows[ext.id] && sig.layers && sig.layers.length > 0 && (
                        <div className="bg-gray-900/60 p-4 border-t border-gray-800/50">
                          <p className="text-xs text-gray-400 font-bold mb-2">Rincian Entry (Layers)</p>
                          <div className="flex flex-col gap-2">
                            {sig.layers.map((layer: any, lIdx: number) => (
                              <div key={lIdx} className="flex items-center justify-between p-2.5 bg-gray-800/50 rounded-lg border border-gray-700/40">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] text-gray-500 font-mono">#{layer.ticket}</span>
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 w-fit rounded ${layer.status === 'HIT_TP' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{layer.status === 'HIT_TP' ? 'PROFIT' : 'LOSS'}</span>
                                </div>
                                <div className="text-right">
                                  {layer.profit > 0 ? (
                                    <span className="text-sm font-bold text-emerald-400">+{Number(layer.profit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  ) : (
                                    <span className="text-sm font-bold text-rose-500">{Number(layer.profit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                  )}
                                  <div className="text-[10px] text-gray-500">{new Date(layer.hit_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                    )}
                    </React.Fragment>
                  );
              })}
            </div>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

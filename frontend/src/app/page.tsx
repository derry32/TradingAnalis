'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { 
  TrendingUp, TrendingDown, Clock, Activity, 
  CheckCircle2, XCircle, AlertTriangle, 
  ArrowUpRight, ArrowDownRight, Zap, Target,
  Crosshair, ShieldAlert, RadioTower, BarChart2
} from 'lucide-react';
import Link from 'next/link';
import { SystemHealthWidget } from '../components/SystemHealthWidget';

const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

export default function Home() {
  const [signals, setSignals] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const statusRes = await axios.get(`${apiUrl}/api/status`);
        setStatus(statusRes.data);
        
        const signalsRes = await axios.get(`${apiUrl}/api/signals`);
        setSignals(signalsRes.data);
      } catch (e) {
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleStrategy = async (newStrategy: string) => {
    if (!status || status.config?.strategy === newStrategy) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      await axios.post(`${apiUrl}/api/settings/strategy`, { strategy: newStrategy });
      setStatus({
        ...status,
        config: { ...status.config, strategy: newStrategy }
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Helper to render confidence stars as progress bar
  const renderConfidence = (conf: number) => {
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${conf >= 80 ? 'bg-emerald-500' : conf >= 60 ? 'bg-yellow-500' : 'bg-rose-500'}`} 
            style={{ width: `${conf}%` }}
          />
        </div>
        <span className="text-[10px] font-bold text-gray-400 tracking-wider whitespace-nowrap">WIN: {conf}%</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-cyber-bg text-gray-100 p-6 font-sans selection:bg-cyber-neon/30 scanlines">
      
      {/* Top Header & Strategy Toggle */}
      <header className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="flex justify-between items-center w-full sm:w-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl cyber-card-glow flex items-center justify-center shadow-lg shadow-cyber-neon/10">
              <Target size={20} className="text-cyber-neon drop-shadow-[0_0_8px_rgba(0,255,157,0.8)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">
                Trade Signal
              </h1>
              <p className="text-[10px] text-emerald-400/70 font-medium tracking-widest uppercase">Trading Analyst Engine</p>
            </div>
          </div>
          <div className="sm:hidden">
            <SystemHealthWidget />
          </div>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="hidden sm:block">
            <SystemHealthWidget />
          </div>
          <div 
            className="flex items-center cyber-card-glow p-1.5 rounded-xl backdrop-blur-md relative z-10 overflow-x-auto w-full sm:w-max"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
          <Link href="/history" className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-gray-400 hover:bg-cyber-bg hover:text-gray-200 transition-all mr-1">
            <Activity size={14} /> Tracker
          </Link>
          <Link href="/performance" className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-gray-400 hover:bg-cyber-bg hover:text-gray-200 transition-all mr-1">
            <BarChart2 size={14} /> Performa
          </Link>
          <div className="flex-shrink-0 w-[1px] h-6 bg-cyber-border mr-1"></div>
          <button 
            onClick={() => toggleStrategy('SNIPER')}
            className={`flex-shrink-0 flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${status?.config?.strategy === 'SNIPER' ? 'bg-cyber-purple/90 text-white shadow-lg shadow-cyber-purple/30 border border-cyber-purple/50 drop-shadow-[0_0_5px_rgba(139,92,246,0.8)]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Crosshair size={14} /> Sniper (M15)
          </button>
          <button 
            onClick={() => toggleStrategy('HYPER_SCALPER')}
            className={`flex-shrink-0 flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${status?.config?.strategy === 'HYPER_SCALPER' ? 'bg-cyber-amber/90 text-white shadow-lg shadow-cyber-amber/30 border border-cyber-amber/50 drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Zap size={14} /> Scalper (M5)
          </button>
        </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Side: Chart */}
        <section className="lg:col-span-3 space-y-6">
          <div className="cyber-card-glow backdrop-blur-xl rounded-2xl p-1 shadow-2xl relative overflow-hidden">
             {/* Subtle Glow */}
             <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent"></div>
            <Chart />
          </div>
        </section>

        {/* Right Side: Dashboard Panel */}
        <section className="space-y-4 flex flex-col">
          {/* Status Pills */}
          <div className="grid grid-cols-2 gap-4 w-full">
            <div className="cyber-card-glow backdrop-blur-md rounded-xl p-4 shadow-lg group hover:border-gray-700 transition-all duration-300">
              <div className="flex flex-wrap justify-between items-start gap-1 mb-1">
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1">
                  <Activity size={12} /> Sentiment
                </p>
                {status?.sentimentStatus?.score && (
                   <span className="text-[9px] bg-cyber-bg px-2 py-1 rounded border border-cyber-border text-gray-300 font-medium whitespace-nowrap">
                     Skor: {status.sentimentStatus.score}
                   </span>
                )}
              </div>
              <p className={`text-lg font-bold flex items-center gap-2 ${status?.sentimentStatus?.sentiment === 'BULLISH' ? 'text-emerald-400' : status?.sentimentStatus?.sentiment === 'BEARISH' ? 'text-rose-400' : 'text-gray-300'}`}>
                {status?.sentimentStatus?.sentiment === 'BULLISH' && <TrendingUp size={18} />}
                {status?.sentimentStatus?.sentiment === 'BEARISH' && <TrendingDown size={18} />}
                {status?.sentimentStatus?.sentiment || 'ANALYZING'}
              </p>
            </div>

            <div className="cyber-card-glow backdrop-blur-md rounded-xl p-4 shadow-lg group hover:border-gray-700 transition-all duration-300">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1 mb-2">
                <BarChart2 size={12} /> Technical
              </p>
              <p className={`text-lg font-bold flex items-center gap-2 ${status?.technicalStatus === 'BULLISH' ? 'text-emerald-400' : status?.technicalStatus === 'BEARISH' ? 'text-rose-400' : 'text-gray-300'}`}>
                {status?.technicalStatus || 'NEUTRAL'}
              </p>
            </div>
          </div>

          <div className="cyber-card-glow backdrop-blur-md rounded-xl p-4 shadow-lg flex justify-between items-center w-full group hover:border-yellow-500/20 transition-all duration-300">
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1">
              <Clock size={12} /> Active Session
            </p>
            <p className="text-xs font-bold text-yellow-500/90 bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/20">
              {status?.activeSession || 'LOADING...'}
            </p>
          </div>

          {status?.upcomingNews && (
            <div className="cyber-card-glow rounded-xl p-5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyber-purple/5 rounded-full blur-2xl -mr-10 -mt-10 transition-all group-hover:bg-cyber-purple/10"></div>
              <p className="text-[10px] text-orange-400/80 uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                <ShieldAlert size={14} className="text-orange-500" />
                High Impact News Radar
              </p>
              <p className="text-sm font-semibold text-gray-200 mb-1 leading-snug">
                {status.upcomingNews.title} <span className="text-gray-500">({status.upcomingNews.country})</span>
              </p>
              <div className="flex justify-between items-end mt-4">
                <div>
                  <p className="text-[10px] font-medium text-gray-400 bg-cyber-bg px-2 py-1 rounded">
                    {new Date(status.upcomingNews.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-0.5">Forecast Bias</p>
                  <p className={`text-[11px] font-bold ${status?.sentimentStatus?.sentiment === 'BULLISH' ? 'text-emerald-400' : status?.sentimentStatus?.sentiment === 'BEARISH' ? 'text-rose-400' : 'text-gray-400'}`}>
                    {status?.sentimentStatus?.sentiment || 'UNKNOWN'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="cyber-card-glow backdrop-blur-xl rounded-2xl shadow-xl flex flex-col h-[530px] relative overflow-hidden">
            {/* Top Glow Edge */}
            <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"></div>
            
            <div className="p-4 border-b border-cyber-border flex justify-between items-center bg-cyber-panel">
              <h2 className="text-sm font-bold flex items-center gap-2 text-gray-100">
                <RadioTower size={16} className="text-emerald-400" />
                Live Signals
              </h2>
              <span className="bg-cyber-bg text-gray-300 border border-cyber-border px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase">
                XAU/USD
              </span>
            </div>
            
            {status?.analysisDetail && (
              <div className="bg-blue-950/10 border-b border-cyber-border p-4 flex items-start gap-3 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500/50"></div>
                <Zap size={14} className="text-blue-400 mt-0.5 animate-pulse" />
                <div>
                  <p className="text-[10px] font-bold text-blue-400/80 uppercase tracking-widest mb-1.5">AI Engine Status</p>
                  <p className="text-xs text-blue-100/70 leading-relaxed font-medium">{status.analysisDetail}</p>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {signals.length === 0 ? (
                <div className="text-center flex flex-col items-center justify-center h-full opacity-50">
                  <Target size={32} className="text-gray-600 mb-3" />
                  <p className="text-xs text-gray-400 font-medium tracking-wide">Waiting for sniper setup...</p>
                </div>
              ) : (
                signals.map((sig, idx) => {
                  let textReason = sig.reason;
                  let ext: any = null;
                  try {
                    ext = typeof sig.reason === 'string' ? JSON.parse(sig.reason) : sig.reason;
                    textReason = ext.text || sig.reason;
                  } catch (e: any) {
                    console.log("Parse fallback");
                  }

                  const isBuy = sig.type === 'BUY';
                  
                  return (
                    <div key={idx} className={`relative bg-gray-900/70 backdrop-blur-md rounded-xl p-4 border transition-all duration-300 group hover:-translate-y-0.5 overflow-hidden ${isBuy ? 'border-emerald-500/30 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'border-rose-500/30 hover:border-rose-500/50 hover:shadow-[0_0_20px_rgba(244,63,94,0.15)]'}`}>
                    
                    {/* Signal Header: Row 1 (Type & Time) */}
                    <div className="flex justify-between items-center gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold tracking-wide border shadow-sm ${isBuy ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border-rose-500/30'}`}>
                          {isBuy ? <ArrowUpRight size={13} className="shrink-0" /> : <ArrowDownRight size={13} className="shrink-0" />}
                          <span>{sig.type}</span>
                        </div>
                        {ext?.probability && (
                          <span className="text-[10px] font-medium text-gray-300 bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/60 truncate">
                            {ext.probability.replace(/[^\x00-\x7F]/g, "").trim()}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-gray-800/60 px-2 py-0.5 rounded border border-gray-700/50 shrink-0">
                        <Clock size={11} className="text-gray-400" />
                        <span>{new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    {/* Setup Type & Market Phase Badges */}
                    {ext?.setupType && (
                      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                        <span className="inline-flex items-center text-[10px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-md">
                          {ext.setupType}
                        </span>
                        {ext.marketPhase && ext.marketPhase !== 'N/A' && (
                          <span className="inline-flex items-center text-[9px] font-mono uppercase tracking-wider text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">
                            {ext.marketPhase}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Signal Header: Row 2 (ID & Win Rate Bar) */}
                    <div className="flex justify-between items-center gap-2 mb-3 pb-2.5 border-b border-gray-800/60">
                      {ext?.id ? (
                        <span className="text-[10px] text-gray-400 font-mono tracking-tight truncate">
                          ID: <span className="text-gray-300">{ext.id}</span>
                        </span>
                      ) : <span />}
                      
                      {ext?.confidence && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden border border-gray-700/50">
                            <div 
                              className={`h-full rounded-full transition-all duration-500 ${ext.confidence >= 80 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : ext.confidence >= 60 ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.8)]' : 'bg-rose-400'}`} 
                              style={{ width: `${ext.confidence}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono font-bold text-gray-300 whitespace-nowrap">WIN {ext.confidence}%</span>
                        </div>
                      )}
                    </div>

                    {/* Price Targets Box */}
                    <div className="bg-[#0B0F19]/80 rounded-lg p-2.5 border border-gray-800/70 space-y-2">
                      {/* Entry Zone Full-width */}
                      <div className="flex items-center justify-between bg-gray-900/90 px-2.5 py-1.5 rounded border border-gray-800/80">
                        <span className="text-[9px] text-gray-400 uppercase font-bold tracking-wider flex items-center gap-1">
                          <Crosshair size={11} className="text-blue-400" /> ENTRY
                        </span>
                        <span className="font-mono text-xs font-bold text-gray-100 tracking-tight whitespace-nowrap">
                          {ext.entryZone || sig.entryPrice?.toFixed(2) || '-'}
                        </span>
                      </div>

                      {/* SL, TP1, TP2 Grid (3 Kolom Simetris) */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="bg-rose-500/10 border border-rose-500/20 rounded p-1.5 text-center">
                          <p className="text-[8px] font-bold text-rose-400 uppercase tracking-wider mb-0.5">SL</p>
                          <p className="font-mono text-[11px] font-bold text-rose-300 truncate">{sig.stopLoss?.toFixed(2) || '-'}</p>
                        </div>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-1.5 text-center">
                          <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5">
                            TP1 <span className="text-[7px] text-emerald-500/80">{status?.config?.strategy === 'HYPER_SCALPER' ? '1:1.8' : '1:2'}</span>
                          </p>
                          <p className="font-mono text-[11px] font-bold text-emerald-300 truncate">{sig.takeProfit?.toFixed(2) || '-'}</p>
                        </div>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-1.5 text-center">
                          <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5">
                            TP2 <span className="text-[7px] text-emerald-500/80">{status?.config?.strategy === 'HYPER_SCALPER' ? '1:2.5' : '1:3'}</span>
                          </p>
                          <p className="font-mono text-[11px] font-bold text-emerald-300 truncate">{ext?.tp2 ? ext.tp2.toFixed(2) : '-'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Time Estimates */}
                    {ext?.validTime && (
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[9px] text-gray-400 mt-2.5 px-0.5 uppercase tracking-wider font-medium">
                         <span>Valid: <span className="text-gray-300 font-mono">{ext.validTime}</span></span>
                         <span>Est TP: <span className="text-gray-300 font-mono">{ext.estTpTime}</span></span>
                         {ext.timeStopLoss && <span>Time SL: <span className="text-gray-300 font-mono">{ext.timeStopLoss}</span></span>}
                      </div>
                    )}

                    {/* Checklist Reasons */}
                    {textReason && (
                      <div className="mt-4 pt-3 border-t border-gray-800/50 space-y-1.5">
                        {textReason.replace(/\\n/g, '\n').split('\n').map((line: string, i: number) => {
                          if (!line.trim()) return null;
                          const isCheck = line.includes('✔');
                          const isCross = line.includes('✖');
                          const cleanLine = line.replace(/✔|✖/g, '').trim();
                          
                          return (
                            <div key={i} className="flex items-start gap-2 text-[11px] font-medium text-gray-400">
                              {isCheck ? (
                                <CheckCircle2 size={12} className="text-emerald-500/70 mt-0.5 shrink-0" />
                              ) : isCross ? (
                                <XCircle size={12} className="text-rose-500/70 mt-0.5 shrink-0" />
                              ) : (
                                <span className="w-3" /> // spacer
                              )}
                              <span className={isCross ? 'text-gray-500 line-through decoration-gray-600/50' : 'text-gray-300'}>{cleanLine}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
                })
              )}
            </div>
          </div>
        </section>
      </main>
      
      <footer className="max-w-[1400px] mx-auto mt-8 text-center flex flex-col items-center gap-2">
        <div className="h-px w-24 bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
        <p className="text-[10px] text-gray-600 font-medium tracking-wide uppercase">
          Institutional Grade AI Agent • {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}

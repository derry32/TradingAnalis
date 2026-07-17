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
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 p-6 font-sans selection:bg-emerald-500/30">
      
      {/* Top Header & Strategy Toggle */}
      <header className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Target size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">
              Institutional AI
            </h1>
            <p className="text-[10px] text-emerald-400/70 font-medium tracking-widest uppercase">Trading Analyst Engine</p>
          </div>
        </div>

        <div className="flex items-center bg-gray-900/60 p-1.5 rounded-xl border border-gray-800/80 backdrop-blur-md">
          <button 
            onClick={() => toggleStrategy('SNIPER')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${status?.config?.strategy === 'SNIPER' ? 'bg-blue-600/90 text-white shadow-lg shadow-blue-500/20 border border-blue-500/50' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Crosshair size={14} /> Sniper (M15)
          </button>
          <button 
            onClick={() => toggleStrategy('HYPER_SCALPER')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${status?.config?.strategy === 'HYPER_SCALPER' ? 'bg-rose-600/90 text-white shadow-lg shadow-rose-500/20 border border-rose-500/50' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Zap size={14} /> Scalper (M5)
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Side: Chart */}
        <section className="lg:col-span-3 space-y-6">
          <div className="bg-[#111827]/80 backdrop-blur-xl border border-gray-800/50 rounded-2xl p-1 shadow-2xl relative overflow-hidden">
             {/* Subtle Glow */}
             <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent"></div>
            <Chart />
          </div>
        </section>

        {/* Right Side: Dashboard Panel */}
        <section className="space-y-4 flex flex-col">
          {/* Status Pills */}
          <div className="grid grid-cols-2 gap-4 w-full">
            <div className="bg-[#111827]/80 backdrop-blur-md border border-gray-800/50 rounded-xl p-4 shadow-lg group hover:border-gray-700 transition-all duration-300">
              <div className="flex flex-wrap justify-between items-start gap-1 mb-1">
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1">
                  <Activity size={12} /> Sentiment
                </p>
                {status?.sentimentStatus?.score && (
                   <span className="text-[9px] bg-gray-800/80 px-2 py-1 rounded border border-gray-700/50 text-gray-300 font-medium whitespace-nowrap">
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

            <div className="bg-[#111827]/80 backdrop-blur-md border border-gray-800/50 rounded-xl p-4 shadow-lg group hover:border-gray-700 transition-all duration-300">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1 mb-2">
                <BarChart2 size={12} /> Technical
              </p>
              <p className={`text-lg font-bold flex items-center gap-2 ${status?.technicalStatus === 'BULLISH' ? 'text-emerald-400' : status?.technicalStatus === 'BEARISH' ? 'text-rose-400' : 'text-gray-300'}`}>
                {status?.technicalStatus || 'NEUTRAL'}
              </p>
            </div>
          </div>

          <div className="bg-[#111827]/80 backdrop-blur-md border border-gray-800/50 rounded-xl p-4 shadow-lg flex justify-between items-center w-full group hover:border-yellow-500/20 transition-all duration-300">
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1">
              <Clock size={12} /> Active Session
            </p>
            <p className="text-xs font-bold text-yellow-500/90 bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/20">
              {status?.activeSession || 'LOADING...'}
            </p>
          </div>

          {status?.upcomingNews && (
            <div className="bg-gradient-to-br from-orange-950/40 to-[#111827]/80 border border-orange-500/30 rounded-xl p-4 shadow-lg w-full relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-bl-full group-hover:scale-110 transition-transform duration-500"></div>
              <p className="text-[10px] text-orange-400/80 uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                <ShieldAlert size={14} className="text-orange-500" />
                High Impact News Radar
              </p>
              <p className="text-sm font-semibold text-gray-200 mb-1 leading-snug">
                {status.upcomingNews.title} <span className="text-gray-500">({status.upcomingNews.country})</span>
              </p>
              <div className="flex justify-between items-end mt-4">
                <div>
                  <p className="text-[10px] font-medium text-gray-400 bg-gray-900/50 px-2 py-1 rounded">
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

          <div className="bg-[#111827]/90 backdrop-blur-xl border border-gray-800/50 rounded-2xl shadow-xl flex flex-col h-[530px] relative overflow-hidden">
            {/* Top Glow Edge */}
            <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"></div>
            
            <div className="p-4 border-b border-gray-800/50 flex justify-between items-center bg-[#111827]">
              <h2 className="text-sm font-bold flex items-center gap-2 text-gray-100">
                <RadioTower size={16} className="text-emerald-400" />
                Live Signals
              </h2>
              <span className="bg-gray-800 text-gray-300 border border-gray-700 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase">
                XAU/USD
              </span>
            </div>
            
            {status?.analysisDetail && (
              <div className="bg-blue-950/10 border-b border-gray-800/50 p-4 flex items-start gap-3 relative overflow-hidden">
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
                  <div key={idx} className={`relative bg-gray-900/50 backdrop-blur-sm rounded-xl p-4 border transition-all duration-300 group hover:-translate-y-1 ${isBuy ? 'border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-[0_8px_30px_rgb(16,185,129,0.1)]' : 'border-rose-500/20 hover:border-rose-500/40 hover:shadow-[0_8px_30px_rgb(244,63,94,0.1)]'}`}>
                    
                    {/* Signal Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold tracking-wide mb-2 whitespace-nowrap ${isBuy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {isBuy ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                          {ext?.probability ? `${sig.type} • ${ext.probability.replace(/[^\x00-\x7F]/g, "").trim()}` : sig.type}
                        </div>
                        {ext?.id && <p className="text-[9px] text-gray-600 font-mono">ID: {ext.id}</p>}
                      </div>
                      
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 font-medium">
                          {new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {ext?.confidence && (
                          <div className="mt-1.5 flex justify-end">
                            {renderConfidence(ext.confidence)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Price Targets Grid */}
                    <div className="grid grid-cols-4 gap-2 text-sm bg-[#0B0F19]/50 rounded-lg p-3 border border-gray-800/50">
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-widest mb-1 flex items-center gap-1">
                          <Crosshair size={10} /> Entry
                        </p>
                        <p className="font-mono text-xs text-gray-200">{sig.entryPrice?.toFixed(2) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-widest mb-1">SL</p>
                        <p className="font-mono text-xs text-rose-400/90">{sig.stopLoss?.toFixed(2) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-widest mb-1">
                          TP1 {status?.config?.strategy === 'HYPER_SCALPER' ? '(1:1.5)' : '(1:2)'}
                        </p>
                        <p className="font-mono text-xs text-emerald-400/90">{sig.takeProfit?.toFixed(2) || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase font-bold tracking-widest mb-1">
                          TP2 {status?.config?.strategy === 'HYPER_SCALPER' ? '(1:2)' : '(1:3)'}
                        </p>
                        <p className="font-mono text-xs text-emerald-400/90">{ext?.tp2 ? ext.tp2.toFixed(2) : '-'}</p>
                      </div>
                    </div>

                    {/* Time Estimates */}
                    {ext?.validTime && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-gray-500 mt-3 px-1 uppercase tracking-widest font-semibold">
                         <span>Valid: <span className="text-gray-400">{ext.validTime}</span></span>
                         <span>Est TP: <span className="text-gray-400">{ext.estTpTime}</span></span>
                         {ext.timeStopLoss && <span>Time SL: <span className="text-gray-400">{ext.timeStopLoss}</span></span>}
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

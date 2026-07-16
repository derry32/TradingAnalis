'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import dynamic from 'next/dynamic';

// Fix Next.js SSR issue with lightweight-charts
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

export default function Home() {
  const [signals, setSignals] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);


  useEffect(() => {
    // Data chart ditarik langsung dari backend (real-time)

    // Fetch data from backend
    const fetchData = async () => {
      try {
        // Gunakan relative path ('') jika di production dengan Caddy, atau localhost untuk testing
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const statusRes = await axios.get(`${apiUrl}/api/status`);
        setStatus(statusRes.data);
        
        const signalsRes = await axios.get(`${apiUrl}/api/signals`);
        // Supabase already sorts by timestamp DESC (newest first)
        setSignals(signalsRes.data);

      } catch (e) {
        // Silently fail if backend is offline during dev
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      <main className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        <section className="lg:col-span-3 space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-1 shadow-2xl relative">
            <Chart />
          </div>
        </section>

        <section className="space-y-4 flex flex-col">
          <div className="flex gap-4 w-full">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-lg flex items-center gap-4 flex-1">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">AI Sentiment</p>
                <p className={"text-lg font-bold " + (status?.sentimentStatus?.sentiment === 'BULLISH' ? 'text-emerald-500' : status?.sentimentStatus?.sentiment === 'BEARISH' ? 'text-red-500' : 'text-gray-300')}>
                  {status?.sentimentStatus?.sentiment || 'ANALYZING...'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-800 text-yellow-500 font-bold ml-auto">
                {status?.sentimentStatus?.score || '-'}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-lg flex flex-col justify-center flex-1">
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Technical</p>
              <p className={"text-lg font-bold " + (status?.technicalStatus === 'BULLISH' ? 'text-emerald-500' : status?.technicalStatus === 'BEARISH' ? 'text-red-500' : 'text-gray-300')}>
                {status?.technicalStatus || 'NEUTRAL'}
              </p>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-lg flex justify-between items-center w-full">
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Active Session</p>
            <p className="text-sm font-bold text-yellow-500 text-right">
              {status?.activeSession || 'LOADING...'}
            </p>
          </div>

          {status?.upcomingNews && (
            <div className="bg-orange-950/30 border border-orange-500/50 rounded-xl p-4 shadow-lg w-full relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/10 rounded-bl-full"></div>
              <p className="text-xs text-orange-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                </span>
                High Impact News Radar
              </p>
              <p className="text-sm font-semibold text-gray-200 mb-1">
                {status.upcomingNews.title} ({status.upcomingNews.country})
              </p>
              <div className="flex justify-between items-end mt-2">
                <div>
                  <p className="text-xs text-gray-400">Time: {new Date(status.upcomingNews.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">AI Forecast</p>
                  <p className={"text-xs font-bold " + (status?.sentimentStatus?.sentiment === 'BULLISH' ? 'text-emerald-500' : status?.sentimentStatus?.sentiment === 'BEARISH' ? 'text-red-500' : 'text-gray-400')}>
                    Bias {status?.sentimentStatus?.sentiment || 'UNKNOWN'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-xl flex flex-col h-[530px]">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Signals
              </h2>
              <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-1 rounded text-xs font-bold tracking-wider">XAU/USD</span>
            </div>
            
            {status?.analysisDetail && (
              <div className="bg-blue-900/20 border-b border-blue-900/40 p-3 flex items-start gap-3">
                <div className="mt-0.5 animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-400"></div>
                <div>
                  <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Status Analisis AI</p>
                  <p className="text-sm text-blue-200/80 leading-snug">{status.analysisDetail}</p>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {signals.length === 0 ? (
                <div className="text-center text-gray-500 text-sm mt-10">
                  Waiting for high probability signals...
                </div>
              ) : (
                signals.map((sig, idx) => {
                  const isHighProb = sig.reason?.includes('[HIGH PROBABILITY]');
                  const isLowProb = sig.reason?.includes('[LOW PROBABILITY]');
                  let displayType = sig.type;
                  if (isHighProb) displayType = `HIGH ${sig.type}`;
                  if (isLowProb) displayType = `LOW ${sig.type}`;

                  return (
                  <div key={idx} className="bg-gray-800 rounded-xl p-4 shadow-md border border-gray-700 hover:border-gray-600 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className={"px-2 py-1 rounded text-xs font-bold " + (sig.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400')}>
                        {displayType}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(sig.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                      <div>
                        <p className="text-gray-500 text-xs">ENTRY</p>
                        <p className="font-mono text-gray-200">{sig.entryPrice.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">SL</p>
                        <p className="font-mono text-red-400">{sig.stopLoss.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">TP</p>
                        <p className="font-mono text-emerald-400">{sig.takeProfit?.toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-700">
                      {sig.reason}
                    </p>
                  </div>
                );
                })
              )}
            </div>
          </div>
        </section>
      </main>
      
      <footer className="max-w-[1400px] mx-auto mt-6 text-center text-xs text-gray-600">
        <p>⚠️ Not Financial Advice. This AI signal generator is for educational purposes only.</p>
      </footer>
    </div>
  );
}

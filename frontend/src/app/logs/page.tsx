'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SystemLog } from '../../components/SystemHealthProvider';
import { Activity, ShieldAlert, CheckCircle, AlertTriangle, ArrowLeft, RefreshCw, Shield } from 'lucide-react';
import Link from 'next/link';

export default function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawdown, setDrawdown] = useState<{active: boolean, dailySLCount: number, maxDailySL: number} | null>(null);
  const [resetting, setResetting] = useState(false);
  const BACKEND_URL = typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
    ? `http://${window.location.hostname}:3002` 
    : 'http://localhost:3002';

  useEffect(() => {
    async function fetchAllLogs() {
      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (data) setLogs(data);
      setLoading(false);
    }
    
    async function fetchDrawdown() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/risk/drawdown-status`);
        if (res.ok) {
          const data = await res.json();
          setDrawdown(data);
        }
      } catch (e) {
        console.error('Failed to fetch drawdown', e);
      }
    }

    fetchAllLogs();
    fetchDrawdown();
  }, [BACKEND_URL]);

  const handleForceReset = async () => {
    setResetting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/risk/reset-drawdown`, { method: 'POST' });
      if (res.ok) {
        setDrawdown(prev => prev ? { ...prev, active: false, dailySLCount: 0 } : null);
        // Add a log artificially to UI so user gets feedback without reload
        setLogs(prev => [{
          id: Date.now().toString(),
          level: 'INFO',
          source: 'System',
          message: 'Drawdown Guard successfully reset via UI',
          timestamp: new Date().toISOString()
        }, ...prev]);
      }
    } catch (e) {
      console.error('Failed to reset drawdown', e);
    }
    setResetting(false);
  };

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'ERROR': return 'bg-red-500/10 text-red-400 border border-red-500/20';
      case 'WARN': return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      default: return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    }
  };

  return (
    <div className="min-h-screen bg-cyber-bg text-gray-100 p-6 font-sans selection:bg-cyber-neon/30 scanlines">
      <header className="max-w-[1000px] mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-2 bg-slate-900 border border-white/10 rounded-lg hover:border-white/30 transition-all">
            <ArrowLeft size={20} className="text-gray-400 hover:text-white" />
          </Link>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">
              System Logs
            </h1>
            <p className="text-[10px] text-emerald-400/70 font-medium tracking-widest uppercase">Diagnostic History</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto">
        {drawdown && (
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 mb-6 shadow-2xl flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl border ${drawdown.active ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                {drawdown.active ? <ShieldAlert className="text-red-400" size={24} /> : <Shield className="text-emerald-400" size={24} />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-100 mb-1 flex items-center gap-2">
                  Drawdown Guard
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold ${drawdown.active ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {drawdown.active ? 'Blocked' : 'Secure'}
                  </span>
                </h2>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>Daily Stop Loss:</span>
                  <div className="flex gap-1 items-center">
                    <span className="text-white font-mono">{drawdown.dailySLCount}</span>
                    <span className="text-gray-600">/</span>
                    <span className="text-gray-500">{drawdown.maxDailySL}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <button 
              onClick={handleForceReset}
              disabled={resetting}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 rounded-lg font-semibold text-sm transition-all shadow-[0_0_15px_rgba(239,68,68,0.1)] hover:shadow-[0_0_20px_rgba(239,68,68,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} className={resetting ? 'animate-spin' : ''} />
              Force Reset
            </button>
          </div>
        )}

        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
          {loading ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center">
              <Activity className="w-8 h-8 animate-pulse mb-4 text-cyber-neon" />
              <p>Loading diagnostics...</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Timestamp (WIB)</th>
                  <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Level</th>
                  <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Source</th>
                  <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-gray-500">
                      No logs recorded yet. System is healthy.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 text-xs text-gray-400 font-mono whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider ${getLevelStyle(log.level)}`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-medium text-gray-300">
                        {log.source}
                      </td>
                      <td className="p-4 text-sm text-gray-300">
                        {log.message}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

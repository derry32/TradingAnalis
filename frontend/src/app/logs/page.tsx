'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SystemLog } from '../../components/SystemHealthProvider';
import { Activity, ShieldAlert, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);

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
    fetchAllLogs();
  }, []);

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

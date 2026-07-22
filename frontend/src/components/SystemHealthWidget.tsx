'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSystemHealth } from './SystemHealthProvider';
import { Activity, AlertTriangle, CheckCircle, AlertOctagon } from 'lucide-react';

export function SystemHealthWidget() {
  const { status, recentLogs } = useSystemHealth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getStatusConfig = () => {
    switch (status) {
      case 'RED': return { color: 'text-red-500', bg: 'bg-red-500', glow: 'shadow-[0_0_10px_rgba(239,68,68,0.7)]', icon: AlertOctagon, text: 'System: Critical' };
      case 'YELLOW': return { color: 'text-yellow-500', bg: 'bg-yellow-500', glow: 'shadow-[0_0_10px_rgba(234,179,8,0.7)]', icon: AlertTriangle, text: 'System: Warning' };
      default: return { color: 'text-green-500', bg: 'bg-green-500', glow: 'shadow-[0_0_10px_rgba(34,197,94,0.7)]', icon: CheckCircle, text: 'System: Healthy' };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Widget Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-white/10 hover:border-white/20 transition-all duration-300"
      >
        <div className="relative flex items-center justify-center w-4 h-4">
          <div className={`absolute w-full h-full rounded-full ${config.bg} opacity-20 animate-ping`}></div>
          <div className={`w-2.5 h-2.5 rounded-full ${config.bg} ${config.glow}`}></div>
        </div>
        <span className={`text-sm font-semibold tracking-wide ${config.color}`}>
          {config.text}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col">
          <div className="p-3 border-b border-white/5 flex justify-between items-center sticky top-0 bg-slate-900/95 backdrop-blur-md">
            <span className="text-sm font-semibold text-white/80">Recent System Logs</span>
            <Activity className="w-4 h-4 text-white/40" />
          </div>
          <div className="flex flex-col p-2 gap-2">
            {recentLogs.length === 0 ? (
              <div className="p-4 text-center text-sm text-white/40">No recent logs</div>
            ) : (
              recentLogs.map(log => (
                <div key={log.id} className="flex flex-col p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      log.level === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                      log.level === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                      log.level === 'WARN' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {log.level}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="text-xs text-white/60 mb-1">[{log.source}]</span>
                  <span className="text-sm text-white/90 leading-tight">{log.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="p-2 border-t border-white/5">
            <a href="/logs" className="block w-full text-center text-xs text-blue-400 hover:text-blue-300 py-1">
              View All Logs
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

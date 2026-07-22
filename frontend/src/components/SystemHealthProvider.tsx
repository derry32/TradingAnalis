'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export type SystemLog = {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  source: string;
  message: string;
  metadata?: any;
};

type HealthContextType = {
  status: 'GREEN' | 'YELLOW' | 'RED';
  recentLogs: SystemLog[];
};

const HealthContext = createContext<HealthContextType>({ status: 'GREEN', recentLogs: [] });

export const useSystemHealth = () => useContext(HealthContext);

export function SystemHealthProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [status, setStatus] = useState<'GREEN' | 'YELLOW' | 'RED'>('GREEN');

  useEffect(() => {
    // Fetch initial latest 5 logs
    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);
        
      if (data) {
        setLogs(data);
        updateStatus(data);
      }
    };
    
    fetchLogs();

    // Subscribe to realtime inserts
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'system_logs' },
        (payload) => {
          const newLog = payload.new as SystemLog;
          setLogs((prev) => {
            const updated = [newLog, ...prev].slice(0, 10);
            updateStatus(updated);
            return updated;
          });

          // Trigger Toast for CRITICAL or ERROR
          if (newLog.level === 'CRITICAL' || newLog.level === 'ERROR') {
            toast.error(`[${newLog.source}] ${newLog.message}`, {
               description: new Date(newLog.timestamp).toLocaleTimeString(),
               style: { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#fff' }
            });
          } else if (newLog.level === 'WARN') {
             toast.warning(`[${newLog.source}] ${newLog.message}`, {
                 description: new Date(newLog.timestamp).toLocaleTimeString(),
                 style: { background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.5)', color: '#fff' }
             });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateStatus = (currentLogs: SystemLog[]) => {
     // Very simple logic: if recent log is ERROR/CRITICAL -> RED
     // if WARN -> YELLOW
     // else GREEN
     const recentErrors = currentLogs.filter(l => l.level === 'ERROR' || l.level === 'CRITICAL');
     const recentWarns = currentLogs.filter(l => l.level === 'WARN');
     
     if (recentErrors.length > 0) setStatus('RED');
     else if (recentWarns.length > 0) setStatus('YELLOW');
     else setStatus('GREEN');
  };

  return (
    <HealthContext.Provider value={{ status, recentLogs: logs }}>
      {children}
    </HealthContext.Provider>
  );
}

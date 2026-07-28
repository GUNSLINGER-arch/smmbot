import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, events, LogEntry, Campaign, SavedService, BalanceResult, AppConfig } from './api';

// ─────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────
interface AppCtx {
  campaigns:        Record<string, Campaign>;
  services:         SavedService[];
  logs:             LogEntry[];
  balance:          BalanceResult | null;
  config:           AppConfig | null;
  hasKey:           boolean;
  toasts:           Toast[];
  refreshCampaigns: () => void;
  refreshServices:  () => void;
  refreshBalance:   () => void;
  refreshData:      () => void;
  addToast:         (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const Ctx = createContext<AppCtx>({} as AppCtx);
export const useApp = () => useContext(Ctx);

export interface Toast {
  id:      string;
  message: string;
  type:    'success' | 'error' | 'info';
}

// ─────────────────────────────────────────────────
//  Provider
// ─────────────────────────────────────────────────
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [campaigns, setCampaigns] = useState<Record<string, Campaign>>({});
  const [services,  setServices]  = useState<SavedService[]>([]);
  const [logs,      setLogs]      = useState<LogEntry[]>([]);
  const [balance,   setBalance]   = useState<BalanceResult | null>(null);
  const [config,    setConfig]    = useState<AppConfig | null>(null);
  const [hasKey,    setHasKey]    = useState(false);
  const [toasts,    setToasts]    = useState<Toast[]>([]);

  // ── Toasts ───────────────────────────────────────
  const addToast = useCallback((message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800);
  }, []);

  // ── Data Refreshers ──────────────────────────────
  const refreshCampaigns = useCallback(async () => {
    try {
      const data = await api.getCampaigns();
      setCampaigns(data || {});
    } catch {}
  }, []);

  const refreshServices = useCallback(async () => {
    try {
      const data = await api.getServices();
      setServices(data || []);
    } catch {}
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const b = await api.getBalance();
      setBalance(b);
    } catch {
      // silent
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setHasKey(cfg?.has_key || false);
    } catch {}
  }, []);

  const refreshData = useCallback(async () => {
    refreshConfig();
    refreshCampaigns();
    refreshServices();
    refreshBalance();
  }, [refreshConfig, refreshCampaigns, refreshServices, refreshBalance]);

  // ── Initial Boot ─────────────────────────────────
  useEffect(() => {
    (async () => {
      await refreshData();
      try {
        const ls = await api.getLogs();
        setLogs(ls || []);
      } catch {}
    })();
  }, [refreshData]);

  // ── Live Log Listener ────────────────────────────
  useEffect(() => {
    const unsub = events.onLog((entry) => {
      setLogs(prev => {
        const next = [...prev, entry];
        return next.slice(-500);
      });
    });
    return () => { unsub.then(fn => fn()); };
  }, []);

  // ── Campaign Update Listener ─────────────────────
  useEffect(() => {
    const unsub = events.onCampaignUpdate(() => refreshCampaigns());
    return () => { unsub.then(fn => fn()); };
  }, [refreshCampaigns]);

  // ── Campaign Complete Listener ───────────────────
  useEffect(() => {
    const unsub = events.onCampaignComplete((url) => {
      addToast(`✅ Campaign complete: …${url.slice(-28)}`, 'success');
      refreshCampaigns();
      refreshBalance();
    });
    return () => { unsub.then(fn => fn()); };
  }, [addToast, refreshCampaigns, refreshBalance]);

  // ── Polling (60s) ────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      refreshCampaigns();
      if (hasKey) refreshBalance();
    }, 60_000);
    return () => clearInterval(iv);
  }, [hasKey, refreshCampaigns, refreshBalance]);

  return (
    <Ctx.Provider value={{
      campaigns, services, logs, balance, config, hasKey, toasts,
      refreshCampaigns, refreshServices, refreshBalance, refreshData, addToast,
    }}>
      {children}
    </Ctx.Provider>
  );
}

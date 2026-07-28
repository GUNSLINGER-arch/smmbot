declare global {
  interface Window {
    electronAPI?: {
      invoke: <T>(channel: string, ...args: any[]) => Promise<T>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

// ──────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────
export interface Campaign {
  id: string;
  url: string;
  platform: string;
  delivery_mode: string;
  view_service: string;
  like_service: string;
  comment_service: string;
  share_service: string;
  save_service: string;
  like_min: number;
  total_views: number;
  days_to_run: number;
  peak_only: boolean;
  views_delivered: number;
  likes_delivered: number;
  comments_delivered: number;
  shares_delivered: number;
  saves_delivered: number;
  last_view_order: string | null;
  last_like_order: string | null;
  status: string;
  video_title: string;
  video_author: string;
  start_views: number | null;
  start_likes: number | null;
  engagement_rate: number;
  created_at: string;
}

export interface SavedService {
  id: string;
  service_id: string;
  name: string;
  rate_usd: number;
  rate_pkr: number;
  min_order: number;
  max_order: number;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
  url?: string;
}

export interface AnalyticsPoint {
  timestamp: string;
  views: number;
  likes: number;
  live_views?: number;
}

export interface AppConfig {
  api_key: string;
  api_url: string;
  api_proxy: string;
  auto_proxy?: string;
  custom_pkr_rate: number;
  has_key: boolean;
  backend_url?: string;
}

export interface BalanceResult {
  ok: boolean;
  usd?: number;
  pkr?: number;
  currency?: string;
  error?: string;
}

export interface OrderHistoryItem {
  order_id: string;
  service_id: string;
  link: string;
  quantity: number;
  runs?: number;
  interval?: number;
  created_at: string;
  type: 'manual' | 'drip' | 'campaign';
}

export interface MetaResult {
  title: string;
  author: string;
  views: number | null;
  likes: number | null;
  source: string;
}

// ──────────────────────────────────────────────────
//  BACKEND URL & HYBRID IPC/HTTP BRIDGE
// ──────────────────────────────────────────────────
export function getBackendUrl(): string {
  const saved = localStorage.getItem('smmbot_backend_url');
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  return 'http://74.162.122.198:7860';
}

export function setBackendUrl(url: string) {
  localStorage.setItem('smmbot_backend_url', url.trim().replace(/\/+$/, ''));
}

async function httpFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let url = endpoint;
  const baseUrl = getBackendUrl();
  if (baseUrl && !endpoint.startsWith('http')) {
    url = `${baseUrl}${endpoint}`;
  }
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const errText = await res.text();
    let parsedErr = 'Request failed';
    try { parsedErr = JSON.parse(errText).error || errText; } catch (e) {}
    throw new Error(parsedErr);
  }
  return res.json();
}

const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

const invoke = <T>(channel: string, ...args: any[]): Promise<T> => {
  if (isElectron && window.electronAPI) {
    return window.electronAPI.invoke<T>(channel, ...args);
  }
  
  // Pure Web Mode HTTP Fallbacks
  switch (channel) {
    case 'get_config':
      return httpFetch<AppConfig>('/api/state').then((st: any) => ({
        api_key: st.api_key || '',
        api_url: st.api_url || '',
        api_proxy: st.api_proxy || '',
        custom_pkr_rate: st.custom_pkr_rate || 297,
        has_key: Boolean(st.api_key),
        backend_url: getBackendUrl()
      })) as Promise<T>;
    case 'save_config':
      return httpFetch('/api/config', { method: 'POST', body: JSON.stringify(args[0]) }) as Promise<T>;
    case 'get_balance':
      return httpFetch<BalanceResult>('/api/balance') as Promise<T>;
    case 'get_campaigns':
      return httpFetch<Record<string, Campaign>>('/api/campaigns') as Promise<T>;
    case 'launch_campaign':
      return httpFetch<{ ok?: boolean; error?: string }>('/api/campaign/launch', { method: 'POST', body: JSON.stringify(args[0]) }) as Promise<T>;
    case 'stop_campaign':
      return httpFetch('/api/campaign/stop', { method: 'POST', body: JSON.stringify(args[0]) }) as Promise<T>;
    case 'fetch_metadata':
      return httpFetch<{ ok: boolean; meta?: MetaResult; error?: string }>('/api/video/metrics', { method: 'POST', body: JSON.stringify(args[0]) }) as Promise<T>;
    case 'get_logs':
      return httpFetch<LogEntry[]>('/api/logs') as Promise<T>;
    case 'get_services':
      return httpFetch<SavedService[]>('/api/services') as Promise<T>;
    case 'get_order_history':
      return httpFetch<OrderHistoryItem[]>('/api/order_history') as Promise<T>;
    case 'scan_proxy':
      return httpFetch<{ ok: boolean; proxy?: string }>('/api/scan_proxy', { method: 'POST' }) as Promise<T>;
    case 'place_order':
      return httpFetch<{ ok: boolean; order_id?: string; error?: string }>('/api/order/place', { method: 'POST', body: JSON.stringify(args[0]) }) as Promise<T>;
    case 'window_close':
    case 'window_minimize':
    case 'window_maximize':
      return Promise.resolve() as Promise<T>;
    default:
      return httpFetch<T>(`/api/${channel}`, { method: 'POST', body: JSON.stringify(args[0] || {}) });
  }
};

const listen = <T>(event: string, callback: (payload: T) => void) => {
  if (isElectron && window.electronAPI) {
    window.electronAPI.on(event, callback);
    return Promise.resolve(() => {});
  }

  // Web Realtime SSE stream setup
  if (event === 'log') {
    try {
      const baseUrl = getBackendUrl();
      const sse = new EventSource(`${baseUrl}/api/events`);
      sse.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.type === 'log') callback(parsed.data);
        } catch (err) {}
      };
      return Promise.resolve(() => sse.close());
    } catch (e) {}
  }
  return Promise.resolve(() => {});
};

// ──────────────────────────────────────────────────
//  API Surface
// ──────────────────────────────────────────────────
export const api = {
  // Config & Auth
  getConfig: () => invoke<AppConfig>('get_config'),
  saveConfig: (cfg: Omit<AppConfig, 'has_key'>) => invoke('save_config', cfg),
  verifyApiKey: (api_key: string, api_url: string) =>
    invoke<{ ok: boolean; balance_usd?: number; balance_pkr?: number; error?: string }>('verify_api_key', { api_key, api_url }),

  // Balance
  getBalance: () => invoke<BalanceResult>('get_balance'),

  // Campaigns
  getCampaigns:   () => invoke<Record<string, Campaign>>('get_campaigns'),
  launchCampaign: (payload: Record<string, unknown>) => invoke<{ ok?: boolean; error?: string }>('launch_campaign', payload),
  stopCampaign:   (url: string) => invoke('stop_campaign', { url }),
  resumeCampaign: (url: string) => invoke<{ ok?: boolean; error?: string }>('resume_campaign', { url }),
  editCampaign:   (url: string, payload: Record<string, unknown>) => invoke<{ ok?: boolean; error?: string }>('edit_campaign', { url, payload }),
  deleteCampaign: (url: string) => invoke('delete_campaign', { url }),
  cancelStuckOrder: (url: string) => invoke<{ ok: boolean }>('cancel_stuck_order_cmd', { url }),

  // Metadata
  fetchMetadata: (url: string, platform: string) =>
    invoke<{ ok: boolean; meta?: MetaResult; error?: string }>('fetch_metadata', { url, platform }),

  // Logs & Analytics
  getLogs:      () => invoke<LogEntry[]>('get_logs'),
  getAnalytics: () => invoke<Record<string, AnalyticsPoint[]>>('get_analytics'),
  exportLogsCsv: () => invoke<{ csv: string }>('export_logs_csv'),

  // Services
  getServices:              () => invoke<SavedService[]>('get_services'),
  addService:               (service_id: string, name: string) => invoke<SavedService & { error?: string }>('add_service', { service_id, name }),
  deleteService:            (id: string) => invoke('delete_service', { id }),
  recalculateServicePrices: () => invoke('recalculate_service_prices'),
  exportServicesCsv:        () => invoke<{ csv: string }>('export_services_csv'),

  // Orders
  placeOrder:    (service_id: string, link: string, quantity: number) =>
    invoke<{ ok: boolean; order_id?: string; error?: string }>('place_order', { service_id, link, quantity }),
  placeDripOrder: (params: { service_id: string; link: string; quantity: number; runs: number; interval: number }) =>
    invoke<{ ok: boolean; order_id?: string; error?: string }>('place_drip_order', params),
  checkOrder:     (order_id: string) =>
    invoke<{ ok: boolean; status?: string }>('check_order', { order_id }),
  multiStatus:    (order_ids: string[]) =>
    invoke<Record<string, { status: string; remains?: number; start_count?: number }>>('multi_status', { order_ids }),
  refillOrder:    (url: string) => invoke('refill', { url }),
  getRefillStatus: (refill_id: string) =>
    invoke<{ ok: boolean; data?: unknown; error?: string }>('get_refill_status', { refill_id }),

  // Order History
  getOrderHistory:   () => invoke<OrderHistoryItem[]>('get_order_history'),
  clearOrderHistory: () => invoke('clear_order_history'),

  // Proxy
  scanProxy:  () => invoke<{ ok: boolean; proxy?: string }>('scan_proxy'),
  clearProxy: () => invoke('clear_proxy'),

  // Window
  windowClose:    () => invoke('window_close'),
  windowMinimize: () => invoke('window_minimize'),
  windowMaximize: () => invoke('window_maximize'),
};

// ──────────────────────────────────────────────────
//  Events
// ──────────────────────────────────────────────────
export const events = {
  onLog:             (cb: (entry: LogEntry) => void)  => listen<LogEntry>('log', cb),
  onCampaignUpdate:  (cb: (url: string) => void)      => listen<string>('campaign_update', cb),
  onCampaignComplete:(cb: (url: string) => void)      => listen<string>('campaign_complete', cb),
};

// ──────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────
export function truncateTitle(title: string, url: string, maxLen = 42): string {
  if (title && title.length > 0) {
    return title.length > maxLen ? title.slice(0, maxLen) + '…' : title;
  }
  const last = url.slice(-32);
  return '…' + last;
}

export function fmtNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return (n || 0).toString();
}

export function pct(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export function getPlatformEmoji(platform: string): string {
  if (platform === 'TikTok') return '🎵';
  if (platform === 'Instagram') return '📸';
  return '🌐';
}

export function timeAgo(isoString: string): string {
  if (!isoString) return '';
  const diffSecs = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return `${Math.floor(diffSecs / 86400)}d ago`;
}

export function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

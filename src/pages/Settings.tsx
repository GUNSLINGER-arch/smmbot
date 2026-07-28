import { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';

// ─────────────────────────────────────────────────────
//  Settings Page
// ─────────────────────────────────────────────────────
export default function Settings() {
  const { addToast, refreshBalance, refreshServices } = useApp();

  const [form, setForm] = useState({
    api_key: '', api_url: 'https://marketerum.com/api/v2',
    api_proxy: '', custom_pkr_rate: '297',
  });
  const [loaded,    setLoaded]    = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; balance_usd?: number; balance_pkr?: number; error?: string } | null>(null);
  const [proxyStatus, setProxyStatus] = useState<{ active: boolean; url?: string }>({ active: false });
  const [scanningProxy, setScanningProxy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      const cfg = await api.getConfig();
      setForm({
        api_key: cfg.api_key || '',
        api_url: cfg.api_url || 'https://marketerum.com/api/v2',
        api_proxy: cfg.api_proxy || '',
        custom_pkr_rate: cfg.custom_pkr_rate?.toString() || '297',
      });
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await api.saveConfig({
      api_key: form.api_key.trim(),
      api_url: form.api_url.trim() || 'https://marketerum.com/api/v2',
      api_proxy: form.api_proxy.trim(),
      custom_pkr_rate: parseFloat(form.custom_pkr_rate) || 297,
    });
    await refreshServices();
    setSaving(false);
    addToast('Settings saved ✅', 'success');
  };

  const handleVerify = async () => {
    if (!form.api_key.trim()) { addToast('Enter your API key first', 'error'); return; }
    setVerifying(true); setVerifyResult(null);
    const res = await api.verifyApiKey(form.api_key.trim(), form.api_url.trim() || 'https://marketerum.com/api/v2');
    setVerifyResult(res);
    setVerifying(false);
    if (res.ok) {
      addToast(`API verified ✅ — $${res.balance_usd?.toFixed(4)}`, 'success');
      refreshBalance();
    } else {
      addToast(res.error || 'Verification failed', 'error');
    }
  };

  const handleScanProxy = async () => {
    setScanningProxy(true);
    addToast('Scanning 150 SOCKS5 proxies…', 'info');
    const res = await api.scanProxy();
    setScanningProxy(false);
    if (res.ok && res.proxy) {
      setProxyStatus({ active: true, url: res.proxy });
      addToast('Working proxy found ✅', 'success');
    } else {
      addToast('No working proxies found — running direct', 'info');
    }
  };

  const handleClearProxy = async () => {
    await api.clearProxy();
    setProxyStatus({ active: false });
    addToast('Auto-proxy cleared', 'info');
  };

  if (!loaded) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-3)' }}>
      <span className="spin" style={{ fontSize:24 }}>⟳</span>
    </div>
  );

  return (
    <div className="page" style={{ overflow:'auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">⚙️ Settings</div>
          <div className="page-sub">API configuration, proxy, and exchange rate</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spin">⟳</span> Saving…</> : '💾 Save Settings'}
        </button>
      </div>

      {/* ── API Config ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">🔑 Marketerum API</div>
        <div className="form-group">
          <label className="form-label">API Key</label>
          <div className="url-fetch-row">
            <input
              className="form-input"
              type={showKey ? 'text' : 'password'}
              placeholder="Paste your Marketerum API key here…"
              value={form.api_key}
              onChange={e => set('api_key', e.target.value)}
            />
            <button className="btn btn-secondary" style={{ flexShrink:0 }} onClick={() => setShowKey(s => !s)}>
              {showKey ? '🙈 Hide' : '👁️ Show'}
            </button>
          </div>
          <span className="form-hint">Get your key from marketerum.com → Profile → API</span>
        </div>

        <div className="form-group">
          <label className="form-label">API URL</label>
          <input className="form-input" value={form.api_url}
            onChange={e => set('api_url', e.target.value)} />
          <span className="form-hint">Default: https://marketerum.com/api/v2</span>
        </div>

        {/* Verify */}
        <div>
          <button className="btn btn-secondary" onClick={handleVerify} disabled={verifying}>
            {verifying ? <><span className="spin">⟳</span> Verifying…</> : '✅ Verify API Key'}
          </button>
          {verifyResult && (
            <div style={{ marginTop:10 }}>
              {verifyResult.ok ? (
                <div className="meta-preview">
                  <div className="meta-row"><span className="meta-key">Balance</span><span className="meta-val">${verifyResult.balance_usd?.toFixed(4)}</span></div>
                  <div className="meta-row"><span className="meta-key">PKR</span><span className="meta-val">₨{verifyResult.balance_pkr?.toFixed(2)}</span></div>
                  <div className="meta-source">✅ API is working correctly</div>
                </div>
              ) : (
                <div style={{ padding:'10px 14px', borderRadius:'var(--radius)', background:'var(--red-dim)', border:'1px solid var(--red-b)', color:'var(--red)', fontSize:12 }}>
                  ❌ {verifyResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Exchange Rate ────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">💱 Currency</div>
        <div className="form-group">
          <label className="form-label">USD → PKR Exchange Rate</label>
          <input className="form-input" type="number" step="0.01" placeholder="e.g. 297" value={form.custom_pkr_rate}
            onChange={e => set('custom_pkr_rate', e.target.value)} />
          <span className="form-hint">Used to show PKR pricing on services and balance. Leave as 297 to use approximate rate.</span>
        </div>
      </div>

      {/* ── Proxy ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">🌐 Proxy (Optional)</div>

        <div className="form-group">
          <label className="form-label">Manual Proxy (SOCKS5 or HTTP)</label>
          <input className="form-input" placeholder="socks5://ip:port  or  http://user:pass@ip:port"
            value={form.api_proxy} onChange={e => set('api_proxy', e.target.value)} />
          <span className="form-hint">Leave empty to use auto-proxy scanner or direct connection</span>
        </div>

        <div className="form-group">
          <label className="form-label">Auto-Proxy Scanner</label>
          <div className={`proxy-status ${proxyStatus.active ? 'active' : ''}`}>
            {proxyStatus.active
              ? <>🟢 Active — {proxyStatus.url?.slice(0, 40)}</>
              : <>⚪ Not active — direct connection</>
            }
          </div>
          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleScanProxy} disabled={scanningProxy}>
              {scanningProxy ? <><span className="spin">⟳</span> Scanning…</> : '🔍 Scan SOCKS5 Proxies'}
            </button>
            {proxyStatus.active && (
              <button className="btn btn-danger btn-sm" onClick={handleClearProxy}>✕ Clear Proxy</button>
            )}
          </div>
          <span className="form-hint">Races 150 free SOCKS5 proxies and locks onto the fastest working one. Useful for Azure/VPS environments.</span>
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">ℹ️ About</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div className="form-group">
            <label className="form-label">App</label>
            <div className="proxy-status">SMMBot Enterprise v2.0</div>
          </div>
          <div className="form-group">
            <label className="form-label">Panel</label>
            <div className="proxy-status">Marketerum API v2</div>
          </div>
          <div className="form-group">
            <label className="form-label">Engine</label>
            <div className="proxy-status">Electron + React + Recharts</div>
          </div>
          <div className="form-group">
            <label className="form-label">Algorithms</label>
            <div className="proxy-status">Viral Burst · Organic · Steady Drip</div>
          </div>
        </div>
        <div style={{ fontSize:11, color:'var(--text-3)', lineHeight:1.7, marginTop:4 }}>
          Campaigns persist across restarts. Running campaigns auto-resume on app open. All data stored locally via Electron's userData path.
          Marketerum features enabled: native drip-feed (runs + interval), batch status polling (multi_status), refill, refill_status, and order history.
        </div>
      </div>

      {/* Bottom save shortcut */}
      <div style={{ display:'flex', justifyContent:'flex-end', paddingBottom:8 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spin">⟳</span> Saving…</> : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}

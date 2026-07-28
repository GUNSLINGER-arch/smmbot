import { useState, useEffect } from 'react';
import { useApp } from '../AppContext';
import { api, getBackendUrl, setBackendUrl } from '../api';

export default function SettingsPage() {
  const { config, balance, addToast, refreshData } = useApp();

  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('https://marketerum.com/api/v2');
  const [apiProxy, setApiProxy] = useState('');
  const [customPkr, setCustomPkr] = useState('297');
  const [backendUrl, setBackendUrlState] = useState(getBackendUrl());
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (config) {
      setApiKey(config.api_key || '');
      setApiUrl(config.api_url || 'https://marketerum.com/api/v2');
      setApiProxy(config.api_proxy || '');
      setCustomPkr(String(config.custom_pkr_rate || 297));
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      setBackendUrl(backendUrl);
      await api.saveConfig({
        api_key: apiKey.trim(),
        api_url: apiUrl.trim(),
        api_proxy: apiProxy.trim(),
        custom_pkr_rate: parseFloat(customPkr) || 297,
      });
      addToast('✅ Configuration saved successfully!', 'success');
      refreshData();
    } catch (e: any) {
      addToast(e.message || 'Failed to save configuration', 'error');
    }
    setSaving(false);
  };

  const handleVerify = async () => {
    if (!apiKey.trim()) {
      addToast('Enter API Key first', 'error');
      return;
    }
    setVerifying(true);
    try {
      const res = await api.verifyApiKey(apiKey.trim(), apiUrl.trim());
      if (res.ok) {
        addToast(`✅ API Key Valid! Balance: $${res.balance_usd?.toFixed(4)} (PKR ${res.balance_pkr?.toFixed(0)})`, 'success');
        refreshData();
      } else {
        addToast(res.error || 'API Key verification failed', 'error');
      }
    } catch (e: any) {
      addToast('Verification error', 'error');
    }
    setVerifying(false);
  };

  return (
    <div className="settings-page" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-title">
          <span>⚙️ Appwrite & Cloud Backend Settings</span>
        </div>

        <div className="input-group">
          <label className="input-label">Appwrite Cloud Project ID</label>
          <input
            className="input-field"
            value="6a67fbf70009ffe490e3"
            disabled
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Connected to Appwrite Singapore Region Cloud</span>
        </div>

        <div className="input-group">
          <label className="input-label">Appwrite API Endpoint</label>
          <input
            className="input-field"
            value="https://sgp.cloud.appwrite.io/v1"
            disabled
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>

        <div className="input-group">
          <label className="input-label">SMMBot Server / Backend Host URL</label>
          <input
            className="input-field"
            value={backendUrl}
            onChange={e => setBackendUrlState(e.target.value)}
            placeholder="http://127.0.0.1:9090 or https://your-space.hf.space"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>🔑 Marketerum SMM Panel Integration</span>
        </div>

        <div className="input-group">
          <label className="input-label">Marketerum API Key</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              type="password"
              style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Enter your Marketerum API key..."
            />
            <button className="btn btn-secondary" onClick={handleVerify} disabled={verifying}>
              {verifying ? 'Verifying...' : 'Test Key'}
            </button>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Marketerum API Endpoint</label>
          <input
            className="input-field"
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="input-group">
            <label className="input-label">Custom PKR Rate (1 USD = X PKR)</label>
            <input
              className="input-field"
              type="number"
              value={customPkr}
              onChange={e => setCustomPkr(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Manual SOCKS5 Proxy (Optional)</label>
            <input
              className="input-field"
              placeholder="socks5://ip:port or socks5://user:pass@ip:port"
              value={apiProxy}
              onChange={e => setApiProxy(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>

        {balance?.ok && (
          <div style={{
            padding: '12px',
            backgroundColor: 'var(--status-green-bg)',
            border: '1px solid var(--status-green-border)',
            borderRadius: 'var(--radius-md)',
            margin: '16px 0',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>Verified Marketerum Account Balance:</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              PKR {balance.pkr?.toFixed(2)} (${balance.usd?.toFixed(4)})
            </span>
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving Settings...' : 'Save All Settings'}
        </button>
      </div>
    </div>
  );
}

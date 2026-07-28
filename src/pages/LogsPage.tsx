import { useState } from 'react';
import { useApp } from '../AppContext';
import { api, LogEntry } from '../api';

export default function LogsPage() {
  const { logs, config, addToast, refreshData } = useApp();
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [scanningProxy, setScanningProxy] = useState(false);

  const filteredLogs = filterLevel === 'all' 
    ? logs 
    : logs.filter((l: LogEntry) => l.level === filterLevel);

  const handleScanProxy = async () => {
    setScanningProxy(true);
    addToast('Scanning free SOCKS5 proxy pool...', 'info');
    try {
      const res = await api.scanProxy();
      if (res.ok && res.proxy) {
        addToast(`✅ Proxy Locked: ${res.proxy}`, 'success');
        refreshData();
      } else {
        addToast('Proxy scan did not find a working server', 'info');
      }
    } catch (e: any) {
      addToast('Proxy scan failed', 'error');
    }
    setScanningProxy(false);
  };

  const handleClearProxy = async () => {
    try {
      await api.clearProxy();
      addToast('Proxy settings cleared', 'info');
      refreshData();
    } catch (e: any) {
      addToast('Failed to clear proxy', 'error');
    }
  };

  return (
    <div className="logs-page">
      {/* Proxy Status Card */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-title">
          <span>🌐 SOCKS5 Proxy Status</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleScanProxy} disabled={scanningProxy}>
              {scanningProxy ? 'Scanning...' : '🔄 Scan & Lock Proxy'}
            </button>
            {config?.api_proxy || config?.auto_proxy ? (
              <button className="btn btn-danger btn-sm" onClick={handleClearProxy}>
                Clear Proxy
              </button>
            ) : null}
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: (config?.api_proxy || config?.auto_proxy) ? 'var(--status-green-bg)' : 'var(--bg-input)',
          border: `1px solid ${(config?.api_proxy || config?.auto_proxy) ? 'var(--status-green-border)' : 'var(--border)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px'
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Active Proxy: </span>
            <span style={{ fontWeight: 700 }}>{config?.api_proxy || config?.auto_proxy || 'Direct Network Connection'}</span>
          </div>
          <span className={`badge ${config?.api_proxy || config?.auto_proxy ? 'badge-green' : 'badge-amber'}`}>
            {config?.api_proxy ? 'Manual Proxy' : (config?.auto_proxy ? 'Auto SOCKS5' : 'Direct')}
          </span>
        </div>
      </div>

      {/* System Logs */}
      <div className="card">
        <div className="card-title">
          <span>📜 Real-Time System Activity Stream</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              className="input-field"
              style={{ padding: '4px 8px', fontSize: '12px' }}
              value={filterLevel}
              onChange={e => setFilterLevel(e.target.value)}
            >
              <option value="all">All Logs ({logs.length})</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warn">Warnings</option>
              <option value="error">Errors</option>
            </select>
          </div>
        </div>

        <div style={{
          backgroundColor: 'var(--bg-app)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px',
          height: '480px',
          overflowY: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>
              No log entries match the selected filter.
            </div>
          ) : (
            filteredLogs.slice().reverse().map((entry: LogEntry, idx: number) => {
              let color = 'var(--text-primary)';
              if (entry.level === 'success') color = 'var(--status-green)';
              if (entry.level === 'warn') color = 'var(--status-amber)';
              if (entry.level === 'error') color = 'var(--status-red)';

              return (
                <div key={idx} style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{entry.timestamp}]</span>
                  <span style={{ color, wordBreak: 'break-all' }}>{entry.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

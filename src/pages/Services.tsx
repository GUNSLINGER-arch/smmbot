import { useState, useEffect } from 'react';
import { api, downloadCsv, timeAgo, SavedService } from '../api';
import { useApp } from '../AppContext';

// ─────────────────────────────────────────────────────
//  Add Service Modal
// ─────────────────────────────────────────────────────
function AddServiceModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { addToast } = useApp();
  const [form, setForm] = useState({ service_id: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ rate_usd: number; rate_pkr: number; min_order: number; max_order: number } | null>(null);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!form.service_id.trim() || !form.name.trim()) { addToast('Both fields required', 'error'); return; }
    setLoading(true);
    const res = await api.addService(form.service_id.trim(), form.name.trim());
    setLoading(false);
    if (res.error) { addToast(res.error, 'error'); return; }
    addToast(`Service ${form.service_id} added ✅`, 'success');
    setPreview({ rate_usd: res.rate_usd, rate_pkr: res.rate_pkr, min_order: res.min_order, max_order: res.max_order });
    onAdded();
    setTimeout(onClose, 1200);
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content narrow">
        <div className="modal-header">
          <span className="modal-title">➕ Add Service</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Service ID</label>
            <input className="form-input" placeholder="e.g. 1234" value={form.service_id}
              onChange={e => set('service_id', e.target.value)} />
            <span className="form-hint">Find this from the Marketerum services list on their website</span>
          </div>
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input className="form-input" placeholder="e.g. TikTok Views – HQ"
              value={form.name} onChange={e => set('name', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          </div>
          {preview && (
            <div className="meta-preview">
              <div className="meta-row"><span className="meta-key">Rate USD</span><span className="meta-val">${preview.rate_usd.toFixed(4)} / 1k</span></div>
              <div className="meta-row"><span className="meta-key">Rate PKR</span><span className="meta-val">₨{preview.rate_pkr.toFixed(2)} / 1k</span></div>
              <div className="meta-row"><span className="meta-key">Min</span><span className="meta-val">{preview.min_order.toLocaleString()}</span></div>
              <div className="meta-row"><span className="meta-key">Max</span><span className="meta-val">{preview.max_order.toLocaleString()}</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={loading}>
            {loading ? <><span className="spin">⟳</span> Fetching…</> : '➕ Add Service'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Order History Panel
// ─────────────────────────────────────────────────────
interface OrderItem {
  order_id: string; service_id: string; link: string;
  quantity: number; runs?: number; interval?: number;
  created_at: string; type: 'manual'|'drip'|'campaign';
}

function OrderHistoryPanel() {
  const { addToast } = useApp();
  const [history, setHistory] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingId, setCheckingId] = useState('');
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const data = await api.getOrderHistory() as OrderItem[];
    setHistory([...data].reverse());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCheck = async (oid: string) => {
    setCheckingId(oid);
    const res = await api.checkOrder(oid);
    setStatusMap(m => ({ ...m, [oid]: res.status || 'Unknown' }));
    setCheckingId('');
  };

  const handleClear = async () => {
    if (!confirm('Clear all order history?')) return;
    await api.clearOrderHistory();
    setHistory([]);
    addToast('History cleared', 'info');
  };

  const handleMultiCheck = async () => {
    const ids = history.slice(0, 20).map(o => o.order_id);
    if (!ids.length) return;
    setLoading(true);
    const result = await api.multiStatus(ids);
    const updates: Record<string, string> = {};
    Object.entries(result).forEach(([oid, data]: [string, any]) => {
      updates[oid] = data.status || 'Unknown';
    });
    setStatusMap(m => ({ ...m, ...updates }));
    setLoading(false);
    addToast(`Updated ${Object.keys(updates).length} order statuses`, 'success');
  };

  return (
    <div className="card" style={{ flex:1 }}>
      <div className="card-header">
        <span className="card-title">📜 Order History</span>
        <div style={{ display:'flex', gap:6 }}>
          <button className="btn btn-secondary btn-xs" onClick={handleMultiCheck} disabled={loading || history.length === 0}>
            {loading ? <span className="spin">⟳</span> : '↺'} Batch Check
          </button>
          <button className="btn btn-ghost btn-xs" onClick={load}>↺</button>
          <button className="btn btn-danger btn-xs" onClick={handleClear}>🗑 Clear</button>
        </div>
      </div>
      {history.length === 0 ? (
        <div className="empty-state">
          <span className="icon">📜</span>
          <span className="title">No orders yet</span>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 280 }}>
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Service</th>
                <th>Qty</th>
                <th>Type</th>
                <th>Time</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 50).map(o => (
                <tr key={o.order_id}>
                  <td className="mono primary">#{o.order_id}</td>
                  <td className="mono">{o.service_id}</td>
                  <td className="mono">{o.quantity.toLocaleString()}{o.runs ? ` ×${o.runs}` : ''}</td>
                  <td>
                    <span className={`badge ${o.type === 'drip' ? 'accent' : o.type === 'campaign' ? 'pending' : 'neutral'}`}>
                      {o.type}
                    </span>
                  </td>
                  <td className="text-xs text-muted">{timeAgo(o.created_at)}</td>
                  <td>
                    {statusMap[o.order_id]
                      ? <span className={`badge ${statusMap[o.order_id]?.toLowerCase().includes('complet') ? 'completed' :
                          statusMap[o.order_id]?.toLowerCase().includes('cancel') ? 'stopped' : 'pending'}`}>
                          {statusMap[o.order_id]}
                        </span>
                      : <span className="text-muted text-xs">—</span>
                    }
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-xs" onClick={() => handleCheck(o.order_id)} disabled={checkingId === o.order_id}>
                      {checkingId === o.order_id ? <span className="spin">⟳</span> : '?'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Services Page
// ─────────────────────────────────────────────────────
export default function Services() {
  const { services, refreshServices, addToast } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = services.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.service_id.includes(filter)
  );

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await api.deleteService(id);
    addToast(`Deleted ${name}`, 'info');
    refreshServices();
  };

  const handleRecalcPrices = async () => {
    await api.recalculateServicePrices();
    addToast('Prices recalculated at current exchange rate', 'success');
    refreshServices();
  };

  const handleExport = async () => {
    const { csv } = await api.exportServicesCsv();
    downloadCsv(csv, 'marketerum_services.csv');
  };

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">🗂️ Services</div>
          <div className="page-sub">{services.length} services configured</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleExport}>⬇ CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={handleRecalcPrices}>♻️ Recalc Prices</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>➕ Add Service</button>
        </div>
      </div>

      {/* Search */}
      <div className="form-group" style={{ marginBottom:0 }}>
        <input className="form-input" placeholder="🔍  Filter by name or service ID…"
          value={filter} onChange={e => setFilter(e.target.value)} />
      </div>

      {/* Table */}
      <div className="card flush" style={{ flex:1, overflow:'hidden' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="icon">🗂️</span>
            <span className="title">{services.length === 0 ? 'No services yet' : 'No results'}</span>
            <span className="sub">
              {services.length === 0
                ? 'Add a service ID from Marketerum and give it a name'
                : 'Try a different search term'}
            </span>
            {services.length === 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>➕ Add First Service</button>
            )}
          </div>
        ) : (
          <div className="table-wrap" style={{ height:'100%' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Rate / 1k</th>
                  <th>PKR / 1k</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: SavedService) => (
                  <tr key={s.id}>
                    <td className="mono primary">{s.service_id}</td>
                    <td style={{ color:'var(--text-1)', fontWeight:500 }}>{s.name}</td>
                    <td className="mono text-green">${s.rate_usd.toFixed(4)}</td>
                    <td className="mono" style={{ color:'var(--yellow)' }}>₨{s.rate_pkr.toFixed(2)}</td>
                    <td className="mono text-muted">{s.min_order.toLocaleString()}</td>
                    <td className="mono text-muted">{s.max_order.toLocaleString()}</td>
                    <td>
                      <button className="btn btn-danger btn-xs" onClick={() => handleDelete(s.id, s.name)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order History */}
      <OrderHistoryPanel />

      {showAdd && (
        <AddServiceModal onClose={() => setShowAdd(false)} onAdded={refreshServices} />
      )}
    </div>
  );
}

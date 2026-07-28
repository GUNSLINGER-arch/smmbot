import { useState } from 'react';
import { useApp } from '../AppContext';
import { api, SavedService } from '../api';

export default function DirectOrderPage() {
  const { services, balance, addToast, refreshData } = useApp();

  const [serviceId, setServiceId] = useState('');
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('1000');
  const [runs, setRuns] = useState('1');
  const [interval, setInterval] = useState('60');
  const [ordering, setOrdering] = useState(false);

  const selectedService = services.find((s: SavedService) => s.service_id === serviceId);

  // Price Calculation
  const qtyNum = parseInt(quantity) || 0;
  const runsNum = parseInt(runs) || 1;
  const totalUnits = qtyNum * runsNum;

  const costUsd = selectedService ? (totalUnits / 1000) * selectedService.rate_usd : 0;
  const costPkr = selectedService ? (totalUnits / 1000) * selectedService.rate_pkr : 0;

  const handlePlaceOrder = async () => {
    if (!serviceId) { addToast('Select a panel service first', 'error'); return; }
    if (!link.trim()) { addToast('Target post/profile link is required', 'error'); return; }
    if (qtyNum <= 0) { addToast('Quantity must be greater than 0', 'error'); return; }

    setOrdering(true);
    try {
      if (runsNum > 1) {
        const res = await api.placeDripOrder({
          service_id: serviceId,
          link: link.trim(),
          quantity: qtyNum,
          runs: runsNum,
          interval: parseInt(interval) || 60
        });
        if (res.ok && res.order_id) {
          addToast(`✅ Drip Order #${res.order_id} placed successfully!`, 'success');
          setLink('');
          refreshData();
        } else {
          addToast(res.error || 'Drip order failed', 'error');
        }
      } else {
        const res = await api.placeOrder(serviceId, link.trim(), qtyNum);
        if (res.ok && res.order_id) {
          addToast(`✅ Direct Order #${res.order_id} placed successfully!`, 'success');
          setLink('');
          refreshData();
        } else {
          addToast(res.error || 'Direct order failed', 'error');
        }
      }
    } catch (e: any) {
      addToast(e.message || 'Order failed', 'error');
    }
    setOrdering(false);
  };

  return (
    <div className="direct-order-page" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="card">
        <div className="card-title">
          <span>⚡ Quick Order Dispatcher</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Direct Marketerum SMM Panel Integration</span>
        </div>

        <div className="input-group">
          <label className="input-label">Select Panel Service</label>
          <select
            className="input-field"
            value={serviceId}
            onChange={e => setServiceId(e.target.value)}
          >
            <option value="">-- Choose Service --</option>
            {services.map(s => (
              <option key={s.id} value={s.service_id}>
                [{s.service_id}] {s.name} — PKR {s.rate_pkr?.toFixed(1)}/k (${s.rate_usd?.toFixed(4)})
              </option>
            ))}
          </select>
        </div>

        <div className="input-group">
          <label className="input-label">Target Link / URL</label>
          <input
            className="input-field"
            placeholder="https://www.tiktok.com/@user/video/..."
            value={link}
            onChange={e => setLink(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div className="input-group">
            <label className="input-label">Quantity per Run</label>
            <input
              className="input-field"
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
            />
            {selectedService && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Min: {selectedService.min_order} | Max: {selectedService.max_order?.toLocaleString()}
              </span>
            )}
          </div>

          <div className="input-group">
            <label className="input-label">Runs (1 for single order)</label>
            <input
              className="input-field"
              type="number"
              value={runs}
              onChange={e => setRuns(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Interval (Minutes)</label>
            <input
              className="input-field"
              type="number"
              value={interval}
              onChange={e => setInterval(e.target.value)}
              disabled={runsNum <= 1}
            />
          </div>
        </div>

        {/* Live Calculation Box */}
        {selectedService && (
          <div style={{
            padding: '14px',
            backgroundColor: 'var(--accent-blue-bg)',
            border: '1px solid var(--accent-blue-border)',
            borderRadius: 'var(--radius-md)',
            margin: '16px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-blue)' }}>Calculated Total Cost:</div>
              <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                PKR {costPkr.toFixed(2)} <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>(${costUsd.toFixed(4)})</span>
              </div>
            </div>
            {balance?.ok && (
              <div style={{ textAlign: 'right', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-muted)' }}>Current Balance:</div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>PKR {balance.pkr?.toFixed(0)}</div>
              </div>
            )}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: '12px', fontSize: '14px' }}
          onClick={handlePlaceOrder}
          disabled={ordering}
        >
          {ordering ? 'Dispatching Order...' : (runsNum > 1 ? '🚀 Dispatch Drip-Feed Order' : '⚡ Dispatch Direct Order')}
        </button>
      </div>
    </div>
  );
}

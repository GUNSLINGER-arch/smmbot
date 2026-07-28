import { useState } from 'react';
import { useApp } from '../AppContext';
import { api, fmtNumber, truncateTitle, Campaign } from '../api';

export default function CampaignsPage() {
  const { campaigns, services, addToast, refreshData } = useApp();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [launching, setLaunching] = useState(false);

  const [form, setForm] = useState({
    url: '',
    platform: 'TikTok',
    delivery_mode: 'Organic Growth',
    view_service: '',
    like_service: '',
    comment_service: '',
    share_service: '',
    save_service: '',
    total_views: '10000',
    days_to_run: '7',
    engagement_rate: '2.2',
  });

  const [meta, setMeta] = useState<{ title: string; author: string; views: number | null; likes: number | null; source: string } | null>(null);

  const campaignList = Object.values(campaigns) as Campaign[];
  const runningCount = campaignList.filter(c => c.status === 'Running').length;
  const totalDeliveredViews = campaignList.reduce((acc, c) => acc + (c.views_delivered || 0), 0);
  const totalDeliveredLikes = campaignList.reduce((acc, c) => acc + (c.likes_delivered || 0), 0);

  const handleFetchMeta = async () => {
    if (!form.url.trim()) {
      addToast('Enter post URL first', 'error');
      return;
    }
    setFetchingMeta(true);
    setMeta(null);
    try {
      const res = await api.fetchMetadata(form.url.trim(), form.platform);
      if (res.ok && res.meta) {
        setMeta(res.meta);
        addToast(`Scraped stats via ${res.meta.source}`, 'success');
      } else {
        addToast(res.error || 'Could not fetch metadata — baseline sync will be used', 'info');
      }
    } catch (e: any) {
      addToast(e.message || 'Fetch failed', 'error');
    }
    setFetchingMeta(false);
  };

  const handleLaunch = async () => {
    if (!form.url.trim()) {
      addToast('URL is required', 'error');
      return;
    }
    if (!form.view_service) {
      addToast('Select a View service', 'error');
      return;
    }

    setLaunching(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        total_views: parseInt(form.total_views) || 10000,
        days_to_run: parseFloat(form.days_to_run) || 7.0,
        engagement_rate: parseFloat(form.engagement_rate) || 2.2,
      };
      if (meta) {
        payload.video_title = meta.title;
        payload.video_author = meta.author;
        payload.start_views = meta.views;
        payload.start_likes = meta.likes;
      }

      const res = await api.launchCampaign(payload);
      if (res.ok) {
        addToast('Stealth Campaign Launched! 🚀', 'success');
        setShowLaunchModal(false);
        setForm({
          url: '', platform: 'TikTok', delivery_mode: 'Organic Growth',
          view_service: '', like_service: '', comment_service: '',
          share_service: '', save_service: '',
          total_views: '10000', days_to_run: '7', engagement_rate: '2.2',
        });
        setMeta(null);
        refreshData();
      } else {
        addToast(res.error || 'Launch failed', 'error');
      }
    } catch (e: any) {
      addToast(e.message || 'Launch error', 'error');
    }
    setLaunching(false);
  };

  const handleStop = async (url: string) => {
    try {
      await api.stopCampaign(url);
      addToast('Campaign stopped', 'info');
      refreshData();
    } catch (e: any) {
      addToast('Failed to stop campaign', 'error');
    }
  };

  const handleDelete = async (url: string) => {
    try {
      await api.deleteCampaign(url);
      addToast('Campaign removed', 'info');
      refreshData();
    } catch (e: any) {
      addToast('Failed to delete campaign', 'error');
    }
  };

  return (
    <div className="campaigns-page">
      {/* Top Overview Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Active Campaigns</div>
          <div className="metric-value">{runningCount} / {campaignList.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Views Delivered</div>
          <div className="metric-value">{fmtNumber(totalDeliveredViews)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Likes Delivered</div>
          <div className="metric-value">{fmtNumber(totalDeliveredLikes)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pacing Standard</div>
          <div className="metric-value" style={{ fontSize: '16px', color: 'var(--status-green)' }}>Option 1: Stealth (2.2%)</div>
        </div>
      </div>

      {/* Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.3px' }}>Campaign Manager</h2>
        <button className="btn btn-primary" onClick={() => setShowLaunchModal(true)}>
          <span>🚀</span> Launch Stealth Campaign
        </button>
      </div>

      {/* Campaigns List */}
      {campaignList.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>No Active Campaigns</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Launch a new campaign to start stealth organic growth.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {campaignList.map(camp => {
            const pct = Math.min(100, Math.round(((camp.views_delivered || 0) / (camp.total_views || 1)) * 100));
            return (
              <div key={camp.id || camp.url} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span className={`badge ${camp.status === 'Running' ? 'badge-green' : 'badge-amber'}`}>
                        {camp.status}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{camp.platform}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>• {camp.delivery_mode}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                      {truncateTitle(camp.video_title, camp.url, 60)}
                    </div>
                    <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                      {camp.url}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {camp.status === 'Running' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleStop(camp.url)}>
                        Stop
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(camp.url)}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    <span>Progress: {pct}%</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtNumber(camp.views_delivered || 0)} / {fmtNumber(camp.total_views)} views</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Delivered Metrics Detail */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', padding: '10px', backgroundColor: 'var(--bg-input)', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Likes Delivered: </span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtNumber(camp.likes_delivered || 0)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Comments: </span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtNumber(camp.comments_delivered || 0)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Shares: </span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtNumber(camp.shares_delivered || 0)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Duration: </span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{camp.days_to_run} Days</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Launch Modal */}
      {showLaunchModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '16px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="card-title">
              <span>🚀 Launch Stealth Organic Campaign</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowLaunchModal(false)}>✕</button>
            </div>

            <div className="input-group">
              <label className="input-label">Post URL</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="input-field"
                  style={{ flex: 1 }}
                  placeholder="https://www.tiktok.com/@user/video/..."
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                />
                <button className="btn btn-secondary" onClick={handleFetchMeta} disabled={fetchingMeta}>
                  {fetchingMeta ? 'Scraping...' : 'Fetch'}
                </button>
              </div>
            </div>

            {meta && (
              <div style={{ padding: '10px 14px', backgroundColor: 'var(--status-green-bg)', border: '1px solid var(--status-green-border)', borderRadius: 'var(--radius-md)', marginBottom: '14px', fontSize: '12px' }}>
                <div><strong>Title:</strong> {meta.title}</div>
                <div><strong>Author:</strong> @{meta.author}</div>
                <div><strong>Live Views:</strong> {meta.views !== null ? fmtNumber(meta.views) : 'N/A'}</div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label className="input-label">Platform</label>
                <select className="input-field" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                  <option value="TikTok">TikTok</option>
                  <option value="Instagram">Instagram</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Target Views</label>
                <input className="input-field" type="number" value={form.total_views} onChange={e => setForm({ ...form, total_views: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label className="input-label">View Service ID</label>
                <select className="input-field" value={form.view_service} onChange={e => setForm({ ...form, view_service: e.target.value })}>
                  <option value="">Select Service...</option>
                  {services.map(s => (
                    <option key={s.id} value={s.service_id}>{s.service_id} — {s.name}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Like Service ID</label>
                <select className="input-field" value={form.like_service} onChange={e => setForm({ ...form, like_service: e.target.value })}>
                  <option value="">Select Service...</option>
                  {services.map(s => (
                    <option key={s.id} value={s.service_id}>{s.service_id} — {s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label className="input-label">Duration (Days)</label>
                <input className="input-field" type="number" value={form.days_to_run} onChange={e => setForm({ ...form, days_to_run: e.target.value })} />
              </div>

              <div className="input-group">
                <label className="input-label">Engagement Target (%)</label>
                <input className="input-field" type="number" value={form.engagement_rate} onChange={e => setForm({ ...form, engagement_rate: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="btn btn-secondary" onClick={() => setShowLaunchModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleLaunch} disabled={launching}>
                {launching ? 'Launching...' : 'Confirm & Launch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

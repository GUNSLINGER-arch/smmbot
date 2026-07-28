import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import './index.css';
import { AppProvider, useApp } from './AppContext';
import {
  api, fmtNumber, truncateTitle, timeAgo, pct, downloadCsv,
  Campaign, SavedService, LogEntry, OrderHistoryItem, AnalyticsPoint
} from './api';

// ─────────────────────────────────────────────────────────────────
//  PROGRESS RING (SVG RADIAL)
// ─────────────────────────────────────────────────────────────────
function ProgressRing({ value, size = 48, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - ((value || 0) / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id={`ring_grad_${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#00d4ff" />
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={`url(#ring_grad_${size})`} strokeWidth={stroke}
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
      </svg>
      <span style={{ position: 'absolute', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
        {(value || 0).toFixed(0)}%
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  PROGRESS BAR
// ─────────────────────────────────────────────────────────────────
function ProgBar({ value }: { value: number }) {
  const pctVal = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="term-prog-bg">
      <div className="term-prog-fill" style={{ width: `${pctVal}%` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  ANALYTICS SPARKLINE
// ─────────────────────────────────────────────────────────────────
function AnalyticsSpark({ camp }: { camp: Campaign }) {
  const [data, setData] = useState<AnalyticsPoint[]>([]);
  const [timeframe, setTimeframe] = useState<'1h' | '12h' | 'all'>('all');

  useEffect(() => {
    (async () => {
      try {
        const allAnalytics = await api.getAnalytics();
        if (allAnalytics && allAnalytics[camp.url]) {
          setData(allAnalytics[camp.url]);
        }
      } catch {}
    })();
  }, [camp.url]);

  if (!data || data.length < 2) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
        No time-series data yet — chart will populate after first delivery pulse
      </div>
    );
  }

  const now = Date.now();
  let filtered = data;
  if (timeframe === '1h') {
    filtered = data.filter(p => now - new Date(p.timestamp).getTime() <= 60 * 60 * 1000);
  } else if (timeframe === '12h') {
    filtered = data.filter(p => now - new Date(p.timestamp).getTime() <= 12 * 60 * 60 * 1000);
  }
  const displayData = filtered.length >= 2 ? filtered : data;

  const chartData = displayData.map(p => ({
    t: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    v: p.views,
    l: p.likes,
    lv: p.live_views !== undefined ? p.live_views : (camp.start_views || 0) + p.views,
  }));

  const latestScraped = displayData[displayData.length - 1]?.live_views || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '14px', marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Mini Stat Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div className="term-section-box" style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Delivered</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent-cyan)' }}>{fmtNumber(camp.views_delivered || 0)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>/ {fmtNumber(camp.total_views)}</div>
        </div>
        <div className="term-section-box" style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Scraped</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--success)' }}>{camp.start_views !== null ? fmtNumber(latestScraped) : '—'}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>live count</div>
        </div>
        <div className="term-section-box" style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Ratio</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{camp.engagement_rate || 2.2}%</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>stealth</div>
        </div>
      </div>

      {/* Timeframe Filter + Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['1h', '12h', 'all'] as const).map(tf => (
            <button
              key={tf}
              className={`term-btn term-btn-sm ${timeframe === tf ? 'term-btn-cyan' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
          <span style={{ color: 'var(--accent-cyan)' }}>● Delivered</span>
          <span style={{ color: 'var(--success)' }}>● Scraped</span>
          <span style={{ color: 'var(--warning)' }}>● Likes</span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: '140px', width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`glv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`gl_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--warning)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--warning)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}
            />
            <Area type="monotone" dataKey="v" stroke="var(--accent-cyan)" fill={`url(#gv_${camp.id})`} strokeWidth={1.5} name="Delivered" />
            <Area type="monotone" dataKey="lv" stroke="var(--success)" fill={`url(#glv_${camp.id})`} strokeWidth={1.5} name="Scraped" />
            <Area type="monotone" dataKey="l" stroke="var(--warning)" fill={`url(#gl_${camp.id})`} strokeWidth={1.5} name="Likes" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CampaignLogPanel({ camp }: { camp: Campaign }) {
  const { logs } = useApp();
  const campLogs = logs.filter(l => l.url === camp.url || (l.message && l.message.includes(camp.url.slice(-20))));

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', padding: '12px', maxHeight: '180px', overflowY: 'auto', marginTop: '14px' }}>
      {campLogs.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '12px', padding: '16px 0' }}>No logs for this campaign</div>
      ) : (
        campLogs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '6px 0', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: '11px' }}>{l.timestamp}</span>
            <span style={{ color: l.level === 'error' ? 'var(--error)' : l.level === 'success' ? 'var(--success)' : 'var(--text-primary)', wordBreak: 'break-all' }}>
              {l.message}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  CAMPAIGNS TAB
// ─────────────────────────────────────────────────────────────────
function CampaignsTab() {
  const { campaigns, services, addToast, refreshData } = useApp();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [editingCamp, setEditingCamp] = useState<Campaign | null>(null);
  const [activePanels, setActivePanels] = useState<Record<string, 'analytics' | 'logs' | 'details' | null>>({});

  const [form, setForm] = useState({
    url: '', platform: 'TikTok', delivery_mode: 'Organic Growth',
    view_service: '', like_service: '', comment_service: '',
    share_service: '', save_service: '',
    total_views: '10000', days_to_run: '7', engagement_rate: '2.2', peak_only: false,
  });

  const [editForm, setEditForm] = useState({
    total_views: '10000', days_to_run: '7', engagement_rate: '2.2',
    view_service: '', like_service: '', comment_service: '',
    share_service: '', save_service: '', peak_only: false,
  });

  const [meta, setMeta] = useState<{ title: string; author: string; views: number | null; likes: number | null; comments?: number | null; shares?: number | null; saves?: number | null; source: string } | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [expenseBreakdown, setExpenseBreakdown] = useState<any>(null);

  const list = Object.values(campaigns) as Campaign[];
  const runningCount = list.filter(c => c.status === 'Running').length;
  const totalDeliveredViews = list.reduce((acc, c) => acc + (c.views_delivered || 0), 0);
  const totalDeliveredLikes = list.reduce((acc, c) => acc + (c.likes_delivered || 0), 0);

  const togglePanel = (id: string, panel: 'analytics' | 'logs' | 'details') => {
    setActivePanels(prev => ({ ...prev, [id]: prev[id] === panel ? null : panel }));
  };

  const handleOpenEdit = (c: Campaign) => {
    setEditingCamp(c);
    setEditForm({
      total_views: String(c.total_views || 10000),
      days_to_run: String(c.days_to_run || 7),
      engagement_rate: String(c.engagement_rate || 2.2),
      view_service: c.view_service || '',
      like_service: c.like_service || '',
      comment_service: c.comment_service || '',
      share_service: c.share_service || '',
      save_service: c.save_service || '',
      peak_only: Boolean(c.peak_only),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingCamp) return;
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {
        total_views: parseInt(editForm.total_views) || 10000,
        days_to_run: parseFloat(editForm.days_to_run) || 7.0,
        engagement_rate: parseFloat(editForm.engagement_rate) || 2.2,
        view_service: editForm.view_service,
        like_service: editForm.like_service,
        comment_service: editForm.comment_service,
        share_service: editForm.share_service,
        save_service: editForm.save_service,
        peak_only: editForm.peak_only,
      };
      await api.editCampaign(editingCamp.url, payload);
      addToast('Campaign updated successfully', 'success');
      setEditingCamp(null);
      refreshData();
    } catch (e: any) { addToast('Edit failed', 'error'); }
    setSavingEdit(false);
  };

  const handleScrape = async () => {
    if (!form.url.trim()) { addToast('Enter Target URL first', 'info'); return; }
    setFetchingMeta(true);
    setMeta(null);
    try {
      const res = await api.fetchMetadata(form.url.trim(), form.platform);
      if (res.ok && res.meta) {
        setMeta(res.meta);
        addToast(`Scraped metrics via ${res.meta.source}`, 'success');
      } else {
        addToast(res.error || 'Scrape unverified — baseline sync enabled', 'info');
      }
    } catch (e: any) { addToast('Scrape error', 'error'); }
    setFetchingMeta(false);
  };

  const calculateExpense = () => {
    const totalViews = parseInt(form.total_views) || 0;
    if (totalViews <= 0) { addToast('Enter target views first', 'error'); return; }
    if (!form.view_service) { addToast('Select View service first', 'error'); return; }

    const viewSvc = services.find(s => s.service_id === form.view_service);
    const likeSvc = services.find(s => s.service_id === form.like_service);
    const commentSvc = services.find(s => s.service_id === form.comment_service);
    const shareSvc = services.find(s => s.service_id === form.share_service);
    const saveSvc = services.find(s => s.service_id === form.save_service);

    let totalUsd = 0;
    let totalPkr = 0;

    const viewsCost = viewSvc ? { qty: totalViews, usd: (totalViews / 1000) * viewSvc.rate_usd, pkr: (totalViews / 1000) * viewSvc.rate_pkr } : null;
    if (viewsCost) { totalUsd += viewsCost.usd; totalPkr += viewsCost.pkr; }

    let likesCost = null;
    if (likeSvc) {
      const rate = parseFloat(form.engagement_rate) || 2.2;
      const qty = Math.max(likeSvc.min_order || 10, Math.round(totalViews * (rate / 100)));
      const usd = (qty / 1000) * likeSvc.rate_usd;
      const pkr = (qty / 1000) * likeSvc.rate_pkr;
      likesCost = { qty, usd, pkr };
      totalUsd += usd; totalPkr += pkr;
    }

    let commentsCost = null;
    if (commentSvc) {
      const qty = Math.max(commentSvc.min_order || 5, Math.round(totalViews * 0.0008));
      const usd = (qty / 1000) * commentSvc.rate_usd;
      const pkr = (qty / 1000) * commentSvc.rate_pkr;
      commentsCost = { qty, usd, pkr };
      totalUsd += usd; totalPkr += pkr;
    }

    let sharesCost = null;
    if (shareSvc) {
      const qty = Math.max(shareSvc.min_order || 5, Math.round(totalViews * 0.0010));
      const usd = (qty / 1000) * shareSvc.rate_usd;
      const pkr = (qty / 1000) * shareSvc.rate_pkr;
      sharesCost = { qty, usd, pkr };
      totalUsd += usd; totalPkr += pkr;
    }

    let savesCost = null;
    if (saveSvc) {
      const qty = Math.max(saveSvc.min_order || 5, Math.round(totalViews * 0.0050));
      const usd = (qty / 1000) * saveSvc.rate_usd;
      const pkr = (qty / 1000) * saveSvc.rate_pkr;
      savesCost = { qty, usd, pkr };
      totalUsd += usd; totalPkr += pkr;
    }

    setExpenseBreakdown({ views: viewsCost, likes: likesCost, comments: commentsCost, shares: sharesCost, saves: savesCost, totalUsd, totalPkr });
  };

  const handleLaunch = async () => {
    if (!form.url.trim() || !form.view_service) { addToast('URL and View Service required', 'info'); return; }
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
        addToast('Campaign initialized', 'success');
        setShowLaunchModal(false);
        refreshData();
      } else { addToast(res.error || 'Launch failed', 'error'); }
    } catch (e: any) { addToast(e.message || 'Launch error', 'error'); }
    setLaunching(false);
  };

  const handleStop = async (url: string) => {
    try { await api.stopCampaign(url); addToast('Campaign stopped', 'info'); refreshData(); }
    catch (e) { addToast('Failed to stop campaign', 'error'); }
  };
  const handleResume = async (url: string) => {
    try { await api.resumeCampaign(url); addToast('Campaign resumed', 'success'); refreshData(); }
    catch (e) { addToast('Failed to resume campaign', 'error'); }
  };
  const handleDelete = async (url: string) => {
    try { await api.deleteCampaign(url); addToast('Campaign deleted', 'info'); refreshData(); }
    catch (e) { addToast('Failed to delete campaign', 'error'); }
  };
  const handleCancelStuck = async (url: string) => {
    try { await api.cancelStuckOrder(url); addToast('Cancelled stuck order', 'info'); refreshData(); }
    catch (e) { addToast('Failed to cancel order', 'error'); }
  };
  const handleRefill = async (url: string) => {
    try { await api.refillOrder(url); addToast('Refill requested', 'info'); }
    catch (e) { addToast('Refill request failed', 'error'); }
  };

  return (
    <div>
      {/* Stats Grid */}
      <div className="term-grid-4">
        <div className="term-metric-box">
          <div className="term-metric-lbl">Active</div>
          <div className="term-metric-val" style={{ color: 'var(--success)' }}>{runningCount} / {list.length}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">Views Delivered</div>
          <div className="term-metric-val" style={{ color: 'var(--accent-cyan)' }}>{fmtNumber(totalDeliveredViews)}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">Likes Delivered</div>
          <div className="term-metric-val" style={{ color: 'var(--warning)' }}>{fmtNumber(totalDeliveredLikes)}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">Pacing Mode</div>
          <div className="term-metric-val" style={{ fontSize: '14px', color: 'var(--success)' }}>Circadian (2.2%)</div>
        </div>
      </div>

      {/* Section Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Active Campaigns ({list.length})
        </div>
        <button className="term-btn term-btn-cyan term-btn-sm" onClick={() => setShowLaunchModal(true)}>
          + Launch
        </button>
      </div>

      {/* Campaign List */}
      {list.length === 0 ? (
        <div className="term-card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)' }}>
          No active campaigns — tap Launch to start one
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {list.map(c => {
            const pctVal = pct(c.views_delivered || 0, c.total_views || 1);
            const activePanel = activePanels[c.id || c.url];
            const deliveredViews = c.views_delivered || 0;
            const totalInteractions = (c.likes_delivered || 0) + (c.comments_delivered || 0) + (c.shares_delivered || 0) + (c.saves_delivered || 0);
            const liveEngagementPct = deliveredViews > 0 ? ((totalInteractions / deliveredViews) * 100).toFixed(1) : '0.0';
            const pctNum = parseFloat(liveEngagementPct);

            let safetyBadgeClass = 'term-badge-green';
            let safetyLabel = `Safe (${liveEngagementPct}%)`;
            if (pctNum >= 1.8 && pctNum <= 4.5) {
              safetyBadgeClass = 'term-badge-green';
              safetyLabel = `Safe (${liveEngagementPct}%)`;
            } else if (pctNum > 4.5 && pctNum <= 7.0) {
              safetyBadgeClass = 'term-badge-amber';
              safetyLabel = `Moderate (${liveEngagementPct}%)`;
            } else if (pctNum > 7.0) {
              safetyBadgeClass = 'term-badge-red';
              safetyLabel = `High Risk (${liveEngagementPct}%)`;
            } else if (deliveredViews > 100) {
              safetyBadgeClass = 'term-badge-amber';
              safetyLabel = `Low (${liveEngagementPct}%)`;
            }

            return (
              <div key={c.id || c.url} className={`term-card ${c.status === 'Running' ? 'glass-card--glow' : ''}`}>
                {/* Header: Ring + Title + Badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <ProgressRing value={pctVal} size={48} stroke={4} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span className={`term-badge ${c.status === 'Running' ? 'term-badge-green' : 'term-badge-amber'}`}>
                          {c.status}
                        </span>
                        <span className="term-badge term-badge-cyan">{c.platform}</span>
                        <span className={`term-badge ${safetyBadgeClass}`}>{safetyLabel}</span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncateTitle(c.video_title, c.url, 48)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 500, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    <span>Progress: {pctVal}%</span>
                    <span>{fmtNumber(c.views_delivered || 0)} / {fmtNumber(c.total_views)}</span>
                  </div>
                  <ProgBar value={pctVal} />
                </div>

                {/* Metrics Row */}
                <div className="campaign-metrics-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', fontSize: '11px', marginBottom: '12px' }}>
                  <div>Views <strong style={{ color: 'var(--accent-cyan)', display: 'block' }}>{fmtNumber(c.views_delivered || 0)}</strong></div>
                  <div>Likes <strong style={{ color: 'var(--warning)', display: 'block' }}>{fmtNumber(c.likes_delivered || 0)}</strong></div>
                  <div>Cmts <strong style={{ color: 'var(--success)', display: 'block' }}>{fmtNumber(c.comments_delivered || 0)}</strong></div>
                  <div>Shares <strong style={{ display: 'block' }}>{fmtNumber(c.shares_delivered || 0)}</strong></div>
                  <div>Saves <strong style={{ display: 'block' }}>{fmtNumber(c.saves_delivered || 0)}</strong></div>
                </div>

                {/* Action Buttons */}
                <div className="campaign-actions-mobile" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {c.status === 'Running' ? (
                    <button className="term-btn term-btn-sm" onClick={() => handleStop(c.url)}>Stop</button>
                  ) : (
                    <button className="term-btn term-btn-green term-btn-sm" onClick={() => handleResume(c.url)}>Resume</button>
                  )}
                  <button className="term-btn term-btn-sm" onClick={() => handleOpenEdit(c)}>Edit</button>
                  <button className="term-btn term-btn-sm" onClick={() => handleRefill(c.url)}>Refill</button>
                  <button className="term-btn term-btn-sm" onClick={() => handleCancelStuck(c.url)}>Cancel</button>
                  <button className="term-btn term-btn-red term-btn-sm" onClick={() => handleDelete(c.url)}>Delete</button>
                </div>

                {/* Accordion Triggers */}
                <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '10px' }}>
                  <button className={`term-btn term-btn-sm ${activePanel === 'analytics' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'analytics')}>
                    Analytics {activePanel === 'analytics' ? '▴' : '▾'}
                  </button>
                  <button className={`term-btn term-btn-sm ${activePanel === 'logs' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'logs')}>
                    Logs {activePanel === 'logs' ? '▴' : '▾'}
                  </button>
                  <button className={`term-btn term-btn-sm ${activePanel === 'details' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'details')}>
                    Details {activePanel === 'details' ? '▴' : '▾'}
                  </button>
                </div>

                {/* Expandable Panels */}
                {activePanel === 'analytics' && <AnalyticsSpark camp={c} />}
                {activePanel === 'logs' && <CampaignLogPanel camp={c} />}
                {activePanel === 'details' && (
                  <div style={{ padding: '14px', background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', marginTop: '14px', fontSize: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>View SVC: <strong style={{ color: 'var(--accent-cyan)' }}>#{c.view_service || 'N/A'}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Like SVC: <strong style={{ color: 'var(--accent-cyan)' }}>#{c.like_service || 'N/A'}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Comment SVC: <strong style={{ color: 'var(--accent-cyan)' }}>#{c.comment_service || 'N/A'}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Share SVC: <strong style={{ color: 'var(--accent-cyan)' }}>#{c.share_service || 'N/A'}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Save SVC: <strong style={{ color: 'var(--accent-cyan)' }}>#{c.save_service || 'N/A'}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Safety: <strong style={{ color: pctNum > 7.0 ? 'var(--error)' : 'var(--success)' }}>{safetyLabel}</strong></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {editingCamp && (
        <div className="modal-overlay" onClick={() => setEditingCamp(null)}>
          <div className="term-card" style={{ width: '100%', maxWidth: '580px', maxHeight: '92vh', overflowY: 'auto', margin: '0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="term-card-header">
              <span className="term-card-title">Edit Campaign</span>
              <button className="term-btn term-btn-sm" onClick={() => setEditingCamp(null)}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', wordBreak: 'break-all' }}>
              {editingCamp.url}
            </div>

            <div className="term-section-box">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '12px' }}>Pacing & Targets</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">Target Views</label>
                  <input className="term-input" type="number" value={editForm.total_views} onChange={e => setEditForm({ ...editForm, total_views: e.target.value })} />
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Duration (Days)</label>
                  <input className="term-input" type="number" value={editForm.days_to_run} onChange={e => setEditForm({ ...editForm, days_to_run: e.target.value })} />
                </div>
              </div>
              <div className="term-field-group">
                <label className="term-field-lbl">Engagement Rate (%)</label>
                <input className="term-input" type="number" value={editForm.engagement_rate} onChange={e => setEditForm({ ...editForm, engagement_rate: e.target.value })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={editForm.peak_only} onChange={e => setEditForm({ ...editForm, peak_only: e.target.checked })} />
                <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>Peak-hours only (12 PM - 11 PM)</span>
              </label>
            </div>

            <div className="term-section-box">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '12px' }}>Service Routing</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">View Service</label>
                  <select className="term-input" value={editForm.view_service} onChange={e => setEditForm({ ...editForm, view_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Like Service</label>
                  <select className="term-input" value={editForm.like_service} onChange={e => setEditForm({ ...editForm, like_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">Comment SVC</label>
                  <select className="term-input" value={editForm.comment_service} onChange={e => setEditForm({ ...editForm, comment_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Share SVC</label>
                  <select className="term-input" value={editForm.share_service} onChange={e => setEditForm({ ...editForm, share_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Save SVC</label>
                  <select className="term-input" value={editForm.save_service} onChange={e => setEditForm({ ...editForm, save_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="term-btn" onClick={() => setEditingCamp(null)}>Cancel</button>
              <button className="term-btn term-btn-cyan" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Launch Modal */}
      {showLaunchModal && (
        <div className="modal-overlay" onClick={() => setShowLaunchModal(false)}>
          <div className="term-card" style={{ width: '100%', maxWidth: '640px', maxHeight: '92vh', overflowY: 'auto', margin: '0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="term-card-header">
              <span className="term-card-title">Launch Campaign</span>
              <button className="term-btn term-btn-sm" onClick={() => setShowLaunchModal(false)}>✕</button>
            </div>

            {/* Section 1: Target */}
            <div className="term-section-box">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '12px' }}>1. Target Post & Scraper</div>
              <div className="term-field-group">
                <label className="term-field-lbl">Post URL</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="term-input" placeholder="https://www.tiktok.com/@user/video/..." value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
                  <button className="term-btn term-btn-cyan term-btn-sm" onClick={handleScrape} disabled={fetchingMeta} style={{ flexShrink: 0 }}>{fetchingMeta ? 'Scraping...' : 'Scrape'}</button>
                </div>
              </div>
              {meta && (
                <div style={{ padding: '12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px', fontSize: '12px' }}>
                  <div><strong>{meta.title}</strong></div>
                  <div style={{ color: 'var(--text-secondary)' }}>@{meta.author}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(34,197,94,0.2)' }}>
                    <div>Views: <strong>{meta.views ? fmtNumber(meta.views) : 'N/A'}</strong></div>
                    <div>Likes: <strong>{meta.likes ? fmtNumber(meta.likes) : 'N/A'}</strong></div>
                    <div>Comments: <strong>{meta.comments ? fmtNumber(meta.comments) : 'N/A'}</strong></div>
                    <div>Shares: <strong>{meta.shares ? fmtNumber(meta.shares) : 'N/A'}</strong></div>
                    <div>Saves: <strong>{meta.saves ? fmtNumber(meta.saves) : 'N/A'}</strong></div>
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Pacing */}
            <div className="term-section-box">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '12px' }}>2. Pacing & Goals</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">Platform</label>
                  <select className="term-input" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                    <option value="TikTok">TikTok</option>
                    <option value="Instagram">Instagram</option>
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Target Views</label>
                  <input className="term-input" type="number" value={form.total_views} onChange={e => setForm({ ...form, total_views: e.target.value })} />
                </div>
              </div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">Duration (Days)</label>
                  <input className="term-input" type="number" value={form.days_to_run} onChange={e => setForm({ ...form, days_to_run: e.target.value })} />
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Engagement (%)</label>
                  <input className="term-input" type="number" value={form.engagement_rate} onChange={e => setForm({ ...form, engagement_rate: e.target.value })} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.peak_only} onChange={e => setForm({ ...form, peak_only: e.target.checked })} />
                <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>Peak-hours only (12 PM - 11 PM)</span>
              </label>
            </div>

            {/* Section 3: Services */}
            <div className="term-section-box">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '12px' }}>3. Service Routing</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">View Service *</label>
                  <select className="term-input" value={form.view_service} onChange={e => setForm({ ...form, view_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Like Service</label>
                  <select className="term-input" value={form.like_service} onChange={e => setForm({ ...form, like_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">Comment SVC</label>
                  <select className="term-input" value={form.comment_service} onChange={e => setForm({ ...form, comment_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Share SVC</label>
                  <select className="term-input" value={form.share_service} onChange={e => setForm({ ...form, share_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">Save SVC</label>
                  <select className="term-input" value={form.save_service} onChange={e => setForm({ ...form, save_service: e.target.value })}>
                    <option value="">Select...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Expense Calc */}
            <button className="term-btn term-btn-sm" style={{ width: '100%', marginBottom: '12px' }} onClick={calculateExpense}>
              Calculate Expense
            </button>

            {expenseBreakdown && (
              <div style={{ padding: '12px', background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '10px', marginBottom: '12px', fontSize: '12px' }}>
                <div>Views: {expenseBreakdown.views ? `PKR ${expenseBreakdown.views.pkr.toFixed(2)} (${expenseBreakdown.views.qty.toLocaleString()})` : 'N/A'}</div>
                <div>Likes: {expenseBreakdown.likes ? `PKR ${expenseBreakdown.likes.pkr.toFixed(2)} (${expenseBreakdown.likes.qty.toLocaleString()})` : 'N/A'}</div>
                <div>Comments: {expenseBreakdown.comments ? `PKR ${expenseBreakdown.comments.pkr.toFixed(2)} (${expenseBreakdown.comments.qty.toLocaleString()})` : 'N/A'}</div>
                <div>Shares: {expenseBreakdown.shares ? `PKR ${expenseBreakdown.shares.pkr.toFixed(2)} (${expenseBreakdown.shares.qty.toLocaleString()})` : 'N/A'}</div>
                <div>Saves: {expenseBreakdown.saves ? `PKR ${expenseBreakdown.saves.pkr.toFixed(2)} (${expenseBreakdown.saves.qty.toLocaleString()})` : 'N/A'}</div>
                <div style={{ marginTop: '8px', borderTop: '1px solid rgba(0,212,255,0.2)', paddingTop: '8px', fontWeight: 700 }}>
                  Total: PKR {expenseBreakdown.totalPkr.toFixed(2)} (${expenseBreakdown.totalUsd.toFixed(4)})
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button className="term-btn" onClick={() => setShowLaunchModal(false)}>Cancel</button>
              <button className="term-btn term-btn-cyan" onClick={handleLaunch} disabled={launching}>
                {launching ? 'Initializing...' : 'Confirm & Launch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  DISPATCH TAB
// ─────────────────────────────────────────────────────────────────
function DispatchTab() {
  const { services, balance, addToast, refreshData } = useApp();
  const [serviceId, setServiceId] = useState('');
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('1000');
  const [runs, setRuns] = useState('1');
  const [interval, setInterval] = useState('60');
  const [ordering, setOrdering] = useState(false);

  const selectedService = services.find((s: SavedService) => s.service_id === serviceId);
  const qtyNum = parseInt(quantity) || 0;
  const runsNum = parseInt(runs) || 1;
  const totalUnits = qtyNum * runsNum;
  const costUsd = selectedService ? (totalUnits / 1000) * selectedService.rate_usd : 0;
  const costPkr = selectedService ? (totalUnits / 1000) * selectedService.rate_pkr : 0;

  const handleDispatch = async () => {
    if (!serviceId || !link.trim() || qtyNum <= 0) { addToast('Invalid input parameters', 'info'); return; }
    setOrdering(true);
    try {
      if (runsNum > 1) {
        const res = await api.placeDripOrder({ service_id: serviceId, link: link.trim(), quantity: qtyNum, runs: runsNum, interval: parseInt(interval) || 60 });
        if (res.ok && res.order_id) { addToast(`Drip Order #${res.order_id} dispatched`, 'success'); setLink(''); refreshData(); }
        else { addToast(res.error || 'Drip order failed', 'error'); }
      } else {
        const res = await api.placeOrder(serviceId, link.trim(), qtyNum);
        if (res.ok && res.order_id) { addToast(`Order #${res.order_id} dispatched`, 'success'); setLink(''); refreshData(); }
        else { addToast(res.error || 'Direct order failed', 'error'); }
      }
    } catch (e: any) { addToast('Dispatch error', 'error'); }
    setOrdering(false);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">Direct Order Dispatcher</span>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">Panel Service</label>
          <select className="term-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">Select service...</option>
            {services.map(s => (
              <option key={s.id} value={s.service_id}>
                [{s.service_id}] {s.name} — PKR {s.rate_pkr?.toFixed(1)}/k
              </option>
            ))}
          </select>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">Target URL</label>
          <input className="term-input" placeholder="https://www.tiktok.com/@user/video/..." value={link} onChange={e => setLink(e.target.value)} />
        </div>
        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
          <div className="term-field-group">
            <label className="term-field-lbl">Qty / Run</label>
            <input className="term-input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">Runs</label>
            <input className="term-input" type="number" value={runs} onChange={e => setRuns(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">Interval (min)</label>
            <input className="term-input" type="number" value={interval} onChange={e => setInterval(e.target.value)} disabled={runsNum <= 1} />
          </div>
        </div>

        {selectedService && (
          <div style={{ padding: '14px', background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '12px', margin: '14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '2px' }}>Calculated Cost</div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>
                PKR {costPkr.toFixed(2)} <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(${costUsd.toFixed(4)})</span>
              </div>
            </div>
            {balance?.ok && (
              <div style={{ textAlign: 'right', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Balance</div>
                <div style={{ fontWeight: 700 }}>PKR {balance.pkr?.toFixed(0)}</div>
              </div>
            )}
          </div>
        )}

        <button className="term-btn term-btn-cyan" style={{ width: '100%' }} onClick={handleDispatch} disabled={ordering}>
          {ordering ? 'Dispatching...' : (runsNum > 1 ? 'Dispatch Drip Order' : 'Dispatch Direct Order')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  SERVICES TAB
// ─────────────────────────────────────────────────────────────────
function ServicesTab() {
  const { services, addToast, refreshServices } = useApp();
  const [filter, setFilter] = useState('');
  const [newSvcId, setNewSvcId] = useState('');
  const [newSvcName, setNewSvcName] = useState('');
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<OrderHistoryItem[]>([]);

  const loadHistory = async () => {
    try {
      const data = await api.getOrderHistory();
      setHistory((data || []).slice().reverse());
    } catch {}
  };

  useEffect(() => { loadHistory(); }, []);

  const handleAddSvc = async () => {
    if (!newSvcId.trim() || !newSvcName.trim()) { addToast('ID and Name required', 'info'); return; }
    setAdding(true);
    try {
      const res = await api.addService(newSvcId.trim(), newSvcName.trim());
      if (res.error) { addToast(res.error, 'error'); }
      else { addToast(`Service #${newSvcId} added`, 'success'); setNewSvcId(''); setNewSvcName(''); refreshServices(); }
    } catch (e) { addToast('Error adding service', 'error'); }
    setAdding(false);
  };

  const handleDeleteSvc = async (id: string) => {
    try { await api.deleteService(id); addToast('Service removed', 'info'); refreshServices(); }
    catch (e) { addToast('Delete failed', 'error'); }
  };

  const handleRecalculatePrices = async () => {
    try { await api.recalculateServicePrices(); addToast('PKR prices recalculated', 'success'); refreshServices(); }
    catch (e) { addToast('Recalculate failed', 'error'); }
  };

  const handleExportCsv = async () => {
    try {
      const res = await api.exportServicesCsv();
      if (res && res.csv) { downloadCsv('smmbot_services.csv', res.csv); addToast('Services exported', 'success'); }
    } catch (e) { addToast('Export failed', 'error'); }
  };

  const handleBatchCheck = async () => {
    const ids = history.slice(0, 20).map(h => h.order_id);
    if (!ids.length) return;
    try {
      await api.multiStatus(ids);
      addToast(`Checked ${ids.length} orders`, 'success');
      loadHistory();
    } catch (e) { addToast('Batch check failed', 'error'); }
  };

  const handleClearHistory = async () => {
    try { await api.clearOrderHistory(); setHistory([]); addToast('History cleared', 'info'); }
    catch (e) { addToast('Clear history failed', 'error'); }
  };

  const filteredServices = services.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.service_id.includes(filter));

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Registered Services</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="term-btn term-btn-sm" onClick={handleRecalculatePrices}>Recalculate PKR</button>
          <button className="term-btn term-btn-sm" onClick={handleExportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Add Service Card */}
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">Register New Service</span>
        </div>
        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: '10px', alignItems: 'end' }}>
          <div className="term-field-group" style={{ marginBottom: 0 }}>
            <label className="term-field-lbl">ID</label>
            <input className="term-input" placeholder="Service ID" value={newSvcId} onChange={e => setNewSvcId(e.target.value)} />
          </div>
          <div className="term-field-group" style={{ marginBottom: 0 }}>
            <label className="term-field-lbl">Name</label>
            <input className="term-input" placeholder="Service name" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
          </div>
          <button className="term-btn term-btn-green term-btn-sm" onClick={handleAddSvc} disabled={adding} style={{ marginBottom: 0 }}>{adding ? 'Adding...' : '+ Add'}</button>
        </div>
      </div>

      {/* Service Catalog */}
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">Service Catalog ({filteredServices.length})</span>
          <input className="term-input" style={{ width: '140px', padding: '8px 12px', fontSize: '12px' }} placeholder="Filter..." value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="term-table-wrap">
          <table className="term-table">
            <thead>
              <tr>
                <th>ID</th><th>Service Name</th><th>USD</th><th>PKR</th><th>Min</th><th>Max</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No services registered</td></tr>
              ) : (
                filteredServices.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>#{s.service_id}</td>
                    <td>{s.name}</td>
                    <td>${s.rate_usd?.toFixed(4)}</td>
                    <td>PKR {s.rate_pkr?.toFixed(1)}</td>
                    <td>{s.min_order?.toLocaleString()}</td>
                    <td>{s.max_order?.toLocaleString()}</td>
                    <td><button className="term-btn term-btn-red term-btn-sm" onClick={() => handleDeleteSvc(s.id)}>Remove</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order History */}
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">Order History ({history.length})</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="term-btn term-btn-sm" onClick={handleBatchCheck}>Batch Check</button>
            <button className="term-btn term-btn-red term-btn-sm" onClick={handleClearHistory}>Clear</button>
          </div>
        </div>
        <div className="term-table-wrap" style={{ maxHeight: '280px' }}>
          <table className="term-table">
            <thead>
              <tr>
                <th>Order ID</th><th>Service</th><th>Qty</th><th>Type</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No orders recorded</td></tr>
              ) : (
                history.slice(0, 50).map(o => (
                  <tr key={o.order_id}>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>#{o.order_id}</td>
                    <td>#{o.service_id}</td>
                    <td>{o.quantity?.toLocaleString()}</td>
                    <td><span className="term-badge term-badge-cyan">{o.type}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{timeAgo(o.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  LOGS TAB
// ─────────────────────────────────────────────────────────────────
function LogsTab() {
  const { logs, config, addToast, refreshData } = useApp();
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [scanningProxy, setScanningProxy] = useState(false);

  const filtered = filterLevel === 'all' ? logs : logs.filter((l: LogEntry) => l.level === filterLevel);

  const handleScanProxy = async () => {
    setScanningProxy(true);
    addToast('Scanning proxy pool...', 'info');
    try {
      const res = await api.scanProxy();
      if (res.ok && res.proxy) { addToast(`Proxy locked: ${res.proxy}`, 'success'); refreshData(); }
      else { addToast('No working proxy found', 'info'); }
    } catch (e) { addToast('Proxy scan error', 'error'); }
    setScanningProxy(false);
  };

  const handleExportLogs = async () => {
    try {
      const res = await api.exportLogsCsv();
      if (res && res.csv) { downloadCsv('smmbot_logs.csv', res.csv); addToast('Logs exported', 'success'); }
    } catch (e) { addToast('Export failed', 'error'); }
  };

  return (
    <div>
      {/* Proxy Card */}
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">SOCKS5 Proxy Rotator</span>
          <button className="term-btn term-btn-sm" onClick={handleScanProxy} disabled={scanningProxy}>
            {scanningProxy ? 'Scanning...' : 'Scan & Lock'}
          </button>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          Active Connection: <strong style={{ color: 'var(--accent-cyan)' }}>{config?.api_proxy || config?.auto_proxy || 'Direct (Local IP)'}</strong>
        </div>
      </div>

      {/* Log Stream */}
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">System Logs ({filtered.length})</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button className="term-btn term-btn-sm" onClick={handleExportLogs}>Export</button>
            <select className="term-input" style={{ width: '110px', padding: '6px 10px', fontSize: '11px' }} value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', padding: '12px', height: '440px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>No logs match filter</div>
          ) : (
            filtered.slice().reverse().map((entry: LogEntry, idx: number) => (
              <div key={idx} style={{
                display: 'flex', gap: '8px', padding: '6px 8px',
                borderLeft: `3px solid ${entry.level === 'error' ? 'var(--error)' : entry.level === 'success' ? 'var(--success)' : entry.level === 'warn' ? 'var(--warning)' : 'rgba(255,255,255,0.06)'}`,
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                fontFamily: 'var(--font-mono)', fontSize: '12px'
              }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: '11px' }}>{entry.timestamp}</span>
                <span style={{ color: entry.level === 'error' ? 'var(--error)' : entry.level === 'success' ? 'var(--success)' : 'var(--text-primary)', wordBreak: 'break-all' }}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  CONFIG TAB
// ─────────────────────────────────────────────────────────────────
function ConfigTab() {
  const { config, balance, addToast, refreshData } = useApp();
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('https://marketerum.com/api/v2');
  const [apiProxy, setApiProxy] = useState('');
  const [customPkr, setCustomPkr] = useState('297');
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
      await api.saveConfig({
        api_key: apiKey.trim(),
        api_url: apiUrl.trim(),
        api_proxy: apiProxy.trim(),
        custom_pkr_rate: parseFloat(customPkr) || 297,
      });
      addToast('Configuration saved', 'success');
      refreshData();
    } catch (e: any) { addToast(e.message || 'Save error', 'error'); }
    setSaving(false);
  };

  const handleVerify = async () => {
    if (!apiKey.trim()) { addToast('Enter API Key first', 'info'); return; }
    setVerifying(true);
    try {
      const res = await api.verifyApiKey(apiKey.trim(), apiUrl.trim());
      if (res.ok) {
        addToast(`API Key valid — Balance: $${res.balance_usd?.toFixed(4)}`, 'success');
        refreshData();
      } else { addToast(res.error || 'Verification failed', 'error'); }
    } catch (e) { addToast('Verification failed', 'error'); }
    setVerifying(false);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">Panel Configuration</span>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">Marketerum API Key</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="term-input" type="password" style={{ flex: 1 }} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste API key..." />
            <button className="term-btn term-btn-cyan term-btn-sm" onClick={handleVerify} disabled={verifying} style={{ flexShrink: 0 }}>{verifying ? 'Testing...' : 'Test Key'}</button>
          </div>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">API Endpoint</label>
          <input className="term-input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
        </div>
        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="term-field-group">
            <label className="term-field-lbl">Exchange Rate (1 USD = X PKR)</label>
            <input className="term-input" type="number" value={customPkr} onChange={e => setCustomPkr(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">SOCKS5 Proxy (optional)</label>
            <input className="term-input" placeholder="socks5://ip:port" value={apiProxy} onChange={e => setApiProxy(e.target.value)} />
          </div>
        </div>

        {balance?.ok && (
          <div style={{ padding: '14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', margin: '14px 0', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Panel Balance</span>
            <strong>PKR {balance.pkr?.toFixed(2)} (${balance.usd?.toFixed(4)})</strong>
          </div>
        )}

        <button className="term-btn term-btn-green" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  TOAST RENDERER
// ─────────────────────────────────────────────────────────────────
function ToastRenderer() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  HEADER BAR
// ─────────────────────────────────────────────────────────────────
function HeaderBar() {
  const { balance, refreshBalance } = useApp();

  return (
    <header className="term-header">
      <div className="term-brand">
        <div className="brand-badge">S</div>
        <span className="term-title">SMMBot</span>
        <span className="term-tag">
          <span className="pulse-dot" /> Online
        </span>
      </div>
      <div className="term-header-right">
        <div
          className="term-pill"
          onClick={refreshBalance}
          title="Tap to sync balance"
        >
          {balance?.ok ? (
            <>
              <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>BAL</span>
              <strong style={{ color: 'var(--success)' }}>
                PKR {balance.pkr?.toFixed(0)}
              </strong>
            </>
          ) : (
            <strong style={{ color: 'var(--warning)', fontSize: '12px' }}>Syncing...</strong>
          )}
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'dispatch' | 'services' | 'logs' | 'config'>('campaigns');

  return (
    <AppProvider>
      <div className="term-shell">
        <HeaderBar />
        <ToastRenderer />

        {/* Desktop Top Nav */}
        <nav className="term-tabs">
          <button className={`term-tab ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>📊 Campaigns</button>
          <button className={`term-tab ${activeTab === 'dispatch' ? 'active' : ''}`} onClick={() => setActiveTab('dispatch')}>⚡ Dispatch</button>
          <button className={`term-tab ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>🛠 Services</button>
          <button className={`term-tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>📜 Logs</button>
          <button className={`term-tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>⚙️ Config</button>
        </nav>

        <main className="term-container">
          {activeTab === 'campaigns' && <CampaignsTab />}
          {activeTab === 'dispatch' && <DispatchTab />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'config' && <ConfigTab />}
        </main>

        {/* Mobile Bottom Nav */}
        <nav className="term-mobile-nav">
          <button className={`term-mobile-btn ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>
            <span style={{ fontSize: '18px' }}>📊</span>
            <span>Campaigns</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'dispatch' ? 'active' : ''}`} onClick={() => setActiveTab('dispatch')}>
            <span style={{ fontSize: '18px' }}>⚡</span>
            <span>Dispatch</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
            <span style={{ fontSize: '18px' }}>🛠</span>
            <span>Services</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
            <span style={{ fontSize: '18px' }}>📜</span>
            <span>Logs</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>
            <span style={{ fontSize: '18px' }}>⚙️</span>
            <span>Config</span>
          </button>
        </nav>
      </div>
    </AppProvider>
  );
}

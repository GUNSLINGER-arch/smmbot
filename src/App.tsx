import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import './index.css';
import { AppProvider, useApp } from './AppContext';
import {
  api, fmtNumber, truncateTitle, timeAgo, pct, downloadCsv,
  Campaign, SavedService, LogEntry, OrderHistoryItem, AnalyticsPoint
} from './api';

// ─────────────────────────────────────────────────────────────────
//  PROGRESS RING (TERMINAL SVG RADIAL WHEEL)
// ─────────────────────────────────────────────────────────────────
function ProgressRing({ value, size = 52, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - ((value || 0) / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--term-border)" strokeWidth={stroke} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke="var(--term-cyan)" strokeWidth={stroke}
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <span style={{ position: 'absolute', fontSize: '10.5px', fontWeight: 800, color: 'var(--term-text)', fontFamily: 'var(--font-mono)' }}>
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
//  ANALYTICS SPARKLINE WITH 3-SERIES & STAT ROW
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
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--term-dim)', fontSize: '11px' }}>
        [ NO TIME-SERIES DATA YET — DELIVERING FIRST PACING PULSE WILL POPULATE CHART ]
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--term-border)' }}>
      {/* Stat Boxes Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div style={{ padding: '10px 12px', backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--term-dim)', textTransform: 'uppercase' }}>VIEWS DELIVERED</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--term-cyan)' }}>{fmtNumber(camp.views_delivered || 0)}</div>
          <div style={{ fontSize: '9px', color: 'var(--term-muted)' }}>/ {fmtNumber(camp.total_views)} target</div>
        </div>

        <div style={{ padding: '10px 12px', backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--term-dim)', textTransform: 'uppercase' }}>SCRAPED PUBLIC</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--term-green)' }}>{camp.start_views !== null ? fmtNumber(latestScraped) : '—'}</div>
          <div style={{ fontSize: '9px', color: 'var(--term-muted)' }}>live post count</div>
        </div>

        <div style={{ padding: '10px 12px', backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--term-dim)', textTransform: 'uppercase' }}>TARGET RATIO</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--term-text)' }}>{camp.engagement_rate || 2.2}%</div>
          <div style={{ fontSize: '9px', color: 'var(--term-muted)' }}>stealth ratio</div>
        </div>
      </div>

      {/* Header & Filter */}
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
        <div style={{ fontSize: '10px', color: 'var(--term-muted)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--term-cyan)' }}>■ DELIVERED</span>
          <span style={{ color: 'var(--term-green)' }}>■ SCRAPED</span>
          <span style={{ color: 'var(--term-amber)' }}>■ LIKES</span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: '140px', width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--term-cyan)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--term-cyan)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`glv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--term-green)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--term-green)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`gl_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--term-amber)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--term-amber)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--term-card)', border: '1px solid var(--term-border)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}
            />
            <Area type="monotone" dataKey="v" stroke="var(--term-cyan)" fill={`url(#gv_${camp.id})`} strokeWidth={1.5} name="Delivered Views" />
            <Area type="monotone" dataKey="lv" stroke="var(--term-green)" fill={`url(#glv_${camp.id})`} strokeWidth={1.5} name="Scraped Views" />
            <Area type="monotone" dataKey="l" stroke="var(--term-amber)" fill={`url(#gl_${camp.id})`} strokeWidth={1.5} name="Likes" />
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
    <div style={{ backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)', padding: '10px', maxHeight: '160px', overflowY: 'auto', fontSize: '10.5px', marginTop: '12px' }}>
      {campLogs.length === 0 ? (
        <div style={{ color: 'var(--term-dim)', textAlign: 'center' }}>[ NO SPECIFIC LOGS FOR THIS CAMPAIGN ]</div>
      ) : (
        campLogs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--term-border)', paddingBottom: '3px', marginBottom: '3px', wordBreak: 'break-all' }}>
            <span style={{ color: 'var(--term-dim)', flexShrink: 0 }}>[{l.timestamp}]</span>
            <span style={{ color: l.level === 'error' ? 'var(--term-red)' : l.level === 'success' ? 'var(--term-green)' : 'var(--term-text)' }}>
              {l.message}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  TERMINAL COMPONENT 1: CAMPAIGNS TAB & EDIT MODAL
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
        addToast(`Scraped All Metrics via ${res.meta.source}`, 'success');
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
        addToast('Stealth Drip Campaign Initialized', 'success');
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
      {/* STRUCTURED TOP DASHBOARD GRID */}
      <div className="term-grid-4">
        <div className="term-metric-box">
          <div className="term-metric-lbl">ACTIVE WORKERS</div>
          <div className="term-metric-val" style={{ color: 'var(--term-green)' }}>{runningCount} / {list.length}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">VIEWS DELIVERED</div>
          <div className="term-metric-val" style={{ color: 'var(--term-cyan)' }}>{fmtNumber(totalDeliveredViews)}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">LIKES DELIVERED</div>
          <div className="term-metric-val" style={{ color: 'var(--term-amber)' }}>{fmtNumber(totalDeliveredLikes)}</div>
        </div>
        <div className="term-metric-box">
          <div className="term-metric-lbl">STEALTH PACING</div>
          <div className="term-metric-val" style={{ fontSize: '15px', color: 'var(--term-green)' }}>CIRCADIAN (2.2%)</div>
        </div>
      </div>

      {/* CAMPAIGN LIST SECTION HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--term-dim)', letterSpacing: '0.5px' }}>
          // ACTIVE CAMPAIGNS ({list.length})
        </div>
        <button className="term-btn term-btn-cyan" onClick={() => setShowLaunchModal(true)}>
          + LAUNCH NEW CAMPAIGN
        </button>
      </div>

      {list.length === 0 ? (
        <div className="term-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--term-dim)' }}>
          [ NO ACTIVE CAMPAIGNS REGISTERED IN SYSTEM — CLICK LAUNCH CAMPAIGN TO START ]
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {list.map(c => {
            const pctVal = pct(c.views_delivered || 0, c.total_views || 1);
            const activePanel = activePanels[c.id || c.url];

            const deliveredViews = c.views_delivered || 0;
            const totalInteractions = (c.likes_delivered || 0) + (c.comments_delivered || 0) + (c.shares_delivered || 0) + (c.saves_delivered || 0);
            const liveEngagementPct = deliveredViews > 0 ? ((totalInteractions / deliveredViews) * 100).toFixed(1) : '0.0';
            const pctNum = parseFloat(liveEngagementPct);

            let safetyBadgeClass = 'term-badge-green';
            let safetyLabel = `SAFE ZONE (${liveEngagementPct}%)`;

            if (pctNum >= 1.8 && pctNum <= 4.5) {
              safetyBadgeClass = 'term-badge-green';
              safetyLabel = `SAFE ZONE (${liveEngagementPct}%)`;
            } else if (pctNum > 4.5 && pctNum <= 7.0) {
              safetyBadgeClass = 'term-badge-amber';
              safetyLabel = `MODERATE SPIKE (${liveEngagementPct}%)`;
            } else if (pctNum > 7.0) {
              safetyBadgeClass = 'term-badge-red';
              safetyLabel = `HIGH RISK SPIKE (${liveEngagementPct}%)`;
            } else if (deliveredViews > 100) {
              safetyBadgeClass = 'term-badge-amber';
              safetyLabel = `LOW INTERACTION (${liveEngagementPct}%)`;
            }

            return (
              <div key={c.id || c.url} className="term-card">
                {/* 1. HEADER ROW: Progress Wheel, Title, Badges, & Action Row */}
                <div className="campaign-card-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <ProgressRing value={pctVal} size={54} stroke={4} />
                    <div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span className={`term-badge ${c.status === 'Running' ? 'term-badge-green' : 'term-badge-amber'}`}>
                          [{c.status.toUpperCase()}]
                        </span>
                        <span style={{ fontWeight: 700, color: 'var(--term-cyan)', fontSize: '11px' }}>[{c.platform.toUpperCase()}]</span>
                        <span className={`term-badge ${safetyBadgeClass}`}>
                          [{safetyLabel}]
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--term-text)', lineClamp: 1, WebkitLineClamp: 1, wordBreak: 'break-all' }}>
                        {truncateTitle(c.video_title, c.url, 48)}
                      </div>
                    </div>
                  </div>

                  {/* Structured Action Buttons */}
                  <div className="campaign-actions-mobile" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {c.status === 'Running' ? (
                      <button className="term-btn term-btn-sm" onClick={() => handleStop(c.url)}>STOP</button>
                    ) : (
                      <button className="term-btn term-btn-green term-btn-sm" onClick={() => handleResume(c.url)}>RESUME</button>
                    )}
                    <button className="term-btn term-btn-sm" onClick={() => handleOpenEdit(c)}>EDIT</button>
                    <button className="term-btn term-btn-sm" onClick={() => handleRefill(c.url)}>REFILL</button>
                    <button className="term-btn term-btn-sm" onClick={() => handleCancelStuck(c.url)}>CANCEL</button>
                    <button className="term-btn term-btn-red term-btn-sm" onClick={() => handleDelete(c.url)}>DEL</button>
                  </div>
                </div>

                {/* 2. PROGRESS BAR ROW */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>
                    <span>PROGRESS: {pctVal}%</span>
                    <span>{fmtNumber(c.views_delivered || 0)} / {fmtNumber(c.total_views)} VIEWS</span>
                  </div>
                  <ProgBar value={pctVal} />
                </div>

                {/* 3. CLEAN 5-COLUMN METRICS GRID */}
                <div className="campaign-metrics-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', padding: '10px 12px', backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)', fontSize: '11px', marginBottom: '12px' }}>
                  <div>VIEWS: <strong style={{ color: 'var(--term-cyan)' }}>{fmtNumber(c.views_delivered || 0)}</strong></div>
                  <div>LIKES: <strong style={{ color: 'var(--term-amber)' }}>{fmtNumber(c.likes_delivered || 0)}</strong></div>
                  <div>COMMENTS: <strong style={{ color: 'var(--term-green)' }}>{fmtNumber(c.comments_delivered || 0)}</strong></div>
                  <div>SHARES: <strong style={{ color: 'var(--term-text)' }}>{fmtNumber(c.shares_delivered || 0)}</strong></div>
                  <div>SAVES: <strong style={{ color: 'var(--term-text)' }}>{fmtNumber(c.saves_delivered || 0)}</strong></div>
                </div>

                {/* 4. EXPANDABLE PANEL ACCORDION TABS */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className={`term-btn term-btn-sm ${activePanel === 'analytics' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'analytics')}>
                    ANALYTICS ▾
                  </button>
                  <button className={`term-btn term-btn-sm ${activePanel === 'logs' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'logs')}>
                    LOGS ▾
                  </button>
                  <button className={`term-btn term-btn-sm ${activePanel === 'details' ? 'term-btn-cyan' : ''}`} onClick={() => togglePanel(c.id || c.url, 'details')}>
                    DETAILS ▾
                  </button>
                </div>

                {activePanel === 'analytics' && <AnalyticsSpark camp={c} />}
                {activePanel === 'logs' && <CampaignLogPanel camp={c} />}
                {activePanel === 'details' && (
                  <div style={{ padding: '12px', backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)', marginTop: '12px', fontSize: '11px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>VIEW SVC: <strong style={{ color: 'var(--term-cyan)' }}>#{c.view_service || 'N/A'}</strong></div>
                    <div>LIKE SVC: <strong style={{ color: 'var(--term-cyan)' }}>#{c.like_service || 'N/A'}</strong></div>
                    <div>COMMENT SVC: <strong style={{ color: 'var(--term-cyan)' }}>#{c.comment_service || 'N/A'}</strong></div>
                    <div>SHARE SVC: <strong style={{ color: 'var(--term-cyan)' }}>#{c.share_service || 'N/A'}</strong></div>
                    <div>SAVE SVC: <strong style={{ color: 'var(--term-cyan)' }}>#{c.save_service || 'N/A'}</strong></div>
                    <div>SAFETY STATUS: <strong style={{ color: pctNum > 7.0 ? 'var(--term-red)' : 'var(--term-green)' }}>{safetyLabel}</strong></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ORGANIZED EDIT MODAL */}
      {editingCamp && (
        <div className="modal-overlay">
          <div className="term-card" style={{ width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="term-card-header">
              <span className="term-card-title">// EDIT_CAMPAIGN_PARAMETERS</span>
              <button className="term-btn term-btn-sm" onClick={() => setEditingCamp(null)}>✕</button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--term-dim)', marginBottom: '14px', wordBreak: 'break-all' }}>
              TARGET: {editingCamp.url}
            </div>

            <div className="term-section-box">
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--term-cyan)', marginBottom: '10px' }}>1. CAMPAIGN PACING & TARGETS</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">TARGET VIEWS</label>
                  <input className="term-input" type="number" value={editForm.total_views} onChange={e => setEditForm({ ...editForm, total_views: e.target.value })} />
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">DURATION (DAYS)</label>
                  <input className="term-input" type="number" value={editForm.days_to_run} onChange={e => setEditForm({ ...editForm, days_to_run: e.target.value })} />
                </div>
              </div>

              <div className="term-field-group">
                <label className="term-field-lbl">ENGAGEMENT TARGET (%)</label>
                <input className="term-input" type="number" value={editForm.engagement_rate} onChange={e => setEditForm({ ...editForm, engagement_rate: e.target.value })} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                <input type="checkbox" id="edit_peak_only" checked={editForm.peak_only} onChange={e => setEditForm({ ...editForm, peak_only: e.target.checked })} />
                <label htmlFor="edit_peak_only" style={{ fontSize: '11px', color: 'var(--term-text)', cursor: 'pointer' }}>
                  ENABLE PEAK-HOURS ONLY MODE (Pulse 12 PM - 11 PM)
                </label>
              </div>
            </div>

            <div className="term-section-box">
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--term-cyan)', marginBottom: '10px' }}>2. SERVICE ROUTING</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">VIEW SERVICE ID</label>
                  <select className="term-input" value={editForm.view_service} onChange={e => setEditForm({ ...editForm, view_service: e.target.value })}>
                    <option value="">SELECT SERVICE...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">LIKE SERVICE ID</label>
                  <select className="term-input" value={editForm.like_service} onChange={e => setEditForm({ ...editForm, like_service: e.target.value })}>
                    <option value="">SELECT SERVICE...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="term-btn" onClick={() => setEditingCamp(null)}>CANCEL</button>
              <button className="term-btn term-btn-cyan" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? 'SAVING...' : 'SAVE CHANGES'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ORGANIZED LAUNCH MODAL */}
      {showLaunchModal && (
        <div className="modal-overlay">
          <div className="term-card" style={{ width: '100%', maxWidth: '640px', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="term-card-header">
              <span className="term-card-title">// LAUNCH_STEALTH_CAMPAIGN</span>
              <button className="term-btn term-btn-sm" onClick={() => setShowLaunchModal(false)}>✕</button>
            </div>

            {/* SECTION 1: TARGET POST & SCRAPE */}
            <div className="term-section-box">
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--term-cyan)', marginBottom: '10px' }}>1. TARGET POST & METRIC SCRAPER</div>
              <div className="term-field-group">
                <label className="term-field-lbl">TARGET POST URL</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="term-input" placeholder="https://www.tiktok.com/@user/video/..." value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
                  <button className="term-btn term-btn-cyan" onClick={handleScrape} disabled={fetchingMeta}>{fetchingMeta ? 'SCRAPING...' : 'SCRAPE'}</button>
                </div>
              </div>

              {meta && (
                <div style={{ padding: '10px', backgroundColor: 'var(--term-green-bg)', border: '1px solid var(--term-green-border)', borderRadius: 'var(--radius-sm)', fontSize: '11px' }}>
                  <div>TITLE: <strong>{meta.title}</strong></div>
                  <div>AUTHOR: <strong>@{meta.author}</strong></div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--term-green-border)' }}>
                    <div>VIEWS: <strong>{meta.views ? fmtNumber(meta.views) : 'N/A'}</strong></div>
                    <div>LIKES: <strong>{meta.likes ? fmtNumber(meta.likes) : 'N/A'}</strong></div>
                    <div>COMMENTS: <strong>{meta.comments ? fmtNumber(meta.comments) : 'N/A'}</strong></div>
                    <div>SHARES: <strong>{meta.shares ? fmtNumber(meta.shares) : 'N/A'}</strong></div>
                    <div>SAVES: <strong>{meta.saves ? fmtNumber(meta.saves) : 'N/A'}</strong></div>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 2: PACING & GOALS */}
            <div className="term-section-box">
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--term-cyan)', marginBottom: '10px' }}>2. PACING & GOALS</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">PLATFORM</label>
                  <select className="term-input" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                    <option value="TikTok">TIKTOK</option>
                    <option value="Instagram">INSTAGRAM</option>
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">TARGET VIEWS</label>
                  <input className="term-input" type="number" value={form.total_views} onChange={e => setForm({ ...form, total_views: e.target.value })} />
                </div>
              </div>

              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">DURATION (DAYS)</label>
                  <input className="term-input" type="number" value={form.days_to_run} onChange={e => setForm({ ...form, days_to_run: e.target.value })} />
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">ENGAGEMENT TARGET (%)</label>
                  <input className="term-input" type="number" value={form.engagement_rate} onChange={e => setForm({ ...form, engagement_rate: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
                <input type="checkbox" id="peak_only" checked={form.peak_only} onChange={e => setForm({ ...form, peak_only: e.target.checked })} />
                <label htmlFor="peak_only" style={{ fontSize: '11px', color: 'var(--term-text)', cursor: 'pointer' }}>
                  ENABLE PEAK-HOURS ONLY MODE (Pulse 12 PM - 11 PM)
                </label>
              </div>
            </div>

            {/* SECTION 3: PANEL SERVICE ROUTING */}
            <div className="term-section-box">
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--term-cyan)', marginBottom: '10px' }}>3. PANEL SERVICE ROUTING</div>
              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">VIEW SERVICE ID *</label>
                  <select className="term-input" value={form.view_service} onChange={e => setForm({ ...form, view_service: e.target.value })}>
                    <option value="">SELECT VIEW SERVICE...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">LIKE SERVICE ID</label>
                  <select className="term-input" value={form.like_service} onChange={e => setForm({ ...form, like_service: e.target.value })}>
                    <option value="">SELECT LIKE SERVICE...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="term-field-group">
                  <label className="term-field-lbl">COMMENT SERVICE ID</label>
                  <select className="term-input" value={form.comment_service} onChange={e => setForm({ ...form, comment_service: e.target.value })}>
                    <option value="">SELECT COMMENT SVC...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">SHARE SERVICE ID</label>
                  <select className="term-input" value={form.share_service} onChange={e => setForm({ ...form, share_service: e.target.value })}>
                    <option value="">SELECT SHARE SVC...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
                <div className="term-field-group">
                  <label className="term-field-lbl">SAVE SERVICE ID</label>
                  <select className="term-input" value={form.save_service} onChange={e => setForm({ ...form, save_service: e.target.value })}>
                    <option value="">SELECT SAVE SVC...</option>
                    {services.map(s => <option key={s.id} value={s.service_id}>[{s.service_id}] {s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION 4: EXPENSE ESTIMATION & LAUNCH */}
            <button className="term-btn term-btn-sm" style={{ width: '100%', marginBottom: '10px' }} onClick={calculateExpense}>
              CALCULATE ESTIMATED EXPENSE
            </button>

            {expenseBreakdown && (
              <div style={{ padding: '10px', backgroundColor: 'var(--term-cyan-bg)', border: '1px solid var(--term-cyan-border)', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '11px' }}>
                <div>VIEWS: {expenseBreakdown.views ? `PKR ${expenseBreakdown.views.pkr.toFixed(2)} (${expenseBreakdown.views.qty.toLocaleString()})` : 'N/A'}</div>
                <div>LIKES: {expenseBreakdown.likes ? `PKR ${expenseBreakdown.likes.pkr.toFixed(2)} (${expenseBreakdown.likes.qty.toLocaleString()})` : 'N/A'}</div>
                <div>COMMENTS: {expenseBreakdown.comments ? `PKR ${expenseBreakdown.comments.pkr.toFixed(2)} (${expenseBreakdown.comments.qty.toLocaleString()})` : 'N/A'}</div>
                <div>SHARES: {expenseBreakdown.shares ? `PKR ${expenseBreakdown.shares.pkr.toFixed(2)} (${expenseBreakdown.shares.qty.toLocaleString()})` : 'N/A'}</div>
                <div>SAVES: {expenseBreakdown.saves ? `PKR ${expenseBreakdown.saves.pkr.toFixed(2)} (${expenseBreakdown.saves.qty.toLocaleString()})` : 'N/A'}</div>
                <div style={{ marginTop: '6px', borderTop: '1px solid var(--term-cyan-border)', paddingTop: '6px', fontWeight: 800 }}>
                  TOTAL COST: PKR {expenseBreakdown.totalPkr.toFixed(2)} (${expenseBreakdown.totalUsd.toFixed(4)})
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button className="term-btn" onClick={() => setShowLaunchModal(false)}>CANCEL</button>
              <button className="term-btn term-btn-cyan" onClick={handleLaunch} disabled={launching}>
                {launching ? 'INITIALIZING...' : 'CONFIRM & LAUNCH'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
        if (res.ok && res.order_id) { addToast(`Drip Order #${res.order_id} Dispatched`, 'success'); setLink(''); refreshData(); }
        else { addToast(res.error || 'Drip order failed', 'error'); }
      } else {
        const res = await api.placeOrder(serviceId, link.trim(), qtyNum);
        if (res.ok && res.order_id) { addToast(`Direct Order #${res.order_id} Dispatched`, 'success'); setLink(''); refreshData(); }
        else { addToast(res.error || 'Direct order failed', 'error'); }
      }
    } catch (e: any) { addToast('Dispatch error', 'error'); }
    setOrdering(false);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">DIRECT ORDER DISPATCHER</span>
        </div>

        <div className="term-field-group">
          <label className="term-field-lbl">PANEL SERVICE</label>
          <select className="term-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">-- SELECT SERVICE --</option>
            {services.map(s => (
              <option key={s.id} value={s.service_id}>
                [{s.service_id}] {s.name} — PKR {s.rate_pkr?.toFixed(1)}/k
              </option>
            ))}
          </select>
        </div>

        <div className="term-field-group">
          <label className="term-field-lbl">TARGET POST / PROFILE URL</label>
          <input className="term-input" placeholder="https://www.tiktok.com/@user/video/..." value={link} onChange={e => setLink(e.target.value)} />
        </div>

        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
          <div className="term-field-group">
            <label className="term-field-lbl">QTY / RUN</label>
            <input className="term-input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">RUNS</label>
            <input className="term-input" type="number" value={runs} onChange={e => setRuns(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">INTERVAL (MIN)</label>
            <input className="term-input" type="number" value={interval} onChange={e => setInterval(e.target.value)} disabled={runsNum <= 1} />
          </div>
        </div>

        {selectedService && (
          <div style={{ padding: '12px', backgroundColor: 'var(--term-cyan-bg)', border: '1px solid var(--term-cyan-border)', borderRadius: 'var(--radius-sm)', margin: '14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--term-cyan)' }}>CALCULATED COST:</div>
              <div style={{ fontSize: '17px', fontWeight: 800 }}>
                PKR {costPkr.toFixed(2)} <span style={{ fontSize: '11px', color: 'var(--term-muted)' }}>(${costUsd.toFixed(4)})</span>
              </div>
            </div>
            {balance?.ok && (
              <div style={{ textAlign: 'right', fontSize: '11px' }}>
                <div style={{ color: 'var(--term-dim)' }}>BALANCE:</div>
                <div style={{ fontWeight: 800 }}>PKR {balance.pkr?.toFixed(0)}</div>
              </div>
            )}
          </div>
        )}

        <button className="term-btn term-btn-cyan" style={{ width: '100%', padding: '10px' }} onClick={handleDispatch} disabled={ordering}>
          {ordering ? 'DISPATCHING...' : (runsNum > 1 ? 'DISPATCH DRIP ORDER' : 'DISPATCH DIRECT ORDER')}
        </button>
      </div>
    </div>
  );
}

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
      else { addToast(`Service #${newSvcId} Added`, 'success'); setNewSvcId(''); setNewSvcName(''); refreshServices(); }
    } catch (e) { addToast('Error adding service', 'error'); }
    setAdding(false);
  };

  const handleDeleteSvc = async (id: string) => {
    try { await api.deleteService(id); addToast('Service removed', 'info'); refreshServices(); }
    catch (e) { addToast('Delete failed', 'error'); }
  };

  const handleRecalculatePrices = async () => {
    try { await api.recalculateServicePrices(); addToast('Service PKR prices recalculated', 'success'); refreshServices(); }
    catch (e) { addToast('Recalculate failed', 'error'); }
  };

  const handleExportCsv = async () => {
    try {
      const res = await api.exportServicesCsv();
      if (res && res.csv) { downloadCsv('smmbot_services.csv', res.csv); addToast('Services exported to CSV', 'success'); }
    } catch (e) { addToast('Export failed', 'error'); }
  };

  const handleBatchCheck = async () => {
    const ids = history.slice(0, 20).map(h => h.order_id);
    if (!ids.length) return;
    try {
      await api.multiStatus(ids);
      addToast(`Checked status for ${ids.length} orders`, 'success');
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--term-dim)' }}>// REGISTERED SERVICES</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="term-btn term-btn-sm" onClick={handleRecalculatePrices}>RECALCULATE PKR</button>
          <button className="term-btn term-btn-sm" onClick={handleExportCsv}>EXPORT CSV</button>
        </div>
      </div>

      <div className="term-card" style={{ marginBottom: '16px' }}>
        <div className="term-card-header">
          <span className="term-card-title">REGISTER NEW PANEL SERVICE</span>
        </div>
        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: '10px', alignItems: 'center' }}>
          <input className="term-input" placeholder="Service ID" value={newSvcId} onChange={e => setNewSvcId(e.target.value)} />
          <input className="term-input" placeholder="Service Description Name" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
          <button className="term-btn term-btn-green" onClick={handleAddSvc} disabled={adding}>{adding ? 'FETCHING...' : '+ ADD SERVICE'}</button>
        </div>
      </div>

      <div className="term-card" style={{ marginBottom: '16px' }}>
        <div className="term-card-header">
          <span className="term-card-title">SAVED SERVICES CATALOG ({filteredServices.length})</span>
          <input className="term-input" style={{ width: '160px', padding: '5px 10px' }} placeholder="FILTER CATALOG..." value={filter} onChange={e => setFilter(e.target.value)} />
        </div>

        <div className="term-table-wrap">
          <table className="term-table">
            <thead>
              <tr>
                <th>ID</th><th>SERVICE NAME</th><th>RATE USD</th><th>RATE PKR</th><th>MIN</th><th>MAX</th><th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--term-dim)', padding: '24px' }}>NO SERVICES REGISTERED</td></tr>
              ) : (
                filteredServices.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 800, color: 'var(--term-cyan)' }}>#{s.service_id}</td>
                    <td>{s.name}</td>
                    <td>${s.rate_usd?.toFixed(4)}</td>
                    <td>PKR {s.rate_pkr?.toFixed(1)}</td>
                    <td>{s.min_order?.toLocaleString()}</td>
                    <td>{s.max_order?.toLocaleString()}</td>
                    <td><button className="term-btn term-btn-red term-btn-sm" onClick={() => handleDeleteSvc(s.id)}>REMOVE</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">RECENT ORDER DISPATCH HISTORY ({history.length})</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="term-btn term-btn-sm" onClick={handleBatchCheck}>BATCH CHECK</button>
            <button className="term-btn term-btn-red term-btn-sm" onClick={handleClearHistory}>CLEAR HISTORY</button>
          </div>
        </div>

        <div className="term-table-wrap" style={{ maxHeight: '280px' }}>
          <table className="term-table">
            <thead>
              <tr>
                <th>ORDER ID</th><th>SERVICE ID</th><th>QTY</th><th>TYPE</th><th>TIMESTAMP</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--term-dim)', padding: '24px' }}>NO ORDERS RECORDED</td></tr>
              ) : (
                history.slice(0, 50).map(o => (
                  <tr key={o.order_id}>
                    <td style={{ fontWeight: 800, color: 'var(--term-green)' }}>#{o.order_id}</td>
                    <td>#{o.service_id}</td>
                    <td>{o.quantity?.toLocaleString()}</td>
                    <td><span className="term-badge term-badge-cyan">[{o.type.toUpperCase()}]</span></td>
                    <td style={{ color: 'var(--term-dim)' }}>{timeAgo(o.created_at)}</td>
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

function LogsTab() {
  const { logs, config, addToast, refreshData } = useApp();
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [scanningProxy, setScanningProxy] = useState(false);

  const filtered = filterLevel === 'all' ? logs : logs.filter((l: LogEntry) => l.level === filterLevel);

  const handleScanProxy = async () => {
    setScanningProxy(true);
    addToast('Scanning free SOCKS5 proxy pool...', 'info');
    try {
      const res = await api.scanProxy();
      if (res.ok && res.proxy) { addToast(`Proxy Locked: ${res.proxy}`, 'success'); refreshData(); }
      else { addToast('No working proxy found in batch', 'info'); }
    } catch (e) { addToast('Proxy scan error', 'error'); }
    setScanningProxy(false);
  };

  const handleExportLogs = async () => {
    try {
      const res = await api.exportLogsCsv();
      if (res && res.csv) { downloadCsv('smmbot_logs.csv', res.csv); addToast('Logs exported to CSV', 'success'); }
    } catch (e) { addToast('Export logs failed', 'error'); }
  };

  return (
    <div>
      <div className="term-card" style={{ marginBottom: '16px' }}>
        <div className="term-card-header">
          <span className="term-card-title">SOCKS5 PROXY ROTATOR POOL</span>
          <button className="term-btn term-btn-sm" onClick={handleScanProxy} disabled={scanningProxy}>
            {scanningProxy ? 'SCANNING...' : 'SCAN & LOCK PROXY'}
          </button>
        </div>
        <div style={{ fontSize: '11.5px' }}>
          ACTIVE WORKER CONNECTION: <strong style={{ color: 'var(--term-cyan)' }}>{config?.api_proxy || config?.auto_proxy || 'DIRECT HOST CONNECTION (LOCAL IP)'}</strong>
        </div>
      </div>

      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">REAL-TIME SYSTEM LOGSTREAM ({filtered.length})</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="term-btn term-btn-sm" onClick={handleExportLogs}>EXPORT CSV</button>
            <select className="term-input" style={{ width: '120px', padding: '3px 6px' }} value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="all">ALL LEVELS</option>
              <option value="info">INFO</option>
              <option value="success">SUCCESS</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--term-surface)', border: '1px solid var(--term-border)', borderRadius: 'var(--radius-sm)', padding: '12px', height: '440px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--term-dim)', textAlign: 'center', padding: '40px' }}>[ NO SYSTEM LOGS MATCH FILTER ]</div>
          ) : (
            filtered.slice().reverse().map((entry: LogEntry, idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--term-dim)', flexShrink: 0 }}>[{entry.timestamp}]</span>
                <span style={{ color: entry.level === 'error' ? 'var(--term-red)' : entry.level === 'success' ? 'var(--term-green)' : 'var(--term-text)', wordBreak: 'break-all' }}>
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
      addToast('Configuration saved successfully', 'success');
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
        addToast(`API Key Valid! Balance: $${res.balance_usd?.toFixed(4)} (PKR ${res.balance_pkr?.toFixed(0)})`, 'success');
        refreshData();
      } else { addToast(res.error || 'Verification failed', 'error'); }
    } catch (e) { addToast('Verification failed', 'error'); }
    setVerifying(false);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="term-card">
        <div className="term-card-header">
          <span className="term-card-title">MARKETERUM PANEL CONFIGURATION</span>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">MARKETERUM API KEY</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="term-input" type="password" style={{ flex: 1 }} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste API key..." />
            <button className="term-btn term-btn-cyan" onClick={handleVerify} disabled={verifying}>{verifying ? 'TESTING...' : 'TEST KEY'}</button>
          </div>
        </div>
        <div className="term-field-group">
          <label className="term-field-lbl">API ENDPOINT</label>
          <input className="term-input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
        </div>
        <div className="modal-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="term-field-group">
            <label className="term-field-lbl">CURRENCY EXCHANGE RATE (1 USD = X PKR)</label>
            <input className="term-input" type="number" value={customPkr} onChange={e => setCustomPkr(e.target.value)} />
          </div>
          <div className="term-field-group">
            <label className="term-field-lbl">SOCKS5 PROXY (OPTIONAL)</label>
            <input className="term-input" placeholder="socks5://ip:port" value={apiProxy} onChange={e => setApiProxy(e.target.value)} />
          </div>
        </div>
        {balance?.ok && (
          <div style={{ padding: '12px', backgroundColor: 'var(--term-green-bg)', border: '1px solid var(--term-green-border)', borderRadius: 'var(--radius-sm)', margin: '12px 0', fontSize: '11.5px', display: 'flex', justifyContent: 'space-between' }}>
            <span>PANEL BALANCE VERIFIED:</span>
            <strong>PKR {balance.pkr?.toFixed(2)} (${balance.usd?.toFixed(4)})</strong>
          </div>
        )}
        <button className="term-btn term-btn-green" style={{ width: '100%', marginTop: '12px', padding: '10px' }} onClick={handleSave} disabled={saving}>{saving ? 'SAVING...' : 'SAVE CONFIGURATION'}</button>
      </div>
    </div>
  );
}

function HeaderBar() {
  const { balance, refreshBalance } = useApp();

  return (
    <header className="term-header">
      <div className="term-brand">
        <div className="brand-badge">S</div>
        <span className="term-title">SMMBOT_v2.0</span>
        <span className="term-tag">
          <span className="pulse-dot" /> ONLINE
        </span>
      </div>
      <div className="term-header-right">
        <div 
          className="term-pill" 
          onClick={refreshBalance} 
          title="Click to sync live balance"
        >
          <span style={{ color: 'var(--term-dim)' }}>BALANCE:</span>
          {balance?.ok ? (
            <strong style={{ color: 'var(--term-green)' }}>
              PKR {balance.pkr?.toFixed(0)} <span style={{ color: 'var(--term-cyan)', fontSize: '10px' }}>(${balance.usd?.toFixed(2)})</span>
            </strong>
          ) : (
            <strong style={{ color: 'var(--term-amber)' }}>SYNCING...</strong>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'dispatch' | 'services' | 'logs' | 'config'>('campaigns');

  return (
    <AppProvider>
      <div className="term-shell">
        <HeaderBar />

        {/* DESKTOP TOP TAB NAVIGATION */}
        <nav className="term-tabs">
          <button className={`term-tab ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>📊 CAMPAIGNS</button>
          <button className={`term-tab ${activeTab === 'dispatch' ? 'active' : ''}`} onClick={() => setActiveTab('dispatch')}>⚡ DISPATCH</button>
          <button className={`term-tab ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>🛠️ SERVICES</button>
          <button className={`term-tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>📜 LOGSTREAM</button>
          <button className={`term-tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>⚙️ CONFIG</button>
        </nav>

        <main className="term-container">
          {activeTab === 'campaigns' && <CampaignsTab />}
          {activeTab === 'dispatch' && <DispatchTab />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'config' && <ConfigTab />}
        </main>

        {/* MOBILE FIXED BOTTOM NAVIGATION BAR */}
        <nav className="term-mobile-nav">
          <button className={`term-mobile-btn ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>
            <span style={{ fontSize: '14px' }}>📊</span>
            <span>CAMPAIGNS</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'dispatch' ? 'active' : ''}`} onClick={() => setActiveTab('dispatch')}>
            <span style={{ fontSize: '14px' }}>⚡</span>
            <span>DISPATCH</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
            <span style={{ fontSize: '14px' }}>🛠️</span>
            <span>SERVICES</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
            <span style={{ fontSize: '14px' }}>📜</span>
            <span>LOGS</span>
          </button>
          <button className={`term-mobile-btn ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>
            <span style={{ fontSize: '14px' }}>⚙️</span>
            <span>CONFIG</span>
          </button>
        </nav>
      </div>
    </AppProvider>
  );
}

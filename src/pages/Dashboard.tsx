import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis
} from 'recharts';
import {
  api, truncateTitle, fmtNumber, pct, downloadCsv,
  Campaign, AnalyticsPoint, getPlatformEmoji, timeAgo
} from '../api';
import { useApp } from '../AppContext';

// ─────────────────────────────────────────────────────
//  Progress Ring
// ─────────────────────────────────────────────────────
function ProgressRing({ value, size = 110, stroke = 7 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="var(--accent-hi)" />
            <stop offset="100%" stopColor="var(--blue)" />
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.04)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="url(#rg)" strokeWidth={stroke}
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div className="ring-center">
        <span className="ring-pct">{value.toFixed(0)}%</span>
        <span className="ring-lbl">Delivered</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Progress Bar
// ─────────────────────────────────────────────────────
function ProgBar({ value, color = '', h = 5 }: { value: number; color?: string; h?: number }) {
  return (
    <div className="prog-bar-wrap" style={{ height: h }}>
      <div className={`prog-bar-fill ${color}`} style={{ width: `${value}%`, height: h }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Status Badge
// ─────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = s.includes('run') ? 'running' : s.includes('complete') ? 'completed' : s.includes('stop') ? 'stopped' : 'pending';
  return (
    <span className={`badge ${cls}`}>
      <span className={`badge-dot${cls === 'running' ? ' pulse' : ''}`} />
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────
//  Analytics Sparkline
// ─────────────────────────────────────────────────────
function AnalyticsSpark({ data, camp }: { data: AnalyticsPoint[]; camp: Campaign }) {
  const [timeframe, setTimeframe] = useState<'1h' | '12h' | 'all'>('all');

  if (!data || data.length < 2) {
    return (
      <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>
        📈 No analytics data yet — delivering first pulse will populate this
      </div>
    );
  }

  // Filter based on timeframe
  const now = Date.now();
  let filtered = data;
  if (timeframe === '1h') {
    filtered = data.filter(p => now - new Date(p.timestamp).getTime() <= 60 * 60 * 1000);
  } else if (timeframe === '12h') {
    filtered = data.filter(p => now - new Date(p.timestamp).getTime() <= 12 * 60 * 60 * 1000);
  }

  // Fallback to all if filtered has too few points
  const displayData = filtered.length >= 2 ? filtered : data;

  const chartData = displayData.map(p => ({
    t: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    v: p.views,
    l: p.likes,
    lv: p.live_views !== undefined ? p.live_views : (camp.start_views || 0) + p.views,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Timeframe selector & Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['1h', '12h', 'all'] as const).map(tf => (
            <button
              key={tf}
              className={`btn btn-xs ${timeframe === tf ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTimeframe(tf)}
              style={{ fontSize: 9.5, padding: '2px 6px' }}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
          <span style={{ color: 'var(--accent-hi)' }}>● Delivered</span>
          <span style={{ color: 'var(--cyan)' }}>● Scraped Public</span>
          <span style={{ color: 'var(--green)' }}>● Likes</span>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          { label: 'Views Delivered', val: fmtNumber(camp.views_delivered), sub: `/ ${fmtNumber(camp.total_views)}`, color: 'var(--accent-hi)' },
          { label: 'Scraped Public',  val: camp.start_views !== null && camp.views_delivered > 0 ? fmtNumber((displayData[displayData.length - 1]?.live_views) || 0) : '—', sub: 'total post views', color: 'var(--cyan)' },
          { label: 'Engagement Rate',  val: `${camp.engagement_rate?.toFixed(1) || '8.5'}%`, sub: 'target ratio', color: 'var(--blue)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)', fontWeight: 700, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--mono)', color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Ring + Chart row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <ProgressRing value={pct(camp.views_delivered, camp.total_views)} size={90} stroke={6} />
        <div style={{ flex: 1, height: 90 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--accent-hi)" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="var(--accent-hi)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id={`gl_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--green)" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id={`glv_${camp.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--cyan)" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 10 }}
                labelStyle={{ color: 'var(--text-3)' }}
              />
              <Area type="monotone" dataKey="v" stroke="var(--accent-hi)" fill={`url(#gv_${camp.id})`} strokeWidth={1.5} dot={false} name="Delivered Views" />
              <Area type="monotone" dataKey="lv" stroke="var(--cyan)" fill={`url(#glv_${camp.id})`} strokeWidth={1.5} dot={false} name="Scraped Views" />
              <Area type="monotone" dataKey="l" stroke="var(--green)" fill={`url(#gl_${camp.id})`} strokeWidth={1.5} dot={false} name="Likes" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Campaign Log Panel (per-campaign filtered logs)
// ─────────────────────────────────────────────────────
function CampaignLogPanel({ camp }: { camp: Campaign }) {
  const { logs } = useApp();
  const logRef = useRef<HTMLDivElement>(null);

  // Filter logs to this campaign — match by URL tail or title keywords
  const urlTail = camp.url.slice(-32).toLowerCase();
  const titleWords = camp.video_title
    ? camp.video_title.toLowerCase().split(' ').filter(w => w.length > 3).slice(0, 3)
    : [];

  const campLogs = logs.filter(l => {
    // 100% reliable matching via structured url property
    if (l.url && l.url.toLowerCase() === camp.url.toLowerCase()) return true;

    // Fallback: match by URL tail or title keywords for generic/legacy entries
    const msg = l.message.toLowerCase();
    if (msg.includes(urlTail)) return true;
    if (titleWords.some(w => msg.includes(w))) return true;
    if (camp.view_service && msg.includes(camp.view_service)) return true;
    if (camp.like_service  && msg.includes(camp.like_service)) return true;
    return false;
  });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [campLogs.length]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>
          📋 Campaign Log — {campLogs.length} entries
        </span>
        <button className="btn btn-ghost btn-xs" onClick={async () => {
          const csv = 'Timestamp,Level,Message\n' +
            campLogs.map(l => `"${l.timestamp}","${l.level}","${l.message.replace(/"/g,'""')}"`).join('\n');
          downloadCsv(csv, `log_${camp.id.slice(0,8)}.csv`);
        }}>⬇ Export</button>
      </div>
      <div className="log-terminal" ref={logRef} style={{ height: 140 }}>
        {campLogs.length === 0 ? (
          <span className="text-muted text-xs">No log entries for this campaign yet. Logs appear once the first pulse runs.</span>
        ) : campLogs.slice(-80).map((l, i) => (
          <div key={i} className={`log-entry ${l.level}`}>
            <span className="log-time">{l.timestamp}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Campaign Card  (self-contained with inline panels)
// ─────────────────────────────────────────────────────
function CampaignCard({
  camp,
  analytics,
  onRefresh,
  onEdit,
}: {
  camp: Campaign;
  analytics: AnalyticsPoint[];
  onRefresh: () => void;
  onEdit: (camp: Campaign) => void;
}) {
  const { addToast } = useApp();
  const [panel, setPanel] = useState<null | 'analytics' | 'log' | 'details'>( null);
  const progress  = pct(camp.views_delivered, camp.total_views);
  const barColor  = progress >= 90 ? 'green' : progress >= 50 ? '' : 'yellow';

  const togglePanel = (p: 'analytics' | 'log' | 'details') =>
    setPanel(prev => (prev === p ? null : p));

  const handleStop = async () => {
    await api.stopCampaign(camp.url);
    addToast('Campaign stopped', 'info');
    onRefresh();
  };
  const handleResume = async () => {
    const res = await api.resumeCampaign(camp.url);
    if (res && res.ok) {
      addToast('Campaign resumed! ▶', 'success');
      onRefresh();
    } else {
      addToast(res.error || 'Failed to resume', 'error');
    }
  };
  const handleDelete = async () => {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    await api.deleteCampaign(camp.url);
    addToast('Campaign deleted', 'info');
    onRefresh();
  };
  const handleRefill = async () => {
    await api.refillOrder(camp.url);
    addToast('Refill requested ✅', 'success');
  };
  const handleCancel = async () => {
    const r = await api.cancelStuckOrder(camp.url);
    addToast(r.ok ? 'Stuck order cancelled' : 'Cancel failed', r.ok ? 'success' : 'error');
  };

  return (
    <div className={`campaign-card ${camp.status.toLowerCase()}`}>
      {/* ── Top row ── */}
      <div className="camp-header">
        <div style={{ minWidth: 0 }}>
          <div className="camp-title" title={camp.url}>
            {getPlatformEmoji(camp.platform)} {truncateTitle(camp.video_title, camp.url)}
          </div>
          {camp.video_author && <div className="camp-author">@{camp.video_author}</div>}
        </div>
        <StatusBadge status={camp.status} />
      </div>

      {/* ── Progress ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span className="text-xs text-muted">{fmtNumber(camp.views_delivered)} / {fmtNumber(camp.total_views)}</span>
          <span className="text-xs mono" style={{ color: 'var(--accent-hi)' }}>{progress}%</span>
        </div>
        <ProgBar value={progress} color={barColor} h={5} />
      </div>

      {/* ── Quick stats ── */}
      <div className="camp-stats">
        <div className="camp-stat">
          <span className="camp-stat-lbl">❤️ Likes</span>
          <span className="camp-stat-val">{fmtNumber(camp.likes_delivered)}</span>
        </div>
        <div className="camp-stat">
          <span className="camp-stat-lbl">💬 Comments</span>
          <span className="camp-stat-val">{fmtNumber(camp.comments_delivered)}</span>
        </div>
        <div className="camp-stat">
          <span className="camp-stat-lbl">🕐 Created</span>
          <span className="camp-stat-val" style={{ fontSize: 11 }}>{timeAgo(camp.created_at)}</span>
        </div>
      </div>

      {/* ── Meta chips ── */}
      <div className="camp-meta">
        <span className="platform-chip">{camp.platform}</span>
        <span className="badge neutral" style={{ fontSize: 10 }}>{camp.delivery_mode}</span>
        <span className="camp-meta-item">📅 {camp.days_to_run}d</span>
        {camp.peak_only && <span className="badge accent" style={{ fontSize: 10 }}>Peak Only</span>}
      </div>

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Toggle panel buttons */}
        <button
          className={`btn btn-xs ${panel === 'analytics' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('analytics')}
          title="Toggle analytics chart"
        >📈 Analytics</button>

        <button
          className={`btn btn-xs ${panel === 'log' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('log')}
          title="Toggle campaign activity log"
        >📋 Log</button>

        <button
          className={`btn btn-xs ${panel === 'details' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => togglePanel('details')}
          title="Toggle campaign details"
        >⋯ Details</button>

        <div style={{ flex: 1 }} />

        {/* Operation buttons */}
        {camp.status === 'Running' && (
          <button className="btn btn-danger btn-xs" onClick={handleStop}>⏹ Stop</button>
        )}
        {camp.status === 'Stopped' && (
          <button className="btn btn-success btn-xs" onClick={handleResume}>▶ Resume</button>
        )}
        <button className="btn btn-secondary btn-xs" onClick={() => onEdit(camp)} title="Edit campaign">✏️ Edit</button>
        <button className="btn btn-secondary btn-xs" onClick={handleRefill} title="Request refill">🔁</button>
        <button className="btn btn-ghost btn-xs" onClick={handleCancel} title="Cancel stuck order">🚫</button>
        <button className="btn btn-danger btn-xs" onClick={handleDelete} title="Delete campaign">🗑</button>
      </div>

      {/* ── Inline Analytics Panel ── */}
      {panel === 'analytics' && (
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 2,
          animation: 'fade-in 0.18s ease',
        }}>
          <AnalyticsSpark data={analytics} camp={camp} />
        </div>
      )}

      {/* ── Inline Campaign Log Panel ── */}
      {panel === 'log' && (
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 2,
          animation: 'fade-in 0.18s ease',
        }}>
          <CampaignLogPanel camp={camp} />
        </div>
      )}

      {/* ── Details Panel ── */}
      {panel === 'details' && (
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2,
          display: 'flex', flexDirection: 'column', gap: 6,
          animation: 'fade-in 0.18s ease',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
            <span>View Service: <span className="mono" style={{ color: 'var(--text-2)' }}>{camp.view_service || '—'}</span></span>
            <span>Like Service: <span className="mono" style={{ color: 'var(--text-2)' }}>{camp.like_service || '—'}</span></span>
            <span>Comment Svc: <span className="mono" style={{ color: 'var(--text-2)' }}>{camp.comment_service || '—'}</span></span>
            <span>Last Order: <span className="mono" style={{ color: 'var(--text-2)' }}>{camp.last_view_order || '—'}</span></span>
            <span>Start Views: <span className="mono" style={{ color: 'var(--text-2)' }}>{camp.start_views !== null ? fmtNumber(camp.start_views!) : '—'}</span></span>
            <span>Peak Only: <span style={{ color: 'var(--text-2)' }}>{camp.peak_only ? '✅ Yes' : 'No'}</span></span>
          </div>
          <div className="text-xs text-muted mono" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{camp.url}</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Launch Campaign Modal
// ─────────────────────────────────────────────────────
interface MetaResult { title: string; author: string; views: number|null; likes: number|null; source: string; }

function LaunchModal({ onClose, onLaunched }: { onClose: () => void; onLaunched: () => void }) {
  const { services, addToast } = useApp();
  const [form, setForm] = useState({
    url: '', platform: 'TikTok', delivery_mode: 'Organic Growth',
    view_service: '', like_service: '', comment_service: '',
    share_service: '', save_service: '',
    total_views: '10000', days_to_run: '7', engagement_rate: '2.2', peak_only: false,
  });

  // Derive min/max from the selected service objects (from panel data)
  const viewSvc    = services.find(s => s.service_id === form.view_service);
  const likeSvc    = services.find(s => s.service_id === form.like_service);
  const commentSvc = services.find(s => s.service_id === form.comment_service);
  const shareSvc   = services.find(s => s.service_id === form.share_service);
  const saveSvc    = services.find(s => s.service_id === form.save_service);
  const viewMin    = viewSvc    ? (viewSvc.min_order    || 1) : 1;
  const viewMax    = viewSvc    ? (viewSvc.max_order    || 1000000) : 1000000;
  const likeMin    = likeSvc    ? (likeSvc.min_order    || 1) : 1;
  const commentMin = commentSvc ? (commentSvc.min_order || 1) : 1;
  const shareMin   = shareSvc   ? (shareSvc.min_order   || 1) : 1;
  const saveMin    = saveSvc    ? (saveSvc.min_order    || 1) : 1;
  const [meta, setMeta]       = useState<MetaResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [estimatedCost, setEstimatedCost] = useState<{
    views: { qty: number; usd: number; pkr: number } | null;
    likes: { qty: number; usd: number; pkr: number } | null;
    comments: { qty: number; usd: number; pkr: number } | null;
    shares: { qty: number; usd: number; pkr: number } | null;
    saves: { qty: number; usd: number; pkr: number } | null;
    totalUsd: number;
    totalPkr: number;
  } | null>(null);

  const calculateExpense = () => {
    const totalViews = parseInt(form.total_views) || 0;
    if (totalViews <= 0) {
      addToast('Enter target views first', 'error');
      return;
    }
    if (!form.view_service) {
      addToast('Select at least a View service', 'error');
      return;
    }

    let totalUsd = 0;
    let totalPkr = 0;

    // 1. Views
    let viewsData = null;
    if (viewSvc) {
      const usd = (totalViews / 1000) * viewSvc.rate_usd;
      const pkr = (totalViews / 1000) * viewSvc.rate_pkr;
      viewsData = { qty: totalViews, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 2. Likes
    let likesData = null;
    if (form.like_service && likeSvc) {
      const rate = parseFloat(form.engagement_rate) || 8.5;
      const qty = Math.max(likeMin, Math.round(totalViews * (rate / 100)));
      const usd = (qty / 1000) * likeSvc.rate_usd;
      const pkr = (qty / 1000) * likeSvc.rate_pkr;
      likesData = { qty, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 3. Comments
    let commentsData = null;
    if (form.comment_service && commentSvc) {
      const qty = Math.max(commentMin, Math.round(totalViews * 0.01));
      const usd = (qty / 1000) * commentSvc.rate_usd;
      const pkr = (qty / 1000) * commentSvc.rate_pkr;
      commentsData = { qty, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 4. Shares
    let sharesData = null;
    if (form.share_service && shareSvc) {
      const qty = Math.max(shareMin, Math.round(totalViews * 0.01));
      const usd = (qty / 1000) * shareSvc.rate_usd;
      const pkr = (qty / 1000) * shareSvc.rate_pkr;
      sharesData = { qty, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 5. Saves
    let savesData = null;
    if (form.save_service && saveSvc && form.platform === 'Instagram') {
      const qty = Math.max(saveMin, Math.round(totalViews * 0.015));
      const usd = (qty / 1000) * saveSvc.rate_usd;
      const pkr = (qty / 1000) * saveSvc.rate_pkr;
      savesData = { qty, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    setEstimatedCost({
      views: viewsData,
      likes: likesData,
      comments: commentsData,
      shares: sharesData,
      saves: savesData,
      totalUsd,
      totalPkr
    });
    addToast('Total campaign expense calculated!', 'success');
  };

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const fetchMeta = async () => {
    if (!form.url.trim()) { addToast('Enter a URL first', 'error'); return; }
    setFetching(true); setMeta(null);
    const res = await api.fetchMetadata(form.url.trim(), form.platform);
    if (res.ok && res.meta) { setMeta(res.meta); addToast(`Metadata fetched via ${res.meta.source}`, 'success'); }
    else addToast(res.error || 'Could not scrape — baseline sync will be used on launch', 'info');
    setFetching(false);
  };

  const handleLaunch = async () => {
    if (!form.url.trim())   { addToast('URL is required', 'error'); return; }
    if (!form.view_service) { addToast('At least a View service is required', 'error'); return; }
    if (parseInt(form.total_views) < viewMin) { addToast(`Target views must be ≥ ${viewMin} (service minimum)`, 'error'); return; }
    if (parseInt(form.total_views) > viewMax) { addToast(`Target views must be ≤ ${viewMax.toLocaleString()} (service maximum)`, 'error'); return; }
    setLoading(true);
    const payload: Record<string, unknown> = {
      ...form,
      total_views:         parseInt(form.total_views),
      days_to_run:         parseFloat(form.days_to_run),
      like_min:            likeMin,
      view_service_min:    viewMin,
      comment_service_min: commentMin,
      share_service_min:   shareMin,
      save_service_min:    saveMin,
      engagement_rate:     parseFloat(form.engagement_rate),
    };
    if (meta) {
      payload.video_title  = meta.title;
      payload.video_author = meta.author;
      payload.start_views  = meta.views;
      payload.start_likes  = meta.likes;
    }
    const res = await api.launchCampaign(payload);
    setLoading(false);
    if (res.ok) { addToast('Campaign launched! 🚀', 'success'); onLaunched(); onClose(); }
    else addToast(res.error || 'Launch failed', 'error');
  };

  const svcOptions = services.map(s => (
    <option key={s.id} value={s.service_id}>{s.service_id} — {s.name}</option>
  ));

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content wide">
        <div className="modal-header">
          <span className="modal-title">🚀 Launch Campaign</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* URL + Fetch */}
          <div className="form-group">
            <label className="form-label">Post URL</label>
            <div className="url-fetch-row">
              <input className="form-input" placeholder="https://www.tiktok.com/@user/video/..."
                value={form.url} onChange={e => set('url', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchMeta()} />
              <button className="btn btn-secondary" onClick={fetchMeta} disabled={fetching} style={{ flexShrink: 0 }}>
                {fetching ? <span className="spin">⟳</span> : '🔍'} Fetch
              </button>
            </div>
          </div>

          {meta && (
            <div className="meta-preview">
              {meta.title  && <div className="meta-row"><span className="meta-key">Title</span><span className="meta-val">{meta.title.slice(0,60)}</span></div>}
              {meta.author && <div className="meta-row"><span className="meta-key">Author</span><span className="meta-val">@{meta.author}</span></div>}
              {meta.views !== null && <div className="meta-row"><span className="meta-key">Views</span><span className="meta-val">{fmtNumber(meta.views!)}</span></div>}
              {meta.likes !== null && <div className="meta-row"><span className="meta-key">Likes</span><span className="meta-val">{fmtNumber(meta.likes!)}</span></div>}
              <div className="meta-source">📡 source: {meta.source}</div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select className="form-select" value={form.platform} onChange={e => set('platform', e.target.value)}>
                <option value="TikTok">🎵 TikTok</option>
                <option value="Instagram">📸 Instagram</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Delivery Mode</label>
              <div className="form-input" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', height: 36, opacity: 0.85 }}>
                🌱 Organic Growth (Locked)
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Target Views
                {viewSvc && <span style={{ float: 'right', color: 'var(--text-2)', fontSize: 11, fontWeight: 400 }}>
                  min {viewMin.toLocaleString()} · max {viewMax.toLocaleString()}
                </span>}
              </label>
              <input className="form-input" type="number" min={viewMin} max={viewMax} value={form.total_views} onChange={e => set('total_views', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Days to Run</label>
              <input className="form-input" type="number" min="0.1" step="0.5" value={form.days_to_run} onChange={e => set('days_to_run', e.target.value)} />
            </div>
          </div>

          <div className="section-sep">🛠️ Service IDs</div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">👁️ Views Service</label>
              <select className="form-select" value={form.view_service} onChange={e => set('view_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">❤️ Likes Service</label>
              <select className="form-select" value={form.like_service} onChange={e => set('like_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">💬 Comments Service</label>
              <select className="form-select" value={form.comment_service} onChange={e => set('comment_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Engagement Ratio (%)</label>
              <input className="form-input" type="number" min="0.1" max="100" step="0.1" value={form.engagement_rate} onChange={e => set('engagement_rate', e.target.value)} />
            </div>
          </div>
          {likeSvc && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">❤️ Like Service Limits</label>
                <div className="form-input" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', height: 36, fontSize: 13, opacity: 0.85, gap: 10 }}>
                  <span>Min: <b>{likeMin.toLocaleString()}</b></span>
                  <span style={{ color: 'var(--border)' }}>|</span>
                  <span>Max: <b>{(likeSvc.max_order || 0).toLocaleString()}</b></span>
                </div>
              </div>
              <div className="form-group" style={{ display: 'none' }} />
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">🔁 Shares Service</label>
              <select className="form-select" value={form.share_service} onChange={e => set('share_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">🔖 Saves Service (Insta)</label>
              <select className="form-select" value={form.save_service} onChange={e => set('save_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
          </div>

          <label className="form-check">
            <input type="checkbox" checked={form.peak_only} onChange={e => set('peak_only', e.target.checked)} />
            <span>Peak-hours only delivery (evenings + weekends)</span>
          </label>

          {estimatedCost && (
            <div className="cost-breakdown-card" style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-2)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginTop: '15px',
              animation: 'fade-in 0.2s ease'
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                📊 Estimated Expense Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {estimatedCost.views && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>👁️ Views ({estimatedCost.views.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.views.usd.toFixed(2)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.views.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.likes && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>❤️ Likes ({estimatedCost.likes.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.likes.usd.toFixed(2)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.likes.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.comments && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>💬 Comments ({estimatedCost.comments.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.comments.usd.toFixed(2)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.comments.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.shares && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>🔁 Shares ({estimatedCost.shares.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.shares.usd.toFixed(2)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.shares.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.saves && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>🔖 Saves ({estimatedCost.saves.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.saves.usd.toFixed(2)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.saves.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                <div style={{ height: '1px', background: 'var(--border-2)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                  <span style={{ color: 'var(--text-1)' }}>💰 Estimated Grand Total:</span>
                  <span style={{ color: 'var(--accent-hi)' }}>
                    ${estimatedCost.totalUsd.toFixed(2)} USD 
                    <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 6, fontWeight: 400 }}>
                      ({estimatedCost.totalPkr.toLocaleString(undefined, { maximumFractionDigits: 0 })} PKR)
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={calculateExpense} style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            📊 Calculate Expense
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-lg" onClick={handleLaunch} disabled={loading}>
            {loading ? <><span className="spin">⟳</span> Launching…</> : '🚀 Launch Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Edit Campaign Modal
// ─────────────────────────────────────────────────────
interface EditModalProps {
  campaign: Campaign;
  onClose: () => void;
  onUpdated: () => void;
}

function EditModal({ campaign, onClose, onUpdated }: EditModalProps) {
  const { services, addToast } = useApp();
  const [form, setForm] = useState({
    view_service: campaign.view_service || '',
    like_service: campaign.like_service || '',
    comment_service: campaign.comment_service || '',
    share_service: campaign.share_service || '',
    save_service: campaign.save_service || '',
    total_views: campaign.total_views.toString(),
    engagement_rate: (campaign.engagement_rate || 8.5).toString(),
    peak_only: !!campaign.peak_only,
  });
  const [loading, setLoading] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState<{
    views: { qty: number; usd: number; pkr: number } | null;
    likes: { qty: number; usd: number; pkr: number } | null;
    comments: { qty: number; usd: number; pkr: number } | null;
    shares: { qty: number; usd: number; pkr: number } | null;
    saves: { qty: number; usd: number; pkr: number } | null;
    totalUsd: number;
    totalPkr: number;
  } | null>(null);

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const viewSvc    = services.find(s => s.service_id === form.view_service);
  const likeSvc    = services.find(s => s.service_id === form.like_service);
  const commentSvc = services.find(s => s.service_id === form.comment_service);
  const shareSvc   = services.find(s => s.service_id === form.share_service);
  const saveSvc    = services.find(s => s.service_id === form.save_service);

  const viewMin    = viewSvc    ? (viewSvc.min_order    || 1) : 1;
  const viewMax    = viewSvc    ? (viewSvc.max_order    || 1000000) : 1000000;
  const likeMin    = likeSvc    ? (likeSvc.min_order    || 1) : 1;
  const commentMin = commentSvc ? (commentSvc.min_order || 1) : 1;
  const shareMin   = shareSvc   ? (shareSvc.min_order   || 1) : 1;
  const saveMin    = saveSvc    ? (saveSvc.min_order    || 1) : 1;

  const calculateExpense = () => {
    const totalViews = parseInt(form.total_views) || 0;
    if (totalViews <= 0) {
      addToast('Enter target views first', 'error');
      return;
    }
    if (!form.view_service) {
      addToast('Select at least a View service', 'error');
      return;
    }

    let totalUsd = 0;
    let totalPkr = 0;

    // 1. Views
    const remainingViews = Math.max(0, totalViews - campaign.views_delivered);
    let viewsData = null;
    if (viewSvc) {
      const usd = (remainingViews / 1000) * viewSvc.rate_usd;
      const pkr = (remainingViews / 1000) * viewSvc.rate_pkr;
      viewsData = { qty: remainingViews, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 2. Likes
    let likesData = null;
    if (form.like_service && likeSvc) {
      const rate = parseFloat(form.engagement_rate) || 8.5;
      const targetLikes = Math.max(likeMin, Math.round(totalViews * (rate / 100)));
      const remainingLikes = Math.max(0, targetLikes - campaign.likes_delivered);
      const usd = (remainingLikes / 1000) * likeSvc.rate_usd;
      const pkr = (remainingLikes / 1000) * likeSvc.rate_pkr;
      likesData = { qty: remainingLikes, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 3. Comments
    let commentsData = null;
    if (form.comment_service && commentSvc) {
      const targetComments = Math.max(commentMin, Math.round(totalViews * 0.01));
      const remainingComments = Math.max(0, targetComments - campaign.comments_delivered);
      const usd = (remainingComments / 1000) * commentSvc.rate_usd;
      const pkr = (remainingComments / 1000) * commentSvc.rate_pkr;
      commentsData = { qty: remainingComments, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 4. Shares
    let sharesData = null;
    if (form.share_service && shareSvc) {
      const targetShares = Math.max(shareMin, Math.round(totalViews * 0.01));
      const remainingShares = Math.max(0, targetShares - campaign.shares_delivered);
      const usd = (remainingShares / 1000) * shareSvc.rate_usd;
      const pkr = (remainingShares / 1000) * shareSvc.rate_pkr;
      sharesData = { qty: remainingShares, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    // 5. Saves
    let savesData = null;
    if (form.save_service && saveSvc && campaign.platform === 'Instagram') {
      const targetSaves = Math.max(saveMin, Math.round(totalViews * 0.015));
      const remainingSaves = Math.max(0, targetSaves - campaign.saves_delivered);
      const usd = (remainingSaves / 1000) * saveSvc.rate_usd;
      const pkr = (remainingSaves / 1000) * saveSvc.rate_pkr;
      savesData = { qty: remainingSaves, usd, pkr };
      totalUsd += usd;
      totalPkr += pkr;
    }

    setEstimatedCost({
      views: viewsData,
      likes: likesData,
      comments: commentsData,
      shares: sharesData,
      saves: savesData,
      totalUsd,
      totalPkr
    });
    addToast('Estimated remaining campaign expense calculated!', 'success');
  };

  const handleUpdate = async () => {
    const target = parseInt(form.total_views);
    if (isNaN(target) || target < campaign.views_delivered) {
      addToast(`Target views must be at least the delivered views (${campaign.views_delivered})`, 'error');
      return;
    }
    if (!form.view_service) {
      addToast('Views service is required', 'error');
      return;
    }
    if (target < viewMin) {
      addToast(`Target views must be ≥ ${viewMin} (service minimum)`, 'error');
      return;
    }
    if (target > viewMax) {
      addToast(`Target views must be ≤ ${viewMax.toLocaleString()} (service maximum)`, 'error');
      return;
    }

    setLoading(true);
    const res = await api.editCampaign(campaign.url, {
      ...form,
      total_views: target,
      engagement_rate: parseFloat(form.engagement_rate) || 8.5
    });
    setLoading(false);

    if (res.ok) {
      addToast('Campaign updated successfully!', 'success');
      onUpdated();
      onClose();
    } else {
      addToast(res.error || 'Update failed', 'error');
    }
  };

  const svcOptions = services.map(s => (
    <option key={s.id} value={s.service_id}>{s.service_id} — {s.name}</option>
  ));

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <div className="modal-header">
          <span className="modal-title">✏️ Edit Campaign</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 15, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{campaign.video_title}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>Delivered so far: <b>{campaign.views_delivered.toLocaleString()}</b> views</div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">🎯 Total Target Views</label>
              <input className="form-input" type="number" min={Math.max(viewMin, campaign.views_delivered)} max={viewMax} value={form.total_views} onChange={e => set('total_views', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Views Service Limits</label>
              <div className="form-input" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', height: 36, fontSize: 12, opacity: 0.85, gap: 10 }}>
                <span>Min: <b>{viewMin.toLocaleString()}</b></span>
                <span style={{ color: 'var(--border)' }}>|</span>
                <span>Max: <b>{viewMax.toLocaleString()}</b></span>
              </div>
            </div>
          </div>

          <div className="section-sep">🛠️ Services Used</div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">👁️ Views Service</label>
              <select className="form-select" value={form.view_service} onChange={e => set('view_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">❤️ Likes Service</label>
              <select className="form-select" value={form.like_service} onChange={e => set('like_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">💬 Comments Service</label>
              <select className="form-select" value={form.comment_service} onChange={e => set('comment_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Engagement Ratio (%)</label>
              <input className="form-input" type="number" min="0.1" max="100" step="0.1" value={form.engagement_rate} onChange={e => set('engagement_rate', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">🔁 Shares Service</label>
              <select className="form-select" value={form.share_service} onChange={e => set('share_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">🔖 Saves Service (Insta)</label>
              <select className="form-select" value={form.save_service} onChange={e => set('save_service', e.target.value)}>
                <option value="">— none —</option>
                {svcOptions}
              </select>
            </div>
          </div>

          <label className="form-check">
            <input type="checkbox" checked={form.peak_only} onChange={e => set('peak_only', e.target.checked)} />
            <span>Peak-hours only delivery (evenings + weekends)</span>
          </label>

          {estimatedCost && (
            <div className="cost-breakdown-card" style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-2)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginTop: '15px',
              animation: 'fade-in 0.2s ease'
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                📊 Estimated Remaining Expense Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {estimatedCost.views && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>👁️ Views (+{estimatedCost.views.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.views.usd.toFixed(3)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.views.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.likes && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>❤️ Likes (+{estimatedCost.likes.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.likes.usd.toFixed(3)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.likes.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.comments && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>💬 Comments (+{estimatedCost.comments.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.comments.usd.toFixed(3)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.comments.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.shares && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>🔁 Shares (+{estimatedCost.shares.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.shares.usd.toFixed(3)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.shares.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                {estimatedCost.saves && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>🔖 Saves (+{estimatedCost.saves.qty.toLocaleString()})</span>
                    <span className="mono">${estimatedCost.saves.usd.toFixed(3)} USD <span style={{ color: 'var(--text-3)' }}>({estimatedCost.saves.pkr.toFixed(0)} PKR)</span></span>
                  </div>
                )}
                <div style={{ height: '1px', background: 'var(--border-2)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                  <span style={{ color: 'var(--text-1)' }}>💰 Est. Remaining Cost:</span>
                  <span style={{ color: 'var(--accent-hi)' }}>
                    ${estimatedCost.totalUsd.toFixed(3)} USD 
                    <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 6, fontWeight: 400 }}>
                      ({estimatedCost.totalPkr.toLocaleString(undefined, { maximumFractionDigits: 0 })} PKR)
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={calculateExpense} style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            📊 Calculate Cost
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleUpdate} disabled={loading}>
            {loading ? <><span className="spin">⟳</span> Updating…</> : '✏️ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Quick Order Modal
// ─────────────────────────────────────────────────────
function QuickOrderModal({ onClose }: { onClose: () => void }) {
  const { addToast, services } = useApp();
  const [tab, setTab] = useState<'single'|'drip'>('single');
  const [form, setForm] = useState({ service_id: '', link: '', quantity: '1000', runs: '5', interval: '60' });
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSend = async () => {
    if (!form.service_id || !form.link || !form.quantity) { addToast('Fill all required fields', 'error'); return; }
    setLoading(true);
    let res;
    if (tab === 'drip') {
      res = await api.placeDripOrder({ service_id: form.service_id, link: form.link, quantity: parseInt(form.quantity), runs: parseInt(form.runs), interval: parseInt(form.interval) });
    } else {
      res = await api.placeOrder(form.service_id, form.link, parseInt(form.quantity));
    }
    setLoading(false);
    if (res.ok) { addToast(`Order #${res.order_id} placed! ✅`, 'success'); onClose(); }
    else addToast(res.error || 'Order failed', 'error');
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content narrow">
        <div className="modal-header">
          <span className="modal-title">⚡ Quick Order</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 6, padding: '2px', background: 'var(--bg-input)', borderRadius: 8, border: '1px solid var(--border-2)' }}>
            {(['single','drip'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '6px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12, background: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-3)', transition: 'all 0.15s' }}>
                {t === 'single' ? '🎯 Single' : '💧 Drip-Feed'}
              </button>
            ))}
          </div>
          <div className="form-group">
            <label className="form-label">Service ID</label>
            <select className="form-select" value={form.service_id} onChange={e => set('service_id', e.target.value)}>
              <option value="">— select service —</option>
              {services.map(s => <option key={s.id} value={s.service_id}>{s.service_id} — {s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Post / Profile URL</label>
            <input className="form-input" placeholder="https://..." value={form.link} onChange={e => set('link', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Quantity</label>
            <input className="form-input" type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
          </div>
          {tab === 'drip' && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Runs</label>
                <input className="form-input" type="number" min="1" value={form.runs} onChange={e => set('runs', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Interval (min)</label>
                <input className="form-input" type="number" min="1" value={form.interval} onChange={e => set('interval', e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSend} disabled={loading}>
            {loading ? <><span className="spin">⟳</span> Sending…</> : '⚡ Place Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  DASHBOARD PAGE
// ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { campaigns, logs, balance, refreshCampaigns } = useApp();
  const [showLaunch, setShowLaunch]         = useState(false);
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics]           = useState<Record<string, AnalyticsPoint[]>>({});
  const globalLogRef = useRef<HTMLDivElement>(null);

  const campList = Object.values(campaigns).sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const running    = campList.filter(c => c.status === 'Running').length;
  const completed  = campList.filter(c => c.status === 'Completed').length;
  const totalViews = campList.reduce((s, c) => s + c.views_delivered, 0);
  const totalLikes = campList.reduce((s, c) => s + c.likes_delivered, 0);

  const loadAnalytics = useCallback(async () => {
    const data = await api.getAnalytics();
    setAnalytics(data);
  }, []);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics, campaigns]);

  useEffect(() => {
    if (globalLogRef.current) globalLogRef.current.scrollTop = globalLogRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">📊 Dashboard</div>
          <div className="page-sub">{running} running · {completed} completed · {campList.length} total</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowQuickOrder(true)}>⚡ Quick Order</button>
          <button className="btn btn-primary"   onClick={() => setShowLaunch(true)}>🚀 New Campaign</button>
        </div>
      </div>

      {/* ── Stats tiles ── */}
      <div className="stat-row">
        <div className={`stat-tile ${running > 0 ? 'green' : ''}`}>
          <span className="stat-label">🟢 Active</span>
          <span className="stat-val">{running}</span>
          <span className="stat-sub">{campList.length} total</span>
        </div>
        <div className="stat-tile accent">
          <span className="stat-label">👁️ Views Delivered</span>
          <span className="stat-val sm">{fmtNumber(totalViews)}</span>
          <span className="stat-sub">all campaigns</span>
        </div>
        <div className="stat-tile blue">
          <span className="stat-label">❤️ Likes Delivered</span>
          <span className="stat-val sm">{fmtNumber(totalLikes)}</span>
        </div>
        <div className={`stat-tile ${balance?.ok ? 'green' : ''}`}>
          <span className="stat-label">💰 Balance</span>
          <span className="stat-val sm mono">{balance?.ok ? `$${balance.usd?.toFixed(3)}` : '—'}</span>
          <span className="stat-sub">{balance?.ok ? `PKR ${balance.pkr?.toFixed(0)}` : 'not verified'}</span>
        </div>
      </div>

      {/* ── Two-col ── */}
      <div className="two-col">
        {/* LEFT — Campaign list (each card is fully self-contained) */}
        <div className="col">
          <div className="card flush">
            <div className="card-header" style={{ padding: '14px 16px' }}>
              <span className="card-title">Campaigns</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-xs" onClick={() => {
                  downloadCsv(
                    'URL,Platform,Status,Views,Likes,Total Views\n' +
                    campList.map(c => `"${c.url}","${c.platform}","${c.status}",${c.views_delivered},${c.likes_delivered},${c.total_views}`).join('\n'),
                    'campaigns.csv'
                  );
                }}>⬇ Export</button>
                <button className="btn btn-ghost btn-xs" onClick={refreshCampaigns}>↺ Refresh</button>
              </div>
            </div>
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {campList.length === 0 ? (
                <div className="empty-state">
                  <span className="icon">🚀</span>
                  <span className="title">No campaigns yet</span>
                  <span className="sub">Click "New Campaign" to get started</span>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowLaunch(true)}>🚀 Launch First Campaign</button>
                </div>
              ) : campList.map(c => (
                <CampaignCard
                  key={c.id}
                  camp={c}
                  analytics={analytics[c.url] || []}
                  onRefresh={refreshCampaigns}
                  onEdit={setEditingCampaign}
                />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Global live log */}
        <div className="col">
          <div className="card" style={{ flex: 1 }}>
            <div className="card-header">
              <span className="card-title">🌐 Global Activity Log</span>
              <button className="btn btn-ghost btn-xs" onClick={async () => {
                const { csv } = await api.exportLogsCsv();
                downloadCsv(csv, 'logs.csv');
              }}>⬇ Export</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
              All system events. Open any campaign card → 📋 Log for campaign-specific entries.
            </div>
            <div className="log-terminal" ref={globalLogRef} style={{ height: 'calc(100vh - 420px)', minHeight: 200 }}>
              {logs.slice(-200).map((l, i) => (
                <div key={i} className={`log-entry ${l.level}`}>
                  <span className="log-time">{l.timestamp}</span>
                  <span className="log-msg">{l.message}</span>
                </div>
              ))}
              {logs.length === 0 && <span className="text-muted text-xs">No activity yet…</span>}
            </div>
          </div>
        </div>
      </div>

      {showLaunch     && <LaunchModal    onClose={() => setShowLaunch(false)}     onLaunched={refreshCampaigns} />}
      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}
      {editingCampaign && (
        <EditModal 
          campaign={editingCampaign} 
          onClose={() => setEditingCampaign(null)} 
          onUpdated={refreshCampaigns} 
        />
      )}
    </div>
  );
}

const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec, execFile } = require('child_process');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────────
//  GLOBAL STATE & PATHS
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;
const stateDir = process.env.DATA_DIR || __dirname;
const stateFile = path.join(stateDir, 'smmbot_state.json');

let state = {
  api_key: process.env.MARKETERUM_API_KEY || '',
  api_url: 'https://marketerum.com/api/v2',
  api_proxy: '',
  auto_proxy: null,
  custom_pkr_rate: 297,
  services: [],
  campaigns: {},
  logs: [],
  analytics: {},
  order_history: [],
};

const activeWorkers = new Map(); // url -> AbortController
const sseClients = new Set();    // Set of HTTP res objects for Server-Sent Events

// ─────────────────────────────────────────────────────────────────
//  PERSISTENCE
// ─────────────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        state = { ...state, ...parsed };
        if (!state.api_url || state.api_url.includes('smmpanelpak')) {
          state.api_url = 'https://marketerum.com/api/v2';
        }
        if (!state.order_history) state.order_history = [];
        if (!state.services) state.services = [];
      } catch (parseErr) {
        console.error('State JSON file corrupted! Backing up corrupted file...', parseErr);
        const backupFile = path.join(stateDir, `smmbot_state_corrupted_${Date.now()}.json`);
        fs.renameSync(stateFile, backupFile);
      }
    }
  } catch (e) {
    console.error('Failed to load state', e);
  }
}

function saveState() {
  try {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    const tempFile = path.join(stateDir, `smmbot_state_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempFile, stateFile);
  } catch (e) {
    console.error('Failed to save state', e);
  }
}

// ─────────────────────────────────────────────────────────────────
//  LOGGING & REALTIME BROADCAST (SSE)
// ─────────────────────────────────────────────────────────────────
function logMsg(message, level = 'info', campaignUrl = null) {
  const timestamp = new Date().toTimeString().split(' ')[0];
  const entry = { timestamp, message, level };
  if (campaignUrl) {
    entry.url = campaignUrl;
  }
  state.logs.push(entry);
  if (state.logs.length > 500) {
    state.logs.shift();
  }
  console.log(`[${level.toUpperCase()}] ${timestamp}: ${message}`);

  const sseData = `data: ${JSON.stringify({ type: 'log', data: entry })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(sseData);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function broadcastEvent(type, data) {
  const sseData = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(sseData);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
//  USER-AGENTS & PROXIES
// ─────────────────────────────────────────────────────────────────
const ROTATING_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
];

function getRandomUserAgent() {
  return ROTATING_USER_AGENTS[Math.floor(Math.random() * ROTATING_USER_AGENTS.length)];
}

function getProxy() {
  if (state.api_proxy && state.api_proxy.trim()) return state.api_proxy.trim();
  if (state.auto_proxy && state.auto_proxy.trim()) return state.auto_proxy.trim();
  return null;
}

function getRequestConfig(customHeaders = {}, useProxy = false) {
  const config = {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept-Language': 'en-US,en;q=0.9',
      ...customHeaders,
    },
    timeout: 5000,
  };
  if (useProxy) {
    const proxy = getProxy();
    if (proxy) {
      config.httpsAgent = new SocksProxyAgent(proxy);
      config.httpAgent  = new SocksProxyAgent(proxy);
    }
  }
  return config;
}

async function findWorkingProxy() {
  logMsg('[AutoProxy] Scanning free SOCKS5 list...', 'info');
  try {
    const listUrl = 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt';
    const res = await axios.get(listUrl, { timeout: 5000 });
    const proxies = res.data.split('\n').map(p => p.trim()).filter(Boolean);
    logMsg(`[AutoProxy] Loaded ${proxies.length} proxies`, 'info');

    const sample = proxies.sort(() => 0.5 - Math.random()).slice(0, 40);
    for (const p of sample) {
      const proxyStr = `socks5://${p}`;
      try {
        const agent = new SocksProxyAgent(proxyStr);
        await axios.get('https://api.ipify.org?format=json', {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: 2500
        });
        logMsg(`[AutoProxy] Found working proxy: ${proxyStr}`, 'success');
        state.auto_proxy = proxyStr;
        saveState();
        return proxyStr;
      } catch (e) {
        continue;
      }
    }
    logMsg('[AutoProxy] Could not find working proxy in sample batch', 'warn');
  } catch (e) {
    logMsg(`[AutoProxy] Failed to fetch proxy list: ${e.message}`, 'error');
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  MARKETERUM SMM PANEL API
// ─────────────────────────────────────────────────────────────────
let cachedBalance = null;
let cachedBalanceTime = 0;
let cachedServices = null;
let cachedServicesTime = 0;

async function smmApiCall(action, params = {}, customKey = null, customUrl = null, timeoutMs = 8000) {
  const key = customKey || state.api_key;
  const url = customUrl || state.api_url || 'https://marketerum.com/api/v2';
  if (!key) throw new Error('API key is empty. Please enter and save your Marketerum API key in Settings.');

  const payload = new URLSearchParams({ key, action, ...params });
  const cfg = getRequestConfig({ 'Content-Type': 'application/x-www-form-urlencoded' }, false);
  cfg.timeout = timeoutMs;
  const res = await axios.post(url, payload.toString(), cfg);
  return res.data;
}

async function smmGetBalance(customKey = null, customUrl = null) {
  const now = Date.now();
  if (!customKey && cachedBalance && (now - cachedBalanceTime < 10000)) {
    return cachedBalance;
  }
  const data = await smmApiCall('balance', {}, customKey, customUrl, 6000);
  if (data.error) throw new Error(data.error);
  const result = { balance: parseFloat(data.balance || 0), currency: data.currency || 'USD' };
  if (!customKey) {
    cachedBalance = result;
    cachedBalanceTime = now;
  }
  return result;
}

async function smmGetServices(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedServices && (now - cachedServicesTime < 180000)) {
    return cachedServices;
  }
  const data = await smmApiCall('services', {}, null, null, 25000);
  if (Array.isArray(data)) {
    cachedServices = data;
    cachedServicesTime = now;
    return data;
  }
  if (data.error) throw new Error(data.error);
  return [];
}

async function smmPlaceOrder(service_id, link, quantity, runs = null, interval = null, comments = null) {
  const params = { service: service_id, link };
  
  if (comments) {
    // Official Marketerum PHP spec for Custom Comments: newline-separated string
    const commentStr = Array.isArray(comments) ? comments.join('\n') : String(comments).trim();
    params.comments = commentStr;
  } else {
    params.quantity = parseInt(quantity);
    if (runs) params.runs = runs;
    if (interval) params.interval = interval;
  }

  const data = await smmApiCall('add', params);
  if (data.error) throw new Error(data.error);
  if (!data.order) throw new Error('No order ID returned from panel');

  state.order_history.unshift({
    order_id: String(data.order),
    service_id,
    link,
    quantity: parseInt(quantity),
    runs: runs ? parseInt(runs) : undefined,
    interval: interval ? parseInt(interval) : undefined,
    created_at: new Date().toISOString(),
    type: runs ? 'drip' : 'manual'
  });
  if (state.order_history.length > 500) state.order_history.pop();
  saveState();

  return String(data.order);
}

async function smmCheckOrder(order_id) {
  const data = await smmApiCall('status', { order: order_id });
  if (data.error) throw new Error(data.error);
  return data.status || 'Unknown';
}

async function smmMultiStatus(order_ids) {
  const ordersStr = order_ids.join(',');
  const data = await smmApiCall('status', { orders: ordersStr });
  return data || {};
}

async function smmRefillOrder(order_id) {
  const data = await smmApiCall('refill', { order: order_id });
  if (data.error) throw new Error(data.error);
  return data;
}

async function smmCancelOrder(order_id) {
  try {
    const data = await smmApiCall('cancel', { order: order_id });
    return data;
  } catch (e) {
    try {
      const data = await smmApiCall('cancel', { orders: order_id });
      return data;
    } catch (err) {
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────
//  RETRY LOOP WITH AUTOMATIC PROXY ROTATION
// ─────────────────────────────────────────────────────────────────
async function smmPlaceOrderWithRetry(serviceId, url, qty, typeLabel, maxAttempts = 4, comments = null) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const orderId = await smmPlaceOrder(serviceId, url, qty, null, null, comments);
      logMsg(`✅ [${typeLabel}] Placed order #${orderId} for ${qty} items`, 'success', url);
      return orderId;
    } catch (err) {
      logMsg(`⚠️ [${typeLabel}] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`, 'warn', url);
      if (err.message && (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED') || err.message.includes('429'))) {
        await findWorkingProxy();
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 4000 * attempt));
      }
    }
  }
  logMsg(`❌ [${typeLabel}] All ${maxAttempts} attempts to place order for ${qty} items failed.`, 'error', url);
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  APIFY SCRAPING POOL & BALANCE MONITOR
// ─────────────────────────────────────────────────────────────────
const apifyKeysFile = path.join(stateDir, 'apify_keys.json');
let cachedApifyStats = null;
let lastApifyStatsFetch = 0;

function readApifyKeys() {
  const keys = [];
  try {
    if (fs.existsSync(apifyKeysFile)) {
      const raw = fs.readFileSync(apifyKeysFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const k of parsed) {
          if (k && typeof k === 'string' && k.trim()) {
            keys.push(k.trim());
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to read apify_keys.json', e);
  }
  const envKeys = process.env.APIFY_API_KEYS || '';
  if (envKeys) {
    for (const k of envKeys.split(',')) {
      const clean = k.trim();
      if (clean && !keys.includes(clean)) keys.push(clean);
    }
  }
  return keys;
}

function saveApifyKeys(keys) {
  try {
    const cleanKeys = Array.from(new Set(keys.map(k => (typeof k === 'string' ? k.trim() : '')).filter(Boolean)));
    fs.writeFileSync(apifyKeysFile, JSON.stringify(cleanKeys, null, 2), 'utf8');
    return cleanKeys;
  } catch (e) {
    console.error('Failed to save apify_keys.json', e);
    return [];
  }
}

async function getApifyPoolStats(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedApifyStats && (now - lastApifyStatsFetch < 25000)) {
    return cachedApifyStats;
  }

  const keys = readApifyKeys();
  let total_limit_usd = 0;
  let total_used_usd = 0;
  let total_remaining_usd = 0;
  let active_accounts = 0;
  const keyDetails = [];

  for (const token of keys) {
    const masked = token.length > 14 ? `${token.slice(0, 10)}...${token.slice(-4)}` : '••••••••';
    try {
      const [limitsRes, userRes] = await Promise.allSettled([
        axios.get(`https://api.apify.com/v2/users/me/limits?token=${token}`, { timeout: 6000 }),
        axios.get(`https://api.apify.com/v2/users/me?token=${token}`, { timeout: 6000 })
      ]);

      if (limitsRes.status === 'fulfilled' && limitsRes.value.data && limitsRes.value.data.data) {
        const limData = limitsRes.value.data.data;
        const userData = userRes.status === 'fulfilled' ? (userRes.value.data?.data || {}) : {};

        const maxMonthly = limData.limits?.maxMonthlyUsageUsd || 10;
        const currentUsage = limData.current?.monthlyUsageUsd || 0;
        const remaining = Math.max(0, maxMonthly - currentUsage);
        const resetDate = limData.monthlyUsageCycle?.endAt ? limData.monthlyUsageCycle.endAt.split('T')[0] : '';
        const username = userData.username || 'Apify User';
        const tier = userData.plan?.tier || 'FREE';

        total_limit_usd += maxMonthly;
        total_used_usd += currentUsage;
        total_remaining_usd += remaining;
        if (remaining > 0.20) active_accounts++;

        keyDetails.push({
          key: token,
          key_masked: masked,
          username,
          tier,
          limit_usd: maxMonthly,
          used_usd: currentUsage,
          remaining_usd: remaining,
          reset_date: resetDate,
          status: remaining > 0.20 ? 'active' : 'depleted'
        });
      } else {
        keyDetails.push({
          key: token,
          key_masked: masked,
          username: 'Invalid / Depleted',
          tier: 'UNKNOWN',
          limit_usd: 0,
          used_usd: 0,
          remaining_usd: 0,
          reset_date: '',
          status: 'invalid'
        });
      }
    } catch (err) {
      keyDetails.push({
        key: token,
        key_masked: masked,
        username: 'Error / Timeout',
        tier: 'UNKNOWN',
        limit_usd: 0,
        used_usd: 0,
        remaining_usd: 0,
        reset_date: '',
        status: 'invalid'
      });
    }
  }

  cachedApifyStats = {
    ok: true,
    total_limit_usd,
    total_used_usd,
    total_remaining_usd,
    active_accounts,
    total_accounts: keys.length,
    keys: keyDetails,
    last_updated: new Date().toLocaleTimeString()
  };
  lastApifyStatsFetch = Date.now();
  return cachedApifyStats;
}

// ─────────────────────────────────────────────────────────────────
//  METADATA SCRAPER
// ─────────────────────────────────────────────────────────────────
function getPythonExecutablePath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (fs.existsSync('/usr/bin/python3')) return '/usr/bin/python3';
  return 'python3';
}

function fetchPythonMetadata(url, platform, forcedProxy = null) {
  return new Promise((resolve) => {
    const scraperPath = path.join(__dirname, 'scraper.py');
    const pyPath = getPythonExecutablePath();
    const activeProxy = forcedProxy !== null ? forcedProxy : (getProxy() || '');

    execFile(pyPath, [scraperPath, url, platform, activeProxy], { timeout: 25000, killSignal: 'SIGKILL' }, (error1, stdout1) => {
      if (!error1 && stdout1) {
        try {
          const info = JSON.parse(stdout1.trim());
          if (info && (info.title || info.views !== undefined)) {
            resolve(info);
            return;
          }
        } catch (e) {}
      }

      // Retry without proxy if active proxy failed/timed out
      execFile(pyPath, [scraperPath, url, platform, ''], { timeout: 25000, killSignal: 'SIGKILL' }, (error2, stdout2) => {
        if (!error2 && stdout2) {
          try {
            const info = JSON.parse(stdout2.trim());
            if (info && (info.title || info.views !== undefined)) {
              resolve(info);
              return;
            }
          } catch (e) {}
        }
        resolve(null);
      });
    });
  });
}

async function fetchLiveMetadata(url, platform) {
  let pyMeta = await fetchPythonMetadata(url, platform, getProxy());

  if (!pyMeta) {
    pyMeta = { title: '', author: '', views: null, likes: null, comments: null, shares: null, saves: null, source: 'js-fallback' };
  }

  // JS Fallback attempt if python scraper missed title/views
  if (!pyMeta.title || pyMeta.views === null) {
    try {
      if (url.includes('tiktok.com') || platform === 'TikTok') {
        const oeUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
        const res = await axios.get(oeUrl, getRequestConfig());
        if (res.data) {
          if (!pyMeta.title) pyMeta.title = res.data.title || '';
          if (!pyMeta.author) pyMeta.author = res.data.author_name || '';
        }
      }
    } catch (e) {}
  }

  let cleanId = 'post';
  if (url && typeof url === 'string') {
    try {
      const parts = url.split('/').filter(Boolean);
      if (parts.length > 0) {
        cleanId = parts[parts.length - 1].split('?')[0];
      }
    } catch (e) {}
  }
  const title = (pyMeta.title && String(pyMeta.title).trim()) ? String(pyMeta.title).trim() : `${platform || 'Social'} Video (${cleanId})`;
  const author = (pyMeta.author && String(pyMeta.author).trim()) ? String(pyMeta.author).trim() : 'creator';

  const views = pyMeta.views !== null ? parseInt(pyMeta.views) : 0;
  const likes = pyMeta.likes !== null ? parseInt(pyMeta.likes) : Math.max(0, Math.floor(views * 0.028));
  const comments = pyMeta.comments !== null ? parseInt(pyMeta.comments) : Math.max(0, Math.floor(views * 0.0010));
  const shares = pyMeta.shares !== null ? parseInt(pyMeta.shares) : Math.max(0, Math.floor(views * 0.0012));
  const saves = pyMeta.saves !== null ? parseInt(pyMeta.saves) : Math.max(0, Math.floor(views * 0.0045));

  // Trigger async Apify pool balance refresh in background after each scrape run
  getApifyPoolStats(true).then(stats => broadcastEvent('apify_stats', stats)).catch(() => {});

  return {
    title,
    author,
    views,
    likes,
    comments,
    shares,
    saves,
    source: pyMeta.source || 'scraper-engine'
  };
}

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
//  STEALTH DRIP WORKER LOOP (WITH OVER-DELIVERY GUARD & DEFICIT POOL)
// ─────────────────────────────────────────────────────────────────
async function updateCampaignLiveStats(camp) {
  try {
    const meta = await fetchLiveMetadata(camp.url, camp.platform);
    const currentViews = meta.views;
    const currentLikes = meta.likes;
    const currentComments = meta.comments;
    const currentShares = meta.shares;
    const currentSaves = meta.saves;

    if (meta.title && !camp.video_title) camp.video_title = meta.title;
    if (meta.author && !camp.video_author) camp.video_author = meta.author;

    // Initialize baseline numbers on first scrape
    if (camp.start_views === undefined || camp.start_views === null) {
      camp.start_views = currentViews !== null ? currentViews : 0;
    }
    if (camp.start_likes === undefined || camp.start_likes === null) {
      camp.start_likes = currentLikes !== null ? currentLikes : 0;
    }
    if (camp.start_comments === undefined || camp.start_comments === null) {
      camp.start_comments = currentComments !== null ? currentComments : 0;
    }
    if (camp.start_shares === undefined || camp.start_shares === null) {
      camp.start_shares = currentShares !== null ? currentShares : 0;
    }
    if (camp.start_saves === undefined || camp.start_saves === null) {
      camp.start_saves = currentSaves !== null ? currentSaves : 0;
    }

    // 1. Calculate actual real-world delivered gains
    const liveViewsGain = Math.max(0, (currentViews || 0) - (camp.start_views || 0));
    const liveLikesGain = Math.max(0, (currentLikes || 0) - (camp.start_likes || 0));
    const liveCommentsGain = Math.max(0, (currentComments || 0) - (camp.start_comments || 0));
    const liveSharesGain = Math.max(0, (currentShares || 0) - (camp.start_shares || 0));
    const liveSavesGain = Math.max(0, (currentSaves || 0) - (camp.start_saves || 0));

    // 2. Sync delivered metrics with ground truth if live gain is higher
    if (liveViewsGain > (camp.views_delivered || 0)) {
      camp.views_delivered = liveViewsGain;
    }
    if (liveLikesGain > (camp.likes_delivered || 0)) {
      camp.likes_delivered = liveLikesGain;
    }
    if (liveCommentsGain > (camp.comments_delivered || 0)) {
      camp.comments_delivered = liveCommentsGain;
    }
    if (liveSharesGain > (camp.shares_delivered || 0)) {
      camp.shares_delivered = liveSharesGain;
    }
    if (liveSavesGain > (camp.saves_delivered || 0)) {
      camp.saves_delivered = liveSavesGain;
    }

    // 3. OVER-DELIVERY AUTO-REBALANCER:
    // Compute target ratios for current views count to prevent any metric inflation
    const currentDeliveredViews = Math.max(camp.views_delivered || 0, 100);
    const targetLikes = Math.floor(currentDeliveredViews * ((camp.engagement_rate || 3.5) / 100));
    const targetComments = Math.floor(currentDeliveredViews * 0.0020);
    const targetShares = Math.floor(currentDeliveredViews * 0.0035);
    const targetSaves = Math.floor(currentDeliveredViews * 0.0060);

    // Likes Over-Delivery Guard
    if ((camp.likes_delivered || 0) >= targetLikes) {
      if (camp.likes_deficit > 0) {
        logMsg(`🛡️ [Over-Delivery Guard] Live likes (${camp.likes_delivered}) meet/exceed target (${targetLikes}) — auto-locking likes deficit to 0`, 'info', camp.url);
        camp.likes_deficit = 0;
      }
    } else {
      camp.likes_deficit = Math.min(camp.likes_deficit || 0, targetLikes - (camp.likes_delivered || 0));
    }

    // Comments Over-Delivery Guard
    if ((camp.comments_delivered || 0) >= targetComments) {
      if (camp.comments_deficit > 0) {
        logMsg(`🛡️ [Over-Delivery Guard] Live comments (${camp.comments_delivered}) meet target (${targetComments}) — pausing comment orders`, 'info', camp.url);
        camp.comments_deficit = 0;
      }
    } else {
      camp.comments_deficit = Math.min(camp.comments_deficit || 0, targetComments - (camp.comments_delivered || 0));
    }

    // Shares Over-Delivery Guard
    if ((camp.shares_delivered || 0) >= targetShares) {
      if (camp.shares_deficit > 0) {
        logMsg(`🛡️ [Over-Delivery Guard] Live shares (${camp.shares_delivered}) exceed target (${targetShares}) — pausing share orders`, 'info', camp.url);
        camp.shares_deficit = 0;
      }
    } else {
      camp.shares_deficit = Math.min(camp.shares_deficit || 0, targetShares - (camp.shares_delivered || 0));
    }

    // Saves Over-Delivery Guard
    if ((camp.saves_delivered || 0) >= targetSaves) {
      if (camp.saves_deficit > 0) {
        logMsg(`🛡️ [Over-Delivery Guard] Live saves (${camp.saves_delivered}) exceed target (${targetSaves}) — pausing save orders`, 'info', camp.url);
        camp.saves_deficit = 0;
      }
    } else {
      camp.saves_deficit = Math.min(camp.saves_deficit || 0, targetSaves - (camp.saves_delivered || 0));
    }

    if (!state.analytics[camp.url]) state.analytics[camp.url] = [];
    state.analytics[camp.url].push({
      timestamp: new Date().toISOString(),
      views: camp.views_delivered,
      likes: camp.likes_delivered,
      live_views: currentViews !== null ? currentViews : (camp.start_views || 0) + camp.views_delivered
    });
    if (state.analytics[camp.url].length > 1000) state.analytics[camp.url].shift();
    saveState();
    broadcastEvent('campaign_update', camp.url);
  } catch (e) {
    console.error('updateCampaignLiveStats exception handled:', e.message);
  }
}

function getServiceMin(serviceId, defaultMin = 1) {
  if (!serviceId) return defaultMin;
  const svc = (state.services || []).find(s => String(s.service_id) === String(serviceId));
  if (svc && svc.min_order && Number(svc.min_order) > 0) {
    return parseInt(svc.min_order);
  }
  return defaultMin;
}

function gaussianRandom(mean = 0, stdev = 1) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

// ─────────────────────────────────────────────────────────────────
//  GROQ AI SMART CUSTOM COMMENTS GENERATOR
// ─────────────────────────────────────────────────────────────────
const DEFAULT_GROQ_KEY = process.env.GROQ_API_KEY || '';

function getGroqKey() {
  return (state.groq_api_key || DEFAULT_GROQ_KEY || '').trim();
}

async function generateAiComments(title, platform = 'Instagram', count = 5) {
  const apiKey = getGroqKey();
  const cleanTitle = (title && typeof title === 'string') ? title.trim() : 'viral reel';
  const targetCount = Math.max(1, Math.min(count || 5, 50));

  if (apiKey) {
    try {
      const systemPrompt = `You are an API that generates realistic, casual human comments on ${platform || 'Instagram'} (TikTok / Instagram Reels).
Output format: JSON object with key "comments" containing an array of exactly ${targetCount} strings.
Example: {"comments": ["comment 1", "comment 2", "comment 3"]}

CRITICAL HUMAN COMMENTING RULES:
1. Content-Relevant: Directly react to or reference the topic, audio, or caption: "${cleanTitle}".
2. Natural Slang & Vibe: Use organic internet slang naturally (e.g. "bro", "nah fr", "lowkey", "ngl", "wait", "w", "fire", "w edit", "crazy", "smh", "so real").
3. Casual Lowercase Typing: Type mostly in lowercase without formal punctuation, like real mobile users.
4. Random Subtle Typos: In 1 or 2 comments out of every 5, include a slight human typo or shorthand (e.g. "teh", "actaully", "ur", "sooo", "prob", "rn", "alot", "dats").
5. Varied Styles: Mix short 2-3 word reactions ("nah this hard 😭"), short questions ("wait what audio is this??"), hype ("the edit was clean af"), and relatable banter.
6. Zero AI Clichés: NEVER say "Great video!", "Nice content", "Love this", or formal complete sentences. No hashtags, no quotes.`;

      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate ${targetCount} comments for video: "${cleanTitle}".` }
        ],
        temperature: 0.88,
        response_format: { type: 'json_object' }
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data?.choices?.[0]?.message?.content) {
        const parsed = JSON.parse(response.data.choices[0].message.content);
        if (Array.isArray(parsed.comments) && parsed.comments.length > 0) {
          return parsed.comments.slice(0, targetCount);
        }
      }
    } catch (err) {
      console.error('Groq AI comments generation notice:', err.message);
    }
  }

  // Fallback humanized comments pool if API key is missing or offline
  const fallbackTemplates = [
    "wait this is actually so clean",
    "nah fr tho 😭",
    "bro cooked with this one",
    "lowkey need part 2 asap",
    "the audio fits so well",
    "w post ngl",
    "sooo good actaully",
    "underrated rn",
    "who else is seeing this on their fyp 🙌",
    "wait whats the song name??"
  ];
  const shuffled = fallbackTemplates.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, targetCount);
}

// ─────────────────────────────────────────────────────────────────
//  3-STAGE VIRAL S-CURVE & ADAPTIVE PACING CALCULATOR
// ─────────────────────────────────────────────────────────────────
function calculatePacingProfile(camp) {
  const currentHour = new Date().getHours();
  const viewsDelivered = camp.views_delivered || 0;
  const totalViews = Math.max(camp.total_views || 1000, 1);
  const progress = Math.min(viewsDelivered / totalViews, 1.0);
  const minViews = getServiceMin(camp.view_service, 100);
  const remaining = Math.max(0, totalViews - viewsDelivered);

  // Timezone / Circadian scale (Night dip -65%, Peak surge +25%)
  let circadianMultiplier = 1.0;
  if (currentHour >= 1 && currentHour <= 6) {
    circadianMultiplier = 0.35; // Night sleeping dip
  } else if ((currentHour >= 12 && currentHour <= 14) || (currentHour >= 18 && currentHour <= 22)) {
    circadianMultiplier = 1.25; // Peak scrolling hours
  }

  // Calculate dynamic pacing duration based on user-selected days_to_run
  const daysToRun = Math.max(1, camp.days_to_run || 1);
  const activeHoursPerDay = camp.peak_only ? 11 : 24;
  const totalActiveSeconds = daysToRun * activeHoursPerDay * 3600;
  const avgPulseSize = Math.max(minViews * 1.5, 200);
  const estimatedTotalPulses = Math.max(5, Math.ceil(totalViews / avgPulseSize));
  const baseTargetIntervalSecs = Math.max(900, Math.floor(totalActiveSeconds / estimatedTotalPulses));

  const mode = camp.delivery_mode || 'fresh_scurve';

  if (mode === 'turbo') {
    const basePulse = Math.round(minViews * 4 + Math.random() * 400);
    return {
      pulseBurst: Math.max(minViews, Math.min(remaining, basePulse)),
      saveRatio: 0.006 + Math.random() * 0.003,
      commentRatio: 0.001 + Math.random() * 0.001,
      shareRatio: 0.002 + Math.random() * 0.002,
      baseSleepSecs: Math.round(600 + Math.random() * 400), // 10-16 mins
      stageName: 'Turbo Mode'
    };
  }

  if (mode === 'circadian') {
    const basePulse = Math.round(minViews + Math.random() * 200);
    return {
      pulseBurst: Math.max(minViews, Math.min(remaining, Math.round(basePulse * circadianMultiplier))),
      saveRatio: 0.005 + Math.random() * 0.003,
      commentRatio: 0.0008 + Math.random() * 0.0006,
      shareRatio: 0.0015 + Math.random() * 0.0015,
      baseSleepSecs: Math.round((baseTargetIntervalSecs * 1.05 + Math.random() * 300) / circadianMultiplier),
      stageName: 'Circadian Wave'
    };
  }

  // DEFAULT & RECOMMENDED: 'fresh_scurve' (3-Stage Viral Growth scaled by days_to_run)
  if (progress < 0.15) {
    // STAGE 1: SEED DISCOVERY PHASE (0% - 15%)
    const basePulse = Math.round(minViews + Math.random() * 150);
    const pulseBurst = Math.max(minViews, Math.min(remaining, Math.round(basePulse * circadianMultiplier)));
    return {
      pulseBurst,
      saveRatio: 0.011 + Math.random() * 0.004,      // 1.1% - 1.5% (Early High-Trust Bookmarks)
      commentRatio: 0.0006 + Math.random() * 0.0004, // 0.06% - 0.10%
      shareRatio: 0.0010 + Math.random() * 0.0010,   // 0.10% - 0.20%
      baseSleepSecs: Math.round((baseTargetIntervalSecs * 1.35 + Math.random() * 300) / circadianMultiplier),
      stageName: 'Stage 1: Seed Discovery'
    };
  } else if (progress < 0.80) {
    // STAGE 2: FYP VIRAL BREAKOUT (15% - 80%)
    const scaleFactor = 1.8 + (progress * 2.0);
    const basePulse = Math.round(minViews * scaleFactor + Math.random() * 250);
    const pulseBurst = Math.max(minViews, Math.min(remaining, Math.round(basePulse * circadianMultiplier)));
    return {
      pulseBurst,
      saveRatio: 0.007 + Math.random() * 0.003,      // 0.70% - 1.00%
      commentRatio: 0.0010 + Math.random() * 0.0008, // 0.10% - 0.18%
      shareRatio: 0.0035 + Math.random() * 0.0020,   // 0.35% - 0.55%
      baseSleepSecs: Math.round((baseTargetIntervalSecs * 0.85 + Math.random() * 240) / circadianMultiplier),
      stageName: 'Stage 2: FYP Viral Breakout'
    };
  } else {
    // STAGE 3: PLATEAU & LONG-TAIL TAIL (80% - 100%)
    const basePulse = Math.round(minViews + Math.random() * 180);
    const pulseBurst = remaining > 0 && remaining < minViews ? minViews : Math.max(minViews, Math.min(remaining, basePulse));
    return {
      pulseBurst,
      saveRatio: 0.005 + Math.random() * 0.002,      // 0.50% - 0.70%
      commentRatio: 0.0007 + Math.random() * 0.0005, // 0.07% - 0.12%
      shareRatio: 0.0015 + Math.random() * 0.0015,   // 0.15% - 0.30%
      baseSleepSecs: Math.round((baseTargetIntervalSecs * 1.15 + Math.random() * 300) / circadianMultiplier),
      stageName: 'Stage 3: Viral Plateau'
    };
  }
}

async function runDripWorker(url, abortSignal) {
  const camp = state.campaigns[url];
  if (!camp) return;

  const titleDisplay = camp.video_title ? camp.video_title.slice(0, 40) : url.slice(-28);
  logMsg(`🚀 [${camp.platform} / ${camp.delivery_mode || 'fresh_scurve'}] Worker Active → ${titleDisplay} | ${camp.total_views} views target`, 'info', url);

  // Initialize Deficit Accumulators if missing (Rule F: Fractional Deficit Pool)
  if (camp.likes_deficit === undefined) camp.likes_deficit = 0;
  if (camp.comments_deficit === undefined) camp.comments_deficit = 0;
  if (camp.shares_deficit === undefined) camp.shares_deficit = 0;
  if (camp.saves_deficit === undefined) camp.saves_deficit = 0;

  while (true) {
    if (abortSignal.aborted) {
      logMsg(`⏹ Campaign stopped: ${titleDisplay}`, 'warn', url);
      camp.status = 'Stopped';
      activeWorkers.delete(url);
      saveState();
      broadcastEvent('campaign_update', url);
      return;
    }

    const currentHour = new Date().getHours();

    if (camp.peak_only) {
      if (currentHour < 12 || currentHour > 23) {
        logMsg(`🌙 Peak-Hours Mode active — sleeping until peak window (12PM - 11PM)`, 'info', url);
        for (let s = 0; s < 1800; s++) {
          if (abortSignal.aborted) {
            activeWorkers.delete(url);
            return;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        continue;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // DUAL-VERIFICATION & PANEL ORDER STATUS CHECK
    // ─────────────────────────────────────────────────────────────────
    if (camp.last_view_order && camp.last_order_timestamp) {
      const ts = new Date(camp.last_order_timestamp).getTime();
      if (!isNaN(ts)) {
        const elapsedMs = Date.now() - ts;

        try {
          const status = await smmCheckOrder(camp.last_view_order);
          logMsg(`🔍 Live Order #${camp.last_view_order} Status: [${status}] (${(elapsedMs / 60000).toFixed(0)}m ago)`, 'info', url);

          if (status === 'Completed') {
            camp.last_view_order = null; // Clean completion, ready for next pulse
          } else if (status === 'Partial') {
            logMsg(`🔄 Order #${camp.last_view_order} reported Partial delivery by panel — syncing deficit pool...`, 'info', url);
            camp.last_view_order = null;
          } else if (status === 'Canceled') {
            logMsg(`⚠️ Order #${camp.last_view_order} was Canceled by SMM panel`, 'warn', url);
            if (camp.backup_view_service && camp.backup_view_service !== camp.view_service) {
              logMsg(`🛡️ [Auto-Failover] Switching from Service #${camp.view_service} to Backup Service #${camp.backup_view_service}!`, 'warn', url);
              camp.view_service = camp.backup_view_service;
            }
            camp.last_view_order = null;
          } else if ((status === 'Pending' || status === 'In progress' || status === 'Processing') && elapsedMs > 20 * 60 * 1000) {
            logMsg(`⚠️ Order #${camp.last_view_order} stuck in [${status}] for >20 mins!`, 'warn', url);
            if (camp.backup_view_service && camp.backup_view_service !== camp.view_service) {
              try { await smmCancelOrder(camp.last_view_order); } catch (e) {}
              logMsg(`🛡️ [Auto-Failover] Switching to Backup View Service #${camp.backup_view_service}`, 'warn', url);
              camp.view_service = camp.backup_view_service;
              camp.last_view_order = null;
            }
          }
        } catch (err) {
          logMsg(`⚠️ Order status check notice: ${err.message}`, 'warn', url);
        }
      }
    }

    await updateCampaignLiveStats(camp);

    const minViews = getServiceMin(camp.view_service, 100);
    const isCompleted = (camp.views_delivered >= camp.total_views) || 
      ((camp.total_views - camp.views_delivered < minViews) && (camp.views_delivered >= camp.total_views * 0.95));

    if (isCompleted) {
      logMsg(`🎉 Campaign COMPLETED: ${titleDisplay} (${camp.views_delivered}/${camp.total_views} views delivered)`, 'success', url);
      camp.status = 'Completed';
      activeWorkers.delete(url);
      saveState();
      broadcastEvent('campaign_complete', url);
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // DYNAMIC PACING PROFILE & 3-STAGE S-CURVE EXECUTION
    // ─────────────────────────────────────────────────────────────────
    const profile = calculatePacingProfile(camp);
    const pulseBurst = profile.pulseBurst;
    camp.current_stage = profile.stageName;

    if (camp.view_service && pulseBurst > 0) {
      const void_id = await smmPlaceOrderWithRetry(camp.view_service, url, pulseBurst, 'VIEWS');
      if (void_id) {
        camp.last_view_order = void_id;
        camp.last_order_timestamp = new Date().toISOString();
        camp.views_delivered += pulseBurst;

        // Dynamic Gaussian noise on user engagement rate (Human "Messiness")
        const baseRate = (camp.engagement_rate || 2.8) / 100;
        const jitteredLikesRate = Math.max(0.012, Math.min(0.065, baseRate + gaussianRandom(0, 0.0035)));
        const jitteredCommentsRate = Math.max(0.0003, profile.commentRatio * (1 + gaussianRandom(0, 0.20)));
        const jitteredSharesRate = Math.max(0.0005, profile.shareRatio * (1 + gaussianRandom(0, 0.25)));
        const jitteredSavesRate = Math.max(0.002, profile.saveRatio * (1 + gaussianRandom(0, 0.18)));

        camp.likes_deficit += pulseBurst * jitteredLikesRate;
        camp.comments_deficit += pulseBurst * jitteredCommentsRate;
        camp.shares_deficit += pulseBurst * jitteredSharesRate;
        camp.saves_deficit += pulseBurst * jitteredSavesRate;

        saveState();
        broadcastEvent('campaign_update', url);

        // ─────────────────────────────────────────────────────────────
        // REACTION LAG STAGGER: Wait 2-4 mins for realistic human watch time
        // ─────────────────────────────────────────────────────────────
        const staggerSecs = Math.round(120 + Math.random() * 120); // 2 - 4 minutes
        logMsg(`⏳ [Reaction Stagger] View burst (${pulseBurst}) registered — waiting ${staggerSecs}s for human reaction lag before firing reactions...`, 'info', url);
        for (let w = 0; w < staggerSecs; w++) {
          if (abortSignal.aborted) return;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    // DISPATCH LIKES ONCE DEFICIT >= MINIMUM (Dynamic from Panel Service)
    const minLikes = getServiceMin(camp.like_service, 10);
    if (camp.like_service && camp.likes_deficit >= minLikes) {
      const dispatchQty = Math.floor(camp.likes_deficit);
      const loid = await smmPlaceOrderWithRetry(camp.like_service, url, dispatchQty, 'LIKES');
      if (loid) {
        camp.last_like_order = loid;
        camp.likes_delivered = (camp.likes_delivered || 0) + dispatchQty;
        camp.likes_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
    }

    // DISPATCH COMMENTS ONCE DEFICIT >= MINIMUM (Dynamic from Panel Service + AI Generation)
    const minComments = getServiceMin(camp.comment_service, 5);
    if (camp.comment_service && camp.comments_deficit >= minComments) {
      const dispatchQty = Math.floor(camp.comments_deficit);
      
      // Auto-generate realistic AI comments based on video title & topic
      let generatedComments = [];
      try {
        generatedComments = await generateAiComments(camp.video_title, camp.platform, dispatchQty);
        logMsg(`🤖 [AI Comments] Generated ${generatedComments.length} contextual comments for "${(camp.video_title || 'post').slice(0, 32)}..."`, 'info', url);
      } catch (e) {
        generatedComments = [];
      }

      const coid = await smmPlaceOrderWithRetry(camp.comment_service, url, dispatchQty, 'COMMENTS', 4, generatedComments);
      if (coid) {
        camp.comments_delivered = (camp.comments_delivered || 0) + dispatchQty;
        camp.comments_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
    }

    // DISPATCH SHARES ONCE DEFICIT >= MINIMUM (Dynamic from Panel Service)
    const minShares = getServiceMin(camp.share_service, 5);
    if (camp.share_service && camp.shares_deficit >= minShares) {
      const dispatchQty = Math.floor(camp.shares_deficit);
      const soid = await smmPlaceOrderWithRetry(camp.share_service, url, dispatchQty, 'SHARES');
      if (soid) {
        camp.shares_delivered = (camp.shares_delivered || 0) + dispatchQty;
        camp.shares_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
    }

    // DISPATCH SAVES ONCE DEFICIT >= MINIMUM (Dynamic from Panel Service)
    const minSaves = getServiceMin(camp.save_service, 5);
    if (camp.save_service && camp.saves_deficit >= minSaves) {
      const dispatchQty = Math.floor(camp.saves_deficit);
      const svid = await smmPlaceOrderWithRetry(camp.save_service, url, dispatchQty, 'SAVES');
      if (svid) {
        camp.saves_delivered = (camp.saves_delivered || 0) + dispatchQty;
        camp.saves_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // POISSON-DISTRIBUTED JITTER INTERVAL (Eliminates metronomes)
    // ─────────────────────────────────────────────────────────────
    const lambda = profile.baseSleepSecs || 1200;
    const u = Math.max(0.0001, Math.random());
    let sleepSecs = Math.round(-Math.log(u) * (lambda * 0.6) + (lambda * 0.4));
    sleepSecs = Math.max(840, Math.min(2400, sleepSecs)); // Clamped between 14m and 40m

    logMsg(`💤 Pulse complete [${profile.stageName}] — next pulse in ${(sleepSecs / 60).toFixed(1)} mins`, 'info', url);
    for (let s = 0; s < sleepSecs; s++) {
      if (abortSignal.aborted) return;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function startActiveCampaigns() {
  for (const url in state.campaigns) {
    const camp = state.campaigns[url];
    if (camp.status === 'Running') {
      const controller = new AbortController();
      activeWorkers.set(url, controller);
      runDripWorker(url, controller.signal);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
//  HTTP REST & SSE SERVER
// ─────────────────────────────────────────────────────────────────
function startServer() {
  loadState();

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', data: { state } })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET') {
      if (!pathname.startsWith('/api')) {
        const distDir = path.join(__dirname, 'dist');
        let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(distDir, 'index.html');
        }
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.html': 'text/html; charset=UTF-8',
            '.js': 'application/javascript; charset=UTF-8',
            '.css': 'text/css; charset=UTF-8',
            '.json': 'application/json; charset=UTF-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
          };
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/health') {
        res.end(JSON.stringify({ ok: true, name: 'SMMBot Enterprise API', version: '2.0.0', has_key: Boolean(state.api_key) }));
      } else if (pathname === '/api/state' || pathname === '/api/get_config') {
        res.end(JSON.stringify({
          api_key: state.api_key || '',
          api_url: state.api_url || 'https://marketerum.com/api/v2',
          api_proxy: state.api_proxy || '',
          auto_proxy: state.auto_proxy || null,
          custom_pkr_rate: state.custom_pkr_rate || 297,
          groq_api_key: state.groq_api_key || DEFAULT_GROQ_KEY || '',
          has_groq_key: Boolean(state.groq_api_key || DEFAULT_GROQ_KEY),
          has_key: Boolean(state.api_key),
          services: state.services || [],
          campaigns: state.campaigns || {},
          logs: state.logs || [],
          order_history: state.order_history || []
        }));
      } else if (pathname === '/api/balance' || pathname === '/api/get_balance') {
        smmGetBalance().then(b => {
          const pkr = b.balance * (state.custom_pkr_rate || 297);
          res.end(JSON.stringify({ ok: true, usd: b.balance, pkr, currency: b.currency }));
        }).catch(e => res.end(JSON.stringify({ ok: false, error: e.message })));
      } else if (pathname === '/api/services' || pathname === '/api/get_services') {
        res.end(JSON.stringify(state.services || []));
      } else if (pathname === '/api/campaigns' || pathname === '/api/get_campaigns') {
        res.end(JSON.stringify(state.campaigns || {}));
      } else if (pathname === '/api/logs' || pathname === '/api/get_logs') {
        res.end(JSON.stringify(state.logs || []));
      } else if (pathname === '/api/order_history' || pathname === '/api/get_order_history') {
        res.end(JSON.stringify(state.order_history || []));
      } else if (pathname === '/api/analytics' || pathname === '/api/get_analytics') {
        res.end(JSON.stringify(state.analytics || {}));
      } else if (pathname === '/api/apify/stats' || pathname === '/api/get_apify_stats') {
        getApifyPoolStats(true).then(stats => {
          res.end(JSON.stringify(stats));
        }).catch(e => res.end(JSON.stringify({ ok: false, error: e.message })));
      } else if (pathname === '/api/export_services_csv') {
        const rows = ['ID,Service_ID,Name,Rate_USD,Rate_PKR,Min,Max'];
        state.services.forEach(s => rows.push(`"${s.id}","${s.service_id}","${s.name}",${s.rate_usd},${s.rate_pkr},${s.min_order},${s.max_order}`));
        res.end(JSON.stringify({ csv: rows.join('\n') }));
      } else if (pathname === '/api/export_logs_csv') {
        const rows = ['Timestamp,Level,Message,URL'];
        state.logs.forEach(l => rows.push(`"${l.timestamp}","${l.level}","${l.message.replace(/"/g, '""')}","${l.url || ''}"`));
        res.end(JSON.stringify({ csv: rows.join('\n') }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ ok: false, error: 'Endpoint not found' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');
        let data = {};
        try { if (body) data = JSON.parse(body); } catch (e) {}

        try {
          if (pathname === '/api/verify_api_key' || pathname === '/api/verify_key') {
            const keyToTest = data.api_key || state.api_key;
            const urlToTest = data.api_url || state.api_url;
            if (!keyToTest) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'API key is empty' }));
              return;
            }
            try {
              const { balance, currency } = await smmGetBalance(keyToTest, urlToTest);
              const pkr = balance * (state.custom_pkr_rate || 297);
              state.api_key = keyToTest;
              state.api_url = urlToTest;
              saveState();
              logMsg(`✅ API Verified — Balance: $${balance.toFixed(4)} (PKR ${pkr.toFixed(0)})`, 'success');
              res.end(JSON.stringify({ ok: true, balance_usd: balance, balance_pkr: pkr, currency }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
          }

          if (pathname === '/api/config' || pathname === '/api/save_config') {
            if (data.api_key !== undefined) state.api_key = data.api_key.trim();
            if (data.api_url !== undefined) state.api_url = data.api_url.trim();
            if (data.api_proxy !== undefined) state.api_proxy = data.api_proxy.trim();
            if (data.custom_pkr_rate !== undefined) state.custom_pkr_rate = parseFloat(data.custom_pkr_rate) || 297;
            saveState();
            logMsg('⚙️ System configuration updated', 'info');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/order/place' || pathname === '/api/place_order') {
            const order_id = await smmPlaceOrder(data.service_id, data.link, data.quantity);
            res.end(JSON.stringify({ ok: true, order_id }));
            return;
          }

          if (pathname === '/api/order/drip' || pathname === '/api/place_drip_order') {
            const order_id = await smmPlaceOrder(data.service_id, data.link, data.quantity, data.runs, data.interval);
            res.end(JSON.stringify({ ok: true, order_id }));
            return;
          }

          if (pathname === '/api/order/check' || pathname === '/api/check_order') {
            const status = await smmCheckOrder(data.order_id);
            res.end(JSON.stringify({ ok: true, status }));
            return;
          }

          if (pathname === '/api/order/multi_status' || pathname === '/api/multi_status') {
            const statuses = await smmMultiStatus(data.order_ids || []);
            res.end(JSON.stringify(statuses));
            return;
          }

          if (pathname === '/api/video/metrics' || pathname === '/api/fetch_metadata') {
            const targetUrl = data.url || data.link || data.target || (data.payload && data.payload.url) || '';
            const targetPlatform = data.platform || (data.payload && data.payload.platform) || 'TikTok';
            logMsg(`🔍 API Scrape Request for URL: ${targetUrl} [${targetPlatform}]`, 'info');
            const meta = await fetchLiveMetadata(targetUrl, targetPlatform);
            logMsg(`📊 API Scrape Result: ${JSON.stringify(meta)}`, 'info');
            res.end(JSON.stringify({ ok: true, meta }));
            return;
          }

          if (pathname === '/api/scan_proxy') {
            const proxy = await findWorkingProxy();
            res.end(JSON.stringify({ ok: true, proxy }));
            return;
          }

          if (pathname === '/api/clear_proxy') {
            state.api_proxy = '';
            state.auto_proxy = null;
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/apify/keys' || pathname === '/api/save_apify_keys') {
            const keysToSave = Array.isArray(data.keys) ? data.keys : [];
            saveApifyKeys(keysToSave);
            const stats = await getApifyPoolStats(true);
            logMsg(`🔄 Apify Key Pool updated: ${stats.total_accounts} accounts registered`, 'success');
            res.end(JSON.stringify(stats));
            return;
          }

          if (pathname === '/api/apify/add_key') {
            const newKey = (data.key || data.new_key || '').trim();
            if (!newKey) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'Key cannot be empty' }));
              return;
            }
            const current = readApifyKeys();
            if (!current.includes(newKey)) {
              current.push(newKey);
              saveApifyKeys(current);
            }
            const stats = await getApifyPoolStats(true);
            logMsg(`➕ Apify Key added: ${stats.total_accounts} accounts total`, 'success');
            res.end(JSON.stringify(stats));
            return;
          }

          if (pathname === '/api/apify/delete_key') {
            const keyToDelete = (data.key || '').trim();
            const current = readApifyKeys();
            const filtered = current.filter(k => k !== keyToDelete);
            saveApifyKeys(filtered);
            const stats = await getApifyPoolStats(true);
            logMsg(`🗑️ Apify Key removed: ${stats.total_accounts} accounts remaining`, 'info');
            res.end(JSON.stringify(stats));
            return;
          }

          if (pathname === '/api/campaign/cancel_stuck_order_cmd' || pathname === '/api/cancel_stuck_order_cmd') {
            const camp = state.campaigns[data.url];
            if (camp) {
              const lastOrder = camp.last_view_order || camp.last_like_order;
              if (lastOrder) {
                try {
                  await smmCancelOrder(lastOrder);
                  logMsg(`🚫 Sent API cancel request to Marketerum for order #${lastOrder}`, 'warn', data.url);
                } catch (e) {
                  logMsg(`⚠️ SMM Panel cancel request notice: ${e.message}`, 'warn', data.url);
                }
              }
              camp.last_view_order = null;
              camp.status = 'Stopped';
              logMsg(`🚫 Unstuck lock reset & campaign stopped for ${data.url.slice(-25)}`, 'warn', data.url);
              saveState();
            }
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/campaign/refill' || pathname === '/api/refill') {
            const camp = state.campaigns[data.url];
            if (camp && camp.last_view_order) {
              try {
                const resData = await smmRefillOrder(camp.last_view_order);
                logMsg(`🔁 Refill requested for order #${camp.last_view_order}`, 'success', data.url);
                res.end(JSON.stringify({ ok: true, data: resData }));
                return;
              } catch (e) {
                res.end(JSON.stringify({ ok: false, error: e.message }));
                return;
              }
            }
            res.end(JSON.stringify({ ok: false, error: 'No recent view order to refill' }));
            return;
          }

          if (pathname === '/api/ai/generate_comments') {
            const title = data.title || data.caption || '';
            const platform = data.platform || 'Instagram';
            const count = parseInt(data.count) || 5;
            const comments = await generateAiComments(title, platform, count);
            res.end(JSON.stringify({ ok: true, comments }));
            return;
          }

          if (pathname === '/api/ai/config') {
            if (data.groq_api_key !== undefined) {
              state.groq_api_key = data.groq_api_key.trim();
              saveState();
              logMsg('🤖 Groq AI comments configuration updated', 'success');
            }
            res.end(JSON.stringify({ ok: true, has_groq_key: Boolean(state.groq_api_key || DEFAULT_GROQ_KEY) }));
            return;
          }

          if (pathname === '/api/campaign/launch' || pathname === '/api/launch_campaign') {
            const { url, platform, delivery_mode, view_service, like_service, comment_service, share_service, save_service, total_views, days_to_run, video_title, video_author, start_views, start_likes, peak_only } = data;
            if (!url || !total_views) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'url and total_views are required' }));
              return;
            }
            const camp = {
              id: uuidv4(),
              url,
              platform: platform || 'TikTok',
              delivery_mode: delivery_mode || 'Organic Growth',
              view_service: view_service || '',
              like_service: like_service || '',
              comment_service: comment_service || '',
              share_service: share_service || '',
              save_service: save_service || '',
              total_views: parseInt(total_views),
              days_to_run: parseFloat(days_to_run) || 7.0,
              peak_only: Boolean(peak_only),
              views_delivered: 0,
              likes_delivered: 0,
              comments_delivered: 0,
              shares_delivered: 0,
              saves_delivered: 0,
              likes_deficit: 0,
              comments_deficit: 0,
              shares_deficit: 0,
              saves_deficit: 0,
              status: 'Running',
              video_title: video_title || '',
              video_author: video_author || '',
              start_views: start_views !== undefined ? parseInt(start_views) : null,
              start_likes: start_likes !== undefined ? parseInt(start_likes) : null,
              created_at: new Date().toISOString()
            };

            const existingController = activeWorkers.get(url);
            if (existingController) {
              existingController.abort();
              activeWorkers.delete(url);
            }

            state.campaigns[url] = camp;
            saveState();

            const controller = new AbortController();
            activeWorkers.set(url, controller);
            runDripWorker(url, controller.signal);

            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/campaign/stop' || pathname === '/api/stop_campaign') {
            const controller = activeWorkers.get(data.url);
            if (controller) { controller.abort(); activeWorkers.delete(data.url); }
            if (state.campaigns[data.url]) state.campaigns[data.url].status = 'Stopped';
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/campaign/resume' || pathname === '/api/resume_campaign') {
            if (state.campaigns[data.url]) {
              state.campaigns[data.url].status = 'Running';
              saveState();
              const controller = new AbortController();
              activeWorkers.set(data.url, controller);
              runDripWorker(data.url, controller.signal);
            }
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/campaign/edit' || pathname === '/api/edit_campaign') {
            const { url, payload } = data;
            const camp = state.campaigns[url];
            if (camp) {
              if (payload.total_views !== undefined) camp.total_views = parseInt(payload.total_views);
              if (payload.days_to_run !== undefined) camp.days_to_run = parseFloat(payload.days_to_run);
              if (payload.engagement_rate !== undefined) camp.engagement_rate = parseFloat(payload.engagement_rate);
              if (payload.view_service !== undefined) camp.view_service = payload.view_service;
              if (payload.like_service !== undefined) camp.like_service = payload.like_service;
              if (payload.comment_service !== undefined) camp.comment_service = payload.comment_service;
              if (payload.share_service !== undefined) camp.share_service = payload.share_service;
              if (payload.save_service !== undefined) camp.save_service = payload.save_service;
              if (payload.peak_only !== undefined) camp.peak_only = Boolean(payload.peak_only);
              saveState();
              logMsg(`✏️ Campaign updated for ${url.slice(-25)}`, 'info', url);
              broadcastEvent('campaign_update', url);
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.end(JSON.stringify({ ok: false, error: 'Campaign not found' }));
            }
            return;
          }

          if (pathname === '/api/export_services_csv') {
            const rows = ['ID,Service_ID,Name,Rate_USD,Rate_PKR,Min,Max'];
            state.services.forEach(s => rows.push(`"${s.id}","${s.service_id}","${s.name}",${s.rate_usd},${s.rate_pkr},${s.min_order},${s.max_order}`));
            res.end(JSON.stringify({ csv: rows.join('\n') }));
            return;
          }

          if (pathname === '/api/export_logs_csv') {
            const rows = ['Timestamp,Level,Message,URL'];
            state.logs.forEach(l => rows.push(`"${l.timestamp}","${l.level}","${l.message.replace(/"/g, '""')}","${l.url || ''}"`));
            res.end(JSON.stringify({ csv: rows.join('\n') }));
            return;
          }

          if (pathname === '/api/campaign/delete' || pathname === '/api/delete_campaign') {
            const controller = activeWorkers.get(data.url);
            if (controller) { controller.abort(); activeWorkers.delete(data.url); }
            delete state.campaigns[data.url];
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/service/lookup' || pathname === '/api/lookup_service') {
            const service_id = data.service_id || data.id;
            if (!service_id) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'service_id is required' }));
              return;
            }
            try {
              const servicesList = await smmGetServices();
              const found = servicesList.find(s => String(s.service) === String(service_id));
              if (found) {
                const rateUsd = parseFloat(found.rate || 0);
                const ratePkr = rateUsd * (state.custom_pkr_rate || 297);
                const minOrder = parseInt(found.min || 1);
                const maxOrder = parseInt(found.max || 1000000);
                res.end(JSON.stringify({
                  ok: true,
                  found: {
                    service_id: String(found.service),
                    name: found.name,
                    category: found.category || 'General',
                    rate_usd: rateUsd,
                    rate_pkr: ratePkr,
                    min_order: minOrder,
                    max_order: maxOrder,
                    type: found.type || 'Default'
                  }
                }));
              } else {
                res.end(JSON.stringify({ ok: false, error: `Service #${service_id} not found on panel` }));
              }
            } catch (err) {
              res.writeHead(500);
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
          }

          if (pathname === '/api/service/sync' || pathname === '/api/sync_services') {
            try {
              const servicesList = await smmGetServices();
              let updatedCount = 0;
              state.services.forEach(s => {
                const found = servicesList.find(item => String(item.service) === String(s.service_id));
                if (found) {
                  if (found.rate) s.rate_usd = parseFloat(found.rate);
                  s.rate_pkr = s.rate_usd * (state.custom_pkr_rate || 297);
                  if (found.min) s.min_order = parseInt(found.min);
                  if (found.max) s.max_order = parseInt(found.max);
                  if (found.name && !s.name) s.name = found.name;
                  updatedCount++;
                }
              });
              saveState();
              logMsg(`🔄 Synced ${updatedCount} services with live panel minimums & rates`, 'success');
              res.end(JSON.stringify({ ok: true, updated: updatedCount }));
            } catch (err) {
              res.writeHead(500);
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
          }

          if (pathname === '/api/service/add' || pathname === '/api/add_service') {
            const { service_id, name } = data;
            if (!service_id) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'service_id is required' }));
              return;
            }
            try {
              const servicesList = await smmGetServices();
              const found = servicesList.find(s => String(s.service) === String(service_id));
              const svcName = (name && name.trim()) ? name.trim() : (found && found.name ? found.name : `Service #${service_id}`);
              const rateUsd = found ? parseFloat(found.rate || 0) : 0.05;
              const ratePkr = rateUsd * (state.custom_pkr_rate || 297);
              const minOrder = found ? parseInt(found.min || 1) : 1;
              const maxOrder = found ? parseInt(found.max || 1000000) : 1000000;

              const existingIdx = state.services.findIndex(s => String(s.service_id) === String(service_id));
              const svcObj = {
                id: existingIdx >= 0 ? state.services[existingIdx].id : uuidv4(),
                service_id: String(service_id),
                name: svcName,
                rate_usd: rateUsd,
                rate_pkr: ratePkr,
                min_order: minOrder,
                max_order: maxOrder
              };

              if (existingIdx >= 0) {
                state.services[existingIdx] = svcObj;
              } else {
                state.services.push(svcObj);
              }
              saveState();
              logMsg(`✅ Service #${service_id} registered (${svcName}) — Min Order: ${minOrder}`, 'success');
              res.end(JSON.stringify({ ok: true, service: svcObj }));
            } catch (err) {
              res.writeHead(500);
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
          }

          if (pathname === '/api/service/delete' || pathname === '/api/delete_service') {
            state.services = state.services.filter(s => s.id !== data.id && s.service_id !== data.service_id);
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/recalculate_service_prices') {
            state.services.forEach(s => {
              s.rate_pkr = s.rate_usd * (state.custom_pkr_rate || 297);
            });
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (pathname === '/api/clear_order_history') {
            state.order_history = [];
            saveState();
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.writeHead(404);
          res.end(JSON.stringify({ ok: false, error: 'Unknown POST route' }));

        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    }
  });

  server.listen(PORT, () => {
    logMsg(`🚀 [SMMBot Enterprise API] Listening on port ${PORT}`, 'success');
    startActiveCampaigns();
  });
}

startServer();

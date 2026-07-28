const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');
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

async function smmApiCall(action, params = {}, customKey = null, customUrl = null) {
  const key = customKey || state.api_key;
  const url = customUrl || state.api_url || 'https://marketerum.com/api/v2';
  if (!key) throw new Error('API key is empty. Please enter and save your Marketerum API key in Settings.');

  const payload = new URLSearchParams({ key, action, ...params });
  const cfg = getRequestConfig({ 'Content-Type': 'application/x-www-form-urlencoded' }, false);
  const res = await axios.post(url, payload.toString(), cfg);
  return res.data;
}

async function smmGetBalance(customKey = null, customUrl = null) {
  const now = Date.now();
  if (!customKey && cachedBalance && (now - cachedBalanceTime < 10000)) {
    return cachedBalance;
  }
  const data = await smmApiCall('balance', {}, customKey, customUrl);
  if (data.error) throw new Error(data.error);
  const result = { balance: parseFloat(data.balance || 0), currency: data.currency || 'USD' };
  if (!customKey) {
    cachedBalance = result;
    cachedBalanceTime = now;
  }
  return result;
}

async function smmGetServices() {
  const data = await smmApiCall('services');
  if (Array.isArray(data)) return data;
  if (data.error) throw new Error(data.error);
  return [];
}

async function smmPlaceOrder(service_id, link, quantity, runs = null, interval = null) {
  const params = { service: service_id, link, quantity };
  if (runs) params.runs = runs;
  if (interval) params.interval = interval;

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
async function smmPlaceOrderWithRetry(serviceId, url, qty, typeLabel, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const orderId = await smmPlaceOrder(serviceId, url, qty);
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
//  METADATA SCRAPER
// ─────────────────────────────────────────────────────────────────
function getPythonExecutablePath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return 'python3';
}

function fetchPythonMetadata(url, platform, forcedProxy = null) {
  return new Promise((resolve) => {
    const scraperPath = path.join(__dirname, 'scraper.py');
    const pyPath = getPythonExecutablePath();
    const activeProxy = forcedProxy || getProxy() || '';

    exec(`"${pyPath}" "${scraperPath}" "${url}" "${platform}" "${activeProxy}"`, { timeout: 25000, killSignal: 'SIGKILL' }, (error1, stdout1) => {
      if (!error1) {
        try {
          const info = JSON.parse(stdout1.trim());
          if (info && (info.title || info.views !== undefined)) {
            resolve(info);
            return;
          }
        } catch (e) {}
      }

      exec(`python "${scraperPath}" "${url}" "${platform}" "${activeProxy}"`, { timeout: 25000, killSignal: 'SIGKILL' }, (error2, stdout2) => {
        if (!error2) {
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
  let proxy = getProxy();
  if (!proxy) {
    proxy = await findWorkingProxy();
  }
  let pyMeta = await fetchPythonMetadata(url, platform, proxy);

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

  const cleanId = url.split('/')[-1] ? url.split('/').filter(Boolean).pop().split('?')[0] : 'post';
  const title = (pyMeta.title && pyMeta.title.trim()) ? pyMeta.title.trim() : `${platform || 'Social'} Video (${cleanId})`;
  const author = (pyMeta.author && pyMeta.author.trim()) ? pyMeta.author.trim() : 'creator';

  const views = pyMeta.views !== null ? parseInt(pyMeta.views) : 0;
  const likes = pyMeta.likes !== null ? parseInt(pyMeta.likes) : Math.max(0, Math.floor(views * 0.028));
  const comments = pyMeta.comments !== null ? parseInt(pyMeta.comments) : Math.max(0, Math.floor(views * 0.0010));
  const shares = pyMeta.shares !== null ? parseInt(pyMeta.shares) : Math.max(0, Math.floor(views * 0.0012));
  const saves = pyMeta.saves !== null ? parseInt(pyMeta.saves) : Math.max(0, Math.floor(views * 0.0045));

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
//  STEALTH DRIP WORKER LOOP (WITH CIRCADIAN WAVE & DEFICIT POOL)
// ─────────────────────────────────────────────────────────────────
async function updateCampaignLiveStats(camp) {
  try {
    const meta = await fetchLiveMetadata(camp.url, camp.platform);
    const currentViews = meta.views;
    const currentLikes = meta.likes;

    if (meta.title && !camp.video_title) camp.video_title = meta.title;
    if (meta.author && !camp.video_author) camp.video_author = meta.author;

    if (camp.start_views === undefined || camp.start_views === null) {
      camp.start_views = currentViews !== null ? currentViews : 0;
    }
    if (camp.start_likes === undefined || camp.start_likes === null) {
      camp.start_likes = currentLikes !== null ? currentLikes : 0;
    }

    if (currentViews !== null && camp.start_views > 0) {
      const actualViewsDelivered = Math.max(0, currentViews - camp.start_views);
      if (actualViewsDelivered > camp.views_delivered) {
        camp.views_delivered = actualViewsDelivered;
      }
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

async function runDripWorker(url, abortSignal) {
  const camp = state.campaigns[url];
  if (!camp) return;

  const titleDisplay = camp.video_title ? camp.video_title.slice(0, 40) : url.slice(-28);
  logMsg(`🚀 [${camp.platform} / ${camp.delivery_mode}] Worker Active → ${titleDisplay} | ${camp.total_views} views target`, 'info', url);

  // Initialize Deficit Accumulators if missing (Rule F: Fractional Deficit Pool)
  if (camp.likes_deficit === undefined) camp.likes_deficit = 0;
  if (camp.comments_deficit === undefined) camp.comments_deficit = 0;
  if (camp.shares_deficit === undefined) camp.shares_deficit = 0;
  if (camp.saves_deficit === undefined) camp.saves_deficit = 0;

  const commentRatioLo = 0.0005;  // 0.05%
  const commentRatioHi = 0.0010;  // 0.10%
  const shareRatioLo = 0.0005;    // 0.05%
  const shareRatioHi = 0.0015;    // 0.15%
  const saveRatioLo = 0.0030;     // 0.30%
  const saveRatioHi = 0.0080;     // 0.80%

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
    // 2-HOUR STUCK ORDER CHECK & AUTOMATIC PANEL CANCEL + CAMPAIGN HALT
    // ─────────────────────────────────────────────────────────────────
    if (camp.last_view_order && camp.last_order_timestamp) {
      const ts = new Date(camp.last_order_timestamp).getTime();
      if (!isNaN(ts)) {
        const elapsedMs = Date.now() - ts;
        const twoHoursMs = 2 * 60 * 60 * 1000;

        if (elapsedMs >= twoHoursMs) {
          try {
            const status = await smmCheckOrder(camp.last_view_order);
            logMsg(`🔍 Checking status for order #${camp.last_view_order} (Age: ${(elapsedMs / 3600000).toFixed(1)}h) → Panel Status: [${status}]`, 'info', url);

            if (status === 'Pending' || status === 'In progress' || status === 'Processing') {
              logMsg(`⚠️ Order #${camp.last_view_order} stuck in status [${status}] for >2 hours! Sending cancel request to SMM Panel and stopping campaign...`, 'warn', url);
              try {
                await smmCancelOrder(camp.last_view_order);
                logMsg(`🚫 Sent API cancel request for order #${camp.last_view_order} to Marketerum panel`, 'warn', url);
              } catch (err) {
                logMsg(`⚠️ Panel cancel API notice: ${err.message}`, 'warn', url);
              }
              camp.last_view_order = null;
              camp.status = 'Stopped';
              activeWorkers.delete(url);
              saveState();
              broadcastEvent('campaign_update', url);
              return;
            }
          } catch (err) {
            logMsg(`⚠️ Could not check order status for #${camp.last_view_order}: ${err.message}`, 'warn', url);
          }
        }
      }
    }

    await updateCampaignLiveStats(camp);

    if (camp.views_delivered >= camp.total_views) {
      logMsg(`🎉 Campaign COMPLETED: ${titleDisplay}`, 'success', url);
      camp.status = 'Completed';
      activeWorkers.delete(url);
      saveState();
      broadcastEvent('campaign_complete', url);
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // RULE B: CIRCADIAN WAVE SCALING (Night = -60%, Peak = +20%)
    // ─────────────────────────────────────────────────────────────────
    let waveMultiplier = 1.0;
    if (currentHour >= 1 && currentHour <= 6) {
      waveMultiplier = 0.40; // Sleeping hours: scale down 60%
    } else if ((currentHour >= 12 && currentHour <= 14) || (currentHour >= 18 && currentHour <= 22)) {
      waveMultiplier = 1.20; // Peak scrolling hours: scale up 20%
    }

    const viewsRemaining = camp.total_views - camp.views_delivered;
    const basePulse = Math.round(100 + Math.random() * 150);
    const pulseBurst = Math.min(viewsRemaining, Math.max(100, Math.round(basePulse * waveMultiplier)));

    if (camp.view_service) {
      const void_id = await smmPlaceOrderWithRetry(camp.view_service, url, pulseBurst, 'VIEWS');
      if (void_id) {
        camp.last_view_order = void_id;
        camp.last_order_timestamp = new Date().toISOString();
        camp.views_delivered += pulseBurst;

        // ─────────────────────────────────────────────────────────────
        // RULE F: FRACTIONAL DEFICIT POOL ACCUMULATION
        // ─────────────────────────────────────────────────────────────
        const userRate = (camp.engagement_rate || 2.2) / 100;
        camp.likes_deficit += pulseBurst * userRate;
        camp.comments_deficit += pulseBurst * (commentRatioLo + Math.random() * (commentRatioHi - commentRatioLo));
        camp.shares_deficit += pulseBurst * (shareRatioLo + Math.random() * (shareRatioHi - shareRatioLo));
        camp.saves_deficit += pulseBurst * (saveRatioLo + Math.random() * (saveRatioHi - saveRatioLo));

        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    // DISPATCH LIKES ONCE DEFICIT >= MINIMUM (Default min 10)
    if (camp.like_service && camp.likes_deficit >= 10) {
      const dispatchQty = Math.floor(camp.likes_deficit);
      const loid = await smmPlaceOrderWithRetry(camp.like_service, url, dispatchQty, 'LIKES');
      if (loid) {
        camp.last_like_order = loid;
        camp.likes_delivered = (camp.likes_delivered || 0) + dispatchQty;
        camp.likes_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    // DISPATCH COMMENTS ONCE DEFICIT >= MINIMUM (Default min 5)
    if (camp.comment_service && camp.comments_deficit >= 5) {
      const dispatchQty = Math.floor(camp.comments_deficit);
      const coid = await smmPlaceOrderWithRetry(camp.comment_service, url, dispatchQty, 'COMMENTS');
      if (coid) {
        camp.comments_delivered = (camp.comments_delivered || 0) + dispatchQty;
        camp.comments_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    // DISPATCH SHARES ONCE DEFICIT >= MINIMUM (Default min 5)
    if (camp.share_service && camp.shares_deficit >= 5) {
      const dispatchQty = Math.floor(camp.shares_deficit);
      const soid = await smmPlaceOrderWithRetry(camp.share_service, url, dispatchQty, 'SHARES');
      if (soid) {
        camp.shares_delivered = (camp.shares_delivered || 0) + dispatchQty;
        camp.shares_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    // DISPATCH SAVES ONCE DEFICIT >= MINIMUM (Default min 5)
    if (camp.save_service && camp.saves_deficit >= 5) {
      const dispatchQty = Math.floor(camp.saves_deficit);
      const svid = await smmPlaceOrderWithRetry(camp.save_service, url, dispatchQty, 'SAVES');
      if (svid) {
        camp.saves_delivered = (camp.saves_delivered || 0) + dispatchQty;
        camp.saves_deficit -= dispatchQty;
        saveState();
        broadcastEvent('campaign_update', url);
      }
    }

    let sleepSecs = Math.round((900 + Math.random() * 1800) / waveMultiplier);
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
            const meta = await fetchLiveMetadata(data.url, data.platform);
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

          if (pathname === '/api/service/add' || pathname === '/api/add_service') {
            const { service_id, name } = data;
            if (!service_id || !name) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'service_id and name required' }));
              return;
            }
            try {
              const servicesList = await smmGetServices();
              const found = servicesList.find(s => String(s.service) === String(service_id));
              const rateUsd = found ? parseFloat(found.rate || 0) : 0.05;
              const ratePkr = rateUsd * (state.custom_pkr_rate || 297);
              const minOrder = found ? parseInt(found.min || 1) : 1;
              const maxOrder = found ? parseInt(found.max || 1000000) : 1000000;

              const svcObj = {
                id: uuidv4(),
                service_id: String(service_id),
                name,
                rate_usd: rateUsd,
                rate_pkr: ratePkr,
                min_order: minOrder,
                max_order: maxOrder
              };
              state.services.push(svcObj);
              saveState();
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

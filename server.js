const express = require('express');
const https   = require('https');
const http    = require('http');
const zlib    = require('zlib');
const path    = require('path');
const crypto  = require('crypto');
const { URL } = require('url');

// ── Apple Search Ads config ──
// Set these env vars before starting:
//   ASA_CLIENT_ID, ASA_TEAM_ID, ASA_KEY_ID
//   ASA_PRIVATE_KEY  (PEM content; use \n for newlines in shell env)
//   ASA_ORG_ID       (optional — skip auto-fetch if you know it)
const ASA = {
  clientId:   process.env.ASA_CLIENT_ID   || '',
  teamId:     process.env.ASA_TEAM_ID     || '',
  keyId:      process.env.ASA_KEY_ID      || '',
  privateKey: (process.env.ASA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  orgId:      process.env.ASA_ORG_ID      || '',
};
const asaState = { token: null, exp: 0, orgId: ASA.orgId || null };
const asaConfigured = () => !!(ASA.clientId && ASA.teamId && ASA.keyId && ASA.privateKey);

function asaJWT() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASA.keyId })).toString('base64url');
  const pay = Buffer.from(JSON.stringify({
    sub: ASA.clientId, aud: 'https://appleid.apple.com',
    iat: now, exp: now + 3600, iss: ASA.teamId,
  })).toString('base64url');
  const msg = `${hdr}.${pay}`;
  const sig = crypto.createSign('SHA256').update(msg)
    .sign({ key: ASA.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${msg}.${sig.toString('base64url')}`;
}

function appleIDTokenRequest(jwt) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ASA.clientId,
      client_secret: jwt,
      scope: 'searchadsorg',
    }).toString();
    const req = https.request({
      hostname: 'appleid.apple.com', path: '/auth/oauth2/token', method: 'POST',
      headers: { 'Host': 'appleid.apple.com', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(new Error('Bad token response')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ASA token request timed out')); });
    req.write(body); req.end();
  });
}

function asaAPIRequest(method, apiPath, body, token, orgId) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Host': 'api.searchads.apple.com',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (orgId) headers['X-AP-Context'] = `orgId=${orgId}`;
    if (data)  headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request({
      hostname: 'api.searchads.apple.com',
      path: `/api/v4${apiPath}`,
      method, headers, timeout: 15000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch(_) { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ASA API request timed out')); });
    if (data) req.write(data);
    req.end();
  });
}

async function getASAToken() {
  if (asaState.token && Date.now() < asaState.exp) return asaState.token;
  const result = await appleIDTokenRequest(asaJWT());
  if (!result.access_token) throw new Error(`ASA auth failed: ${JSON.stringify(result)}`);
  asaState.token = result.access_token;
  asaState.exp   = Date.now() + Math.max(0, (result.expires_in || 3600) - 60) * 1000;
  console.log('  ✓ ASA token obtained');
  return asaState.token;
}

async function getASAOrgId(token) {
  if (asaState.orgId) return asaState.orgId;
  const r = await asaAPIRequest('GET', '/me/orgs', null, token, null);
  if (r.status !== 200 || !Array.isArray(r.body?.data) || !r.body.data.length)
    throw new Error(`ASA orgs fetch failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  asaState.orgId = r.body.data[0].orgId;
  console.log(`  ✓ ASA orgId: ${asaState.orgId}`);
  return asaState.orgId;
}

const PORT = process.env.PORT || 3131;
const app  = express();

const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const ALLOWED_HOSTS = [
  'play.google.com',
  'apps.apple.com',
  'itunes.apple.com',
  'search.itunes.apple.com',  // autocomplete hints
];
// Domain-suffix patterns for image CDNs (leading dot = any subdomain)
const ALLOWED_SUFFIXES = [
  '.mzstatic.com',                  // Apple screenshot CDN (is1-ssl.mzstatic.com etc.)
  'play-lh.googleusercontent.com',  // Google Play screenshot CDN
];
function isHostAllowed(h) {
  return ALLOWED_HOSTS.includes(h) ||
         ALLOWED_SUFFIXES.some(s => s.startsWith('.') ? h.endsWith(s) : h === s);
}

// App Store storefront IDs — the hints endpoint returns nothing without X-Apple-Store-Front
const STOREFRONTS = { us:143441, gb:143444, ca:143455, au:143460, de:143443, fr:143442, jp:143462, it:143450, es:143454, br:143503, mx:143468, in:143467, kr:143466, nl:143452 };
function extraHeaders(parsed) {
  if (parsed.hostname !== 'search.itunes.apple.com') return {};
  const cc = (parsed.searchParams.get('country') || 'us').toLowerCase();
  return { 'X-Apple-Store-Front': `${STOREFRONTS[cc] || STOREFRONTS.us}-1,29` };
}

function proxyFetch(targetUrl, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error('Invalid URL')); }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { ...FETCH_HEADERS, ...extraHeaders(parsed), Host: parsed.hostname },
      timeout:  20000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : new URL(loc, targetUrl).href;
        res.resume();
        return proxyFetch(next, redirects + 1).then(resolve).catch(reject);
      }

      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({
        status:      res.statusCode,
        contentType: res.headers['content-type'] || 'text/html; charset=utf-8',
        body:        Buffer.concat(chunks),
      }));
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

// ── Static frontend ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Proxy route ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing ?url= param' });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  if (!isHostAllowed(parsed.hostname)) {
    return res.status(403).json({ error: `Host not allowed: ${parsed.hostname}` });
  }

  console.log(`  → ${url.slice(0, 90)}`);

  try {
    const result = await proxyFetch(url);
    res
      .status(result.status)
      .set('Content-Type', result.contentType)
      .set('Cache-Control', 'no-store')
      .send(result.body);
    console.log(`  ✓ ${result.body.length.toLocaleString()} bytes`);
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// ── ASA keyword volume endpoint ──
app.get('/api/asa/volume', async (req, res) => {
  if (!asaConfigured()) return res.status(503).json({ error: 'not_configured' });

  const keywords = (req.query.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 25);
  const adamId   = req.query.adamId ? Number(req.query.adamId) : undefined;
  if (!keywords.length) return res.status(400).json({ error: 'no_keywords' });

  try {
    const token = await getASAToken();
    const orgId = await getASAOrgId(token);
    const body  = { keywords };
    if (adamId) body.adamId = adamId;

    console.log(`  → ASA volume: [${keywords.join(', ')}]`);
    const r = await asaAPIRequest('POST', '/keywords/search-popularity', body, token, orgId);
    console.log(`  ASA volume (${r.status}):`, JSON.stringify(r.body).slice(0, 300));
    res.json(r.body);
  } catch(e) {
    console.error('  ✗ ASA volume:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Keyword trend endpoint (Google Trends: web + YouTube search interest) ──
// Unofficial endpoints; add a source by appending to TREND_SOURCES.
const TREND_SOURCES = [
  { id: 'google',  label: 'Google Search',  property: '' },
  { id: 'youtube', label: 'YouTube Search', property: 'youtube' },
];
const trendCache = new Map();           // key → { exp, data }
const TREND_TTL  = 6 * 3600 * 1000;
const gtJar = {};                       // cookie jar for trends.google.com
const GT_UA = FETCH_HEADERS['User-Agent'];

function gtCookieHeader() { return Object.entries(gtJar).map(([k, v]) => `${k}=${v}`).join('; '); }
async function gtFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': GT_UA, 'Cookie': gtCookieHeader() }, signal: AbortSignal.timeout(15000) });
  for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); gtJar[kv.slice(0, i)] = kv.slice(i + 1); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.text()).replace(/^\)\]\}',?\s*/, '');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function gtSeries(keyword, geo, property) {
  if (!gtJar.NID) await gtFetch('https://trends.google.com/trends/').catch(() => {});   // warm up cookies
  for (let attempt = 0; ; attempt++) {
    try { return await gtSeriesOnce(keyword, geo, property); }
    catch (e) { if (attempt >= 2 || !/429/.test(e.message)) throw e; await sleep(1500 * (attempt + 1)); }
  }
}
async function gtSeriesOnce(keyword, geo, property) {
  const req = { comparisonItem: [{ keyword, geo, time: 'today 12-m' }], category: 0, property };
  const ex  = JSON.parse(await gtFetch(`https://trends.google.com/trends/api/explore?${new URLSearchParams({ hl: 'en-US', tz: '0', req: JSON.stringify(req) })}`));
  const w   = ex.widgets.find(w => w.id === 'TIMESERIES');
  if (!w) throw new Error('no timeseries widget');
  const q   = new URLSearchParams({ hl: 'en-US', tz: '0', req: JSON.stringify(w.request), token: w.token });
  const ts  = JSON.parse(await gtFetch(`https://trends.google.com/trends/api/widgetdata/multiline?${q}`));
  return ts.default.timelineData.map(p => p.value[0]);
}

app.get('/api/trends', async (req, res) => {
  const keywords = (req.query.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 10);
  const geo = (req.query.geo || 'US').toUpperCase().slice(0, 2);
  if (!keywords.length) return res.status(400).json({ error: 'no_keywords' });

  const out = {};
  for (const kw of keywords) {                       // sequential — Google rate-limits bursts
    const key = `${geo}|${kw.toLowerCase()}`;
    const hit = trendCache.get(key);
    if (hit && hit.exp > Date.now() && !req.query.fresh) { out[kw.toLowerCase()] = hit.data; continue; }
    const sources = {};
    for (const src of TREND_SOURCES) {
      await sleep(300);
      try { sources[src.id] = { label: src.label, series: await gtSeries(kw, geo, src.property) }; }
      catch (e) { console.error(`  ✗ trend ${src.id} "${kw}": ${e.message}`); sources[src.id] = { label: src.label, error: e.message }; }
    }
    console.log(`  → trend "${kw}": ${Object.entries(sources).map(([k, v]) => `${k}=${v.series ? v.series.length : 'err'}`).join(' ')}`);
    if (Object.values(sources).some(s => s.series)) trendCache.set(key, { exp: Date.now() + TREND_TTL, data: sources });
    out[kw.toLowerCase()] = sources;
  }
  res.json(out);
});

// ── Social accounts (TikTok / Instagram / X): log in once in a real Chrome window, reuse the session headless ──
// Sessions live in ./.sessions/<id> (gitignored). Requires Google Chrome installed (playwright-core, no browser download).
const fs = require('fs');
const SOCIAL = {
  tiktok:    { label: 'TikTok',      loginUrl: 'https://www.tiktok.com/login',              cookie: 'sessionid',  domain: 'tiktok.com' },
  instagram: { label: 'Instagram',   loginUrl: 'https://www.instagram.com/accounts/login/', cookie: 'sessionid',  domain: 'instagram.com' },
  twitter:   { label: 'X / Twitter', loginUrl: 'https://x.com/i/flow/login',                cookie: 'auth_token', domain: 'x.com' },
};
const SESSIONS_DIR = path.join(__dirname, '.sessions');
const socialPending = {};                 // id → true while a login window is open
const socialMarker = id => path.join(SESSIONS_DIR, `${id}.connected`);
const socialConnected = id => fs.existsSync(socialMarker(id));

function launchSocial(id, headless) {
  const { chromium } = require('playwright-core');
  return chromium.launchPersistentContext(path.join(SESSIONS_DIR, id), {
    channel: 'chrome', headless, viewport: headless ? { width: 1280, height: 900 } : null,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

app.get('/api/social/status', (req, res) => {
  res.json(Object.fromEntries(Object.entries(SOCIAL).map(([id, s]) =>
    [id, { label: s.label, connected: socialConnected(id), pending: !!socialPending[id] }])));
});

app.post('/api/social/:id/login', async (req, res) => {
  const id = req.params.id, cfg = SOCIAL[id];
  if (!cfg) return res.status(404).json({ error: 'unknown platform' });
  if (socialPending[id]) return res.json({ pending: true });
  let ctx;
  try { ctx = await launchSocial(id, false); }
  catch (e) { return res.status(500).json({ error: `Could not open Chrome: ${e.message}` }); }
  socialPending[id] = true;
  console.log(`  → ${cfg.label}: login window opened`);
  let closed = false;
  ctx.on('close', () => { closed = true; socialPending[id] = false; });
  (async () => {
    try {
      const page = ctx.pages()[0] || await ctx.newPage();
      await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const deadline = Date.now() + 5 * 60 * 1000;
      while (!closed && Date.now() < deadline) {
        await sleep(1500);
        const cookies = await ctx.cookies().catch(() => []);
        if (cookies.some(c => c.name === cfg.cookie && c.domain.includes(cfg.domain))) {
          await sleep(2500);                                   // let the session settle
          fs.mkdirSync(SESSIONS_DIR, { recursive: true });
          fs.writeFileSync(socialMarker(id), new Date().toISOString());
          console.log(`  ✓ ${cfg.label}: logged in`);
          break;
        }
      }
    } catch (e) { console.error(`  ✗ ${cfg.label} login:`, e.message); }
    finally { socialPending[id] = false; if (!closed) await ctx.close().catch(() => {}); }
  })();
  res.json({ pending: true });
});

app.post('/api/social/:id/logout', (req, res) => {
  const id = req.params.id;
  if (!SOCIAL[id]) return res.status(404).json({ error: 'unknown platform' });
  fs.rmSync(path.join(SESSIONS_DIR, id), { recursive: true, force: true });
  fs.rmSync(socialMarker(id), { force: true });
  res.json({ connected: false });
});

const toNum = v => (v == null || v === '' ? null : Number(v));
const hashtagOf = kw => kw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
class SessionExpired extends Error {}

const SOCIAL_SCRAPERS = {
  async tiktok(ctx, kw) {
    const page = await ctx.newPage();
    try {
      await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(hashtagOf(kw))}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      if (/\/login/.test(page.url())) throw new SessionExpired();
      const ci = await page.evaluate(() => {
        const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        return el ? JSON.parse(el.textContent).__DEFAULT_SCOPE__?.['webapp.challenge-detail']?.challengeInfo || null : null;
      });
      const st = ci?.statsV2 || ci?.stats;
      if (!st) return { error: 'no hashtag data (hashtag may not exist)' };
      return { views: toNum(st.viewCount), posts: toNum(st.videoCount) };
    } finally { await page.close().catch(() => {}); }
  },
  async instagram(ctx, kw) {
    const r = await ctx.request.get(`https://www.instagram.com/api/v1/tags/web_info/?tag_name=${encodeURIComponent(hashtagOf(kw))}`,
      { headers: { 'X-IG-App-ID': '936619743392459' }, maxRedirects: 0 });
    if ([301, 302, 401, 403].includes(r.status())) throw new SessionExpired();
    if (!r.ok()) return { error: `HTTP ${r.status()}` };
    const j = await r.json().catch(() => null);
    const n = j?.data?.media_count ?? j?.media_count;
    return n == null ? { error: 'no hashtag data' } : { posts: toNum(n) };
  },
  async twitter(ctx, kw) {         // X exposes no counts: estimate posting rate from the first page of "Latest"
    const page = await ctx.newPage();
    try {
      await page.goto(`https://x.com/search?q=${encodeURIComponent(kw)}&f=live`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('article time', { timeout: 12000 }).catch(() => {});
      if (/\/(login|i\/flow)/.test(page.url())) throw new SessionExpired();
      const times = await page.$$eval('article time[datetime]', els => els.map(e => Date.parse(e.getAttribute('datetime'))));
      if (times.length < 3) return { error: 'too few recent posts to estimate' };
      const hours = Math.max((Math.max(...times) - Math.min(...times)) / 3.6e6, 0.05);
      return { postsPerHour: +(times.length / hours).toFixed(1), sample: times.length };
    } finally { await page.close().catch(() => {}); }
  },
};

const socialCache = new Map();
app.get('/api/social/metrics', async (req, res) => {
  const keywords = (req.query.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 10);
  const ids = Object.keys(SOCIAL).filter(id => socialConnected(id) && !socialPending[id]);
  const out = Object.fromEntries(keywords.map(k => [k.toLowerCase(), {}]));
  for (const id of ids) {
    let ctx;
    try { ctx = await launchSocial(id, true); }
    catch (e) { for (const k of keywords) out[k.toLowerCase()][id] = { error: `Chrome launch failed: ${e.message}` }; continue; }
    try {
      for (const kw of keywords) {
        const key = `${id}|${kw.toLowerCase()}`, hit = socialCache.get(key);
        if (hit && hit.exp > Date.now() && !req.query.fresh) { out[kw.toLowerCase()][id] = hit.data; continue; }
        let data;
        try { data = await SOCIAL_SCRAPERS[id](ctx, kw); }
        catch (e) {
          if (e instanceof SessionExpired) { fs.rmSync(socialMarker(id), { force: true }); data = { error: 'session expired — log in again', expired: true }; }
          else data = { error: e.message.split('\n')[0] };
        }
        console.log(`  → ${id} "${kw}":`, JSON.stringify(data));
        if (!data.error) socialCache.set(key, { exp: Date.now() + TREND_TTL, data });
        out[kw.toLowerCase()][id] = data;
        if (data.expired) break;
        await sleep(800);
      }
    } finally { await ctx.close().catch(() => {}); }
  }
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`\n  ASO Analyzer  →  http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});

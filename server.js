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
      headers:  { ...FETCH_HEADERS, Host: parsed.hostname },
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

app.listen(PORT, () => {
  console.log(`\n  ASO Analyzer  →  http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});

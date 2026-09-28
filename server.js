const express = require('express');
const https   = require('https');
const http    = require('http');
const zlib    = require('zlib');
const path    = require('path');
const { URL } = require('url');

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
];

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

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
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

app.listen(PORT, () => {
  console.log(`\n  ASO Analyzer  →  http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});

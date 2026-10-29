// Server TV Nusantara tanpa dependency.
// - Web utama: semua path tanpa ekstensi (mis. /indosiar) dikembalikan ke index.html.
// - Portal admin: /admin (login password, pengaturan disimpan di folder data/).
// - /api/youtube-live mencari ID video live di channel YouTube resmi
//   (YouTube sudah tidak mendukung embed live berdasarkan channel ID).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FILES = {
  config: path.join(DATA_DIR, 'config.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  codes: path.join(DATA_DIR, 'access-codes.json'),
  stats: path.join(DATA_DIR, 'stats.json'),
};
const PORT = Number(process.env.PORT) || 8080;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const YT_CACHE_MS = 10 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const SECRET_MASK = '••••••••';
const SOURCE_TYPES = ['hls', 'iframe', 'youtube', 'vidio'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// ---------- Penyimpanan ----------

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const newId = () => crypto.randomBytes(6).toString('hex');

function slugify(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function seedChannels() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'channels.js'), 'utf8'), sandbox);
  return sandbox.window.NATIONAL_CHANNELS.map((c) => ({
    id: newId(), slug: '', aliases: [], enabled: true, premium: false, ...c,
  }));
}

function defaultConfig() {
  return {
    site: {
      name: 'TV Nusantara',
      logoUrl: '',
      accent: '#e5203a',
      theme: 'dark',
      welcomeTitle: 'Nonton TV Indonesia, live.',
      welcomeText: 'Pilih channel di bawah atau dari daftar di samping.',
      announcement: { enabled: false, text: '', tone: 'info' },
      sidebarPosition: 'right',
      showQuickGrid: true,
      quickGridCount: 18,
      defaultCategory: 'Semua',
      footerText: '',
    },
    streaming: {
      playlistEnabled: true,
      playlistUrl: 'https://iptv-org.github.io/iptv/countries/id.m3u',
      hiddenPlaylist: [],
      defaultQuality: 'auto',
      startMuted: false,
      autoFallback: true,
      loadTimeoutSec: 25,
      maxBufferSec: 30,
      lowLatency: false,
    },
    payment: {
      enabled: false,
      currency: 'IDR',
      plans: [
        { id: 'harian', name: 'Harian', price: 5000, durationDays: 1, description: 'Akses semua channel premium selama 24 jam.', active: true },
        { id: 'bulanan', name: 'Bulanan', price: 30000, durationDays: 30, description: 'Akses semua channel premium selama 30 hari.', active: true },
      ],
      bankAccounts: [],
      ewallets: [],
      qrisImageUrl: '',
      instructions: 'Transfer sesuai harga paket, lalu kirim bukti pembayaran ke WhatsApp admin. Kode akses dikirim setelah pembayaran diverifikasi.',
      whatsapp: '',
      gateway: { provider: 'none', mode: 'sandbox', merchantId: '', clientKey: '', serverKey: '' },
    },
    channels: seedChannels(),
  };
}

function loadConfig() {
  const def = defaultConfig();
  const saved = readJson(FILES.config, null);
  if (!saved) {
    writeJson(FILES.config, def);
    return def;
  }
  return {
    site: { ...def.site, ...saved.site, announcement: { ...def.site.announcement, ...(saved.site || {}).announcement } },
    streaming: { ...def.streaming, ...saved.streaming },
    payment: { ...def.payment, ...saved.payment, gateway: { ...def.payment.gateway, ...(saved.payment || {}).gateway } },
    channels: Array.isArray(saved.channels) ? saved.channels : def.channels,
  };
}

let config = loadConfig();
let codes = readJson(FILES.codes, []);
let stats = readJson(FILES.stats, { views: {} });

let statsTimer = null;
function saveStatsSoon() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; writeJson(FILES.stats, stats); }, 5000);
}

// ---------- Validasi input admin ----------

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v) => v === true;
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const url = (v) => {
  const s = str(v, 2000);
  return /^https?:\/\//i.test(s) ? s : '';
};
const color = (v, def) => (/^#[0-9a-f]{6}$/i.test(v) ? v : def);

function sanitizeSource(s) {
  const type = oneOf(s && s.type, SOURCE_TYPES, null);
  if (!type) return null;
  if (type === 'hls') return url(s.url) ? { type, url: url(s.url) } : null;
  if (type === 'iframe') return url(s.url) ? { type, url: url(s.url), label: str(s.label, 60) } : null;
  if (type === 'youtube') return /^UC[\w-]{22}$/.test(s.channelId) ? { type, channelId: s.channelId } : null;
  return /^[\w-]{1,80}$/.test(s.id) ? { type, id: s.id } : null;
}

function sanitizeChannel(c) {
  const name = str(c.name, 80);
  if (!name) return null;
  return {
    id: /^[a-f0-9]{12}$/.test(c.id) ? c.id : newId(),
    name,
    slug: slugify(c.slug),
    tvgId: str(c.tvgId, 80),
    logo: url(c.logo),
    groups: (Array.isArray(c.groups) ? c.groups : []).map((g) => str(g, 40)).filter(Boolean).slice(0, 6),
    aliases: (Array.isArray(c.aliases) ? c.aliases : []).map(slugify).filter(Boolean).slice(0, 10),
    enabled: bool(c.enabled),
    premium: bool(c.premium),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(sanitizeSource).filter(Boolean).slice(0, 6),
  };
}

function sanitizeConfig(input, current) {
  const site = input.site || {};
  const streaming = input.streaming || {};
  const payment = input.payment || {};
  const gw = payment.gateway || {};
  const keepSecret = (v, old) => (v === SECRET_MASK ? old : str(v, 300));
  return {
    site: {
      name: str(site.name, 60) || 'TV Nusantara',
      logoUrl: url(site.logoUrl),
      accent: color(site.accent, '#e5203a'),
      theme: oneOf(site.theme, ['dark', 'light'], 'dark'),
      welcomeTitle: str(site.welcomeTitle, 120),
      welcomeText: str(site.welcomeText, 400),
      announcement: {
        enabled: bool((site.announcement || {}).enabled),
        text: str((site.announcement || {}).text, 300),
        tone: oneOf((site.announcement || {}).tone, ['info', 'warning', 'promo'], 'info'),
      },
      sidebarPosition: oneOf(site.sidebarPosition, ['right', 'left'], 'right'),
      showQuickGrid: bool(site.showQuickGrid),
      quickGridCount: num(site.quickGridCount, 0, 48, 18),
      defaultCategory: str(site.defaultCategory, 40) || 'Semua',
      footerText: str(site.footerText, 300),
    },
    streaming: {
      playlistEnabled: bool(streaming.playlistEnabled),
      playlistUrl: url(streaming.playlistUrl),
      hiddenPlaylist: (Array.isArray(streaming.hiddenPlaylist) ? streaming.hiddenPlaylist : [])
        .map((x) => str(x, 120)).filter(Boolean).slice(0, 2000),
      defaultQuality: streaming.defaultQuality === 'auto' ? 'auto' : num(streaming.defaultQuality, 144, 2160, 'auto'),
      startMuted: bool(streaming.startMuted),
      autoFallback: bool(streaming.autoFallback),
      loadTimeoutSec: num(streaming.loadTimeoutSec, 5, 120, 25),
      maxBufferSec: num(streaming.maxBufferSec, 10, 120, 30),
      lowLatency: bool(streaming.lowLatency),
    },
    payment: {
      enabled: bool(payment.enabled),
      currency: oneOf(payment.currency, ['IDR', 'USD'], 'IDR'),
      plans: (Array.isArray(payment.plans) ? payment.plans : []).map((p) => ({
        id: slugify(p.id || p.name) || newId(),
        name: str(p.name, 60),
        price: num(p.price, 0, 1e9, 0),
        durationDays: num(p.durationDays, 1, 3650, 30),
        description: str(p.description, 300),
        active: bool(p.active),
      })).filter((p) => p.name).slice(0, 20),
      bankAccounts: (Array.isArray(payment.bankAccounts) ? payment.bankAccounts : []).map((b) => ({
        bank: str(b.bank, 40), number: str(b.number, 40), holder: str(b.holder, 80),
      })).filter((b) => b.bank && b.number).slice(0, 10),
      ewallets: (Array.isArray(payment.ewallets) ? payment.ewallets : []).map((w) => ({
        name: str(w.name, 40), number: str(w.number, 40), holder: str(w.holder, 80),
      })).filter((w) => w.name && w.number).slice(0, 10),
      qrisImageUrl: url(payment.qrisImageUrl),
      instructions: str(payment.instructions, 1000),
      whatsapp: str(payment.whatsapp, 20).replace(/[^\d]/g, ''),
      gateway: {
        provider: oneOf(gw.provider, ['none', 'midtrans', 'xendit', 'tripay'], 'none'),
        mode: oneOf(gw.mode, ['sandbox', 'production'], 'sandbox'),
        merchantId: str(gw.merchantId, 100),
        clientKey: str(gw.clientKey, 300),
        serverKey: keepSecret(gw.serverKey, current.payment.gateway.serverKey),
      },
    },
    channels: (Array.isArray(input.channels) ? input.channels : []).map(sanitizeChannel).filter(Boolean).slice(0, 500),
  };
}

function adminView(cfg) {
  const copy = JSON.parse(JSON.stringify(cfg));
  if (copy.payment.gateway.serverKey) copy.payment.gateway.serverKey = SECRET_MASK;
  return copy;
}

function publicView(cfg) {
  const paid = cfg.payment.enabled;
  const p = cfg.payment;
  return {
    site: cfg.site,
    streaming: cfg.streaming,
    payment: paid
      ? {
        enabled: true, currency: p.currency, plans: p.plans.filter((x) => x.active),
        bankAccounts: p.bankAccounts, ewallets: p.ewallets, qrisImageUrl: p.qrisImageUrl,
        instructions: p.instructions, whatsapp: p.whatsapp,
      }
      : { enabled: false },
    channels: cfg.channels.filter((c) => c.enabled).map((c) => ({
      name: c.name, slug: c.slug, tvgId: c.tvgId, logo: c.logo, groups: c.groups, aliases: c.aliases,
      premium: paid && c.premium,
      sources: paid && c.premium ? [] : c.sources,
    })),
  };
}

// ---------- Akun admin & sesi ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

let admin = readJson(FILES.admin, null);
if (!admin) {
  const initial = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  admin = hashPassword(initial);
  writeJson(FILES.admin, admin);
  console.log('──────────────────────────────────────────────');
  console.log(' Akun admin dibuat. Password awal portal /admin:');
  console.log(`   ${initial}`);
  console.log(' Segera ganti lewat menu Akun di portal.');
  console.log('──────────────────────────────────────────────');
}

function verifyPassword(password) {
  if (typeof password !== 'string' || !password) return false;
  const h = crypto.scryptSync(password, admin.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(admin.hash, 'hex'));
}

const sessions = new Map();

function sessionToken(req) {
  const m = /(?:^|;\s*)tvn_admin=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return null; }
  return m[1];
}

const attempts = new Map();
function limited(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 5 && a.until > Date.now();
}
function recordFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  if (a.until < Date.now()) a.count = 0;
  a.count++;
  a.until = Date.now() + 5 * 60 * 1000;
  attempts.set(ip, a);
}

// ---------- Kode akses premium ----------

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `TVN-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function codeStatus(c) {
  if (!c.redeemedAt) return 'baru';
  return c.expiresAt > Date.now() ? 'aktif' : 'kedaluwarsa';
}

function activeCode(value) {
  const c = codes.find((x) => x.code === String(value || '').trim().toUpperCase());
  return c && c.redeemedAt && c.expiresAt > Date.now() ? c : null;
}

// ---------- YouTube live ----------

const ytCache = new Map();

async function youtubeLive(channelId) {
  const hit = ytCache.get(channelId);
  if (hit && Date.now() - hit.at < YT_CACHE_MS) return hit.data;
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
  });
  const html = await res.text();
  const videoId = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1] || null;
  const data = { videoId, live: Boolean(videoId) && /"isLive":true/.test(html) };
  ytCache.set(channelId, { at: Date.now(), data });
  return data;
}

// ---------- HTTP ----------

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const ip = req.socket.remoteAddress || '';
  const isJson = (req.headers['content-type'] || '').startsWith('application/json');
  if (req.method !== 'GET' && !isJson) return sendJson(res, 415, { error: 'Gunakan application/json' });

  // --- Publik ---
  if (p === '/api/config' && req.method === 'GET') return sendJson(res, 200, publicView(config));

  if (p === '/api/youtube-live' && req.method === 'GET') {
    const channel = url.searchParams.get('channel') || '';
    if (!/^UC[\w-]{22}$/.test(channel)) return sendJson(res, 400, { error: 'channel tidak valid' });
    try { return sendJson(res, 200, await youtubeLive(channel)); }
    catch (err) { return sendJson(res, 502, { error: String(err.message || err) }); }
  }

  if (p === '/api/stats/view' && req.method === 'POST') {
    const { slug } = await readBody(req);
    if (typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      stats.views[slug] = (stats.views[slug] || 0) + 1;
      saveStatsSoon();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/access/redeem' && req.method === 'POST') {
    if (limited(ip)) return sendJson(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 5 menit lagi.' });
    const { code } = await readBody(req);
    const c = codes.find((x) => x.code === String(code || '').trim().toUpperCase());
    if (!c) { recordFailure(ip); return sendJson(res, 404, { error: 'Kode akses tidak ditemukan.' }); }
    if (!c.redeemedAt) {
      const plan = config.payment.plans.find((x) => x.id === c.planId);
      c.redeemedAt = Date.now();
      c.expiresAt = c.redeemedAt + (plan ? plan.durationDays : c.durationDays || 1) * 86400000;
      writeJson(FILES.codes, codes);
    }
    if (c.expiresAt <= Date.now()) return sendJson(res, 410, { error: 'Kode akses sudah kedaluwarsa.' });
    return sendJson(res, 200, { code: c.code, expiresAt: c.expiresAt, plan: c.planName });
  }

  if (p === '/api/access/sources' && req.method === 'GET') {
    if (!activeCode(req.headers['x-access-code'])) return sendJson(res, 403, { error: 'Akses premium tidak aktif.' });
    const slug = url.searchParams.get('slug') || '';
    const ch = config.channels.find((c) => c.enabled && (c.slug || slugify(c.name)) === slug);
    if (!ch) return sendJson(res, 404, { error: 'Channel tidak ditemukan.' });
    return sendJson(res, 200, { sources: ch.sources });
  }

  // --- Admin: login ---
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (limited(ip)) return sendJson(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 5 menit lagi.' });
    const { password } = await readBody(req);
    if (!verifyPassword(password)) { recordFailure(ip); return sendJson(res, 401, { error: 'Password salah.' }); }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `tvn_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    });
  }

  if (!p.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Tidak ditemukan' });
  const token = sessionToken(req);
  if (!token) return sendJson(res, 401, { error: 'Silakan login.' });

  // --- Admin: butuh sesi ---
  if (p === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'tvn_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (p === '/api/admin/config' && req.method === 'GET') return sendJson(res, 200, adminView(config));

  if (p === '/api/admin/config' && req.method === 'PUT') {
    config = sanitizeConfig(await readBody(req), config);
    writeJson(FILES.config, config);
    return sendJson(res, 200, adminView(config));
  }

  if (p === '/api/admin/config/reset-channels' && req.method === 'POST') {
    config.channels = seedChannels();
    writeJson(FILES.config, config);
    return sendJson(res, 200, adminView(config));
  }

  if (p === '/api/admin/password' && req.method === 'POST') {
    const { current, next } = await readBody(req);
    if (!verifyPassword(current)) return sendJson(res, 400, { error: 'Password lama salah.' });
    if (typeof next !== 'string' || next.length < 8) return sendJson(res, 400, { error: 'Password baru minimal 8 karakter.' });
    admin = hashPassword(next);
    writeJson(FILES.admin, admin);
    for (const t of sessions.keys()) if (t !== token) sessions.delete(t);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      views: stats.views,
      codes: { total: codes.length, active: codes.filter((c) => codeStatus(c) === 'aktif').length, unused: codes.filter((c) => !c.redeemedAt).length },
    });
  }

  if (p === '/api/admin/codes' && req.method === 'GET') {
    return sendJson(res, 200, codes.map((c) => ({ ...c, status: codeStatus(c) })).reverse());
  }

  if (p === '/api/admin/codes' && req.method === 'POST') {
    const body = await readBody(req);
    const plan = config.payment.plans.find((x) => x.id === body.planId);
    if (!plan) return sendJson(res, 400, { error: 'Pilih paket yang valid.' });
    const count = num(body.count, 1, 100, 1);
    const created = [];
    for (let i = 0; i < count; i++) {
      const c = {
        code: makeCode(), planId: plan.id, planName: plan.name, durationDays: plan.durationDays,
        note: str(body.note, 120), createdAt: Date.now(), redeemedAt: null, expiresAt: null,
      };
      codes.push(c);
      created.push(c);
    }
    writeJson(FILES.codes, codes);
    return sendJson(res, 200, created);
  }

  const del = /^\/api\/admin\/codes\/(TVN-[A-Z0-9]{4}-[A-Z0-9]{4})$/.exec(p);
  if (del && req.method === 'DELETE') {
    codes = codes.filter((c) => c.code !== del[1]);
    writeJson(FILES.codes, codes);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Tidak ditemukan' });
}

function resolveStatic(urlPath) {
  if (urlPath === '/admin' || urlPath === '/admin/') return 'admin/index.html';
  if (/^\/(assets|admin)\/[\w.-]+$/.test(urlPath)) return urlPath.slice(1);
  if (urlPath === '/index.html' || !path.extname(urlPath)) return 'index.html';
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, url); }
    catch (err) { sendJson(res, 400, { error: String(err.message || err) }); }
    return;
  }

  const rel = resolveStatic(decodeURIComponent(url.pathname));
  if (!rel) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
    return;
  }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TV Nusantara berjalan di http://localhost:${PORT}`);
  console.log(`Portal admin: http://localhost:${PORT}/admin`);
  const lan = Object.values(require('os').networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  if (lan.length) console.log(`Dari HP / aplikasi (satu Wi-Fi): ${lan.join('  ')}`);
});

// Server TEKDROID TV tanpa dependency.
// - Web utama: semua path tanpa ekstensi (mis. /indosiar) dikembalikan ke index.html.
// - Portal admin: /admin (login password, pengaturan disimpan di folder data/).
// - Akun penonton: /api/auth/* (daftar/masuk); bila "wajib login" aktif, data channel hanya untuk yang sudah masuk.
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
  users: path.join(DATA_DIR, 'users.json'),
  userSessions: path.join(DATA_DIR, 'user-sessions.json'),
};
const PORT = Number(process.env.PORT) || 8080;
const DEV = process.argv.includes('--dev');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const YT_CACHE_MS = 10 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
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
      name: 'TEKDROID TV',
      logoUrl: '',
      accent: '#e5203a',
      theme: 'dark',
      welcomeTitle: 'Nonton TV Indonesia, live.',
      welcomeText: 'Pilih channel dari daftar untuk mulai menonton.',
      announcement: { enabled: false, text: '', tone: 'info' },
      sidebarPosition: 'right',
      showQuickGrid: true,
      quickGridCount: 18,
      defaultCategory: 'Semua',
      footerText: '',
    },
    auth: {
      requireLogin: true,
      allowRegister: true,
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
    auth: { ...def.auth, ...saved.auth },
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
  const auth = input.auth || {};
  const streaming = input.streaming || {};
  const payment = input.payment || {};
  const gw = payment.gateway || {};
  const keepSecret = (v, old) => (v === SECRET_MASK ? old : str(v, 300));
  return {
    site: {
      name: str(site.name, 60) || 'TEKDROID TV',
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
    auth: {
      requireLogin: bool(auth.requireLogin),
      allowRegister: bool(auth.allowRegister),
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
    auth: cfg.auth,
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
if (admin && !admin.username) {
  admin = { username: 'admin', ...admin };
  writeJson(FILES.admin, admin);
}
if (!admin) {
  const initial = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  admin = { username: 'admin', ...hashPassword(initial) };
  writeJson(FILES.admin, admin);
  console.log('──────────────────────────────────────────────');
  console.log(' Akun admin dibuat. Login portal /admin:');
  console.log(`   username: admin   password: ${initial}`);
  console.log(' Segera ganti lewat menu Akun di portal.');
  console.log('──────────────────────────────────────────────');
}

function checkPassword(password, rec) {
  if (typeof password !== 'string' || !password || password.length > 200) return false;
  const h = crypto.scryptSync(password, rec.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(rec.hash, 'hex'));
}

const verifyPassword = (password) => checkPassword(password, admin);

const sessions = new Map();

function sessionToken(req) {
  const m = /(?:^|;\s*)tvn_admin=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return null; }
  return m[1];
}

function makeLimiter(max, windowMs) {
  const attempts = new Map();
  return {
    limited(ip) {
      const a = attempts.get(ip);
      return Boolean(a && a.count >= max && a.until > Date.now());
    },
    hit(ip) {
      const a = attempts.get(ip) || { count: 0, until: 0 };
      if (a.until < Date.now()) a.count = 0;
      a.count++;
      a.until = Date.now() + windowMs;
      attempts.set(ip, a);
    },
    reset(ip) { attempts.delete(ip); },
  };
}

const TOO_MANY = { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };
const adminLimiter = makeLimiter(5, 5 * 60 * 1000);
const codeLimiter = makeLimiter(5, 5 * 60 * 1000);
const userLimiter = makeLimiter(8, 5 * 60 * 1000);
const registerLimiter = makeLimiter(5, 60 * 60 * 1000);

// ---------- Akun penonton ----------

let users = readJson(FILES.users, []);
const saveUsers = () => writeJson(FILES.users, users);

// Token sesi disimpan dalam bentuk hash, jadi isi file tidak bisa dipakai untuk login.
const userSessions = new Map(
  Object.entries(readJson(FILES.userSessions, {})).filter(([, s]) => s && s.exp > Date.now()),
);
const saveUserSessions = () => writeJson(FILES.userSessions, Object.fromEntries(userSessions));
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function normalizeLogin(value) {
  const s = str(value, 60).toLowerCase();
  return /^[a-z0-9._@+-]{3,60}$/.test(s) ? s : '';
}

function startUserSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  userSessions.set(tokenHash(token), { userId: user.id, exp: Date.now() + USER_SESSION_MS });
  saveUserSessions();
  return `tvn_user=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USER_SESSION_MS / 1000}`;
}

function userSessionKey(req) {
  const m = /(?:^|;\s*)tvn_user=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? tokenHash(m[1]) : null;
}

function currentUser(req) {
  const key = userSessionKey(req);
  const s = key && userSessions.get(key);
  if (!s) return null;
  const user = users.find((u) => u.id === s.userId);
  if (s.exp < Date.now() || !user || user.disabled) {
    userSessions.delete(key);
    saveUserSessions();
    return null;
  }
  return user;
}

function endUserSessions(userId, keepKey = null) {
  for (const [k, s] of userSessions) if (s.userId === userId && k !== keepKey) userSessions.delete(k);
  saveUserSessions();
}

function userAccess(user) {
  const now = Date.now();
  const active = codes.filter((c) => c.userId === user.id && c.redeemedAt && c.expiresAt > now)
    .sort((a, b) => b.expiresAt - a.expiresAt)[0];
  return active ? { plan: active.planName, expiresAt: active.expiresAt } : null;
}

const userView = (u) => ({ id: u.id, name: u.name, login: u.login, createdAt: u.createdAt, access: userAccess(u) });
const CLEAR_USER_COOKIE = 'tvn_user=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';

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

  if (p === '/api/ping') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  // --- Akun penonton ---
  const user = currentUser(req);
  const loginRequired = config.auth.requireLogin && !user;

  if (p === '/api/auth/register' && req.method === 'POST') {
    if (!config.auth.allowRegister) return sendJson(res, 403, { error: 'Pendaftaran akun sedang ditutup.' });
    if (registerLimiter.limited(ip)) return sendJson(res, 429, TOO_MANY);
    const body = await readBody(req);
    const login = normalizeLogin(body.login);
    if (!login) return sendJson(res, 400, { error: 'Username minimal 3 karakter, hanya huruf, angka, titik, garis bawah, atau strip.' });
    const name = str(body.name, 60) || login;
    if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 200) {
      return sendJson(res, 400, { error: 'Password minimal 6 karakter.' });
    }
    if (users.some((u) => u.login === login)) return sendJson(res, 409, { error: 'Username ini sudah dipakai. Pilih yang lain atau silakan masuk.' });
    registerLimiter.hit(ip);
    const now = Date.now();
    const created = { id: newId(), name, login, ...hashPassword(body.password), createdAt: now, lastLoginAt: now, disabled: false };
    users.push(created);
    saveUsers();
    return sendJson(res, 200, { user: userView(created) }, { 'Set-Cookie': startUserSession(created) });
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    if (userLimiter.limited(ip)) return sendJson(res, 429, TOO_MANY);
    const body = await readBody(req);
    const login = normalizeLogin(body.login);
    const found = login && users.find((u) => u.login === login);
    if (!found || !checkPassword(body.password, found)) {
      userLimiter.hit(ip);
      return sendJson(res, 401, { error: 'Username atau password salah.' });
    }
    if (found.disabled) return sendJson(res, 403, { error: 'Akun ini dinonaktifkan. Hubungi admin.' });
    userLimiter.reset(ip);
    found.lastLoginAt = Date.now();
    saveUsers();
    return sendJson(res, 200, { user: userView(found) }, { 'Set-Cookie': startUserSession(found) });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    const key = userSessionKey(req);
    if (key && userSessions.delete(key)) saveUserSessions();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': CLEAR_USER_COOKIE });
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    return user ? sendJson(res, 200, { user: userView(user) }) : sendJson(res, 401, { error: 'Silakan masuk.' });
  }

  if (p === '/api/auth/password' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { error: 'Silakan masuk.' });
    const { current, next } = await readBody(req);
    if (!checkPassword(current, user)) return sendJson(res, 400, { error: 'Password lama salah.' });
    if (typeof next !== 'string' || next.length < 6 || next.length > 200) return sendJson(res, 400, { error: 'Password baru minimal 6 karakter.' });
    Object.assign(user, hashPassword(next));
    saveUsers();
    endUserSessions(user.id, userSessionKey(req));
    return sendJson(res, 200, { ok: true });
  }

  // --- Publik (tertutup bila wajib login) ---
  if (p === '/api/config' && req.method === 'GET') {
    if (loginRequired) return sendJson(res, 200, { site: config.site, auth: config.auth, user: null, locked: true });
    return sendJson(res, 200, { ...publicView(config), user: user ? userView(user) : null });
  }

  if (!p.startsWith('/api/admin/') && loginRequired) return sendJson(res, 401, { error: 'Silakan masuk terlebih dahulu.' });

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
    if (!user) return sendJson(res, 401, { error: 'Masuk ke akun Anda dulu untuk memakai kode akses.' });
    if (codeLimiter.limited(ip)) return sendJson(res, 429, TOO_MANY);
    const { code } = await readBody(req);
    const c = codes.find((x) => x.code === String(code || '').trim().toUpperCase());
    if (!c) { codeLimiter.hit(ip); return sendJson(res, 404, { error: 'Kode akses tidak ditemukan.' }); }
    if (c.userId && c.userId !== user.id) return sendJson(res, 409, { error: 'Kode ini sudah dipakai akun lain.' });
    if (!c.redeemedAt) {
      const plan = config.payment.plans.find((x) => x.id === c.planId);
      const current = userAccess(user);
      c.redeemedAt = Date.now();
      c.expiresAt = Math.max(c.redeemedAt, current ? current.expiresAt : 0)
        + (plan ? plan.durationDays : c.durationDays || 1) * 86400000;
    }
    if (c.expiresAt <= Date.now()) return sendJson(res, 410, { error: 'Kode akses sudah kedaluwarsa.' });
    c.userId = user.id;
    writeJson(FILES.codes, codes);
    return sendJson(res, 200, { user: userView(user) });
  }

  if (p === '/api/access/sources' && req.method === 'GET') {
    if (!user || !userAccess(user)) return sendJson(res, 403, { error: 'Akses premium tidak aktif.' });
    const slug = url.searchParams.get('slug') || '';
    const ch = config.channels.find((c) => c.enabled && (c.slug || slugify(c.name)) === slug);
    if (!ch) return sendJson(res, 404, { error: 'Channel tidak ditemukan.' });
    return sendJson(res, 200, { sources: ch.sources });
  }

  // --- Admin: login ---
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (adminLimiter.limited(ip)) return sendJson(res, 429, TOO_MANY);
    const { username, password } = await readBody(req);
    const sameUser = String(username || '').trim().toLowerCase() === admin.username;
    if (!verifyPassword(password) || !sameUser) { adminLimiter.hit(ip); return sendJson(res, 401, { error: 'Username atau password salah.' }); }
    adminLimiter.reset(ip);
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
    admin = { username: admin.username, ...hashPassword(next) };
    writeJson(FILES.admin, admin);
    for (const t of sessions.keys()) if (t !== token) sessions.delete(t);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      views: stats.views,
      codes: { total: codes.length, active: codes.filter((c) => codeStatus(c) === 'aktif').length, unused: codes.filter((c) => !c.redeemedAt).length },
      users: { total: users.length, premium: users.filter((u) => userAccess(u)).length },
    });
  }

  if (p === '/api/admin/codes' && req.method === 'GET') {
    const owner = (id) => {
      if (!id) return '';
      const u = users.find((x) => x.id === id);
      return u ? `${u.name} (${u.login})` : '(akun dihapus)';
    };
    return sendJson(res, 200, codes.map((c) => ({ ...c, status: codeStatus(c), usedBy: owner(c.userId) })).reverse());
  }

  if (p === '/api/admin/users' && req.method === 'GET') {
    return sendJson(res, 200, users.map((u) => ({
      id: u.id, name: u.name, login: u.login, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      disabled: Boolean(u.disabled), access: userAccess(u),
    })).reverse());
  }

  const userRoute = /^\/api\/admin\/users\/([a-f0-9]{12})(\/reset-password)?$/.exec(p);
  if (userRoute) {
    const target = users.find((u) => u.id === userRoute[1]);
    if (!target) return sendJson(res, 404, { error: 'Pengguna tidak ditemukan.' });
    if (userRoute[2] && req.method === 'POST') {
      const temp = crypto.randomBytes(6).toString('base64url');
      Object.assign(target, hashPassword(temp));
      saveUsers();
      endUserSessions(target.id);
      return sendJson(res, 200, { password: temp });
    }
    if (!userRoute[2] && req.method === 'PATCH') {
      const body = await readBody(req);
      target.disabled = bool(body.disabled);
      saveUsers();
      if (target.disabled) endUserSessions(target.id);
      return sendJson(res, 200, { ok: true });
    }
    if (!userRoute[2] && req.method === 'DELETE') {
      users = users.filter((u) => u !== target);
      saveUsers();
      endUserSessions(target.id);
      return sendJson(res, 200, { ok: true });
    }
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

// ---------- Mode pengembangan: halaman memuat ulang sendiri saat file diedit ----------

const reloadClients = new Set();
const DEV_SNIPPET = `<script>(() => {
  let lost = false;
  const es = new EventSource('/__dev/reload');
  es.onmessage = () => location.reload();
  es.onerror = () => { lost = true; };
  es.onopen = () => { if (lost) location.reload(); };
})();</script>`;

if (DEV) {
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { for (const c of reloadClients) c.write('data: reload\n\n'); }, 150);
  };
  for (const target of ['index.html', 'assets', 'admin']) fs.watch(path.join(ROOT, target), notify);
  setInterval(() => { for (const c of reloadClients) c.write(': ping\n\n'); }, 25000).unref();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (DEV && url.pathname === '/__dev/reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }
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
    res.end(DEV && file.endsWith('.html') ? data.toString().replace('</body>', DEV_SNIPPET + '</body>') : data);
  });
});

server.listen(PORT, () => {
  console.log(`TEKDROID TV berjalan di http://localhost:${PORT}`);
  console.log(`Portal admin: http://localhost:${PORT}/admin`);
  const lan = Object.values(require('os').networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  if (lan.length) console.log(`Dari HP / aplikasi (satu Wi-Fi): ${lan.join('  ')}`);
  if (DEV) console.log('Mode pengembangan: halaman di semua perangkat memuat ulang otomatis saat file diedit.');
});

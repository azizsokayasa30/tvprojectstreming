// Menjalankan TEKDROID TV agar bisa dibuka dari jaringan mana pun (npm run online):
// - menyalakan server lokal bila belum berjalan,
// - membuka Cloudflare Quick Tunnel (gratis, tanpa akun) ke server itu,
// - mengumumkan alamat publiknya di branch `server-url` GitHub, tempat APK membacanya.
// Alamat trycloudflare.com berganti tiap kali tunnel dibuka ulang, jadi selalu diumumkan ulang.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const LOCAL = `http://localhost:${PORT}`;
const BRANCH = 'server-url';
const IS_WIN = process.platform === 'win32';
const CLOUDFLARED = path.join(ROOT, 'tools', IS_WIN ? 'cloudflared.exe' : 'cloudflared');
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/'
  + (IS_WIN ? 'cloudflared-windows-amd64.exe' : 'cloudflared-linux-amd64');

const children = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url, timeoutMs = 4000) {
  try {
    const res = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureCloudflared() {
  if (fs.existsSync(CLOUDFLARED)) return;
  console.log('Mengunduh cloudflared (sekali saja, sekitar 55 MB)…');
  fs.mkdirSync(path.dirname(CLOUDFLARED), { recursive: true });
  const partial = CLOUDFLARED + '.part';
  try {
    execFileSync('curl', ['-L', '--fail', '--retry', '3', '-o', partial, CLOUDFLARED_URL], { stdio: 'inherit' });
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal mengunduh cloudflared. Cek koneksi internet lalu jalankan ulang.');
    const res = await fetch(CLOUDFLARED_URL);
    if (!res.ok) throw new Error(`Gagal mengunduh cloudflared: HTTP ${res.status}`);
    fs.writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
  }
  fs.chmodSync(partial, 0o755);
  fs.renameSync(partial, CLOUDFLARED);
}

async function ensureServer() {
  if (await reachable(LOCAL)) {
    console.log(`Server sudah berjalan di ${LOCAL}`);
    return;
  }
  console.log('Menyalakan server…');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit' });
  children.add(server);
  server.on('exit', (code) => {
    children.delete(server);
    if (stopping) return;
    console.error(`Server berhenti (kode ${code}). Menutup tunnel.`);
    shutdown(1);
  });
  for (let i = 0; i < 30; i++) {
    if (await reachable(LOCAL)) return;
    await sleep(500);
  }
  throw new Error('Server tidak merespons di ' + LOCAL);
}

function git(args, input) {
  return execFileSync('git', args, { cwd: ROOT, input, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function launcherPage(url) {
  const safe = url.replace(/[^\w:/.-]/g, '');
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${safe}">
  <title>TEKDROID TV</title>
</head>
<body style="background:#0a0e17;color:#e7ecf5;font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
  <p>Membuka TEKDROID TV… <a style="color:#0ea5e9" href="${safe}">klik di sini</a> bila tidak terbuka otomatis.</p>
  <script>location.replace(${JSON.stringify(safe)});</script>
</body>
</html>
`;
}

// Ditulis lewat git plumbing ke branch terpisah sehingga folder kerja dan branch main tidak tersentuh.
function publish(url) {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'public-url.txt'), url + '\n');
  try {
    const json = git(['hash-object', '-w', '--stdin'], JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    const html = git(['hash-object', '-w', '--stdin'], launcherPage(url));
    const tree = git(['mktree'], `100644 blob ${html}\tindex.html\n100644 blob ${json}\tserver-url.json\n`);
    const commit = git(['commit-tree', tree, '-m', `Alamat server: ${url}`]);
    git(['push', '-f', '-q', 'origin', `${commit}:refs/heads/${BRANCH}`]);
    console.log('Alamat baru sudah diumumkan ke GitHub; APK akan memakainya otomatis.');
  } catch (err) {
    console.error('Gagal mengumumkan alamat ke GitHub (APK belum tahu alamat baru):', err.message);
  }
}

function banner(url) {
  const line = '='.repeat(64);
  console.log(`\n${line}\n  TEKDROID TV ONLINE — bisa dibuka dari jaringan mana pun:\n\n    ${url}\n    ${url}/admin   (portal admin)\n\n  Biarkan jendela ini tetap terbuka. Tekan Ctrl+C untuk berhenti.\n${line}\n`);
}

// File yang baru diunduh bisa terkunci sebentar saat dipindai antivirus Windows (EBUSY).
async function spawnCloudflared() {
  for (let attempt = 1; ; attempt++) {
    try {
      return spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', LOCAL], { cwd: ROOT });
    } catch (err) {
      if (err.code !== 'EBUSY' || attempt >= 15) throw err;
      await sleep(2000);
    }
  }
}

async function startTunnel() {
  const tunnel = await spawnCloudflared();
  children.add(tunnel);
  let announced = false;
  let buffer = '';
  const onData = async (chunk) => {
    buffer += chunk.toString();
    const match = !announced && buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return;
    announced = true;
    buffer = '';
    const url = match[0];
    console.log(`Tunnel dibuka: ${url} — menunggu alamat aktif…`);
    for (let i = 0; i < 40 && !(await reachable(url, 5000)); i++) await sleep(1500);
    publish(url);
    banner(url);
  };
  tunnel.on('error', (err) => console.error('cloudflared gagal dijalankan:', err.message));
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.on('exit', async (code) => {
    children.delete(tunnel);
    if (stopping) return;
    console.error(`Tunnel terputus (kode ${code}). Membuka ulang dalam 5 detik…`);
    await sleep(5000);
    if (!stopping) startTunnel().catch((err) => { console.error(err.message); shutdown(1); });
  });
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

(async () => {
  try {
    await ensureCloudflared();
    await ensureServer();
    await startTunnel();
  } catch (err) {
    console.error(err.message);
    shutdown(1);
  }
})();

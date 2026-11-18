// Menyiapkan proyek Capacitor sebelum build:
//   node scripts/prepare.js [alamat-server-wifi] [--debug]
// - menulis capacitor.config.json
// - menyalin www/ ke build/www/ dengan repo pengumuman alamat & alamat Wi-Fi cadangan terisi
// - membuat gambar ikon & splash di assets/ untuk @capacitor/assets
// Aplikasi membuka www/index.html, yang mencari alamat server terbaru (lihat scripts/online.js di root).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const isDebug = args.includes('--debug') || process.env.APK_DEBUG === '1';
const lanUrl = (args.find((a) => !a.startsWith('--')) || process.env.SERVER_URL || '').trim().replace(/\/+$/, '');
const urlRepo = (process.env.URL_REPO || process.env.GITHUB_REPOSITORY || 'azizsokayasa30/tvprojectstreming').trim();

if (lanUrl && !/^https?:\/\/[^\s/]+(:\d+)?$/i.test(lanUrl)) {
  console.error('Alamat server Wi-Fi tidak valid. Contoh: node scripts/prepare.js http://192.168.2.101:8080');
  process.exit(1);
}
if (!/^[\w.-]+\/[\w.-]+$/.test(urlRepo)) {
  console.error('URL_REPO harus berbentuk pemilik/nama-repo.');
  process.exit(1);
}

const lanHost = lanUrl ? new URL(lanUrl).hostname : '';
// IP LAN lain diizinkan di native (FrameLoginClient) agar form alamat manual tidak perlu rebuild.
const allowNavigation = [
  '*.trycloudflare.com', 'rctiplus.com', '*.rctiplus.com', 'vidio.com', '*.vidio.com',
  'localhost', '127.0.0.1',
  ...(lanHost ? [lanHost] : []),
];

const config = {
  appId: isDebug ? 'id.tekdroid.tv.debug' : 'id.tekdroid.tv',
  appName: isDebug ? 'TEKDROID TV Debug' : 'TEKDROID TV',
  webDir: 'build/www',
  backgroundColor: '#06121f',
  // Tanda bagi web bahwa APK ini menangani layar penuh + landscape secara native (lihat native/).
  appendUserAgent: 'TekdroidFullscreen',
  server: {
    androidScheme: 'https',
    cleartext: true,
    // RCTI+ di HP hanya bisa diputar sebagai halaman utama (cookie-nya ditolak di iframe), jadi dibuka di dalam aplikasi.
    // Login Vidio (lihat native/FrameLoginClient.java) juga harus tetap di dalam aplikasi.
    allowNavigation,
    errorPath: 'error.html',
  },
  android: {
    allowMixedContent: true,
    adjustMarginsForEdgeToEdge: 'force',
  },
};
fs.writeFileSync(path.join(ROOT, 'capacitor.config.json'), JSON.stringify(config, null, 2));

const outDir = path.join(ROOT, 'build', 'www');
fs.rmSync(path.join(ROOT, 'build'), { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(path.join(ROOT, 'www'))) {
  const html = fs.readFileSync(path.join(ROOT, 'www', file), 'utf8');
  fs.writeFileSync(
    path.join(outDir, file),
    html
      .replaceAll('__SERVER_URL__', lanUrl)
      .replaceAll('__URL_REPO__', urlRepo)
      .replaceAll('__DEBUG__', isDebug ? '1' : '0'),
  );
}

async function makeAssets() {
  const dir = path.join(ROOT, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const icon = fs.readFileSync(path.join(ROOT, 'resources', 'icon.svg'));
  const bg = { r: 6, g: 18, b: 31, alpha: 1 };

  await sharp(icon).resize(1024, 1024).png().toFile(path.join(dir, 'icon-only.png'));
  // Ikon adaptif Android: gambar TV di lapisan depan, gradasi di lapisan belakang.
  const svg = icon.toString();
  const shapes = svg.replace(/<rect width="1024" height="1024"[^>]*\/>/, '');
  const background = svg.replace(/<\/defs>[\s\S]*<\/svg>/, '</defs><rect width="1024" height="1024" fill="url(#bg)"/></svg>');
  await sharp(Buffer.from(shapes)).resize(1024, 1024).png().toFile(path.join(dir, 'icon-foreground.png'));
  await sharp(Buffer.from(background)).resize(1024, 1024).png().toFile(path.join(dir, 'icon-background.png'));

  const corners = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560"><rect width="560" height="560" rx="128"/></svg>');
  const logo = await sharp(icon).resize(560, 560).composite([{ input: corners, blend: 'dest-in' }]).png().toBuffer();
  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
      .composite([{ input: logo, gravity: 'center' }]).png().toFile(path.join(dir, name));
  }
}

makeAssets().then(() => {
  const kind = isDebug ? 'APK Debug' : 'APK';
  console.log(`Siap build ${kind} (${config.appId}). Alamat server dibaca dari github.com/${urlRepo} (branch server-url)${lanUrl ? `, cadangan Wi-Fi: ${lanUrl}` : ''}.`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

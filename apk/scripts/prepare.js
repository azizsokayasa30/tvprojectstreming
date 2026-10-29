// Menyiapkan proyek Capacitor sebelum build:
//   node scripts/prepare.js http://192.168.0.168:8080
// - menulis capacitor.config.json dengan alamat server
// - menyalin www/ ke build/www/ dengan alamat server terisi
// - membuat gambar ikon & splash di assets/ untuk @capacitor/assets
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const serverUrl = (process.argv[2] || process.env.SERVER_URL || '').trim().replace(/\/+$/, '');

if (!/^https?:\/\/[^\s/]+/i.test(serverUrl)) {
  console.error('Alamat server tidak valid. Contoh: node scripts/prepare.js http://192.168.0.168:8080');
  process.exit(1);
}

const config = {
  appId: 'id.tekdroid.tv',
  appName: 'TEKDROID TV',
  webDir: 'build/www',
  backgroundColor: '#0a0e17',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http:'),
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
  fs.writeFileSync(path.join(outDir, file), html.replaceAll('__SERVER_URL__', serverUrl));
}

async function makeAssets() {
  const dir = path.join(ROOT, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const icon = fs.readFileSync(path.join(ROOT, 'resources', 'icon.svg'));
  const bg = { r: 10, g: 14, b: 23, alpha: 1 };

  await sharp(icon).resize(1024, 1024).png().toFile(path.join(dir, 'icon-only.png'));
  // Ikon adaptif Android: gambar TV di lapisan depan, gradasi di lapisan belakang.
  const svg = icon.toString();
  const shapes = svg.replace(/<rect width="1024" height="1024"[^>]*\/>/, '');
  const background = svg.replace(/<\/defs>[\s\S]*<\/svg>/, '</defs><rect width="1024" height="1024" fill="url(#bg)"/></svg>');
  await sharp(Buffer.from(shapes)).resize(1024, 1024).png().toFile(path.join(dir, 'icon-foreground.png'));
  await sharp(Buffer.from(background)).resize(1024, 1024).png().toFile(path.join(dir, 'icon-background.png'));

  const logo = await sharp(icon).resize(560, 560).png().toBuffer();
  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
      .composite([{ input: logo, gravity: 'center' }]).png().toFile(path.join(dir, name));
  }
}

makeAssets().then(() => {
  console.log(`Siap build. Aplikasi akan membuka: ${serverUrl}`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

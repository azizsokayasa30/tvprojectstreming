(() => {
  'use strict';

  const PLAYLIST_CACHE = 'playlist';
  // Dipakai jika server tidak berjalan (mis. index.html dibuka langsung dari file://).
  const FALLBACK_CONFIG = {
    site: {
      name: 'TEKDROID TV', logoUrl: '', accent: '#0ea5e9', theme: 'dark',
      welcomeTitle: 'Nonton TV Indonesia, live.', welcomeText: 'Pilih channel dari daftar untuk mulai menonton.',
      announcement: { enabled: false, text: '', tone: 'info' }, sidebarPosition: 'right',
      showQuickGrid: true, quickGridCount: 18, defaultCategory: 'Semua', footerText: '',
    },
    streaming: {
      playlistEnabled: true, playlistUrl: 'https://iptv-org.github.io/iptv/countries/id.m3u', hiddenPlaylist: [],
      defaultQuality: 'auto', startMuted: false, autoFallback: true, loadTimeoutSec: 25, maxBufferSec: 30, lowLatency: false,
    },
    payment: { enabled: false },
  };
  const SPLASH_MIN_MS = 2200;
  const LIVE_EVERY_MS = 60000;
  const CATEGORY_ORDER = ['Semua', 'Nasional', 'Berita', 'Olahraga', 'TVRI Daerah', 'Daerah & Lainnya', 'Religi', 'Anak & Edukasi'];
  const REGION_NAMES = {
    'Central Java': 'Jawa Tengah', 'East Java': 'Jawa Timur', 'West Java': 'Jawa Barat',
    'Central Kalimantan': 'Kalimantan Tengah', 'East Kalimantan': 'Kalimantan Timur',
    'South Kalimantan': 'Kalimantan Selatan', 'West Kalimantan': 'Kalimantan Barat',
    'North Sulawesi': 'Sulawesi Utara', 'Central Sulawesi': 'Sulawesi Tengah',
    'South Sulawesi': 'Sulawesi Selatan', 'Southeast Sulawesi': 'Sulawesi Tenggara',
    'West Sulawesi': 'Sulawesi Barat', 'North Sumatra': 'Sumatera Utara',
    'South Sumatra': 'Sumatera Selatan', 'West Sumatra': 'Sumatera Barat',
    'East Nusa Tenggara': 'NTT', 'West Nusa Tenggara': 'NTB', 'West Papua': 'Papua Barat',
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    player: $('player'), video: $('video'), frameHost: $('frameHost'),
    welcome: $('welcome'), quickGrid: $('quickGrid'), exampleUrl: $('exampleUrl'),
    external: $('external'), externalLogo: $('externalLogo'), externalTitle: $('externalTitle'),
    externalText: $('externalText'), externalLink: $('externalLink'), externalBtnText: $('externalBtnText'),
    externalNext: $('externalNext'),
    message: $('message'), messageTitle: $('messageTitle'), messageText: $('messageText'),
    retryBtn: $('retryBtn'), nextSourceBtn: $('nextSourceBtn'),
    bigPlay: $('bigPlay'), unmuteBtn: $('unmuteBtn'),
    playBtn: $('playBtn'), muteBtn: $('muteBtn'), volume: $('volume'), ctlTitle: $('ctlTitle'),
    qualityBtn: $('qualityBtn'), qualityBadge: $('qualityBadge'), qualityMenu: $('qualityMenu'),
    pipBtn: $('pipBtn'), fsBtn: $('fsBtn'), fsCorner: $('fsCorner'),
    fsUpdate: $('fsUpdate'), fsUpdateClose: $('fsUpdateClose'),
    infobar: $('infobar'), nowLogo: $('nowLogo'), nowName: $('nowName'), nowMeta: $('nowMeta'),
    qualitySelect: $('qualitySelect'),
    copyBtn: $('copyBtn'), fsInfoBtn: $('fsInfoBtn'),
    search: $('search'), list: $('list'), status: $('status'),
    listHead: $('listHead'), catTitle: $('catTitle'), catCount: $('catCount'),
    drawer: $('drawer'), drawerNav: $('drawerNav'), drawerClose: $('drawerClose'),
    toast: $('toast'), pullRefresh: $('pullRefresh'), brandLink: $('brandLink'), brandMark: $('brandMark'), brandName: $('brandName'),
    welcomeTitle: $('welcomeTitle'), welcomeText: $('welcomeText'), announce: $('announce'),
    layout: $('layout'), footer: $('footer'),
    paywallLogo: $('paywallLogo'), paywallTitle: $('paywallTitle'), paywallForm: $('paywallForm'),
    paywallCode: $('paywallCode'), paywallPlans: $('paywallPlans'), paywallPrice: $('paywallPrice'),
    subscribeBtn: $('subscribeBtn'), subscribeText: $('subscribeText'), subModal: $('subModal'), subClose: $('subClose'),
    accessStatus: $('accessStatus'), plans: $('plans'), payMethods: $('payMethods'), payInstructions: $('payInstructions'),
    redeemForm: $('redeemForm'), redeemCode: $('redeemCode'), waBtn: $('waBtn'),
    settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'), settingsClose: $('settingsClose'), themeChoice: $('themeChoice'),
    splash: $('splash'), splashMark: $('splashMark'), splashName: $('splashName'), splashVersion: $('splashVersion'),
    updateModal: $('updateModal'), updateVersions: $('updateVersions'), updateBtn: $('updateBtn'), updateLater: $('updateLater'),
  };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('tvn.' + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('tvn.' + key, JSON.stringify(value)); } catch { /* storage penuh/diblokir */ }
    },
  };

  const state = {
    channels: [],
    bySlug: new Map(),
    current: null,
    sourceIndex: 0,
    hls: null,
    manualLevel: -1,
    token: 0,
    loadTimer: null,
    category: 'Semua',
    query: '',
    playlistLoaded: false,
    settings: FALLBACK_CONFIG,
    nationalTvgIds: new Set(),
    access: null,
    live: null,
  };

  const activeAccess = () => {
    const a = state.access;
    return a && a.expiresAt > Date.now() ? a : null;
  };

  // ---------- Utilitas ----------

  function slugify(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(name) {
    const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : name.slice(0, 4)).toUpperCase();
  }

  function logoBox(channel, extraClass = '') {
    const box = document.createElement('span');
    box.className = 'logo ' + extraClass;
    const fallback = () => {
      box.classList.add('text');
      box.textContent = initials(channel.name);
    };
    if (channel.logo) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = channel.logo;
      img.onerror = fallback;
      box.appendChild(img);
    } else {
      fallback();
    }
    return box;
  }

  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  function sourceLabel(src) {
    switch (src.type) {
      case 'vidio': return 'Vidio.com';
      case 'youtube': return 'YouTube (resmi)';
      case 'iframe': return src.label || 'Player resmi';
      case 'web': return src.label || 'Situs resmi';
      default: return src.origin === 'playlist' ? 'Stream publik (HLS)' : 'Stream resmi (HLS)';
    }
  }

  const MODE_BY_TYPE = { hls: 'hls', iframe: 'frame', youtube: 'frame', vidio: 'frame', web: 'external' };

  const IS_PHONE = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);

  // Sumber "khusus HP" didahulukan di HP dan tidak dipakai di komputer. RCTI+ tidak bisa diputar di dalam
  // pemutar di HP (lihat RCTI_MOBILE), jadi di HP sumber lain yang bisa langsung diputar dicoba lebih dulu.
  function arrangeSources(sources) {
    const rank = (s) => {
      if (s.mobileOnly) return 0;
      return RCTI_MOBILE && s.type === 'iframe' && isRctiUrl(s.url) ? 2 : 1;
    };
    return sources.filter((s) => IS_PHONE || !s.mobileOnly).sort((a, b) => rank(a) - rank(b));
  }

  function onlyExternal(ch) {
    return ch.sources.length > 0 && ch.sources.every((s) => s.type === 'vidio');
  }

  const isLocked = (ch) => ch.premium && !ch.sources.length;

  // ---------- Data channel ----------

  function addChannel(ch) {
    const base = ch.slug || slugify(ch.name) || 'channel';
    let slug = base;
    let n = 2;
    while (state.bySlug.has(slug)) slug = `${base}-${n++}`;
    if (!ch.groups || !ch.groups.length) ch.groups = ['Daerah & Lainnya'];
    ch.slug = slug;
    state.bySlug.set(slug, ch);
    const compact = slug.replace(/-/g, '');
    if (!state.bySlug.has(compact)) state.bySlug.set(compact, ch);
    (ch.aliases || []).forEach((a) => { if (!state.bySlug.has(a)) state.bySlug.set(a, ch); });
    state.channels.push(ch);
  }

  function parseM3U(text) {
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        const re = /([\w-]+)="([^"]*)"/g;
        let m;
        while ((m = re.exec(line))) attrs[m[1]] = m[2];
        const cut = line.lastIndexOf('",');
        const name = cut >= 0 ? line.slice(cut + 2) : line.slice(line.indexOf(',') + 1);
        cur = { attrs, name: name.trim() };
      } else if (!line.startsWith('#') && cur) {
        cur.url = line;
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  function cleanName(raw) {
    const tags = [];
    let res = null;
    let name = raw
      .replace(/\[(.*?)\]/g, (_, t) => { tags.push(t); return ''; })
      .replace(/\((\d{3,4}[pi])\)/g, (_, r) => { res = r; return ''; })
      .replace(/\((Indonesia|Taiwan)\)/g, '');
    for (const [en, id] of Object.entries(REGION_NAMES)) name = name.replace(en, id);
    return { name: name.replace(/\s+/g, ' ').trim(), tags, res };
  }

  function groupsFor(name, groupTitle) {
    const g = (groupTitle || '').split(';');
    const out = [];
    if (/^TVRI Sport\b/.test(name)) return ['Olahraga', 'Nasional'];
    if (/^TVRI World\b/.test(name)) return ['Nasional'];
    if (/^TVRI\b/.test(name)) out.push('TVRI Daerah');
    if (g.some((x) => ['News', 'Business', 'Legislative'].includes(x))) out.push('Berita');
    if (g.includes('Sports')) out.push('Olahraga');
    if (g.includes('Religious')) out.push('Religi');
    if (g.some((x) => ['Kids', 'Education'].includes(x))) out.push('Anak & Edukasi');
    if (!out.length || (!out.includes('TVRI Daerah') && !out.includes('Religi') && !out.includes('Anak & Edukasi'))) {
      out.push('Daerah & Lainnya');
    }
    return out;
  }

  function ingestPlaylist(text) {
    const national = state.nationalTvgIds;
    const hidden = new Set(state.settings.streaming.hiddenPlaylist);
    let added = 0;
    for (const entry of parseM3U(text)) {
      const tvgId = entry.attrs['tvg-id'] || '';
      const [base, feed = ''] = tvgId.split('@');
      if (!/\.id$/.test(base)) continue;                         // hanya channel Indonesia
      if (national.has(base) && ['SD', 'HD', 'FHD', ''].includes(feed)) continue;
      if (hidden.has(tvgId)) continue;                           // disembunyikan dari portal admin
      // Stream yang mewajibkan Referer/User-Agent khusus hanya boleh diputar di situs pemiliknya.
      if (entry.attrs['http-referrer'] || entry.attrs['http-user-agent']) continue;
      if (!/\.m3u8?(\?|$)/i.test(entry.url) && !/\/play\//.test(entry.url)) continue; // lewati DASH/format lain
      const { name, tags, res } = cleanName(entry.name);
      addChannel({
        name,
        tvgId,
        logo: entry.attrs['tvg-logo'] || '',
        groups: groupsFor(name, entry.attrs['group-title']),
        tags,
        res,
        sources: [{ type: 'hls', url: entry.url, origin: 'playlist' }],
      });
      added++;
    }
    return added;
  }

  async function loadPlaylist() {
    const { playlistEnabled, playlistUrl } = state.settings.streaming;
    if (!playlistEnabled || !playlistUrl) {
      state.playlistLoaded = true;
      el.status.textContent = `${state.channels.length} channel`;
      route();
      autoStart();
      return;
    }
    const cached = store.get(PLAYLIST_CACHE, null);
    let text = null;
    try {
      const res = await fetch(playlistUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
      store.set(PLAYLIST_CACHE, { at: Date.now(), url: playlistUrl, text });
    } catch (err) {
      console.warn('Gagal memuat playlist, memakai cache:', err);
      text = cached && cached.url === playlistUrl ? cached.text : null;
    }
    const added = text ? ingestPlaylist(text) : 0;
    state.playlistLoaded = true;
    el.status.textContent = text
      ? `${state.channels.length} channel · ${added} channel daerah dari playlist`
      : 'Channel daerah gagal dimuat (cek koneksi internet).';
    renderChips();
    renderList();
    route();
    autoStart();
  }

  // ---------- Daftar & filter ----------

  // Channel playlist yang terdeteksi mati oleh server disembunyikan, dan muncul lagi saat siarannya kembali.
  function channelOffline(ch) {
    const live = state.live;
    if (ch.id || ch === state.current || !live || !live.checkedAt) return false;
    const src = ch.sources[0];
    return Boolean(src) && live.playlist[src.url] === false;
  }

  function listedChannels() {
    return state.channels.filter((c) => !channelOffline(c));
  }

  function visibleChannels() {
    const q = state.query.trim().toLowerCase();
    return listedChannels().filter((c) =>
      (state.category === 'Semua' || c.groups.includes(state.category)) &&
      (!q || c.name.toLowerCase().includes(q) || c.slug.includes(slugify(q))));
  }

  function renderChips() {
    const counts = {};
    const listed = listedChannels();
    for (const c of listed) for (const g of c.groups) counts[g] = (counts[g] || 0) + 1;
    counts['Semua'] = listed.length;
    el.drawerNav.innerHTML = '';
    const custom = Object.keys(counts).filter((c) => !CATEGORY_ORDER.includes(c));
    for (const cat of [...CATEGORY_ORDER, ...custom]) {
      if (!counts[cat]) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cat === state.category ? 'on' : '';
      b.innerHTML = `<span>${escapeHtml(cat)}</span><em>${counts[cat]}</em>`;
      b.onclick = () => selectCategory(cat);
      el.drawerNav.appendChild(b);
    }
    el.catTitle.textContent = state.category;
    el.catCount.textContent = `${counts[state.category] || 0} channel`;
  }

  function selectCategory(cat) {
    state.category = cat;
    renderChips();
    renderList();
    closeDrawer();
    el.list.scrollTop = 0;
    const top = el.listHead.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight - 120) el.listHead.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openDrawer() {
    el.drawer.hidden = false;
    const on = el.drawerNav.querySelector('.on') || el.drawerNav.querySelector('button');
    if (on) on.focus();
  }

  function closeDrawer() { el.drawer.hidden = true; }

  function renderList() {
    const items = visibleChannels();
    el.list.innerHTML = '';
    if (!items.length) {
      el.list.innerHTML = '<li class="empty">Channel tidak ditemukan.</li>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const ch of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item' + (ch === state.current ? ' on' : '');
      btn.dataset.slug = ch.slug;
      btn.appendChild(logoBox(ch));
      const tags = [];
      if (ch.premium) tags.push('<span class="tag premium"><svg><use href="#i-star"/></svg>Premium</span>');
      if (ch.res) tags.push(`<span class="tag">${escapeHtml(ch.res)}</span>`);
      if (onlyExternal(ch)) tags.push('<span class="tag">di Vidio</span>');
      for (const t of ch.tags || []) {
        tags.push(`<span class="tag red">${escapeHtml(t === 'Not 24/7' ? 'Tidak 24 jam' : t)}</span>`);
      }
      const text = document.createElement('span');
      text.className = 'item-text';
      text.innerHTML = `<span class="item-name">${escapeHtml(ch.name)}</span>` +
        `<span class="item-sub">${escapeHtml(ch.groups[0])}${tags.join('')}</span>`;
      btn.appendChild(text);
      btn.classList.toggle('live', channelLive(ch));
      btn.insertAdjacentHTML('beforeend', '<span class="live-tag"><i></i>LIVE</span><span class="eq"><i></i><i></i><i></i></span>');
      btn.onclick = () => navigate(ch.slug);
      li.appendChild(btn);
      frag.appendChild(li);
    }
    el.list.appendChild(frag);
  }

  // Channel dari server punya id; channel playlist dicocokkan lewat URL stream-nya.
  function channelLive(ch) {
    const live = state.live;
    if (!live) return false;
    if (ch.id) return live.channels[ch.id] === true;
    const src = ch.sources[0];
    return Boolean(src && live.playlist[src.url]);
  }

  async function refreshLive() {
    if (!document.hidden) {
      try {
        const res = await fetch(`${basePath}api/live`, { cache: 'no-store' });
        if (res.ok) state.live = await res.json();
      } catch { /* offline */ }
      const offline = state.channels.filter(channelOffline).map((c) => c.slug).join();
      if (offline !== state.offlineKey) {
        state.offlineKey = offline;
        renderChips();
        renderList();
      }
      for (const b of el.list.querySelectorAll('.item')) {
        const ch = state.bySlug.get(b.dataset.slug);
        if (ch) b.classList.toggle('live', channelLive(ch));
      }
    }
    // Selama pengecekan pertama di server belum selesai, tanya lebih sering agar badge cepat muncul.
    setTimeout(refreshLive, state.live && state.live.checkedAt ? LIVE_EVERY_MS : 10000);
  }

  function highlightActive() {
    for (const b of el.list.querySelectorAll('.item')) {
      b.classList.toggle('on', state.current && b.dataset.slug === state.current.slug);
    }
    const on = el.list.querySelector('.item.on');
    if (on) {
      // Gulir daftar saja, bukan seluruh halaman, supaya player tetap terlihat.
      const top = on.getBoundingClientRect().top - el.list.getBoundingClientRect().top + el.list.scrollTop;
      if (top < el.list.scrollTop || top + on.offsetHeight > el.list.scrollTop + el.list.clientHeight) {
        el.list.scrollTop = top - el.list.clientHeight / 2 + on.offsetHeight / 2;
      }
    }
  }

  function renderQuickGrid() {
    const { showQuickGrid, quickGridCount } = state.settings.site;
    el.quickGrid.innerHTML = '';
    el.quickGrid.hidden = !showQuickGrid;
    if (!showQuickGrid) return;
    const national = state.channels.filter((c) => c.groups.includes('Nasional'));
    const ordered = [...national.filter((c) => !onlyExternal(c)), ...national.filter(onlyExternal)];
    for (const ch of ordered.slice(0, quickGridCount)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.appendChild(logoBox(ch));
      b.insertAdjacentHTML('beforeend', `<span>${escapeHtml(ch.name)}</span>`);
      b.onclick = () => navigate(ch.slug);
      el.quickGrid.appendChild(b);
    }
  }

  // ---------- Routing: /indosiar atau #/indosiar ----------

  const useHistory = location.protocol.startsWith('http');
  const basePath = new URL('../', document.currentScript.src).pathname;

  function currentSlug() {
    if (location.hash.startsWith('#/')) return decodeURIComponent(location.hash.slice(2)).toLowerCase();
    if (useHistory && location.pathname.startsWith(basePath)) {
      const p = location.pathname.slice(basePath.length).replace(/\/+$/, '');
      if (p && p !== 'index.html') return decodeURIComponent(p).toLowerCase();
    }
    return null;
  }

  function channelUrl(slug) {
    return useHistory ? location.origin + basePath + slug : location.href.split('#')[0] + '#/' + slug;
  }

  function navigate(slug) {
    if (useHistory) {
      if (currentSlug() !== slug || location.hash) history.pushState(null, '', basePath + slug);
      route();
    } else {
      location.hash = '/' + slug;
    }
  }

  function canAutoplay(ch) {
    if (isLocked(ch)) return !!activeAccess();
    const src = ch.sources[0];
    return !!src && src.type !== 'vidio' && src.type !== 'web' && !channelOffline(ch);
  }

  // Sekali per kunjungan: bila dibuka di beranda, langsung putar channel terakhir atau channel pertama yang bisa diputar.
  function autoStart() {
    if (state.autoStarted) return;
    if (currentSlug()) { state.autoStarted = true; return; }
    const lastSlug = store.get('last', null);
    const last = lastSlug ? state.bySlug.get(lastSlug) : null;
    if (lastSlug && !last && !state.playlistLoaded) return;
    state.autoStarted = true;
    const ch = (last && canAutoplay(last) && last)
      || state.channels.find((c) => !c.premium && c.sources[0] && c.sources[0].type === 'hls')
      || state.channels.find(canAutoplay);
    if (!ch) return;
    if (useHistory) history.replaceState(null, '', basePath + ch.slug);
    else location.replace('#/' + ch.slug);
    route();
  }

  function route() {
    const slug = currentSlug();
    if (!slug) {
      stopPlayback();
      state.current = null;
      el.player.dataset.mode = 'idle';
      el.infobar.hidden = true;
      document.title = `${state.settings.site.name} — Live TV Indonesia`;
      highlightActive();
      return;
    }
    const ch = state.bySlug.get(slug) || state.bySlug.get(slug.replace(/-/g, ''));
    if (ch) {
      if (ch !== state.current) {
        recordView(ch);
        playChannel(ch, 0);
      }
    } else if (!state.playlistLoaded) {
      el.player.dataset.mode = 'hls';
      setLoading(true);
    } else {
      stopPlayback();
      el.player.dataset.mode = 'hls';
      showMessage('Channel tidak ditemukan', `Tidak ada channel dengan alamat "/${slug}". Pilih channel dari daftar.`, false);
    }
  }

  // ---------- Player ----------

  function setLoading(on) { el.player.classList.toggle('loading', on); }

  function clearTimer() { clearTimeout(state.loadTimer); state.loadTimer = null; }

  function stopPlayback() {
    state.token++;
    clearTimer();
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    state.manualLevel = -1;
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
    el.frameHost.innerHTML = '';
    el.message.hidden = true;
    el.bigPlay.hidden = true;
    el.unmuteBtn.hidden = true;
    el.qualityMenu.hidden = true;
    setLoading(false);
  }

  function showMessage(title, text, canRetry = true) {
    clearTimer();
    setLoading(false);
    el.messageTitle.textContent = title;
    el.messageText.textContent = text;
    el.retryBtn.hidden = !canRetry;
    const ch = state.current;
    el.nextSourceBtn.hidden = !(ch && ch.sources.length > 1);
    el.message.hidden = false;
  }

  function playChannel(ch, sourceIndex) {
    stopPlayback();
    const token = state.token;
    state.current = ch;
    state.sourceIndex = sourceIndex;
    document.title = `${ch.name} Live — ${state.settings.site.name}`;
    if (isLocked(ch)) {
      unlockChannel(ch, token);
      return;
    }
    const src = ch.sources[sourceIndex];
    if (!src) {
      el.player.dataset.mode = 'hls';
      el.infobar.hidden = true;
      highlightActive();
      showMessage(`${ch.name} belum punya sumber siaran`, 'Admin belum mengisi sumber siaran untuk channel ini.', false);
      return;
    }
    const rctiOutside = src.type === 'iframe' && RCTI_MOBILE && isRctiUrl(src.url);
    el.player.dataset.mode = rctiOutside ? 'external' : MODE_BY_TYPE[src.type];
    store.set('last', ch.slug);
    updateInfo();
    highlightActive();

    if (rctiOutside) {
      showRctiLink(ch, src.url);
      showExternalNext(ch, sourceIndex);
    } else if (src.type === 'web') {
      showExternal(ch, src, sourceIndex);
    } else if (src.type === 'vidio') {
      setLoading(true);
      playFrame(vidioUrl(src.id));
    } else if (src.type === 'iframe') {
      setLoading(true);
      playFrame(src.url);
    } else if (src.type === 'youtube') {
      setLoading(true);
      playYoutube(src.channelId, token);
    } else {
      setLoading(true);
      playHls(src.url, token);
      state.loadTimer = setTimeout(() => {
        if (token === state.token && el.video.readyState < 2) fail('Siaran tidak merespons.');
      }, state.settings.streaming.loadTimeoutSec * 1000);
    }
    renderQuality();
  }

  // ---------- Channel premium ----------

  async function unlockChannel(ch, token) {
    el.infobar.hidden = true;
    highlightActive();
    if (activeAccess()) {
      el.player.dataset.mode = 'loading';
      setLoading(true);
      try {
        const res = await fetch(`${basePath}api/access/sources?slug=${encodeURIComponent(ch.slug)}`);
        if (token !== state.token) return;
        if (res.ok) {
          ch.sources = (await res.json()).sources || [];
          if (ch.sources.length) { playChannel(ch, 0); return; }
        } else if (res.status === 403) {
          setAccess(null);
          toast('Masa aktif langganan Anda sudah berakhir.');
        }
      } catch { /* server tidak bisa dihubungi */ }
      if (token !== state.token) return;
      setLoading(false);
    }
    el.player.dataset.mode = 'paywall';
    el.paywallLogo.innerHTML = '';
    el.paywallLogo.appendChild(logoBox(ch));
    el.paywallTitle.textContent = ch.name;
    const plan = cheapestPlan();
    el.paywallPlans.hidden = !state.settings.payment.enabled;
    el.paywallPrice.textContent = plan ? `${formatMoney(plan.price)} / ${durationLabel(plan.durationDays)}` : '';
  }

  function cheapestPlan() {
    const plans = state.settings.payment.plans || [];
    return plans.reduce((best, p) => (!best || p.price < best.price ? p : best), null);
  }

  function durationLabel(days) {
    if (days % 365 === 0) return `${days / 365} tahun`;
    if (days % 30 === 0) return `${days / 30} bulan`;
    if (days % 7 === 0) return `${days / 7} minggu`;
    return `${days} hari`;
  }

  async function redeem(code, input) {
    code = code.trim().toUpperCase();
    if (!code) return;
    try {
      const res = await postJson('api/access/redeem', { code });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Kode akses tidak valid.'); return; }
      setAccess(data.access);
      if (input) input.value = '';
      el.subModal.hidden = true;
      const access = activeAccess();
      if (access) toast(`Langganan aktif sampai ${formatDate(access.expiresAt)}.`);
      if (state.current && isLocked(state.current)) playChannel(state.current, 0);
    } catch {
      toast('Server tidak bisa dihubungi. Coba lagi.');
    }
  }

  // ---------- Langganan & pengaturan ----------

  function postJson(path, body) {
    return fetch(basePath + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  function setAccess(access) {
    state.access = access;
    renderSubscribeButton();
  }

  function bindSettingsEvents() {
    el.settingsBtn.onclick = () => {
      el.settingsModal.hidden = false;
      el.themeChoice.querySelector('[aria-checked="true"]').focus();
    };
    el.settingsClose.onclick = () => { el.settingsModal.hidden = true; };
    el.settingsModal.addEventListener('click', (e) => { if (e.target === el.settingsModal) el.settingsModal.hidden = true; });
    el.themeChoice.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]');
      if (!b) return;
      store.set('theme', b.dataset.theme);
      applyTheme(b.dataset.theme);
    });
  }

  const formatDate = (ms) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  function formatMoney(n) {
    const currency = state.settings.payment.currency || 'IDR';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(n);
  }

  function renderSubscribeButton() {
    const pay = state.settings.payment;
    const access = activeAccess();
    el.subscribeBtn.hidden = !pay.enabled;
    el.subscribeBtn.classList.toggle('active', Boolean(access));
    el.subscribeText.textContent = access ? 'Premium aktif' : 'Berlangganan';
  }

  function openSubscribe() {
    const pay = state.settings.payment;
    const site = state.settings.site;
    const access = activeAccess();
    el.accessStatus.hidden = !access;
    if (access) {
      el.accessStatus.textContent = `Akses premium aktif (${access.plan || 'paket'}) sampai ${formatDate(access.expiresAt)}.`;
    }

    el.plans.innerHTML = '';
    for (const plan of pay.plans || []) {
      const card = document.createElement('div');
      card.className = 'plan';
      card.innerHTML = `<strong>${escapeHtml(plan.name)}</strong>` +
        `<span class="price">${escapeHtml(formatMoney(plan.price))}</span>` +
        `<span class="tag">${durationLabel(plan.durationDays)}</span>` +
        `<p>${escapeHtml(plan.description)}</p>`;
      el.plans.appendChild(card);
    }
    el.waBtn.hidden = !pay.whatsapp;
    if (pay.whatsapp) {
      el.waBtn.href = `https://wa.me/${pay.whatsapp}?text=${encodeURIComponent(`Halo kak saya mau langganan ${site.name}`)}`;
    }

    el.payMethods.innerHTML = '';
    const rows = [
      ...(pay.bankAccounts || []).map((b) => ({ title: `Bank ${b.bank}`, number: b.number, holder: b.holder })),
      ...(pay.ewallets || []).map((w) => ({ title: w.name, number: w.number, holder: w.holder })),
    ];
    if (rows.length || pay.qrisImageUrl) {
      el.payMethods.insertAdjacentHTML('beforeend', '<h3>Cara membayar</h3>');
      const list = document.createElement('div');
      list.className = 'pay-list';
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'pay-row';
        row.innerHTML = `<div><b>${escapeHtml(r.title)}</b><span>a.n. ${escapeHtml(r.holder || '-')}</span></div>` +
          `<code>${escapeHtml(r.number)}</code>`;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn ghost';
        copy.textContent = 'Salin';
        copy.onclick = () => navigator.clipboard.writeText(r.number).then(() => toast('Nomor disalin.'));
        row.appendChild(copy);
        list.appendChild(row);
      }
      if (pay.qrisImageUrl) {
        const img = document.createElement('img');
        img.className = 'qris-img';
        img.alt = 'QRIS';
        img.src = pay.qrisImageUrl;
        list.appendChild(img);
      }
      el.payMethods.appendChild(list);
    }
    el.payInstructions.textContent = pay.instructions || '';
    el.subModal.hidden = false;
  }

  function recordView(ch) {
    if (!useHistory) return;
    fetch(`${basePath}api/stats/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: ch.slug }),
      keepalive: true,
    }).catch(() => {});
  }

  function fail(reason) {
    const ch = state.current;
    if (!ch) return;
    if (!state.settings.streaming.autoFallback && ch.sources.length > 1) {
      stopPlayback();
      showMessage(`Sumber ini gagal diputar`, `${reason} Coba sumber lain dengan tombol di bawah.`);
      return;
    }
    if (state.sourceIndex < ch.sources.length - 1) {
      toast(`Sumber gagal, pindah ke ${sourceLabel(ch.sources[state.sourceIndex + 1])}…`);
      playChannel(ch, state.sourceIndex + 1);
      return;
    }
    stopPlayback();
    showMessage(
      `${ch.name} sedang tidak dapat diputar`,
      `${reason} Siaran mungkin sedang off-air, dibatasi wilayah, atau link-nya sudah berubah.`,
    );
  }

  // Situs seperti Vision+ menolak dibingkai dan siarannya ber-DRM, jadi hanya bisa dibuka di situs/aplikasinya sendiri.
  function showExternal(ch, src, sourceIndex) {
    const site = src.label ? src.label.replace(/\s*\(.*\)\s*$/, '') : new URL(src.url).hostname;
    el.externalLogo.innerHTML = '';
    el.externalLogo.appendChild(logoBox(ch));
    el.externalTitle.textContent = `Tonton ${ch.name} di ${site}`;
    el.externalText.textContent = `${site} tidak mengizinkan siarannya diputar langsung di sini. Tekan tombol di bawah untuk membukanya; aplikasi ${site} terbuka otomatis bila sudah terpasang.`;
    el.externalLink.href = src.url;
    el.externalLink.target = '_blank';
    el.externalBtnText.textContent = `Buka ${site}`;
    showExternalNext(ch, sourceIndex);
  }

  function showExternalNext(ch, sourceIndex) {
    el.externalNext.hidden = ch.sources.length < 2;
    if (el.externalNext.hidden) return;
    const next = ch.sources[(sourceIndex + 1) % ch.sources.length];
    el.externalNext.textContent = `Sumber lain: ${sourceLabel(next).replace(/\s*\(.*\)\s*$/, '')}`;
  }

  function playFrame(url) {
    const frame = document.createElement('iframe');
    frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture; screen-wake-lock');
    frame.setAttribute('allowfullscreen', 'true');
    frame.setAttribute('webkitallowfullscreen', 'true');
    frame.setAttribute('mozallowfullscreen', 'true');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.addEventListener('load', () => setLoading(false), { once: true });
    if (isRctiUrl(url)) frame.classList.add('frame-scaled');
    el.frameHost.appendChild(frame);
    fitScaledFrame();
    frame.src = url;
  }

  // RCTI+ pindah ke situs mobile bila lebar halaman atau layar perangkat < 768px. Situs desktop bisa diputar
  // di iframe asal dirender selebar desktop lalu diperkecil. Situs mobile menyimpan token pengunjungnya di
  // cookie SameSite=Lax yang ditolak browser di iframe situs lain, jadi di HP siarannya macet di logo dan
  // hanya bisa ditonton dengan membuka halaman RCTI+ langsung.
  const RCTI_MOBILE = screen.width < 768;
  const DESKTOP_FRAME_WIDTH = 1024;

  function isRctiUrl(url) {
    try { return /(^|\.)rctiplus\.com$/.test(new URL(url).hostname); } catch { return false; }
  }

  function fitScaledFrame() {
    const frame = el.frameHost.querySelector('iframe.frame-scaled');
    const w = el.frameHost.clientWidth, h = el.frameHost.clientHeight;
    if (!frame || !w || !h) return;
    const scale = Math.min(1, w / DESKTOP_FRAME_WIDTH);
    frame.style.width = `${w / scale}px`;
    frame.style.height = `${h / scale}px`;
    frame.style.transform = scale < 1 ? `scale(${scale})` : '';
  }

  function showRctiLink(ch, url) {
    el.externalLogo.innerHTML = '';
    el.externalLogo.appendChild(logoBox(ch));
    el.externalTitle.textContent = `Tonton ${ch.name} di RCTI+`;
    el.externalText.textContent = 'Di HP, RCTI+ tidak bisa diputar di dalam pemutar ini. Tekan tombol di bawah untuk membuka siaran langsungnya di web RCTI+ (gratis, tanpa login).';
    el.externalLink.href = url.replace('://www.rctiplus.com', '://m.rctiplus.com');
    // Di APK dibuka di jendela yang sama: APK baru memuatnya di dalam aplikasi (tombol Kembali kembali ke sini),
    // APK lama meneruskannya ke browser.
    el.externalLink.target = IN_APP ? '_self' : '_blank';
    el.externalBtnText.textContent = 'Buka siaran di RCTI+';
  }

  async function playYoutube(channelId, token) {
    let info = null;
    try {
      const res = await fetch(`${basePath}api/youtube-live?channel=${encodeURIComponent(channelId)}`);
      if (res.ok) info = await res.json();
    } catch { /* server.js tidak berjalan (mis. dibuka via file://) */ }
    if (token !== state.token) return;
    if (!info || !info.videoId || !info.live) {
      fail(info ? 'Channel YouTube resminya sedang tidak siaran live.' : 'Pencarian live YouTube butuh server.js (jalankan "npm start").');
      return;
    }
    playFrame(`https://www.youtube.com/embed/${info.videoId}?autoplay=1&playsinline=1&rel=0`);
  }

  function playHls(url, token) {
    const video = el.video;
    const cfg = state.settings.streaming;
    video.muted = store.get('muted', cfg.startMuted);
    video.volume = store.get('volume', 1);

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        backBufferLength: 30,
        maxBufferLength: cfg.maxBufferSec,
        lowLatencyMode: cfg.lowLatency,
        abrEwmaDefaultEstimate: 3000000,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
      });
      state.hls = hls;
      let mediaRecovered = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (token !== state.token) return;
        applyPreferredQuality();
        renderQuality();
        tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (token === state.token) renderQuality(); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (token !== state.token || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        const httpCode = data.response && data.response.code;
        fail(data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? `Server siaran tidak bisa dihubungi${httpCode ? ` (HTTP ${httpCode})` : ''}.`
          : 'Format siaran tidak didukung browser.');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadedmetadata', () => { if (token === state.token) tryPlay(); }, { once: true });
    } else {
      fail('Browser ini tidak mendukung pemutaran HLS.');
    }
  }

  function tryPlay() {
    const video = el.video;
    video.play().catch(() => {
      video.muted = true;
      video.play()
        .then(() => { el.unmuteBtn.hidden = false; })
        .catch(() => { setLoading(false); el.bigPlay.hidden = false; });
    });
  }

  // ---------- Resolusi ----------

  function qualityOptions() {
    const hls = state.hls;
    if (!hls || !hls.levels || !hls.levels.length) return [];
    const levels = hls.levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate }));
    levels.sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));
    const seen = {};
    levels.forEach((l) => { seen[l.height] = (seen[l.height] || 0) + 1; });
    return levels.map((l) => ({
      index: l.index,
      label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`,
      detail: l.height && seen[l.height] > 1 ? `${Math.round(l.bitrate / 1000)} kbps` : (l.height >= 720 ? 'HD' : ''),
    }));
  }

  function applyPreferredQuality() {
    const pref = store.get('quality', state.settings.streaming.defaultQuality);
    const hls = state.hls;
    if (!hls || pref === 'auto') return;
    const opts = hls.levels.map((l, i) => ({ i, h: l.height })).sort((a, b) => b.h - a.h);
    const pick = opts.find((o) => o.h <= pref) || opts[opts.length - 1];
    if (pick) {
      state.manualLevel = pick.i;
      hls.startLevel = pick.i;
      hls.currentLevel = pick.i;
    }
  }

  function setQuality(index) {
    const hls = state.hls;
    if (!hls) return;
    state.manualLevel = index;
    hls.currentLevel = index;
    store.set('quality', index === -1 ? 'auto' : hls.levels[index].height);
    el.qualityMenu.hidden = true;
    const label = index === -1 ? 'Otomatis' : `${hls.levels[index].height}p`;
    toast(`Resolusi: ${label}`);
    renderQuality();
  }

  function renderQuality() {
    const src = state.current && state.current.sources[state.sourceIndex];
    const sel = el.qualitySelect;
    sel.innerHTML = '';
    el.qualityMenu.innerHTML = '';

    if (!src || src.type !== 'hls') {
      const text = !src || src.type === 'vidio' ? 'Atur di Vidio'
        : src.type === 'web' ? 'Atur di situsnya' : 'Atur lewat ikon ⚙ di player';
      sel.add(new Option(text, ''));
      sel.disabled = true;
      return;
    }
    const opts = qualityOptions();
    const hls = state.hls;
    if (!opts.length) {
      sel.add(new Option(hls ? 'Memuat…' : 'Otomatis', ''));
      sel.disabled = true;
      el.qualityBadge.textContent = 'Auto';
      return;
    }

    const manual = state.manualLevel;
    const playing = hls.levels[hls.currentLevel];
    const autoLabel = `Otomatis${manual === -1 && playing && playing.height ? ` (${playing.height}p)` : ''}`;

    sel.disabled = opts.length < 2;
    sel.add(new Option(autoLabel, '-1', false, manual === -1));
    for (const o of opts) sel.add(new Option(o.label + (o.detail ? ` · ${o.detail}` : ''), String(o.index), false, manual === o.index));

    el.qualityBadge.textContent = manual === -1
      ? (playing && playing.height ? `Auto ${playing.height}p` : 'Auto')
      : opts.find((o) => o.index === manual).label;

    el.qualityMenu.insertAdjacentHTML('beforeend', '<h4>Resolusi</h4>');
    const items = [{ index: -1, label: autoLabel, detail: '' }, ...opts];
    for (const o of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = o.index === manual ? 'on' : '';
      b.innerHTML = `<svg><use href="#i-check"/></svg>${escapeHtml(o.label)}${o.detail ? `<small>${escapeHtml(o.detail)}</small>` : ''}`;
      b.onclick = (e) => { e.stopPropagation(); setQuality(o.index); };
      el.qualityMenu.appendChild(b);
    }
    if (opts.length < 2) {
      el.qualityMenu.insertAdjacentHTML('beforeend', '<h4 style="text-transform:none;letter-spacing:0">Siaran ini hanya punya 1 resolusi</h4>');
    }
  }

  // ---------- Info bar ----------

  function updateInfo() {
    const ch = state.current;
    const src = ch.sources[state.sourceIndex];
    el.infobar.hidden = false;
    el.nowLogo.innerHTML = '';
    el.nowLogo.appendChild(logoBox(ch));
    el.nowName.textContent = ch.name;
    el.ctlTitle.textContent = ch.name;
    el.nowMeta.textContent = `${ch.groups.join(' · ')} — ${sourceLabel(src)}`;
    el.fsInfoBtn.hidden = el.player.dataset.mode === 'external';
  }

  const vidioUrl = (id) => `https://www.vidio.com/live/${encodeURIComponent(id)}`;

  // ---------- Fullscreen ----------

  // WebView APK lama langsung membatalkan layar penuh; APK baru menandai user agent-nya dengan "TekdroidFullscreen".
  const IN_APP = /; wv\)/.test(navigator.userAgent);
  const PSEUDO_FULLSCREEN = IN_APP && !navigator.userAgent.includes('TekdroidFullscreen');

  const isPseudoFullscreen = () => el.player.classList.contains('pseudo-fs');

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement) || isPseudoFullscreen();
  }

  // Masuk menambah entri riwayat, jadi tombol Kembali Android menutup layar penuh, bukan pindah halaman.
  function setPseudoFullscreen(on) {
    if (on === isPseudoFullscreen()) return;
    if (on) history.pushState({ pseudoFs: true }, '', location.href);
    el.player.classList.toggle('pseudo-fs', on);
    document.body.classList.toggle('pseudo-fs-open', on);
    syncFullscreenIcons();
    animateFullscreen();
    if (on && PSEUDO_FULLSCREEN) showUpdateHint();
    else hideUpdateHint();
  }

  function animateFullscreen() {
    el.player.classList.remove('fs-anim');
    void el.player.offsetWidth;
    el.player.classList.add('fs-anim');
  }

  // Layar penuh tiruan tidak bisa memutar bilah status & navigasi HP; itu hanya bisa dilakukan APK baru.
  let updateHintTimer = 0;
  function showUpdateHint() {
    try {
      if (sessionStorage.getItem('tvn.fsHint')) return;
      sessionStorage.setItem('tvn.fsHint', '1');
    } catch {}
    el.fsUpdate.hidden = false;
    clearTimeout(updateHintTimer);
    updateHintTimer = setTimeout(hideUpdateHint, 9000);
  }

  function hideUpdateHint() {
    clearTimeout(updateHintTimer);
    el.fsUpdate.hidden = true;
  }

  function requestFullscreen(node) {
    if (!node) return Promise.reject();
    if (node.requestFullscreen) {
      try {
        return Promise.resolve(node.requestFullscreen({ navigationUI: 'hide' }));
      } catch {
        try { return Promise.resolve(node.requestFullscreen()); } catch { return Promise.reject(); }
      }
    }
    if (node.webkitRequestFullscreen) {
      node.webkitRequestFullscreen();
      return Promise.resolve();
    }
    return Promise.reject();
  }

  function lockLandscape() {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  }

  function toggleFullscreen() {
    if (isPseudoFullscreen()) {
      history.back();
      return;
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (PSEUDO_FULLSCREEN) {
      setPseudoFullscreen(true);
      return;
    }
    const player = el.player;
    const frame = player.dataset.mode === 'frame' ? el.frameHost.querySelector('iframe') : null;
    // Pemutar yang berisi halaman Vidio sering ditolak browser bila layar penuh diminta
    // pada kotak induknya. Coba kotaknya dulu, lalu iframe-nya, lalu layar penuh tiruan.
    requestFullscreen(player).then(lockLandscape).catch(() => {
      if (!frame) return Promise.reject();
      return requestFullscreen(frame).then(lockLandscape);
    }).catch(() => {
      if (player.dataset.mode === 'hls' && el.video.webkitEnterFullscreen) {
        el.video.webkitEnterFullscreen();
        return;
      }
      setPseudoFullscreen(true);
    });
  }

  function syncFullscreenIcons() {
    const icon = isFullscreen() ? '#i-compress' : '#i-expand';
    for (const b of [el.fsBtn, el.fsCorner]) b.querySelector('use').setAttribute('href', icon);
    el.fsInfoBtn.innerHTML = `<svg><use href="${icon}"/></svg> ${isFullscreen() ? 'Keluar layar penuh' : 'Layar penuh'}`;
  }

  // ---------- Kontrol video ----------

  function syncPlayIcon() {
    el.playBtn.querySelector('use').setAttribute('href', el.video.paused ? '#i-play' : '#i-pause');
  }

  function syncVolume() {
    const muted = el.video.muted || el.video.volume === 0;
    el.muteBtn.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-volume');
    el.volume.value = el.video.muted ? 0 : el.video.volume;
  }

  function toggleMute() {
    el.video.muted = !el.video.muted;
    if (!el.video.muted && el.video.volume === 0) el.video.volume = 0.5;
    store.set('muted', el.video.muted);
    el.unmuteBtn.hidden = true;
  }

  function togglePlay() {
    if (el.player.dataset.mode !== 'hls') return;
    if (el.video.paused) {
      // Untuk siaran live, lanjut dari posisi live terbaru, bukan dari titik saat dijeda.
      if (state.hls && state.hls.liveSyncPosition) el.video.currentTime = state.hls.liveSyncPosition;
      el.video.play().catch(() => {});
    } else {
      el.video.pause();
    }
  }

  let idleTimer;
  function wake() {
    el.player.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!el.video.paused && el.qualityMenu.hidden) el.player.classList.add('idle');
    }, 3000);
  }

  function stepChannel(delta) {
    const list = visibleChannels();
    if (!list.length) return;
    const i = state.current ? list.indexOf(state.current) : -1;
    const next = list[(i + delta + list.length) % list.length];
    navigate(next.slug);
  }

  // ---------- Event ----------

  function bindPullToRefresh() {
    const bar = el.pullRefresh;
    if (!bar) return;
    const label = bar.querySelector('b');
    const THRESHOLD = 72;
    let startX = 0;
    let startY = 0;
    let active = false;
    let distance = 0;

    function blocked(target) {
      if (!target || !target.closest) return true;
      if (!el.drawer.hidden || !el.subModal.hidden || !el.settingsModal.hidden || !el.updateModal.hidden || isPseudoFullscreen()) return true;
      return !!target.closest('input, textarea, select, video, .controls, .volume, .quality-menu');
    }

    function scrolledAway(target) {
      let node = target instanceof Element ? target : null;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4 && node.scrollTop > 2) return true;
        node = node.parentElement;
      }
      return (window.scrollY || document.documentElement.scrollTop || 0) > 2;
    }

    function reset() {
      active = false;
      distance = 0;
      bar.classList.remove('show', 'ready', 'loading');
      bar.style.transform = '';
      label.textContent = 'Tarik untuk menyegarkan';
    }

    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || blocked(e.target) || scrolledAway(e.target)) {
        active = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      distance = 0;
      active = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!active) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (distance === 0 && Math.abs(dx) > Math.abs(dy)) {
        active = false;
        return;
      }
      if (dy <= 0 || scrolledAway(e.target)) {
        reset();
        return;
      }
      distance = Math.min(dy * 0.45, 108);
      bar.classList.add('show');
      bar.style.transform = `translateY(${distance}px)`;
      const ready = distance >= THRESHOLD;
      bar.classList.toggle('ready', ready);
      label.textContent = ready ? 'Lepas untuk menyegarkan' : 'Tarik untuk menyegarkan';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', () => {
      if (!active) return;
      if (distance >= THRESHOLD) {
        bar.classList.add('loading');
        label.textContent = 'Menyegarkan…';
        location.reload();
        return;
      }
      reset();
    });
    document.addEventListener('touchcancel', reset);
  }

  function bindEvents() {
    const v = el.video;
    v.addEventListener('playing', () => { clearTimer(); setLoading(false); el.bigPlay.hidden = true; });
    v.addEventListener('waiting', () => setLoading(true));
    v.addEventListener('play', syncPlayIcon);
    v.addEventListener('pause', syncPlayIcon);
    v.addEventListener('volumechange', syncVolume);
    v.addEventListener('error', () => {
      if (!state.hls && el.player.dataset.mode === 'hls' && v.getAttribute('src')) fail('Siaran gagal dimuat.');
    });
    v.addEventListener('click', togglePlay);
    v.addEventListener('dblclick', toggleFullscreen);

    el.playBtn.onclick = togglePlay;
    el.bigPlay.onclick = () => { el.bigPlay.hidden = true; setLoading(true); v.play().catch(() => {}); };
    el.muteBtn.onclick = toggleMute;
    el.unmuteBtn.onclick = () => { v.muted = false; store.set('muted', false); el.unmuteBtn.hidden = true; };
    el.volume.oninput = () => {
      v.volume = Number(el.volume.value);
      v.muted = v.volume === 0;
      store.set('volume', v.volume);
      store.set('muted', v.muted);
      el.unmuteBtn.hidden = true;
    };

    el.qualityBtn.onclick = (e) => {
      e.stopPropagation();
      el.qualityMenu.hidden = !el.qualityMenu.hidden;
      wake();
    };
    document.addEventListener('click', (e) => {
      if (!el.qualityMenu.hidden && !el.qualityMenu.contains(e.target)) el.qualityMenu.hidden = true;
    });
    el.qualitySelect.onchange = () => setQuality(Number(el.qualitySelect.value));
    el.pipBtn.hidden = !document.pictureInPictureEnabled;
    el.pipBtn.onclick = () => {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else v.requestPictureInPicture().catch(() => toast('Picture-in-picture tidak tersedia.'));
    };

    el.fsBtn.onclick = toggleFullscreen;
    el.fsCorner.onclick = toggleFullscreen;
    el.fsInfoBtn.onclick = toggleFullscreen;
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(type, () => { syncFullscreenIcons(); animateFullscreen(); });
    }
    el.player.addEventListener('animationend', (e) => {
      if (e.animationName.startsWith('fs-')) el.player.classList.remove('fs-anim');
    });
    if (window.ResizeObserver) new ResizeObserver(fitScaledFrame).observe(el.frameHost);
    else window.addEventListener('resize', fitScaledFrame);
    el.fsUpdateClose.onclick = hideUpdateHint;

    el.retryBtn.onclick = () => state.current && playChannel(state.current, state.sourceIndex);
    el.nextSourceBtn.onclick = el.externalNext.onclick = () => {
      const ch = state.current;
      if (ch) playChannel(ch, (state.sourceIndex + 1) % ch.sources.length);
    };

    el.copyBtn.onclick = () => {
      if (!state.current) return;
      const url = channelUrl(state.current.slug);
      navigator.clipboard.writeText(url).then(() => toast('Link disalin: ' + url), () => toast(url));
    };

    el.player.addEventListener('mousemove', wake);
    el.player.addEventListener('touchstart', wake, { passive: true });

    el.search.addEventListener('input', () => {
      state.query = el.search.value;
      if (state.query && state.category !== 'Semua') { state.category = 'Semua'; renderChips(); }
      renderList();
    });
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = visibleChannels()[0];
        if (first) { navigate(first.slug); el.search.blur(); }
      }
    });

    el.brandLink.onclick = (e) => {
      e.preventDefault();
      if (useHistory) { history.pushState(null, '', basePath); route(); } else { location.hash = ''; route(); }
    };

    window.addEventListener('popstate', () => {
      if (isPseudoFullscreen()) setPseudoFullscreen(false);
      else route();
    });
    window.addEventListener('hashchange', route);

    el.paywallForm.addEventListener('submit', (e) => { e.preventDefault(); redeem(el.paywallCode.value, el.paywallCode); });
    el.redeemForm.addEventListener('submit', (e) => { e.preventDefault(); redeem(el.redeemCode.value, el.redeemCode); });
    el.paywallPlans.onclick = openSubscribe;
    el.subscribeBtn.onclick = openSubscribe;
    el.subClose.onclick = () => { el.subModal.hidden = true; };
    el.subModal.addEventListener('click', (e) => { if (e.target === el.subModal) el.subModal.hidden = true; });
    bindPullToRefresh();
    el.listHead.onclick = openDrawer;
    el.drawerClose.onclick = closeDrawer;
    el.drawer.addEventListener('click', (e) => { if (e.target === el.drawer) closeDrawer(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isPseudoFullscreen()) { history.back(); return; }
        if (!el.drawer.hidden) { closeDrawer(); return; }
        if (!el.subModal.hidden) { el.subModal.hidden = true; return; }
        if (!el.settingsModal.hidden) { el.settingsModal.hidden = true; return; }
        if (!el.updateModal.hidden) { el.updateLater.click(); return; }
      }
      if (!el.drawer.hidden) return;
      if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
        case 'm': case 'M': toggleMute(); break;
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowUp': e.preventDefault(); stepChannel(-1); break;
        case 'ArrowDown': e.preventDefault(); stepChannel(1); break;
        case '/': e.preventDefault(); el.search.focus(); break;
        default: return;
      }
      wake();
    });
  }

  // ---------- Start ----------

  async function fetchConfig() {
    if (!useHistory) return null;
    try {
      const res = await fetch(`${basePath}api/config`, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  function renderBrand(markEl, nameEl, site = state.settings.site) {
    const words = site.name.trim().split(/\s+/);
    nameEl.textContent = words.length > 1 ? words.slice(0, -1).join(' ') + ' ' : '';
    const bold = document.createElement('b');
    bold.textContent = words[words.length - 1];
    nameEl.appendChild(bold);
    if (site.logoUrl) {
      const img = document.createElement('img');
      img.src = site.logoUrl;
      img.alt = '';
      img.style.cssText = 'height:34px;max-width:120px;object-fit:contain;display:block';
      markEl.replaceChildren(img);
    }
  }

  function applyBaseLook() {
    const site = state.settings.site;
    document.documentElement.style.setProperty('--accent', site.accent);
    applyTheme(store.get('theme', site.theme));
  }

  function applySettings() {
    const site = state.settings.site;
    applyBaseLook();
    renderBrand(el.brandMark, el.brandName);

    if (site.welcomeTitle) el.welcomeTitle.textContent = site.welcomeTitle;
    el.welcomeText.textContent = site.welcomeText;

    const ann = site.announcement;
    el.announce.hidden = !(ann.enabled && ann.text);
    el.announce.className = 'announce ' + ann.tone;
    el.announce.textContent = ann.text;

    el.layout.classList.toggle('sidebar-left', site.sidebarPosition === 'left');
    el.footer.hidden = !site.footerText;
    el.footer.textContent = site.footerText;
    if (site.defaultCategory) state.category = site.defaultCategory;
    renderSubscribeButton();
  }

  function applyTheme(theme) {
    const light = theme === 'light';
    document.body.classList.toggle('light', light);
    const barColor = light ? '#ffffff' : '#06121f';
    document.querySelector('meta[name="theme-color"]').content = barColor;
    if (window.TekdroidNative) window.TekdroidNative.setTheme(barColor, light);
    for (const b of el.themeChoice.querySelectorAll('[data-theme]')) {
      const on = b.dataset.theme === (light ? 'light' : 'dark');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  // APK 1.0.9+ menulis versinya di user agent; 1.0.6–1.0.8 hanya "TekdroidFullscreen";
  // yang lebih lama dikenali dari halaman pemuat Capacitor (https://localhost) yang membukanya.
  const APK_VERSION = (/TekdroidApp\/(\d+\.\d+\.\d+)/.exec(navigator.userAgent) || [])[1] || null;
  const IS_APK = Boolean(APK_VERSION) || navigator.userAgent.includes('TekdroidFullscreen')
    || (IN_APP && document.referrer === 'https://localhost/') || (IN_APP && store.get('apk', false));
  if (IS_APK) store.set('apk', true);

  const isNewer = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };

  function checkApkUpdate(config) {
    const latest = config && config.apk;
    // Tanpa tanda versi berarti APK 1.0.8 atau lebih lama.
    if (!IS_APK || !latest || !isNewer(latest.version, APK_VERSION || '1.0.8')) return;
    try { if (sessionStorage.getItem('tvn.updateLater') === latest.version) return; } catch { /* storage diblokir */ }
    el.updateVersions.textContent = APK_VERSION
      ? `Versi Anda: ${APK_VERSION} · Versi terbaru: ${latest.version}`
      : `Versi terbaru: ${latest.version}`;
    if (latest.url) el.updateBtn.href = latest.url;
    el.updateLater.onclick = () => {
      el.updateModal.hidden = true;
      try { sessionStorage.setItem('tvn.updateLater', latest.version); } catch { /* storage diblokir */ }
    };
    el.updateModal.hidden = false;
  }

  // Di APK yang ditampilkan versi aplikasinya, di web versi server.
  async function appVersion(config) {
    if (APK_VERSION) return APK_VERSION;
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.nativePromise) {
      try { return (await cap.nativePromise('App', 'getInfo')).version; } catch { /* plugin App tidak tersedia */ }
    }
    return config && config.version;
  }

  async function finishSplash(config) {
    if (!el.splash) return;
    renderBrand(el.splashMark, el.splashName, config ? config.site : FALLBACK_CONFIG.site);
    const version = await appVersion(config);
    if (version) el.splashVersion.textContent = `Versi ${version}`;
    await new Promise((r) => setTimeout(r, Math.max(0, SPLASH_MIN_MS - performance.now())));
    try { sessionStorage.setItem('tvn.splash', '1'); } catch { /* storage diblokir */ }
    el.splash.classList.add('out');
    setTimeout(() => el.splash.remove(), 600);
  }

  async function startApp(config) {
    await finishSplash(config);
    checkApkUpdate(config);
  }

  async function init() {
    // Terapkan pilihan tema pengunjung sebelum menunggu server agar halaman tidak berkedip.
    const savedTheme = store.get('theme', null);
    if (savedTheme) applyTheme(savedTheme);
    bindSettingsEvents();
    const config = await fetchConfig();
    startApp(config);
    const channels = config && config.channels ? config.channels : window.NATIONAL_CHANNELS;
    if (config) state.settings = config;
    state.access = config ? config.access : null;
    state.nationalTvgIds = new Set([...window.NATIONAL_CHANNELS, ...channels].map((c) => c.tvgId).filter(Boolean));
    applySettings();
    // Tanpa server tidak ada langganan, jadi tanda premium dari daftar bawaan diabaikan.
    channels.forEach((c) => addChannel({ ...c, premium: Boolean(config && c.premium), sources: arrangeSources(c.sources || []), tags: [], res: null }));
    const awaitsPlaylist = state.settings.streaming.playlistEnabled;
    if (!awaitsPlaylist && !state.channels.some((c) => c.groups.includes(state.category))) state.category = 'Semua';
    el.exampleUrl.textContent = useHistory ? basePath + 'indosiar' : '#/indosiar';
    bindEvents();
    syncVolume();
    renderChips();
    renderList();
    renderQuickGrid();
    route();
    autoStart();
    loadPlaylist();
    if (config) refreshLive();
  }

  init();
})();

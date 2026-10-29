(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEFAULT_CATEGORIES = ['Nasional', 'Berita', 'TVRI Daerah', 'Daerah & Lainnya', 'Religi', 'Anak & Edukasi', 'Olahraga', 'Hiburan'];
  const SOURCE_INFO = {
    hls: { label: 'HLS (.m3u8)', hint: 'Stream langsung, resolusi bisa diatur dari web.' },
    iframe: { label: 'Player embed', hint: 'Halaman player resmi yang boleh di-embed.' },
    youtube: { label: 'YouTube live', hint: 'Live 24 jam di channel YouTube resmi.' },
    vidio: { label: 'Vidio (tautan)', hint: 'Ditampilkan sebagai tombol "Tonton di Vidio".' },
  };
  const PAGES = {
    ringkasan: 'Ringkasan',
    channel: 'Pengaturan Channel',
    tampilan: 'Pengaturan Tampilan',
    streaming: 'Pengaturan Streaming',
    pembayaran: 'Pengaturan Pembayaran',
    pengguna: 'Pengguna',
    akun: 'Akun Admin',
  };

  const state = {
    config: null,
    savedJson: '',
    page: 'ringkasan',
    stats: null,
    codes: [],
    users: [],
    userQuery: '',
    playlist: null,
    channelQuery: '',
    playlistQuery: '',
  };

  // ---------- Utilitas DOM ----------

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  let toastTimer;
  function toast(text, isError = false) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (isError ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function slugify(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  const formatMoney = (n, currency) => new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
  const formatDate = (ms) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  function logoBox(src, name) {
    const box = h('span', { class: 'logo' });
    const fallback = () => { box.classList.add('text'); box.textContent = (name || '?').slice(0, 4).toUpperCase(); };
    if (src) {
      const img = h('img', { src, alt: '', referrerPolicy: 'no-referrer' });
      img.onerror = fallback;
      box.append(img);
    } else fallback();
    return box;
  }

  // ---------- API ----------

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin();
      throw new Error(data.error || 'Sesi berakhir, silakan login lagi.');
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---------- Status simpan ----------

  function isDirty() { return state.config && JSON.stringify(state.config) !== state.savedJson; }

  function markDirty() {
    const dirty = isDirty();
    $('saveBtn').disabled = !dirty;
    $('dirtyNote').hidden = !dirty;
    $('discardBtn').hidden = !dirty;
  }

  function setConfig(cfg) {
    state.config = cfg;
    state.savedJson = JSON.stringify(cfg);
    $('navSiteName').textContent = cfg.site.name;
    markDirty();
  }

  async function save() {
    const btn = $('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
    try {
      setConfig(await api('PUT', '/api/admin/config', state.config));
      toast('Perubahan disimpan. Web utama memakai pengaturan baru saat dimuat ulang.');
      render();
    } catch (err) {
      toast(err.message, true);
      markDirty();
    } finally {
      btn.textContent = 'Simpan perubahan';
    }
  }

  // ---------- Komponen form (terikat ke objek konfigurasi) ----------

  function textField(obj, key, label, opts = {}) {
    const input = h(opts.multiline ? 'textarea' : 'input', {
      type: opts.multiline ? null : (opts.type || 'text'),
      value: obj[key] ?? '',
      placeholder: opts.placeholder || '',
      oninput: (e) => {
        obj[key] = opts.type === 'number' ? Number(e.target.value) : e.target.value;
        if (opts.onChange) opts.onChange(obj[key]);
        markDirty();
      },
    });
    if (opts.multiline) input.value = obj[key] ?? '';
    if (opts.min != null) input.min = opts.min;
    if (opts.max != null) input.max = opts.max;
    return h('label', { class: 'field' }, h('span', { text: label }), input, opts.help && h('small', { text: opts.help }));
  }

  function selectField(obj, key, label, options, opts = {}) {
    const sel = h('select', {
      onchange: (e) => {
        const raw = e.target.value;
        obj[key] = opts.numeric && raw !== 'auto' ? Number(raw) : raw;
        if (opts.onChange) opts.onChange(obj[key]);
        markDirty();
      },
    }, options.map(([v, l]) => h('option', { value: String(v), text: l })));
    sel.value = String(obj[key]);
    return h('label', { class: 'field' }, h('span', { text: label }), sel, opts.help && h('small', { text: opts.help }));
  }

  function toggle(obj, key, title, desc, onChange) {
    return h('label', { class: 'switch' },
      h('input', {
        type: 'checkbox',
        checked: !!obj[key],
        onchange: (e) => { obj[key] = e.target.checked; if (onChange) onChange(obj[key]); markDirty(); },
      }),
      h('span', {}, h('b', { text: title }), desc && h('small', { text: desc })));
  }

  function card(title, desc, ...children) {
    return h('div', { class: 'card' }, h('h2', { text: title }), desc && h('p', { class: 'desc', text: desc }), children);
  }

  function categoriesInUse() {
    const set = new Set(DEFAULT_CATEGORIES);
    for (const c of state.config.channels) for (const g of c.groups || []) set.add(g);
    return [...set];
  }

  // ---------- Halaman: Ringkasan ----------

  async function renderRingkasan(page) {
    const cfg = state.config;
    const ch = cfg.channels;
    try { state.stats = await api('GET', '/api/admin/stats'); } catch { state.stats = { views: {}, codes: {} }; }
    const views = state.stats.views || {};
    const total = Object.values(views).reduce((a, b) => a + b, 0);

    page.append(h('div', { class: 'stats' },
      stat('Channel utama', `${ch.filter((c) => c.enabled).length}/${ch.length}`, 'aktif / total'),
      stat('Channel premium', ch.filter((c) => c.premium).length, cfg.payment.enabled ? 'butuh kode akses' : 'pembayaran nonaktif → gratis'),
      stat('Pembayaran', cfg.payment.enabled ? 'Aktif' : 'Nonaktif', `${cfg.payment.plans.filter((p) => p.active).length} paket aktif`),
      stat('Pengguna terdaftar', (state.stats.users || {}).total || 0, `${(state.stats.users || {}).premium || 0} premium aktif`),
      stat('Kode akses aktif', state.stats.codes.active || 0, `${state.stats.codes.unused || 0} belum dipakai`),
      stat('Total tayangan', total.toLocaleString('id-ID'), 'sejak server berjalan pertama kali'),
    ));

    const notes = [];
    if (cfg.payment.enabled && !cfg.payment.plans.some((p) => p.active)) notes.push('Pembayaran aktif tapi belum ada paket aktif.');
    if (cfg.payment.enabled && !cfg.payment.bankAccounts.length && !cfg.payment.ewallets.length && !cfg.payment.qrisImageUrl) {
      notes.push('Pembayaran aktif tapi belum ada rekening, e-wallet, atau QRIS.');
    }
    if (cfg.payment.enabled && !cfg.payment.whatsapp) notes.push('Nomor WhatsApp konfirmasi pembayaran belum diisi.');
    if (ch.some((c) => c.enabled && !c.sources.length)) notes.push('Ada channel aktif tanpa sumber siaran.');
    if (notes.length) page.append(h('div', { class: 'notice warn' }, h('strong', { text: 'Perlu diperhatikan' }), h('ul', {}, notes.map((n) => h('li', { text: n })))));

    const top = Object.entries(views).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = top.length ? top[0][1] : 1;
    page.append(card('Channel terpopuler', 'Jumlah kali channel dibuka di web utama.',
      top.length
        ? top.map(([slug, n]) => h('div', { class: 'bar' },
          h('span', { class: 'mono', text: '/' + slug }),
          h('i', { style: `width:${Math.max(4, (n / max) * 100)}%` }),
          h('span', { text: n.toLocaleString('id-ID') })))
        : h('p', { class: 'muted', text: 'Belum ada data tayangan.' })));
  }

  function stat(label, value, sub) {
    return h('div', { class: 'stat' }, h('span', { text: label }), h('strong', { text: String(value) }), h('small', { text: sub }));
  }

  // ---------- Halaman: Channel ----------

  function renderChannel(page) {
    const cfg = state.config;
    const tbody = h('tbody');
    const search = h('input', {
      type: 'search', placeholder: 'Cari channel…', value: state.channelQuery,
      oninput: (e) => { state.channelQuery = e.target.value; fill(); },
    });

    function fill() {
      tbody.innerHTML = '';
      const q = state.channelQuery.toLowerCase();
      cfg.channels.forEach((c, i) => {
        if (q && !c.name.toLowerCase().includes(q)) return;
        tbody.append(h('tr', { class: c.enabled ? '' : 'off' },
          h('td', {}, h('div', { class: 'order' },
            h('button', { type: 'button', title: 'Naik', text: '▲', onclick: () => move(i, -1) }),
            h('button', { type: 'button', title: 'Turun', text: '▼', onclick: () => move(i, 1) }))),
          h('td', {}, logoBox(c.logo, c.name)),
          h('td', {}, h('strong', { text: c.name }), h('div', { class: 'muted small mono', text: '/' + (c.slug || slugify(c.name)) })),
          h('td', {}, (c.groups || []).map((g) => h('span', { class: 'badge', text: g }))),
          h('td', {}, c.sources.length
            ? c.sources.map((s) => h('span', { class: 'badge' + (s.type === 'vidio' ? ' warn' : ' ok'), text: SOURCE_INFO[s.type].label }))
            : h('span', { class: 'badge red', text: 'Tanpa sumber' })),
          h('td', {}, miniSwitch(c, 'enabled', () => fill())),
          h('td', {}, miniSwitch(c, 'premium')),
          h('td', {}, h('div', { class: 'row' },
            h('button', { class: 'btn sm', type: 'button', text: 'Edit', onclick: () => editChannel(c) }),
            h('button', {
              class: 'btn sm danger', type: 'button', text: 'Hapus',
              onclick: () => {
                if (!confirm(`Hapus channel ${c.name}?`)) return;
                cfg.channels.splice(cfg.channels.indexOf(c), 1);
                markDirty();
                fill();
              },
            })))));
      });
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= cfg.channels.length) return;
      [cfg.channels[i], cfg.channels[j]] = [cfg.channels[j], cfg.channels[i]];
      markDirty();
      fill();
    }

    fill();
    page.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', { text: 'Channel utama' }),
          h('p', { text: 'Urutan di sini = urutan di web. Channel nonaktif disembunyikan. Channel premium hanya bisa ditonton dengan kode akses saat pembayaran aktif.' })),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn ghost', type: 'button', text: 'Kembalikan daftar bawaan',
            onclick: async () => {
              if (!confirm('Ganti semua channel utama dengan daftar bawaan? Perubahan channel yang sudah dibuat akan hilang.')) return;
              try { setConfig(await api('POST', '/api/admin/config/reset-channels', {})); render(); toast('Daftar channel dikembalikan.'); }
              catch (err) { toast(err.message, true); }
            },
          }),
          h('button', { class: 'btn primary', type: 'button', text: '+ Tambah channel', onclick: () => editChannel(null) }))),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, h('div', { style: 'flex:1;max-width:340px' }, search)),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['', 'Logo', 'Nama', 'Kategori', 'Sumber', 'Aktif', 'Premium', ''].map((t) => h('th', { text: t })))),
        tbody))));

    page.append(renderPlaylistCard());
  }

  function miniSwitch(obj, key, after) {
    const labels = { enabled: 'Aktif', premium: 'Premium', active: 'Aktif' };
    return h('label', { class: 'switch' }, h('input', {
      type: 'checkbox', checked: !!obj[key], 'aria-label': `${labels[key] || key}${obj.name ? ' ' + obj.name : ''}`,
      onchange: (e) => { obj[key] = e.target.checked; markDirty(); if (after) after(); },
    }));
  }

  function parsePlaylist(text) {
    const national = new Set(state.config.channels.map((c) => c.tvgId).filter(Boolean));
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; });
        const cut = line.lastIndexOf('",');
        cur = { attrs, name: (cut >= 0 ? line.slice(cut + 2) : line.slice(line.indexOf(',') + 1)).trim() };
      } else if (line && !line.startsWith('#') && cur) {
        const tvgId = cur.attrs['tvg-id'] || '';
        const [base, feed = ''] = tvgId.split('@');
        const ok = /\.id$/.test(base) && !(national.has(base) && ['SD', 'HD', 'FHD', ''].includes(feed)) &&
          !cur.attrs['http-referrer'] && !cur.attrs['http-user-agent'] &&
          (/\.m3u8?(\?|$)/i.test(line) || /\/play\//.test(line));
        if (ok) out.push({ tvgId, name: cur.name.replace(/\[.*?\]|\(\d{3,4}[pi]\)/g, '').trim(), logo: cur.attrs['tvg-logo'], group: cur.attrs['group-title'], url: line });
        cur = null;
      }
    }
    return out;
  }

  function renderPlaylistCard() {
    const s = state.config.streaming;
    const body = h('div', { class: 'stack' });

    async function load() {
      body.innerHTML = '';
      body.append(h('p', { class: 'muted', text: 'Memuat playlist…' }));
      try {
        const res = await fetch(s.playlistUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        state.playlist = parsePlaylist(await res.text());
        draw();
      } catch (err) {
        body.innerHTML = '';
        body.append(h('p', { class: 'error', text: 'Gagal memuat playlist: ' + err.message }));
      }
    }

    function draw() {
      body.innerHTML = '';
      const hidden = new Set(s.hiddenPlaylist);
      const q = state.playlistQuery.toLowerCase();
      const items = state.playlist.filter((p) => !q || p.name.toLowerCase().includes(q));
      const tbody = h('tbody', {}, items.map((p) => h('tr', { class: hidden.has(p.tvgId) ? 'off' : '' },
        h('td', {}, logoBox(p.logo, p.name)),
        h('td', {}, h('strong', { text: p.name }), h('div', { class: 'muted small mono', text: p.tvgId })),
        h('td', {}, h('span', { class: 'badge', text: p.group || '-' })),
        h('td', {}, h('label', { class: 'switch' }, h('input', {
          type: 'checkbox', checked: !hidden.has(p.tvgId),
          onchange: (e) => {
            const set = new Set(s.hiddenPlaylist);
            if (e.target.checked) set.delete(p.tvgId); else set.add(p.tvgId);
            s.hiddenPlaylist = [...set];
            markDirty();
            draw();
          },
        }))))));
      const setAll = (show) => {
        const set = new Set(s.hiddenPlaylist);
        for (const p of items) { if (show) set.delete(p.tvgId); else set.add(p.tvgId); }
        s.hiddenPlaylist = [...set];
        markDirty();
        draw();
      };
      body.append(
        h('div', { class: 'row' },
          h('div', { style: 'flex:1;max-width:340px' }, h('input', {
            type: 'search', placeholder: 'Cari channel daerah…', value: state.playlistQuery,
            oninput: (e) => { state.playlistQuery = e.target.value; draw(); const i = body.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); },
          })),
          h('span', { class: 'muted', text: `${state.playlist.length - s.hiddenPlaylist.filter((id) => state.playlist.some((p) => p.tvgId === id)).length} dari ${state.playlist.length} ditampilkan` }),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', type: 'button', text: 'Tampilkan semua (hasil cari)', onclick: () => setAll(true) }),
          h('button', { class: 'btn sm', type: 'button', text: 'Sembunyikan semua (hasil cari)', onclick: () => setAll(false) })),
        h('div', { class: 'table-wrap', style: 'max-height:520px;overflow:auto' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Logo', 'Nama', 'Grup', 'Tampil'].map((t) => h('th', { text: t })))), tbody)));
    }

    if (!s.playlistEnabled) {
      body.append(h('p', { class: 'muted', text: 'Playlist channel daerah sedang dinonaktifkan di Pengaturan Streaming.' }));
    } else if (state.playlist) {
      draw();
    } else {
      body.append(h('button', { class: 'btn', type: 'button', text: 'Muat daftar channel daerah', onclick: load }));
    }

    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {},
        h('h2', { text: 'Channel daerah (playlist otomatis)' }),
        h('p', { text: 'Diambil otomatis dari URL playlist di Pengaturan Streaming. Matikan channel yang tidak ingin ditampilkan.' }))),
      body);
  }

  // ---------- Editor channel ----------

  function editChannel(original) {
    const draft = original
      ? JSON.parse(JSON.stringify(original))
      : { id: '', name: '', slug: '', tvgId: '', logo: '', groups: ['Nasional'], aliases: [], enabled: true, premium: false, sources: [{ type: 'hls', url: '' }] };
    let previewHls = null;
    const preview = h('div', { class: 'preview' }, h('p', { text: 'Klik "Uji" pada salah satu sumber untuk mencoba memutarnya di sini.' }));
    const sourcesBox = h('div', { class: 'list-edit' });
    const logoPreview = h('span');
    const slugInput = textField(draft, 'slug', 'Alamat (slug)', { placeholder: slugify(draft.name) || 'otomatis dari nama', help: 'Contoh: indosiar → situs.com/indosiar' });

    const updateLogo = () => { logoPreview.innerHTML = ''; logoPreview.append(logoBox(draft.logo, draft.name)); };
    updateLogo();

    function stopPreview() {
      if (previewHls) { previewHls.destroy(); previewHls = null; }
      preview.innerHTML = '';
    }

    async function test(src) {
      stopPreview();
      if (src.type === 'hls') {
        const v = h('video', { controls: true, muted: true, autoplay: true, playsInline: true });
        preview.append(v);
        if (window.Hls && Hls.isSupported()) {
          previewHls = new Hls();
          previewHls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
            v.play().catch(() => {});
            toast(`Stream OK · ${d.levels.length} resolusi: ${d.levels.map((l) => l.height + 'p').join(', ')}`);
          });
          previewHls.on(Hls.Events.ERROR, (_, d) => {
            if (!d.fatal) return;
            stopPreview();
            preview.append(h('p', { text: 'Stream gagal diputar dari browser (mati, diblokir CORS, atau butuh referrer khusus).' }));
          });
          previewHls.loadSource(src.url);
          previewHls.attachMedia(v);
        } else v.src = src.url;
      } else if (src.type === 'iframe') {
        preview.append(h('iframe', { src: src.url, allow: 'autoplay; fullscreen; encrypted-media', allowFullscreen: true }));
      } else if (src.type === 'youtube') {
        try {
          const info = await api('GET', `/api/youtube-live?channel=${encodeURIComponent(src.channelId || '')}`);
          if (!info.live) throw new Error('Channel YouTube ini sedang tidak live.');
          preview.append(h('iframe', { src: `https://www.youtube.com/embed/${info.videoId}?autoplay=1&mute=1`, allow: 'autoplay; fullscreen; encrypted-media', allowFullscreen: true }));
        } catch (err) {
          preview.append(h('p', { text: err.message }));
        }
      } else {
        preview.append(h('p', {}, 'Vidio tidak mengizinkan embed. Di web, channel ini tampil sebagai tombol ke ',
          h('a', { href: `https://www.vidio.com/live/${src.id}`, target: '_blank', rel: 'noopener', text: `vidio.com/live/${src.id}` })));
      }
    }

    function drawSources() {
      sourcesBox.innerHTML = '';
      draft.sources.forEach((src, i) => {
        const fields = h('div', { class: 'grid2' });
        if (src.type === 'hls') fields.append(textField(src, 'url', 'URL stream (.m3u8)', { placeholder: 'https://…/playlist.m3u8' }));
        if (src.type === 'iframe') fields.append(
          textField(src, 'url', 'URL player embed', { placeholder: 'https://…' }),
          textField(src, 'label', 'Label sumber', { placeholder: 'mis. detik.com (resmi)' }));
        if (src.type === 'youtube') fields.append(textField(src, 'channelId', 'ID channel YouTube', { placeholder: 'UC…', help: 'Diawali "UC", 24 karakter.' }));
        if (src.type === 'vidio') fields.append(textField(src, 'id', 'ID live Vidio', { placeholder: '205-indosiar', help: 'Dari URL vidio.com/live/205-indosiar' }));
        const typeSel = h('select', {
          onchange: (e) => { draft.sources[i] = { type: e.target.value }; drawSources(); },
        }, Object.entries(SOURCE_INFO).map(([v, info]) => h('option', { value: v, text: info.label })));
        typeSel.value = src.type;
        sourcesBox.append(h('div', { class: 'source' },
          h('label', { class: 'field' }, h('span', { text: `Sumber ${i + 1}` }), typeSel, h('small', { text: SOURCE_INFO[src.type].hint })),
          fields,
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', type: 'button', text: 'Uji', onclick: () => test(src) }),
            h('button', { class: 'btn sm', type: 'button', text: '▲', title: 'Prioritaskan', disabled: i === 0,
              onclick: () => { [draft.sources[i - 1], draft.sources[i]] = [draft.sources[i], draft.sources[i - 1]]; drawSources(); } }),
            h('button', { class: 'btn sm danger', type: 'button', text: '✕', title: 'Hapus sumber',
              onclick: () => { draft.sources.splice(i, 1); drawSources(); } }))));
      });
    }
    drawSources();

    const groupsBox = h('div', { class: 'checks' });
    function drawGroups() {
      groupsBox.innerHTML = '';
      const all = [...new Set([...categoriesInUse(), ...draft.groups])];
      for (const g of all) {
        groupsBox.append(h('label', {}, h('input', {
          type: 'checkbox', checked: draft.groups.includes(g),
          onchange: (e) => { draft.groups = e.target.checked ? [...draft.groups, g] : draft.groups.filter((x) => x !== g); },
        }), g));
      }
      const custom = h('input', { type: 'text', placeholder: '+ kategori baru', style: 'width:160px;padding:4px 10px;border-radius:99px' });
      custom.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = custom.value.trim();
        if (v && !draft.groups.includes(v)) { draft.groups.push(v); drawGroups(); }
      });
      groupsBox.append(custom);
    }
    drawGroups();

    const aliasesHolder = { aliases: (draft.aliases || []).join(', ') };

    openModal(original ? `Edit channel: ${original.name}` : 'Tambah channel', [
      h('div', { class: 'grid2' },
        textField(draft, 'name', 'Nama channel', { placeholder: 'mis. Indosiar', onChange: () => { slugInput.querySelector('input').placeholder = slugify(draft.name) || 'otomatis dari nama'; updateLogo(); } }),
        slugInput),
      h('div', { class: 'grid2' },
        h('div', { class: 'row', style: 'align-items:flex-end' },
          h('div', { style: 'flex:1' }, textField(draft, 'logo', 'URL logo', { placeholder: 'https://…/logo.png', onChange: updateLogo })),
          logoPreview),
        textField(aliasesHolder, 'aliases', 'Alamat alternatif', { placeholder: 'mis. cnn, cnnindo', help: 'Pisahkan dengan koma.' })),
      h('div', { class: 'field' }, h('span', { text: 'Kategori' }), groupsBox, h('small', { text: 'Tekan Enter untuk menambah kategori baru.' })),
      h('div', { class: 'grid2' },
        toggle(draft, 'enabled', 'Aktif', 'Tampilkan channel ini di web.'),
        toggle(draft, 'premium', 'Premium', 'Hanya bisa ditonton dengan kode akses (saat pembayaran aktif).')),
      h('div', { class: 'field' },
        h('span', { text: 'Sumber siaran (dicoba berurutan dari atas)' }),
        sourcesBox,
        h('div', { class: 'row' }, h('button', {
          class: 'btn sm', type: 'button', text: '+ Tambah sumber',
          onclick: () => { draft.sources.push({ type: 'hls', url: '' }); drawSources(); },
        }))),
      h('div', { class: 'field' }, h('span', { text: 'Pratinjau' }), preview),
    ], [
      h('button', { class: 'btn', type: 'button', text: 'Batal', onclick: closeModal }),
      h('button', {
        class: 'btn primary', type: 'button', text: original ? 'Terapkan' : 'Tambahkan',
        onclick: () => {
          draft.name = draft.name.trim();
          if (!draft.name) { toast('Nama channel wajib diisi.', true); return; }
          draft.slug = slugify(draft.slug);
          draft.aliases = aliasesHolder.aliases.split(',').map(slugify).filter(Boolean);
          const slug = draft.slug || slugify(draft.name);
          const clash = state.config.channels.find((c) => c !== original && (c.slug || slugify(c.name)) === slug);
          if (clash) { toast(`Alamat /${slug} sudah dipakai ${clash.name}.`, true); return; }
          if (!draft.sources.length) { toast('Tambahkan minimal satu sumber siaran.', true); return; }
          if (original) Object.assign(original, draft);
          else state.config.channels.push(draft);
          markDirty();
          closeModal();
          render();
          toast('Channel diperbarui. Klik "Simpan perubahan" untuk menerapkan ke web.');
        },
      }),
    ], stopPreview);
  }

  // ---------- Halaman: Tampilan ----------

  function renderTampilan(page) {
    const s = state.config.site;
    const swatch = h('span', { style: `display:inline-block;width:38px;height:38px;border-radius:10px;background:${s.accent}` });
    const hex = h('input', {
      type: 'text', value: s.accent, style: 'width:110px',
      oninput: (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { s.accent = e.target.value; picker.value = s.accent; swatch.style.background = s.accent; markDirty(); } },
    });
    const picker = h('input', {
      type: 'color', value: s.accent,
      oninput: (e) => { s.accent = e.target.value; hex.value = s.accent; swatch.style.background = s.accent; markDirty(); },
    });
    const logoPrev = h('span');
    const drawLogo = () => { logoPrev.innerHTML = ''; if (s.logoUrl) logoPrev.append(logoBox(s.logoUrl, s.name)); };
    drawLogo();

    page.append(
      card('Identitas situs', 'Nama, logo, dan warna utama yang tampil di web.',
        h('div', { class: 'grid2' },
          textField(s, 'name', 'Nama situs', { onChange: (v) => { $('navSiteName').textContent = v; } }),
          h('div', { class: 'row', style: 'align-items:flex-end' },
            h('div', { style: 'flex:1' }, textField(s, 'logoUrl', 'URL logo (opsional)', { placeholder: 'https://…/logo.png', help: 'Kosongkan untuk memakai logo bawaan.', onChange: drawLogo })),
            logoPrev)),
        h('div', { class: 'grid2', style: 'margin-top:16px' },
          h('div', { class: 'field' }, h('span', { text: 'Warna utama (aksen)' }), h('div', { class: 'row' }, picker, hex, swatch)),
          selectField(s, 'theme', 'Tema', [['dark', 'Gelap'], ['light', 'Terang']]))),
      card('Halaman awal', 'Teks dan grid channel yang muncul sebelum pengunjung memilih channel.',
        h('div', { class: 'stack' },
          textField(s, 'welcomeTitle', 'Judul sambutan'),
          textField(s, 'welcomeText', 'Teks sambutan', { multiline: true }),
          h('div', { class: 'grid3' },
            toggle(s, 'showQuickGrid', 'Tampilkan grid channel', 'Logo channel populer di halaman awal.'),
            textField(s, 'quickGridCount', 'Jumlah channel di grid', { type: 'number', min: 0, max: 48 }),
            selectField(s, 'defaultCategory', 'Kategori awal di daftar', [['Semua', 'Semua'], ...categoriesInUse().map((c) => [c, c])])))),
      card('Pengumuman', 'Banner di bagian atas web, mis. info promo atau jadwal pemeliharaan.',
        h('div', { class: 'stack' },
          toggle(s.announcement, 'enabled', 'Tampilkan pengumuman'),
          textField(s.announcement, 'text', 'Isi pengumuman', { multiline: true }),
          selectField(s.announcement, 'tone', 'Gaya', [['info', 'Info (biru)'], ['warning', 'Peringatan (kuning)'], ['promo', 'Promo (warna aksen)']]))),
      card('Tata letak', null,
        h('div', { class: 'grid2' },
          selectField(s, 'sidebarPosition', 'Posisi daftar channel', [['right', 'Kanan'], ['left', 'Kiri']]),
          textField(s, 'footerText', 'Teks footer (opsional)', { placeholder: 'mis. © 2026 TEKDROID TV' }))),
    );
  }

  // ---------- Halaman: Streaming ----------

  function renderStreaming(page) {
    const s = state.config.streaming;
    page.append(
      card('Playlist channel daerah', 'Channel daerah dimuat otomatis dari playlist M3U publik. Pilih channel mana yang tampil di menu Pengaturan Channel.',
        h('div', { class: 'stack' },
          toggle(s, 'playlistEnabled', 'Muat channel daerah dari playlist'),
          textField(s, 'playlistUrl', 'URL playlist M3U', { type: 'url', help: 'Bawaan: playlist Indonesia dari iptv-org.' }),
          h('p', { class: 'muted small' }, `${s.hiddenPlaylist.length} channel playlist sedang disembunyikan. `,
            h('a', { href: '#channel', text: 'Atur di Pengaturan Channel →' })))),
      card('Pemutar video', 'Berlaku untuk stream HLS (TVRI, channel daerah, dan sumber .m3u8 lainnya). Channel YouTube/embed memakai pengaturan player masing-masing.',
        h('div', { class: 'stack' },
          h('div', { class: 'grid3' },
            selectField(s, 'defaultQuality', 'Resolusi awal', [['auto', 'Otomatis'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['240', '240p']],
              { numeric: true, help: 'Dipakai jika pengunjung belum memilih resolusi sendiri.' }),
            textField(s, 'loadTimeoutSec', 'Batas waktu memuat (detik)', { type: 'number', min: 5, max: 120, help: 'Setelah ini, sumber dianggap gagal.' }),
            textField(s, 'maxBufferSec', 'Buffer maksimum (detik)', { type: 'number', min: 10, max: 120, help: 'Lebih besar = lebih stabil, lebih boros kuota.' })),
          toggle(s, 'autoFallback', 'Pindah sumber otomatis', 'Jika sumber pertama gagal, coba sumber berikutnya tanpa menunggu pengunjung.'),
          toggle(s, 'startMuted', 'Mulai tanpa suara', 'Berguna agar autoplay lebih sering berhasil di browser.'),
          toggle(s, 'lowLatency', 'Mode latensi rendah', 'Lebih dekat ke siaran langsung, tapi lebih rentan buffering.'))),
    );
  }

  // ---------- Halaman: Pembayaran ----------

  function listEditor(arr, columns, makeEmpty, addLabel) {
    const box = h('div', { class: 'list-edit' });
    function draw() {
      box.innerHTML = '';
      arr.forEach((item, i) => {
        box.append(h('div', { class: 'list-row', style: `grid-template-columns:${columns.map((c) => c.width || '1fr').join(' ')} auto` },
          columns.map((c) => (c.toggle
            ? h('div', { class: 'field' }, h('span', { text: c.label }), miniSwitch(item, c.key))
            : textField(item, c.key, c.label, { type: c.type, placeholder: c.placeholder }))),
          h('button', { class: 'btn sm danger', type: 'button', text: '✕', title: 'Hapus', onclick: () => { arr.splice(i, 1); markDirty(); draw(); } })));
      });
      box.append(h('div', {}, h('button', { class: 'btn sm', type: 'button', text: addLabel, onclick: () => { arr.push(makeEmpty()); markDirty(); draw(); } })));
    }
    draw();
    return box;
  }

  function renderPembayaran(page) {
    const p = state.config.payment;
    const qrisPrev = h('div');
    const drawQris = () => { qrisPrev.innerHTML = ''; if (p.qrisImageUrl) qrisPrev.append(h('img', { class: 'qris', src: p.qrisImageUrl, alt: 'QRIS' })); };
    drawQris();

    page.append(
      h('div', { class: 'notice info' },
        'Pembayaran diverifikasi manual: pengunjung membayar lewat rekening/e-wallet/QRIS, mengirim bukti via WhatsApp, lalu Anda memberi kode akses dari bagian "Kode akses" di bawah. ',
        'Catatan: jual akses hanya untuk konten yang Anda punya haknya. Siaran TV nasional dimiliki stasiunnya.'),
      card('Status pembayaran', null,
        h('div', { class: 'stack' },
          toggle(p, 'enabled', 'Aktifkan pembayaran & channel premium',
            'Jika nonaktif, semua channel (termasuk yang ditandai premium) gratis dan tombol Berlangganan disembunyikan.'),
          h('div', { class: 'grid2' },
            selectField(p, 'currency', 'Mata uang', [['IDR', 'Rupiah (IDR)'], ['USD', 'Dolar AS (USD)']]),
            textField(p, 'whatsapp', 'WhatsApp konfirmasi', { placeholder: '6281234567890', help: 'Format internasional tanpa + atau spasi.' })))),
      card('Paket langganan', 'Paket yang ditawarkan di jendela Berlangganan.',
        listEditor(p.plans, [
          { key: 'name', label: 'Nama paket', placeholder: 'Bulanan' },
          { key: 'price', label: 'Harga', type: 'number', width: '130px' },
          { key: 'durationDays', label: 'Durasi (hari)', type: 'number', width: '120px' },
          { key: 'description', label: 'Deskripsi', width: '2fr' },
          { key: 'active', label: 'Aktif', toggle: true, width: '60px' },
        ], () => ({ id: '', name: '', price: 0, durationDays: 30, description: '', active: true }), '+ Tambah paket')),
      card('Metode pembayaran', 'Ditampilkan ke pengunjung sebagai cara membayar.',
        h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('span', { text: 'Rekening bank' }),
            listEditor(p.bankAccounts, [
              { key: 'bank', label: 'Bank', placeholder: 'BCA', width: '140px' },
              { key: 'number', label: 'Nomor rekening' },
              { key: 'holder', label: 'Atas nama' },
            ], () => ({ bank: '', number: '', holder: '' }), '+ Tambah rekening')),
          h('div', { class: 'field' }, h('span', { text: 'E-wallet' }),
            listEditor(p.ewallets, [
              { key: 'name', label: 'E-wallet', placeholder: 'DANA / OVO / GoPay', width: '160px' },
              { key: 'number', label: 'Nomor' },
              { key: 'holder', label: 'Atas nama' },
            ], () => ({ name: '', number: '', holder: '' }), '+ Tambah e-wallet')),
          h('div', { class: 'row', style: 'align-items:flex-start' },
            h('div', { style: 'flex:1' }, textField(p, 'qrisImageUrl', 'URL gambar QRIS (opsional)', { type: 'url', placeholder: 'https://…/qris.png', onChange: drawQris })),
            qrisPrev),
          textField(p, 'instructions', 'Instruksi pembayaran', { multiline: true }))),
      card('Payment gateway (opsional)', 'Kredensial disimpan aman di server (kunci rahasia tidak pernah dikirim ke pengunjung). Checkout otomatis lewat gateway belum diaktifkan; saat ini verifikasi tetap manual.',
        h('div', { class: 'grid2' },
          selectField(p.gateway, 'provider', 'Penyedia', [['none', 'Tidak dipakai'], ['midtrans', 'Midtrans'], ['xendit', 'Xendit'], ['tripay', 'Tripay']]),
          selectField(p.gateway, 'mode', 'Mode', [['sandbox', 'Sandbox (uji coba)'], ['production', 'Production (live)']]),
          textField(p.gateway, 'merchantId', 'Merchant ID'),
          textField(p.gateway, 'clientKey', 'Client key'),
          textField(p.gateway, 'serverKey', 'Server key (rahasia)', { type: 'password', help: 'Kosongkan lalu ketik ulang untuk mengganti.' }))),
      renderCodesCard(),
      renderPremiumCard(),
    );
  }

  function renderCodesCard() {
    const p = state.config.payment;
    const saved = JSON.parse(state.savedJson).payment.plans;
    const form = { planId: saved[0] ? saved[0].id : '', count: 1, note: '' };
    const tbody = h('tbody');
    const created = h('div');

    async function load() {
      try { state.codes = await api('GET', '/api/admin/codes'); } catch (err) { toast(err.message, true); }
      fill();
    }

    function fill() {
      tbody.innerHTML = '';
      if (!state.codes.length) {
        tbody.append(h('tr', {}, h('td', { colspan: 8, class: 'muted', text: 'Belum ada kode akses.' })));
        return;
      }
      for (const c of state.codes) {
        const tone = c.status === 'aktif' ? 'ok' : c.status === 'baru' ? 'warn' : 'red';
        tbody.append(h('tr', {},
          h('td', {}, h('span', { class: 'mono', text: c.code }), ' ',
            h('button', { class: 'btn sm ghost', type: 'button', text: 'Salin', onclick: () => navigator.clipboard.writeText(c.code).then(() => toast('Kode disalin.')) })),
          h('td', { text: c.planName }),
          h('td', {}, h('span', { class: 'badge ' + tone, text: c.status })),
          h('td', { text: formatDate(c.createdAt) }),
          h('td', { text: c.expiresAt ? formatDate(c.expiresAt) : `${c.durationDays} hari setelah dipakai` }),
          h('td', { text: c.usedBy || '—' }),
          h('td', { text: c.note || '—' }),
          h('td', {}, h('button', {
            class: 'btn sm danger', type: 'button', text: 'Hapus',
            onclick: async () => {
              if (!confirm(`Hapus kode ${c.code}? Pengguna kode ini akan kehilangan akses.`)) return;
              try { await api('DELETE', `/api/admin/codes/${c.code}`); await load(); } catch (err) { toast(err.message, true); }
            },
          }))));
      }
    }

    load();

    const planSel = h('select', { onchange: (e) => { form.planId = e.target.value; } },
      saved.map((pl) => h('option', { value: pl.id, text: `${pl.name} · ${pl.durationDays} hari · ${formatMoney(pl.price, p.currency)}` })));

    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {},
        h('h2', { text: 'Kode akses premium' }),
        h('p', { text: 'Buat kode setelah pembayaran terverifikasi, lalu kirim ke pelanggan. Masa aktif dihitung sejak kode pertama kali dipakai.' }))),
      saved.length
        ? h('div', { class: 'row', style: 'align-items:flex-end;margin-bottom:14px' },
          h('label', { class: 'field', style: 'min-width:260px' }, h('span', { text: 'Paket' }), planSel),
          h('label', { class: 'field', style: 'width:110px' }, h('span', { text: 'Jumlah' }),
            h('input', { type: 'number', min: 1, max: 100, value: 1, oninput: (e) => { form.count = Number(e.target.value); } })),
          h('label', { class: 'field', style: 'flex:1;min-width:200px' }, h('span', { text: 'Catatan (opsional)' }),
            h('input', { type: 'text', placeholder: 'mis. Budi — transfer BCA 29/10', oninput: (e) => { form.note = e.target.value; } })),
          h('button', {
            class: 'btn primary', type: 'button', text: 'Buat kode',
            onclick: async () => {
              try {
                const list = await api('POST', '/api/admin/codes', form);
                created.innerHTML = '';
                created.append(h('div', { class: 'notice info', style: 'margin-bottom:14px' },
                  h('strong', { text: `${list.length} kode baru: ` }), h('span', { class: 'mono', text: list.map((c) => c.code).join(', ') })));
                await load();
              } catch (err) { toast(err.message, true); }
            },
          }))
        : h('p', { class: 'muted', text: 'Tambahkan dan simpan paket langganan terlebih dahulu.' }),
      isDirty() && h('p', { class: 'muted small', text: 'Paket yang belum disimpan belum muncul di pilihan; klik "Simpan perubahan" dulu.' }),
      created,
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Kode', 'Paket', 'Status', 'Dibuat', 'Aktif sampai', 'Dipakai oleh', 'Catatan', ''].map((t) => h('th', { text: t })))),
        tbody)));
  }

  function renderPremiumCard() {
    const list = h('div', { class: 'checks' }, state.config.channels.map((c) => h('label', {},
      h('input', { type: 'checkbox', checked: c.premium, onchange: (e) => { c.premium = e.target.checked; markDirty(); } }), c.name)));
    return card('Channel premium', 'Centang channel yang hanya bisa ditonton dengan kode akses aktif.', list);
  }

  // ---------- Halaman: Pengguna ----------

  function renderPengguna(page) {
    const a = state.config.auth;
    const tbody = h('tbody');
    const count = h('span', { class: 'muted small' });
    const search = h('input', {
      type: 'search', placeholder: 'Cari nama, email, atau nomor HP…', value: state.userQuery,
      oninput: (e) => { state.userQuery = e.target.value; fill(); },
    });

    async function load() {
      try { state.users = await api('GET', '/api/admin/users'); } catch (err) { toast(err.message, true); }
      fill();
    }

    async function act(fn) {
      try { await fn(); await load(); } catch (err) { toast(err.message, true); }
    }

    function fill() {
      tbody.innerHTML = '';
      const q = state.userQuery.trim().toLowerCase();
      const list = state.users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.login.includes(q));
      count.textContent = `${state.users.length} akun terdaftar`;
      if (!list.length) {
        tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'muted', text: state.users.length ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna yang mendaftar.' })));
        return;
      }
      for (const u of list) {
        tbody.append(h('tr', { class: u.disabled ? 'off' : '' },
          h('td', {}, h('strong', { text: u.name }), h('div', { class: 'muted small mono', text: u.login })),
          h('td', {}, u.disabled
            ? h('span', { class: 'badge red', text: 'Nonaktif' })
            : h('span', { class: 'badge ok', text: 'Aktif' })),
          h('td', {}, u.access
            ? h('span', { class: 'badge warn', text: `${u.access.plan} · s/d ${formatDate(u.access.expiresAt)}` })
            : h('span', { class: 'muted', text: 'Gratis' })),
          h('td', { text: formatDate(u.createdAt) }),
          h('td', { text: formatDate(u.lastLoginAt) }),
          h('td', {}, h('div', { class: 'row' },
            h('button', {
              class: 'btn sm ghost', type: 'button', text: 'Reset password',
              onclick: () => act(async () => {
                if (!confirm(`Buat password sementara untuk ${u.name}? Password lamanya tidak bisa dipakai lagi.`)) return;
                const { password } = await api('POST', `/api/admin/users/${u.id}/reset-password`, {});
                openModal('Password sementara', [
                  h('p', { text: `Kirim password ini ke ${u.name} (${u.login}). Minta dia menggantinya lewat menu akun setelah masuk.` }),
                  h('p', {}, h('span', { class: 'mono', style: 'font-size:20px;font-weight:700', text: password })),
                ], [
                  h('button', { class: 'btn ghost', type: 'button', text: 'Salin', onclick: () => navigator.clipboard.writeText(password).then(() => toast('Password disalin.')) }),
                  h('button', { class: 'btn primary', type: 'button', text: 'Selesai', onclick: closeModal }),
                ]);
              }),
            }),
            h('button', {
              class: 'btn sm ghost', type: 'button', text: u.disabled ? 'Aktifkan' : 'Nonaktifkan',
              onclick: () => act(() => api('PATCH', `/api/admin/users/${u.id}`, { disabled: !u.disabled })),
            }),
            h('button', {
              class: 'btn sm danger', type: 'button', text: 'Hapus',
              onclick: () => act(async () => {
                if (!confirm(`Hapus akun ${u.name} (${u.login})? Akses premium akun ini ikut hilang.`)) return;
                await api('DELETE', `/api/admin/users/${u.id}`);
              }),
            })))));
      }
    }

    load();
    page.append(
      card('Login penonton', 'Simpan perubahan agar berlaku di web dan aplikasi.',
        h('div', { class: 'stack' },
          toggle(a, 'requireLogin', 'Wajib login untuk menonton', 'Pengunjung harus masuk ke akunnya sebelum daftar channel dan siaran ditampilkan.'),
          toggle(a, 'allowRegister', 'Izinkan daftar akun sendiri', 'Tampilkan tab "Daftar" di halaman login. Matikan jika akun hanya untuk pengguna yang sudah ada.'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h2', { text: 'Daftar pengguna' }),
            h('p', { text: 'Akun yang dinonaktifkan atau dihapus langsung keluar dari semua perangkat.' })),
          count),
        h('div', { class: 'row', style: 'margin-bottom:10px' }, h('div', { style: 'flex:1;max-width:340px' }, search)),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Pengguna', 'Status', 'Langganan', 'Terdaftar', 'Terakhir masuk', ''].map((t) => h('th', { text: t })))),
          tbody))),
    );
  }

  // ---------- Halaman: Akun ----------

  function renderAkun(page) {
    const form = { current: '', next: '', confirm: '' };
    const err = h('p', { class: 'error', hidden: true });
    page.append(card('Ganti password', 'Minimal 8 karakter. Sesi lain akan otomatis keluar.',
      h('form', {
        class: 'stack', style: 'max-width:420px',
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          if (form.next !== form.confirm) { err.textContent = 'Konfirmasi password tidak sama.'; err.hidden = false; return; }
          try {
            await api('POST', '/api/admin/password', { current: form.current, next: form.next });
            e.target.reset();
            toast('Password berhasil diganti.');
          } catch (x) { err.textContent = x.message; err.hidden = false; }
        },
      },
      textField(form, 'current', 'Password lama', { type: 'password' }),
      textField(form, 'next', 'Password baru', { type: 'password' }),
      textField(form, 'confirm', 'Ulangi password baru', { type: 'password' }),
      err,
      h('div', {}, h('button', { class: 'btn primary', type: 'submit', text: 'Ganti password' })))));
  }

  // ---------- Modal ----------

  let modalCleanup = null;
  function openModal(title, body, footer, onClose) {
    $('modalTitle').textContent = title;
    $('modalBody').replaceChildren(...body);
    $('modalFoot').replaceChildren(...footer);
    $('modal').hidden = false;
    modalCleanup = onClose || null;
  }
  function closeModal() {
    if (modalCleanup) modalCleanup();
    modalCleanup = null;
    $('modal').hidden = true;
  }

  // ---------- Navigasi ----------

  function render() {
    const page = $('page');
    page.innerHTML = '';
    $('pageTitle').textContent = PAGES[state.page];
    for (const a of document.querySelectorAll('#navLinks a')) a.classList.toggle('on', a.dataset.page === state.page);
    ({ ringkasan: renderRingkasan, channel: renderChannel, tampilan: renderTampilan, streaming: renderStreaming, pembayaran: renderPembayaran, pengguna: renderPengguna, akun: renderAkun })[state.page](page);
  }

  function route() {
    const page = location.hash.slice(1);
    state.page = PAGES[page] ? page : 'ringkasan';
    if (state.config) render();
  }

  function showLogin() {
    $('shell').hidden = true;
    $('login').hidden = false;
    $('loginPassword').focus();
  }

  async function boot() {
    try {
      setConfig(await api('GET', '/api/admin/config'));
      $('login').hidden = true;
      $('shell').hidden = false;
      route();
    } catch { /* showLogin dipanggil oleh api() */ }
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').hidden = true;
    try {
      await api('POST', '/api/admin/login', { password: $('loginPassword').value });
      $('loginPassword').value = '';
      boot();
    } catch (err) {
      $('loginError').textContent = err.message;
      $('loginError').hidden = false;
    }
  });

  $('logoutBtn').onclick = async () => {
    if (isDirty() && !confirm('Ada perubahan yang belum disimpan. Tetap keluar?')) return;
    try { await api('POST', '/api/admin/logout', {}); } catch { /* sesi mungkin sudah habis */ }
    state.config = null;
    showLogin();
  };
  $('saveBtn').onclick = save;
  $('discardBtn').onclick = () => {
    if (!confirm('Batalkan semua perubahan yang belum disimpan?')) return;
    setConfig(JSON.parse(state.savedJson));
    render();
  };
  $('modalClose').onclick = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal').hidden) closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && isDirty()) { e.preventDefault(); save(); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  boot();
})();

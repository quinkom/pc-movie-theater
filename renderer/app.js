'use strict';
/* ============ helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const fmtTime = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
const stripHtml = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const S = {
  settings: {}, items: [], view: [], idx: 0, tab: 'all', f: { genres: [], decades: [], minRating: 0, unwatched: false, status: 'all' }, q: '', themes: [], theme: null,
  modals: [], playing: false, askedThisSession: new Set(),
};

function toast(msg) {
  const t = el('div', { class: 'toast', text: msg });
  $('#toasts').append(t); setTimeout(() => t.remove(), 4100);
}
async function guard(fn, errPrefix = '') {
  try { return await fn(); } catch (e) { toast('⚠ ' + errPrefix + (e.message || e)); console.error(e); return undefined; }
}

/* ============ sound effects (synthesized, no files) ============ */
const SFX = {
  ctx: null,
  on() { return S.settings.sfx && !S.playing; },
  ac() { if (!this.ctx) this.ctx = new AudioContext(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; },
  vol() { return (S.settings.sfxVolume ?? .5); },
  tone({ f = 440, f2 = null, t = .1, type = 'sine', v = .2, delay = 0, lp = 0 }) {
    const c = this.ac(), o = c.createOscillator(), g = c.createGain(); let last = o;
    const t0 = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + t);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v * this.vol(), t0 + Math.min(.02, t / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); last = fl; }
    last.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + t + .05);
  },
  noise({ t = .3, v = .1, fc = 800, q = 1, delay = 0, sweep = 0 }) {
    const c = this.ac(), n = c.sampleRate * t, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; const t0 = c.currentTime + delay;
    f.frequency.setValueAtTime(fc, t0); if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + t);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v * this.vol(), t0 + t * .2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    s.connect(f); f.connect(g); g.connect(c.destination); s.start(t0);
  },
  spooky() { return (S.theme && S.theme.sfx) === 'spooky'; },
  move() { if (!this.on()) return; this.spooky() ? (this.tone({ f: 220, f2: 140, t: .07, type: 'triangle', v: .09, lp: 900 }), this.noise({ t: .06, v: .05, fc: 3000 })) : this.tone({ f: 900, f2: 700, t: .04, type: 'sine', v: .08 }); },
  select() { if (!this.on()) return; if (this.spooky()) { this.tone({ f: 90, f2: 45, t: .6, type: 'sine', v: .4 }); this.noise({ t: .5, v: .1, fc: 300, sweep: 1400, q: 3 }); } else { this.tone({ f: 500, f2: 800, t: .12, v: .15 }); } },
  open() { if (!this.on()) return; if (this.spooky()) { // creaky door
    const c = this.ac(), o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain(); const t0 = c.currentTime, T = .75;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t0); o.frequency.linearRampToValueAtTime(230, t0 + T * .5); o.frequency.linearRampToValueAtTime(120, t0 + T);
    lfo.frequency.value = 22; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency); fl.type = 'bandpass'; fl.frequency.value = 700; fl.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(.12 * this.vol(), t0 + .1); g.gain.exponentialRampToValueAtTime(0.0001, t0 + T);
    o.connect(fl); fl.connect(g); g.connect(c.destination); o.start(t0); lfo.start(t0); o.stop(t0 + T + .05); lfo.stop(t0 + T + .05);
  } else this.tone({ f: 400, f2: 650, t: .15, v: .12 }); },
  back() { if (!this.on()) return; this.spooky() ? (this.tone({ f: 300, f2: 90, t: .22, type: 'sawtooth', v: .07, lp: 700 })) : this.tone({ f: 600, f2: 350, t: .1, v: .1 }); },
  bad() { if (!this.on()) return; this.tone({ f: 120, t: .25, type: 'square', v: .08, lp: 500 }); },
  jingle() { if (!this.on()) return; const n = this.spooky() ? [196, 233, 277, 233] : [523, 659, 784, 1047]; n.forEach((f, i) => this.tone({ f, t: .5, v: .1, delay: i * .12, type: this.spooky() ? 'triangle' : 'sine', lp: 2500 })); },
  ambience: null,
  setAmbience(on) {
    if (this.ambience) { try { this.ambience.stop(); } catch {} this.ambience = null; }
    if (!on) return;
    const c = this.ac(), n = c.sampleRate * 4, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let l = 0; for (let i = 0; i < n; i++) { l = (l + (Math.random() * 2 - 1) * .02) * .995; d[i] = l * 6; }
    const s = c.createBufferSource(); s.buffer = b; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .08; lg.gain.value = 250; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g = c.createGain(); g.gain.value = .35 * this.vol(); s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    this.ambience = { stop() { try { s.stop(); lfo.stop(); } catch {} }, gain: g };
  },
};

/* ============ themes & fx ============ */
const mmdd = d => (d.getMonth() + 1) * 100 + d.getDate();
function seasonMatch(t, d = new Date()) {
  if (!t.season) return false;
  const [a, b] = t.season.map(s => { const [m, dd] = s.split('-').map(Number); return m * 100 + dd; });
  const x = mmdd(d); return a <= b ? x >= a && x <= b : x >= a || x <= b;
}
function pickTheme() {
  const pref = S.settings.theme;
  if (pref && pref !== 'auto') { const t = S.themes.find(t => t.id === pref); if (t) return t; }
  return S.themes.find(t => seasonMatch(t)) || S.themes.find(t => t.id === 'classic') || S.themes[0];
}
function applyTheme() {
  const t = pickTheme(); if (!t) return;
  S.theme = t;
  $('#theme-css').textContent = t.css.replace(/url\(\s*(['"]?)(?!https?:|data:|file:)([^)'"]+)\1\s*\)/g, (_, q, p) => `url("${t.base}/${p}")`);
  $('#brand').textContent = t.brand || 'PC MOVIE THEATER';
  $('#logoIcon').textContent = t.icon || '🎬';
  $('#decor').innerHTML = t.decor || '';
  document.body.classList.toggle('no-decor', S.settings.decor === false);
  document.title = t.brand || 'PC Movie Theater';
  FX.setup(t.fx || []);
  renderAll(true);
}

const FX = {
  c: $('#fx'), g: $('#fx').getContext('2d'), kinds: [], parts: [], raf: 0, last: 0, bolt: 0,
  setup(kinds) { this.kinds = kinds; this.parts = []; this.restart(); },
  restart() {
    cancelAnimationFrame(this.raf); this.g.clearRect(0, 0, this.c.width, this.c.height);
    if (!S.settings.fx || !this.kinds.length) return;
    this.resize(); this.raf = requestAnimationFrame(t => { this.last = t; this.tick(t); });
  },
  resize() { const r = devicePixelRatio > 1.5 ? 1.5 : 1; this.c.width = innerWidth * r; this.c.height = innerHeight * r; this.r = r; },
  rnd: (a, b) => a + Math.random() * (b - a),
  spawn(kind, initial) {
    const W = this.c.width, H = this.c.height, r = this.r, R = this.rnd;
    switch (kind) {
      case 'fog': return { k: kind, x: R(-.2, 1) * W, y: R(.45, 1) * H, rad: R(.22, .45) * W, vx: R(5, 18) * r * (Math.random() < .5 ? -1 : 1), a: R(.04, .09) };
      case 'bats': { const dir = Math.random() < .5 ? 1 : -1; return { k: kind, x: dir > 0 ? -60 * r : W + 60 * r, y: R(.05, .45) * H, vx: dir * R(90, 170) * r, vy: R(-20, 20) * r, s: R(.5, 1.1) * r, ph: R(0, 6), dir }; }
      case 'embers': return { k: kind, x: R(0, 1) * W, y: initial ? R(0, 1) * H : H + 10, vy: -R(20, 70) * r, vx: R(-15, 15) * r, s: R(1, 3) * r, a: R(.4, .9), ph: R(0, 6) };
      case 'snow': return { k: kind, x: R(0, 1) * W, y: initial ? R(0, 1) * H : -10, vy: R(30, 80) * r, vx: R(-10, 10) * r, s: R(1.5, 4) * r, a: R(.5, .95), ph: R(0, 6) };
      case 'leaves': return { k: kind, x: R(0, 1) * W, y: initial ? R(0, 1) * H : -20, vy: R(40, 90) * r, vx: R(10, 40) * r, s: R(5, 11) * r, ph: R(0, 6), rot: R(0, 6), col: ['#c2410c', '#d97706', '#9a3412', '#b45309', '#ca8a04'][Math.floor(R(0, 5))] };
      case 'ghosts': return { k: kind, x: R(.05, .95) * W, y: R(.1, .5) * H, s: R(.6, 1.1) * r, ph: R(0, 6), vx: R(8, 22) * r * (Math.random() < .5 ? -1 : 1), a: R(.08, .16) };
      case 'dust': return { k: kind, x: R(0, 1) * W, y: R(0, 1) * H, vx: R(-6, 6) * r, vy: R(-5, 3) * r, s: R(.8, 2.2) * r, a: R(.12, .38), ph: R(0, 6) };
      case 'stars': return { k: kind, x: R(0, 1) * W, y: R(0, .6) * H, s: R(.6, 1.8) * r, ph: R(0, 6) };
    }
  },
  want: { dust: 46, fog: 7, bats: 0, embers: 40, snow: 90, leaves: 26, ghosts: 3, stars: 70 },
  tick(t) {
    this.raf = requestAnimationFrame(tt => this.tick(tt));
    if (document.hidden || S.playing) { this.last = t; return; }
    const dt = Math.min(.05, (t - this.last) / 1000); this.last = t;
    const g = this.g, W = this.c.width, H = this.c.height, r = this.r;
    g.clearRect(0, 0, W, H);
    for (const k of this.kinds) {
      if (k === 'lightning') continue;
      if (k === 'bats') { if (this.parts.filter(p => p.k === 'bats').length < 3 && Math.random() < dt * .25) this.parts.push(this.spawn('bats')); continue; }
      const n = this.parts.filter(p => p.k === k).length;
      for (let i = n; i < (this.want[k] || 0); i++) this.parts.push(this.spawn(k, true));
    }
    if (this.kinds.includes('lightning') && Math.random() < dt * .045) {
      const f = $('#flash'); f.classList.add('on'); SFX.on() && SFX.noise({ t: 1.6, v: .18, fc: 120, q: .6, delay: .25 });
      setTimeout(() => { f.classList.remove('on'); setTimeout(() => { f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 70); }, 90); }, 60);
    }
    this.parts = this.parts.filter(p => {
      p.ph = (p.ph || 0) + dt;
      switch (p.k) {
        case 'fog': { p.x += p.vx * dt; const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rad); gr.addColorStop(0, `rgba(210,200,230,${p.a})`); gr.addColorStop(1, 'rgba(210,200,230,0)'); g.fillStyle = gr; g.fillRect(p.x - p.rad, p.y - p.rad, p.rad * 2, p.rad * 2); return p.x > -p.rad * 1.2 && p.x < W + p.rad * 1.2; }
        case 'bats': { p.x += p.vx * dt; p.y += (p.vy + Math.sin(p.ph * 3) * 40 * r) * dt; const flap = Math.sin(p.ph * 18); g.save(); g.translate(p.x, p.y); g.scale(p.s * p.dir, p.s); g.fillStyle = '#05020a'; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-14, -16 * (.4 + flap * .6), -34, -6 + flap * 12); g.quadraticCurveTo(-26, 2, -20, 6); g.quadraticCurveTo(-14, 0, -8, 8); g.quadraticCurveTo(-3, 2, 0, 10); g.quadraticCurveTo(3, 2, 8, 8); g.quadraticCurveTo(14, 0, 20, 6); g.quadraticCurveTo(26, 2, 34, -6 + flap * 12); g.quadraticCurveTo(14, -16 * (.4 + flap * .6), 0, 0); g.fill(); g.beginPath(); g.moveTo(-4, -2); g.lineTo(-3, -9); g.lineTo(0, -4); g.lineTo(3, -9); g.lineTo(4, -2); g.fill(); g.restore(); return p.x > -120 * r && p.x < W + 120 * r; }
        case 'embers': p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.ph * 2) * 12) * dt; g.fillStyle = `rgba(255,${Math.floor(120 + 80 * Math.sin(p.ph * 3))},30,${p.a * (.6 + .4 * Math.sin(p.ph * 6))})`; g.shadowColor = '#ff7a18'; g.shadowBlur = 8; g.beginPath(); g.arc(p.x, p.y, p.s, 0, 7); g.fill(); g.shadowBlur = 0; return p.y > -10;
        case 'snow': p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.ph) * 14) * dt; g.fillStyle = `rgba(255,255,255,${p.a})`; g.beginPath(); g.arc(p.x, p.y, p.s, 0, 7); g.fill(); return p.y < H + 10;
        case 'leaves': p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.ph * 1.5) * 25) * dt; p.rot += dt * 2; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, .55 + .45 * Math.abs(Math.sin(p.ph))); g.fillStyle = p.col; g.globalAlpha = .85; g.beginPath(); g.ellipse(0, 0, p.s, p.s * .55, 0, 0, 7); g.fill(); g.restore(); return p.y < H + 20;
        case 'ghosts': { p.x += p.vx * dt; const y = p.y + Math.sin(p.ph * .9) * 24 * r, s = 46 * p.s; g.save(); g.translate(p.x, y); g.fillStyle = `rgba(235,240,255,${p.a})`; g.shadowColor = 'rgba(200,220,255,.6)'; g.shadowBlur = 24; g.beginPath(); g.arc(0, 0, s, Math.PI, 0); g.lineTo(s, s * 1.5); for (let i = 0; i < 4; i++) { const x1 = s - (i + .5) * s / 2, x2 = s - (i + 1) * s / 2; g.quadraticCurveTo(x1, s * (i % 2 ? 1.5 : 1.85), x2, s * 1.5); } g.closePath(); g.fill(); g.shadowBlur = 0; g.fillStyle = `rgba(20,10,40,${p.a * 5})`; g.beginPath(); g.ellipse(-s * .35, -s * .1, s * .12, s * .2, 0, 0, 7); g.ellipse(s * .35, -s * .1, s * .12, s * .2, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, s * .35, s * .12, s * .18, 0, 0, 7); g.fill(); g.restore(); return p.x > -s * 2 && p.x < W + s * 2; }
        case 'dust': p.x += (p.vx + Math.sin(p.ph * .7) * 5) * dt; p.y += p.vy * dt; if (p.x < -5) p.x = W + 5; if (p.x > W + 5) p.x = -5; if (p.y < -5) p.y = H + 5; if (p.y > H + 5) p.y = -5; g.fillStyle = `rgba(255,236,170,${p.a * (.6 + .4 * Math.sin(p.ph * 1.3))})`; g.beginPath(); g.arc(p.x, p.y, p.s, 0, 7); g.fill(); return true;
        case 'stars': g.fillStyle = `rgba(255,255,255,${.35 + .5 * Math.abs(Math.sin(p.ph * .8))})`; g.fillRect(p.x, p.y, p.s, p.s); return true;
      }
      return false;
    });
  },
};
addEventListener('resize', () => { FX.resize(); renderFlow(); });

/* ============ library state ============ */
const isWatched = it => it.type === 'movie' ? !!(it.watched && it.watched.movie) : it.episodes.length > 0 && it.episodes.every(e => it.watched && it.watched[e.path]);
const seasonsOf = it => [...new Set(it.episodes.map(e => e.season))].sort((a, b) => a - b);
/* ============ filters: genre / decade lists build themselves from whatever data each title has ============ */
const TABS = [['all', 'All'], ['movies', 'Movies'], ['shows', 'TV Shows'], ['favs', '♥ Favorites'], ['continue', 'Continue'], ['new', 'New']];
const decadeOf = y => y ? Math.floor(y / 10) * 10 : null;
const tabsAvail = () => TABS.filter(([t]) => t !== 'continue' || S.items.some(i => i.resume));
function facets() {
  const g = new Map(), d = new Map(); let uns = 0, unk = 0, rated = false;
  for (const it of S.items) {
    const gs = it.genres || []; if (!gs.length) uns++;
    for (const x of gs) g.set(x, (g.get(x) || 0) + 1);
    const dc = decadeOf(it.year); if (dc) d.set(dc, (d.get(dc) || 0) + 1); else unk++;
    if (it.rating) rated = true;
  }
  return { genres: [...g].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), uns, decades: [...d].sort((a, b) => b[0] - a[0]), unk, rated };
}
const filterCount = () => S.f.genres.length + S.f.decades.length + (S.f.minRating ? 1 : 0) + (S.f.unwatched ? 1 : 0) + (S.f.status !== 'all' ? 1 : 0);

function applyFilter(keepId) {
  const q = norm(S.q), now = Date.now(), F = S.f;
  let v = S.items.filter(it => {
    const t = S.tab;
    if (t === 'movies' && it.type !== 'movie') return false;
    if (t === 'shows' && it.type !== 'show') return false;
    if (t === 'favs' && !it.fav) return false;
    if (t === 'continue' && !it.resume) return false;
    if (t === 'new' && (it.virtual || now - it.added > 21 * 864e5)) return false;
    if (F.status === 'downloaded' && it.virtual) return false;
    if (F.status === 'ghost' && !it.virtual) return false;
    if (F.unwatched && isWatched(it)) return false;
    if (F.genres.length) { const g = it.genres || []; if (!F.genres.some(x => x === 'Unsorted' ? !g.length : g.includes(x))) return false; }
    if (F.decades.length) { const d = decadeOf(it.year); if (!F.decades.some(x => x === 'unknown' ? !d : x === d)) return false; }
    if (F.minRating && !(it.rating >= F.minRating)) return false;
    if (q && !(norm(it.title).includes(q) || (it.genres || []).some(g => norm(g).includes(q)) || String(it.year || '') === q || norm(it.overview).includes(q))) return false;
    return true;
  });
  const sort = S.settings.sort;
  const byTitle = (a, b) => a.title.replace(/^(the|a|an)\s+/i, '').localeCompare(b.title.replace(/^(the|a|an)\s+/i, ''), undefined, { numeric: true, sensitivity: 'base' });
  if (S.tab === 'continue') v.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  else if (S.tab === 'new' || sort === 'added') v.sort((a, b) => b.added - a.added);
  else if (sort === 'year') v.sort((a, b) => (b.year || 0) - (a.year || 0) || byTitle(a, b));
  else if (sort === 'recent') v.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || byTitle(a, b));
  else v.sort(byTitle);
  S.view = v;
  const k = v.findIndex(i => i.id === keepId);
  S.idx = k >= 0 ? k : Math.min(S.idx, Math.max(0, v.length - 1));
}
const cur = () => S.view[S.idx];

function commit() { const k = (cur() || {}).id; applyFilter(k); if (!S.view.some(i => i.id === k)) S.idx = 0; renderAll(true); }
function setTab(t) { S.tab = t; S.idx = 0; applyFilter(); renderAll(true); }
function cycleCat(d) { const l = tabsAvail().map(x => x[0]); let i = l.indexOf(S.tab); if (i < 0) i = 0; setTab(l[(i + d + l.length) % l.length]); SFX.move(); }
function toggleF(key, val) { const a = S.f[key], i = a.indexOf(val); if (i >= 0) a.splice(i, 1); else a.push(val); SFX.move(); commit(); }
function setStatus(v) { S.f.status = v; S.settings.status = v; api.setSettings({ status: v }); commit(); }
function resetFilters(keepStatus) {
  S.f.genres = []; S.f.decades = []; S.f.minRating = 0; S.f.unwatched = false; S.tab = 'all'; S.q = ''; $('#search').value = '';
  if (!keepStatus) { S.f.status = 'all'; S.settings.status = 'all'; api.setSettings({ status: 'all' }); }
  S.idx = 0; applyFilter(); renderAll(true);
}

function renderFilterBar() {
  const tabs = $('#tabs'); tabs.textContent = '';
  for (const [t, label] of tabsAvail()) tabs.append(el('button', { class: S.tab === t ? 'on' : '', 'data-nav': '', text: label, onclick: () => { SFX.move(); setTab(t); } }));
  const F = facets(), q = $('#qchips'); q.textContent = '';
  const top = F.genres.slice(0, 7).map(x => x[0]);
  for (const g of S.f.genres) if (g !== 'Unsorted' && !top.includes(g)) top.unshift(g);
  for (const g of top) q.append(el('button', { class: 'fchip' + (S.f.genres.includes(g) ? ' on' : ''), 'data-nav': '', text: g, onclick: () => toggleF('genres', g) }));
  if (F.genres.length > 7 || F.decades.length > 1) q.append(el('button', { class: 'fchip more', 'data-nav': '', text: 'More filters…', onclick: openFilters }));
  const gb = $('#btnGhost'), hidden = S.f.status === 'downloaded';
  gb.hidden = !S.items.some(i => i.virtual) && S.f.status === 'all';
  gb.className = 'pill' + (hidden ? ' off' : ''); gb.textContent = hidden ? '☁ Not downloaded: hidden' : '☁ Not downloaded: shown';
  const n = filterCount(), fc = $('#fcount'); fc.textContent = n || ''; fc.hidden = !n;
  $('#countLabel').textContent = `${S.view.length} ${S.view.length === 1 ? 'title' : 'titles'}`;
}

function openFilters() {
  SFX.open(); let m; const body = el('div', { class: 'fpanel' });
  const chip = (label, on, fn, n) => el('button', { class: 'fchip' + (on ? ' on' : ''), 'data-nav': '', onclick: fn }, label, n != null ? el('b', { text: n }) : null);
  const sec = (title, ...kids) => el('div', { class: 'fsec' }, el('div', { class: 'ftitle', text: title }), el('div', { class: 'fchips' }, ...kids));
  const draw = () => {
    const F = facets(); body.textContent = '';
    body.append(sec('Show', ...[['all', 'Everything'], ['downloaded', 'Downloaded only'], ['ghost', '☁ Not downloaded only']].map(([v, l]) => chip(l, S.f.status === v, () => { setStatus(v); draw(); }))));
    body.append(sec('Genre', ...F.genres.map(([g, n]) => chip(g, S.f.genres.includes(g), () => { toggleF('genres', g); draw(); }, n)),
      F.uns && F.genres.length ? chip('Unsorted', S.f.genres.includes('Unsorted'), () => { toggleF('genres', 'Unsorted'); draw(); }, F.uns) : null));
    if (!F.genres.length) body.append(el('div', { class: 'muted small', text: 'No genres yet — press “Auto-categorize” below to look them up.' }));
    if (F.decades.length) body.append(sec('Decade', ...F.decades.map(([d, n]) => chip(d + 's', S.f.decades.includes(d), () => { toggleF('decades', d); draw(); }, n)),
      F.unk ? chip('Unknown year', S.f.decades.includes('unknown'), () => { toggleF('decades', 'unknown'); draw(); }, F.unk) : null));
    if (F.rated) body.append(sec('Rating', ...[[0, 'Any'], [6, '★ 6+'], [7, '★ 7+'], [8, '★ 8+']].map(([v, l]) => chip(l, S.f.minRating === v, () => { S.f.minRating = v; commit(); draw(); }))));
    body.append(sec('Watching', chip('♥ Favorites only', S.tab === 'favs', () => { setTab(S.tab === 'favs' ? 'all' : 'favs'); draw(); }), chip('Unwatched only', S.f.unwatched, () => { S.f.unwatched = !S.f.unwatched; commit(); draw(); })));
    body.append(sec('Sort by', ...[['title', 'A–Z'], ['year', 'Newest'], ['added', 'Recently added'], ['recent', 'Recently watched']].map(([v, l]) => chip(l, S.settings.sort === v, () => { S.settings.sort = v; api.setSettings({ sort: v }); commit(); draw(); }))));
    body.append(el('div', { class: 'fresult', text: `${S.view.length} of ${S.items.length} titles match` }));
    body.append(el('div', { class: 'btns' },
      el('button', { class: 'btn primary', 'data-autofocus': '', text: 'Done', onclick: () => closeModal(m) }),
      el('button', { class: 'btn', 'data-nav': '', text: 'Clear filters', onclick: () => { resetFilters(false); draw(); } }),
      el('button', { class: 'btn', 'data-nav': '', text: '✨ Auto-categorize', title: 'Look up genres & years for titles that are missing them', onclick: async () => { toast('Looking up genres & years…'); const n = await autoCategorize(true); draw(); toast(n ? `Categorized ${n} title${n === 1 ? '' : 's'}` : 'Nothing new found'); } }),
      el('button', { class: 'btn', 'data-nav': '', text: '⬇ Get movies', onclick: () => { closeModal(m); openArchive(); } })));
  };
  m = openModal(el('div', {}, mkHead('Filters', () => m), el('div', { class: 'body' }, body)), { cls: 'mid' });
  draw();
}

// Quietly fills in genres / years for titles missing them (metadata only — no images are downloaded).
async function autoCategorize(force) {
  const stale = i => !(typeof i.metaTried === 'number' && Date.now() - i.metaTried < 7 * 864e5);
  const todo = S.items.filter(i => (!(i.genres && i.genres.length) || !i.year) && (force || stale(i))).slice(0, 80);
  let n = 0;
  for (const it of todo) {
    const r = await api.autoMeta(it.id, !!force).catch(() => null); if (!r) continue;
    const i = S.items.findIndex(x => x.id === r.id);
    if (i >= 0) { if ((!(it.genres && it.genres.length) && r.genres && r.genres.length) || (!it.year && r.year)) n++; S.items[i] = r; }
  }
  if (todo.length) { const k = (cur() || {}).id; applyFilter(k); renderAll(true); }
  return n;
}

/* ============ box rendering ============ */
function makeArt(it) {
  const art = el('div', { class: 'art' });
  if (it.coverUrl) art.append(el('img', { src: it.coverUrl, draggable: 'false', loading: 'lazy' }));
  else art.append(el('div', { class: 'ph' }, el('div', { class: 'pi', text: (S.theme && S.theme.icon) || '🎬' }), el('div', { class: 'pt', text: it.title }), el('div', { class: 'py', text: it.year || '' })));
  return art;
}
function makeBox(it) {
  const front = el('div', { class: 'face front' }, makeArt(it), el('div', { class: 'gloss' }));
  if (it.virtual) front.append(el('span', { class: 'badge cloud', text: '☁ NOT DOWNLOADED' }));
  else if (Date.now() - it.added < 14 * 864e5) front.append(el('span', { class: 'badge new', text: 'NEW' }));
  if (it.type === 'show') front.append(el('span', { class: 'badge tv', text: seasonsOf(it).length + ' S' }));
  if (isWatched(it)) front.append(el('span', { class: 'badge seen', text: '✓' }));
  if (it.fav) front.append(el('span', { class: 'badge fav', text: '♥' }));
  if (it.resume && it.resume.dur) front.append(el('div', { class: 'prog' }, el('i', { style: `width:${Math.min(100, it.resume.pos / it.resume.dur * 100)}%` })));
  const spine = el('div', { class: 'face side sideL' }, el('div', { class: 'spine' }, el('b', { text: it.title }), it.year ? el('i', { text: it.year }) : null));
  const cube = el('div', { class: 'cube' }, front, el('div', { class: 'face back' }), spine, el('div', { class: 'face side sideR' }), el('div', { class: 'face cap capT' }), el('div', { class: 'face cap capB' }));
  return el('div', { class: 'box' + (it.virtual ? ' ghost' : ''), 'data-id': it.id }, el('div', { class: 'glow' }), cube, el('div', { class: 'reflect' }, makeArt(it)));
}
const boxes = new Map();
function place(b, d) {
  const a = Math.abs(d), s = Math.sign(d);
  let x = 0, z = .55, r = 0;
  if (d) { x = s * (.9 + (a - 1) * .38); z = -.25 - Math.min(a, 6) * .02; r = -s * 64; }
  b.style.transform = `translateX(calc(var(--bw) * ${x})) translateZ(calc(var(--bw) * ${z})) rotateY(${r}deg)`;
  b.style.zIndex = 100 - a; b.style.opacity = a > 7 ? 0 : 1; b.style.pointerEvents = a > 8 ? 'none' : '';
  b.classList.toggle('center', d === 0);
}
function renderFlow() {
  const flow = $('#flow'), N = S.view.length, R = 9, want = new Set();
  for (let i = Math.max(0, S.idx - R); i <= Math.min(N - 1, S.idx + R); i++) want.add(S.view[i].id);
  for (const [id, b] of boxes) if (!want.has(id)) { b.remove(); boxes.delete(id); }
  for (let i = Math.max(0, S.idx - R); i <= Math.min(N - 1, S.idx + R); i++) {
    const it = S.view[i]; let b = boxes.get(it.id);
    if (!b) {
      b = makeBox(it); b.classList.add('nt'); boxes.set(it.id, b); flow.append(b);
      b.addEventListener('click', () => { const j = S.view.findIndex(v => v.id === it.id); if (j === S.idx) openDetails(it); else { S.idx = j; SFX.move(); update(); } });
      place(b, i - S.idx); void b.offsetWidth; b.classList.remove('nt');
    } else place(b, i - S.idx);
  }
}
const wallBoxes = new Map();
function renderWall(rebuild, noScroll) {
  const w = $('#wall');
  if (rebuild) {
    w.textContent = ''; wallBoxes.clear();
    S.view.forEach((it, i) => {
      const b = makeBox(it); b.classList.add('nt'); wallBoxes.set(it.id, b);
      b.addEventListener('click', () => { S.idx = i; SFX.select(); update(); openDetails(it); });
      w.append(b);
    });
  }
  for (const [id, b] of wallBoxes) b.classList.toggle('sel', id === (cur() || {}).id);
  const s = wallBoxes.get((cur() || {}).id); if (s && !noScroll) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// hovering a box selects it, so its name shows in the plaque (mousemove only, so keyboard scrolling under a parked mouse doesn't fight)
$('#wall').addEventListener('mousemove', e => {
  const b = e.target.closest('.box'); if (!b) return;
  const i = S.view.findIndex(v => v.id === b.dataset.id);
  if (i >= 0 && i !== S.idx) { S.idx = i; SFX.move(); renderWall(false, true); updatePlaque(); }
});
function clearBoxes() { for (const b of boxes.values()) b.remove(); boxes.clear(); }

function updatePlaque() {
  const it = cur(), N = S.view.length;
  $('#plTitle').textContent = it ? it.title + (it.year ? ` (${it.year})` : '') : '—';
  $('#plSub').textContent = it ? `${S.idx + 1} of ${N}` + (it.type === 'show' ? ` · ${seasonsOf(it).length} season${seasonsOf(it).length === 1 ? '' : 's'}, ${it.episodes.length} episodes` : '') + (it.genres && it.genres.length ? ' · ' + it.genres.slice(0, 3).join(', ') : '') + (it.virtual ? ' · ☁ not downloaded' : '') + (it.fav ? ' · ♥ favorite' : '') : '0 of 0';
}
function update() { renderFlow(); if (S.settings.layout === 'wall') renderWall(false); updatePlaque(); }
function renderAll(rebuild = true) {
  document.body.dataset.layout = S.settings.layout;
  const none = !S.view.length;
  const emp = $('#empty'); emp.hidden = !none;
  if (none) {
    emp.textContent = '';
    if (!S.items.length) emp.append(el('div', { class: 'big', text: 'The shelf is empty…' }), el('div', { text: `No videos found in ${S.settings.moviesPath}` }),
      el('div', { class: 'btns' }, el('button', { class: 'btn primary', 'data-nav': '', text: 'Choose movies folder', onclick: openSettings }), el('button', { class: 'btn', 'data-nav': '', text: 'Get movies from Archive.org', onclick: openArchive })));
    else emp.append(el('div', { class: 'big', text: 'Nothing here…' }), el('div', { text: 'No titles match this filter or search.' }),
      el('button', { class: 'btn', 'data-nav': '', text: 'Show everything', onclick: () => resetFilters(false) }));
  }
  if (rebuild) { clearBoxes(); }
  renderFlow(); if (S.settings.layout === 'wall') renderWall(rebuild);
  updatePlaque(); renderFilterBar(); renderHints();
}
function refreshItem(newItem) {
  const i = S.items.findIndex(x => x.id === newItem.id); if (i < 0) return;
  S.items[i] = newItem; const keep = (cur() || {}).id; applyFilter(keep || newItem.id);
  const b = boxes.get(newItem.id); if (b) { b.remove(); boxes.delete(newItem.id); }
  renderAll(true);
}

/* ============ navigation ============ */
function move(d) {
  const N = S.view.length; if (!N) return;
  const n = Math.max(0, Math.min(N - 1, S.idx + d));
  if (n === S.idx) { SFX.bad(); return; }
  S.idx = n; SFX.move(); update();
}
function wallCols() { const w = $('#wall'); return getComputedStyle(w).gridTemplateColumns.split(' ').length || 1; }
function nav(dx, dy) {
  MS.active = false;   // keyboard/controller takes over from the mouse until it moves again
  if (S.modals.length) return modalNav(dx, dy);
  if (document.activeElement === $('#search') && (dx || dy)) { if (dy) $('#search').blur(); else return; }
  if (S.settings.layout === 'wall') move(dx + dy * wallCols()); else move(dx || 0);
}
function openSelected() { const it = cur(); if (it) { SFX.select(); openDetails(it); } else SFX.bad(); }
function jumpAlpha(ch) { const i = S.view.findIndex(v => v.title.replace(/^(the|a|an)\s+/i, '').toLowerCase().startsWith(ch)); if (i >= 0) { S.idx = i; SFX.move(); update(); } }
async function surprise() {
  const pool = S.view.filter(i => !isWatched(i)); const list = pool.length ? pool : S.view; if (!list.length) return SFX.bad();
  const tgt = S.view.indexOf(list[Math.floor(Math.random() * list.length)]);
  SFX.jingle();
  const steps = 14; for (let s = 0; s < steps; s++) { S.idx = Math.round(S.idx + (tgt - S.idx) * (s < steps - 1 ? .45 : 1)); update(); await sleep(60 + s * 18); }
  S.idx = tgt; update(); await sleep(250); openDetails(S.view[tgt]);
}
function toggleLayout() { S.settings.layout = S.settings.layout === 'flow' ? 'wall' : 'flow'; api.setSettings({ layout: S.settings.layout }); SFX.open(); renderAll(true); }

/* ---- spatial focus in modals ---- */
const focusables = root => [...root.querySelectorAll('[data-nav], button, input, select, textarea, a[href]')].filter(e => !e.disabled && e.offsetParent !== null && e.type !== 'hidden');
function modalNav(dx, dy) {
  const root = S.modals[S.modals.length - 1].root, all = focusables(root);
  if (!all.length) return;
  const a = document.activeElement;
  if (!root.contains(a) || a === document.body) { all[0].focus(); return; }
  if (a.tagName === 'SELECT' && dx) { a.selectedIndex = Math.max(0, Math.min(a.options.length - 1, a.selectedIndex + dx)); a.dispatchEvent(new Event('change')); return; }
  if (a.type === 'range' && dx) { a.value = +a.value + dx * (a.step || 1) * 5; a.dispatchEvent(new Event('input')); return; }
  const r = a.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  let best = null, bs = 1e9;
  for (const e of all) {
    if (e === a) continue; const q = e.getBoundingClientRect(), x = q.x + q.width / 2, y = q.y + q.height / 2, ddx = x - cx, ddy = y - cy;
    if (dx > 0 && ddx <= 2 || dx < 0 && ddx >= -2 || dy > 0 && ddy <= 2 || dy < 0 && ddy >= -2) continue;
    const s = dx ? Math.abs(ddx) + Math.abs(ddy) * 3 : Math.abs(ddy) + Math.abs(ddx) * 3;
    if (s < bs) { bs = s; best = e; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); SFX.move(); }
}
function activate() {
  if (S.modals.length) { const a = document.activeElement; if (a && S.modals[S.modals.length - 1].root.contains(a)) { if (a.tagName === 'INPUT' && a.type === 'checkbox') a.click(); else if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') return; else a.click(); } else { const f = focusables(S.modals[S.modals.length - 1].root)[0]; f && f.focus(); } return; }
  const a = document.activeElement;
  if (a && a !== document.body && a.matches('[data-nav]') && a !== $('#search')) { a.click(); return; }
  openSelected();
}
function back() {
  if (S.modals.length) { closeModal(); SFX.back(); return; }
  if (document.activeElement === $('#search')) { $('#search').blur(); return; }
  if (S.q) { S.q = ''; $('#search').value = ''; applyFilter(); renderAll(true); SFX.back(); return; }
  if (S.tab !== 'all' || filterCount() - (S.f.status !== 'all' ? 1 : 0) > 0) { resetFilters(true); SFX.back(); return; }
}

/* ============ modals ============ */
function openModal(content, { cls = '', onClose, dismiss = true } = {}) {
  const root = el('div', { class: 'scrim' }, content);
  content.classList.add('modal'); if (cls) content.classList.add(...cls.split(' '));
  root.addEventListener('mousedown', e => { if (e.target === root && dismiss) closeModal(m); });
  $('#modals').append(root);
  const m = { root, onClose }; S.modals.push(m);
  setTimeout(() => { const f = content.querySelector('[data-autofocus]') || focusables(content).find(e => !e.classList.contains('x')); f && f.focus(); }, 30);
  return m;
}
function closeModal(m) {
  m = m || S.modals[S.modals.length - 1]; if (!m) return;
  S.modals = S.modals.filter(x => x !== m); m.root.remove(); m.onClose && m.onClose();
  if (!S.modals.length) renderHints();
}
const closeAll = () => { while (S.modals.length) closeModal(); };
const mkHead = (title, m) => el('h2', {}, el('span', { text: title }), el('button', { class: 'x', 'data-nav': '', text: '✕', title: 'Close (Esc)', onclick: () => closeModal(m()) }));
function simpleModal(title, body, opts) { let m; const box = el('div', {}, mkHead(title, () => m), el('div', { class: 'body' }, body)); m = openModal(box, opts); return m; }
function confirmBox(title, text, yes = 'Yes', no = 'Cancel') {
  return new Promise(res => { let m; const done = v => { res(v); closeModal(m); };
    m = simpleModal(title, [el('p', { text, style: 'white-space:pre-wrap' }), el('div', { class: 'btns' }, el('button', { class: 'btn primary', 'data-autofocus': '', text: yes, onclick: () => done(true) }), el('button', { class: 'btn', text: no, onclick: () => done(false) }))], { cls: '', onClose: () => res(false) }); });
}

/* ---- details ---- */
function openDetails(it0) {
  let it = S.items.find(x => x.id === it0.id) || it0; let m;
  const root = el('div', { class: 'det' }), side = el('div'), main = el('div');
  root.append(side, main);
  let season = null;
  const render = () => {
    it = S.items.find(x => x.id === it.id) || it;
    side.textContent = ''; main.textContent = '';
    const cb = el('div', { class: 'coverbox' }, makeBox(it)); side.append(cb);
    cb.addEventListener('dragover', e => e.preventDefault());
    cb.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; const p = api.pathForFile(f); const r = await guard(() => api.coverFromFile(it.id, p)); if (r) { refreshItem(r); toast('Cover updated'); render(); } });
    cb.title = 'Tip: drag an image file here to set the cover';
    main.append(el('h1', { text: it.title }));
    const meta = [it.year, it.type === 'show' ? `${seasonsOf(it).length} season(s) · ${it.episodes.length} episodes` : it.virtual ? '☁ Not downloaded' : fmtSize(it.size), it.rating ? '★ ' + it.rating : null].filter(Boolean).join('  ·  ');
    main.append(el('div', { class: 'muted', text: meta }));
    main.append(el('div', { class: 'chips' }, ...(it.genres || []).map(g => el('button', { class: 'chip', text: g, 'data-nav': '', onclick: () => { closeModal(m); S.tab = 'all'; S.f.genres = [g]; S.idx = 0; commit(); } }))));
    main.append(el('p', { class: 'ov', text: stripHtml(it.overview) || 'No description yet. Use “Edit info” or “Change cover” (which can also fetch the details).' }));
    const btns = el('div', { class: 'btns' });
    if (it.virtual) {
      btns.append(el('button', { class: 'btn primary', 'data-autofocus': '', text: it.source ? '⬇ Download' : '🔎 Find a download', onclick: () => openGhostDownload(it) }));
    } else if (it.type === 'movie') {
      if (it.resume) btns.append(el('button', { class: 'btn primary', 'data-autofocus': '', text: `▶ Resume ${fmtTime(it.resume.pos)}`, onclick: () => startPlay(it, null, it.resume.pos) }), el('button', { class: 'btn', text: '↺ Start over', onclick: () => startPlay(it, null, 0) }));
      else btns.append(el('button', { class: 'btn primary', 'data-autofocus': '', text: '▶ Play', onclick: () => startPlay(it, null, 0) }));
    } else {
      const nxt = nextEpisode(it);
      btns.append(el('button', { class: 'btn primary', 'data-autofocus': '', text: it.resume ? `▶ Resume S${nxt.season}E${nxt.episode} (${fmtTime(it.resume.pos)})` : `▶ Play S${nxt.season}E${nxt.episode}`, onclick: () => startPlay(it, nxt.path, it.resume && it.resume.file === nxt.path ? it.resume.pos : 0) }));
    }
    btns.append(el('button', { class: 'btn' + (it.fav ? ' on' : ''), 'data-nav': '', text: it.fav ? '♥ Favorited' : '♡ Add to favorites', onclick: async () => { await toggleFav(it); render(); } }),
      el('button', { class: 'btn', text: '🖼 Change cover', onclick: () => openCoverPicker(it, render) }),
      el('button', { class: 'btn', text: '✎ Edit info', onclick: () => openEdit(it, render) }),
      it.virtual ? null : el('button', { class: 'btn', text: isWatched(it) ? '☐ Mark unwatched' : '☑ Mark watched', onclick: async () => { const r = await guard(() => api.markWatched(it.id, !isWatched(it))); if (r) { refreshItem(r); render(); } } }),
      it.virtual ? null : el('button', { class: 'btn', text: '📂 Show file', onclick: () => api.reveal(it.id) }),
      it.virtual ? el('button', { class: 'btn danger', text: '✕ Remove from shelf', onclick: async () => { if (!await confirmBox('Remove from shelf?', `“${it.title}” isn't downloaded, so nothing is deleted from your PC. It will just be taken off the shelf.`, 'Remove')) return; const ok = await guard(() => api.forget(it.id)); if (ok) { closeAll(); await loadLibrary(); toast('Removed from shelf'); } } })
                 : el('button', { class: 'btn danger', text: '🗑 Delete from PC…', onclick: () => openDelete(it) }));
    main.append(btns);
    if (it.type === 'show' && !it.virtual) {
      const ss = seasonsOf(it); if (season == null) season = (nextEpisode(it) || {}).season ?? ss[0];
      const eps = el('div', { class: 'eps' }), tabs = el('div', { class: 'seasons' }), list = el('div', { class: 'eplist' });
      ss.forEach(s => tabs.append(el('button', { class: 'btn sm' + (s === season ? ' primary' : ''), 'data-nav': '', text: s === 0 ? 'Specials' : 'Season ' + s, onclick: () => { season = s; render(); } })));
      it.episodes.filter(e => e.season === season).forEach(e => {
        const w = it.watched && it.watched[e.path];
        list.append(el('button', { class: 'ep', 'data-nav': '', onclick: () => startPlay(it, e.path, it.resume && it.resume.file === e.path ? it.resume.pos : 0) },
          el('span', { class: 'n', text: `E${String(e.episode).padStart(2, '0')}` }), el('span', { class: 't', text: epTitle(e.path, it) }), el('span', { class: 'w', text: w ? '✓' : (it.resume && it.resume.file === e.path ? fmtTime(it.resume.pos) : '') }),
          el('span', { class: 'btn sm', text: w ? 'Unwatch' : 'Watched', onclick: async ev => { ev.stopPropagation(); const r = await guard(() => api.markEpisode(it.id, e.path, !w)); if (r) { refreshItem(r); render(); } } })));
      });
      eps.append(tabs, list); main.append(eps);
    }
  };
  render();
  m = openModal(el('div', {}, mkHead('', () => m), root), { cls: 'wide', onClose: () => unsub() });
  SFX.open();
  const unsub = api.onChanged(n => { refreshItem(n); render(); });
}
function nextEpisode(it) {
  if (it.resume) { const e = it.episodes.find(e => e.path === it.resume.file); if (e) return e; }
  return it.episodes.find(e => !(it.watched && it.watched[e.path])) || it.episodes[0];
}
function epTitle(p, it) { let n = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); n = n.replace(/[sS]\d{1,2}[ ._-]*[eE]\d{1,3}/, '').replace(/\b\d{1,2}x\d{2,3}\b/, '').replace(/[._]/g, ' ').replace(/\b(1080p|720p|480p|web-?dl|webrip|hdtv|x26[45]|bluray).*$/i, '').replace(new RegExp('^\\s*' + it.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^[\s\-–]+|[\s\-–]+$/g, ''); return n || 'Episode'; }
async function startPlay(it, file, pos) {
  if (it.virtual) { toast('☁ Not downloaded yet'); return openGhostDownload(it); }
  SFX.select(); const r = await guard(() => api.play(it.id, file, pos)); if (r === undefined && false) return;
}

/* ---- delete a downloaded title (keeps a faded entry so it can be re-downloaded) ---- */
function openDelete(it) {
  let m;
  const go = async permanent => {
    closeModal(m); const r = await guard(() => api.deleteFiles(it.id, permanent)); if (!r) return;
    closeAll(); await loadLibrary(it.id); SFX.back();
    toast(permanent ? `Deleted — freed ${fmtSize(r.freed)}` : `Moved to Recycle Bin (${fmtSize(r.freed)}) — empty it to free the space`);
  };
  m = simpleModal('Delete from this PC?', [
    el('p', { style: 'white-space:pre-wrap', text: `“${it.title}” · ${fmtSize(it.size || 0)}\n\nThe video file${it.type === 'show' ? 's' : ''} will be removed to free up storage. The title stays on your shelf, faded out, with its cover and info${it.source ? ', so you can download it again whenever you like' : ''}.` }),
    el('div', { class: 'btns' },
      el('button', { class: 'btn primary', 'data-autofocus': '', text: '♻ Move to Recycle Bin', onclick: () => go(false) }),
      el('button', { class: 'btn danger', text: 'Delete permanently', onclick: () => go(true) }),
      el('button', { class: 'btn', text: 'Cancel', onclick: () => closeModal(m) })),
    el('p', { class: 'small muted', text: 'Recycle Bin keeps the file until you empty it, so the space is only freed then. “Delete permanently” frees it right away.' })]);
}
async function openGhostDownload(it) {
  if (!it.source || !it.source.id) { closeAll(); openArchive(it.title, it); return; }
  const r = await guard(() => api.iaFiles(it.source.id)); if (!r) return;
  let m;
  const list = el('div', { class: 'iafiles' });
  r.files.slice(0, 8).forEach((f, i) => list.append(el('button', { class: 'btn' + (i === 0 ? ' primary' : ''), 'data-nav': '', style: 'text-align:left', onclick: () => { closeModal(m); closeAll(); startDownload({ id: it.source.id, title: it.title, year: it.year, subject: it.genres, description: it.overview }, f, it.id); } },
    `⬇ ${fmtSize(f.size)} · ${f.format || f.name.split('.').pop()}${f.source === 'original' ? ' · original' : ''}`)));
  if (!r.files.length) list.append(el('div', { class: 'muted', text: 'No downloadable video file was found for this one.' }));
  m = simpleModal(`Download “${it.title}”`, [el('p', { class: 'muted small', text: 'Pick a version — bigger files are higher quality and use more storage.' }), list,
    el('div', { class: 'btns' }, el('button', { class: 'btn sm', text: '🔎 Find a different source on Archive.org', onclick: () => { closeModal(m); closeAll(); openArchive(it.title, it); } }))]);
}

/* ---- edit info ---- */
function openEdit(it, done) {
  let m;
  const f = { title: el('input', { type: 'text', value: it.title }), year: el('input', { type: 'number', value: it.year || '' }), genres: el('input', { type: 'text', value: (it.genres || []).join(', ') }), rating: el('input', { type: 'number', step: '.1', value: it.rating || '' }), overview: el('textarea', { rows: 5 }) };
  f.overview.value = stripHtml(it.overview);
  const row = (l, e, h) => el('div', { class: 'field' }, el('label', { class: 'l', text: l }), e, h ? el('div', { class: 'hint2', text: h }) : null);
  const save = async () => {
    const r = await guard(() => api.update(it.id, { title: f.title.value.trim() || it.title, year: +f.year.value || null, genres: f.genres.value.split(',').map(s => s.trim()).filter(Boolean), rating: +f.rating.value || null, overview: f.overview.value }));
    if (r) { refreshItem(r); closeModal(m); done && done(); toast('Saved'); }
  };
  m = simpleModal('Edit info', [row('Title', f.title, 'Used for searching covers too'), row('Year', f.year), row('Genres', f.genres, 'Comma separated, e.g. Horror, Comedy'), row('Rating', f.rating), row('Description', f.overview),
    el('div', { class: 'btns' }, el('button', { class: 'btn primary', text: 'Save', onclick: save }), el('button', { class: 'btn', text: 'Cancel', onclick: () => closeModal(m) }))], { cls: 'mid' });
}

/* ---- cover picker ---- */
function openCoverPicker(it, done) {
  let m; const res = el('div', { class: 'grid' }), q = el('input', { class: 'inp', type: 'text', value: it.title, 'data-nav': '' }), status = el('div', { class: 'muted small' });
  const apply = async fn => { status.innerHTML = '<span class="spin"></span>Working…'; const r = await guard(fn); if (r) { refreshItem(r); toast('Cover updated'); closeModal(m); done && done(); } else status.textContent = ''; };
  const search = async () => {
    res.textContent = ''; status.innerHTML = '<span class="spin"></span>Searching…';
    const c = await guard(() => api.searchCovers(q.value.trim(), q.value.trim() === it.title ? it.year : null, it.type)) || [];
    status.textContent = c.length ? `${c.length} results — click one to use it` : 'Nothing found. Try a different title, or pick your own image.';
    c.forEach(x => res.append(el('button', { class: 'cand', 'data-nav': '', onclick: () => apply(() => api.applyCover(it.id, x)) }, el('img', { src: x.thumb, loading: 'lazy' }), el('div', { text: x.title + (x.year ? ` (${x.year})` : '') }), el('div', { class: 'src', text: x.source }))));
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  const pick = async () => { const p = await guard(() => api.pickImage()); if (p) apply(() => api.coverFromFile(it.id, p)); };
  m = simpleModal('Change cover', [
    el('div', { class: 'row' }, q, el('button', { class: 'btn primary', 'data-nav': '', text: 'Search', onclick: search })),
    el('div', { class: 'btns', style: 'margin-top:10px' },
      el('button', { class: 'btn', 'data-nav': '', text: '📁 Use my own picture…', onclick: pick }),
      el('button', { class: 'btn', 'data-nav': '', text: '🔗 From web address…', onclick: () => askText('Image address', 'https://…').then(u => u && apply(() => api.coverFromUrl(it.id, u))) }),
      it.cover ? el('button', { class: 'btn danger', 'data-nav': '', text: 'Remove cover', onclick: () => apply(() => api.removeCover(it.id)) }) : null),
    status, res], { cls: 'wide' });
  search();
}
function askText(title, ph, val = '') {
  return new Promise(res => { let m, ok = false; const i = el('input', { class: 'inp', type: 'text', placeholder: ph, value: val, 'data-autofocus': '' });
    const go = () => { ok = true; closeModal(m); res(i.value.trim()); };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    m = simpleModal(title, [i, el('div', { class: 'btns' }, el('button', { class: 'btn primary', text: 'OK', onclick: go }), el('button', { class: 'btn', text: 'Cancel', onclick: () => closeModal(m) }))], { onClose: () => { if (!ok) res(null); } }); });
}

/* ---- missing cover prompt (asks automatically) ---- */
let askBusy = false;
async function askMissingCovers() {
  if (askBusy || !S.settings.askCovers) return; askBusy = true;
  try {
    let yesAll = false;
    for (;;) {
      const it = S.items.find(i => !i.cover && !i.coverAsked && !i.noCoverAsk && !S.askedThisSession.has(i.id)); if (!it) break;
      S.askedThisSession.add(it.id);
      let choice = 'yes';
      if (!yesAll) choice = await new Promise(res => {
        let m, done = false; const pick = v => { done = true; closeModal(m); res(v); };
        m = simpleModal('Missing cover', [
          el('p', { html: `There's no box cover for <b></b>${it.year ? ' (' + it.year + ')' : ''}.<br>Want me to find one?` }),
          el('div', { class: 'btns' },
            el('button', { class: 'btn primary', 'data-autofocus': '', text: '🔎 Yes, find it', onclick: () => pick('yes') }),
            el('button', { class: 'btn', text: 'Let me choose', onclick: () => pick('choose') }),
            el('button', { class: 'btn', text: 'Use my own picture', onclick: () => pick('own') }),
            el('button', { class: 'btn', text: 'Skip', onclick: () => pick('skip') })),
          el('div', { class: 'btns' }, el('button', { class: 'btn sm', text: '⚡ Yes to all missing', onclick: () => pick('all') }), el('button', { class: 'btn sm danger', text: 'Never ask for this one', onclick: () => pick('never') }), el('button', { class: 'btn sm', text: 'Stop asking this session', onclick: () => pick('stop') }))
        ], { onClose: () => { if (!done) res('skip'); } });
        $('b', m.root).textContent = it.title;
      });
      if (choice === 'stop') break;
      if (choice === 'skip') continue;
      if (choice === 'never') { const r = await guard(() => api.update(it.id, { noCoverAsk: true })); r && refreshItem(r); continue; }
      if (choice === 'all') { yesAll = true; choice = 'yes'; }
      if (choice === 'choose') { await new Promise(r => { const mm = openCoverPicker(it); S.modals[S.modals.length - 1].onClose = r; }); continue; }
      if (choice === 'own') { const p = await guard(() => api.pickImage()); if (p) { const r = await guard(() => api.coverFromFile(it.id, p)); r && refreshItem(r); } continue; }
      if (choice === 'yes') {
        toast(`Hunting for “${it.title}”…`);
        const r = await guard(() => api.autoCover(it.id));
        if (r) { refreshItem(r.item); toast(r.found ? `Found it: ${r.cand.title}` : `No match for “${it.title}” — use Change cover to search manually`); }
      }
    }
  } finally { askBusy = false; }
}
/* ---- archive.org ---- */
const dlState = new Map();
const IA_CHIPS = [['🎃 Halloween picks', 'horror'], ['👻 Classic horror', 'classic horror'], ['🧟 Zombies', 'zombie'], ['🚀 Sci-Fi', 'science fiction'], ['🕵 Film noir', 'film noir'], ['😂 Comedy', 'comedy'], ['🤠 Westerns', 'western'], ['🎞 Silent films', 'silent'], ['✏ Animation', 'animation'], ['🎥 Documentaries', 'documentary']];
function openArchive(prefill, ghost) {
  SFX.open(); let m; let feat = true, runId = 0;
  const q = el('input', { class: 'inp', type: 'text', placeholder: 'Search by movie name or topic — e.g. Nosferatu, Night of the Living Dead, vampire…', 'data-nav': '', 'data-autofocus': '' });
  const grid = el('div', { class: 'iagrid' }), status = el('div', { class: 'muted small', style: 'margin:6px 0 10px' });
  const chips = el('div', { class: 'chips', style: 'margin:10px 0 4px' });
  const go = async term => {
    term = (term ?? q.value).trim(); if (!term) return; q.value = term; const my = ++runId;
    grid.textContent = ''; status.innerHTML = '<span class="spin"></span>Searching archive.org…';
    const r = await guard(() => api.iaSearch(term, feat)) || []; if (my !== runId) return;
    status.textContent = r.length ? `${r.length} results for “${term}” — most downloaded first. Click “⬇ Get” on any movie.` : 'No results. Try fewer words or a different spelling. (Turning off “Hide adult content & junk” widens the search.)';
    r.forEach(x => grid.append(iaCard(x, ghost)));
  };
  IA_CHIPS.forEach(([label, term]) => chips.append(el('button', { class: 'chip', 'data-nav': '', text: label, onclick: () => go(term) })));
  q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const chk = el('input', { type: 'checkbox', checked: true, 'data-nav': '' }); chk.addEventListener('change', () => { feat = chk.checked; go(); });
  const body = [
    ghost ? el('div', { class: 'chip', style: 'margin-bottom:10px;display:inline-block', text: `Finding a download for “${ghost.title}” — pick a version and it fills in the faded entry` }) : null,
    el('div', { class: 'muted small', style: 'margin-bottom:10px', text: 'Free & legal: public-domain and freely shared films from the Internet Archive. Search by name, or tap a category below. Downloads go straight into your movies folder and show up on the shelf with a cover.' }),
    el('div', { class: 'row' }, q, el('button', { class: 'btn primary', 'data-nav': '', text: '🔎 Search', onclick: () => go() }), el('label', { class: 'row small muted' }, el('span', { class: 'sw' }, chk, el('i')), 'Hide adult content & junk (recommended)')),
    chips, status, grid];
  m = openModal(el('div', {}, mkHead('⬇  Get Movies', () => m), el('div', { class: 'body' }, body)), { cls: 'full' });
  go(typeof prefill === 'string' ? prefill : 'horror');
}
function iaCard(x, ghost) {
  const files = el('div', { class: 'iafiles' }); let open = false;
  const toggle = async () => {
    if (open) { files.textContent = ''; open = false; return; } open = true; files.innerHTML = '<span class="small"><span class="spin"></span>Finding video files…</span>';
    const r = await guard(() => api.iaFiles(x.id)); files.textContent = ''; if (!r) { open = false; return; }
    if (!r.files.length) { files.append(el('div', { class: 'muted small', text: 'No downloadable video file in this one.' })); return; }
    r.files.slice(0, 6).forEach((f, i) => files.append(el('button', { class: 'btn sm' + (i === 0 ? ' primary' : ''), 'data-nav': '', style: 'text-align:left', onclick: () => startDownload(x, f, ghost && ghost.id) }, `⬇ ${fmtSize(f.size)} · ${(f.format || f.name.split('.').pop())}${f.source === 'original' ? ' · original' : ''}`)));
  };
  const onShelf = () => S.items.find(i => i.source && i.source.id === x.id);
  const addBtn = el('button', { class: 'btn sm', 'data-nav': '', title: 'Put it on your shelf (faded) without downloading — download it later', text: onShelf() ? '✓ On shelf' : '＋ Add to shelf', disabled: !!onShelf(),
    onclick: async () => {
      const r = await guard(() => api.addGhost({ title: x.title.replace(/\s*\(.*?\)\s*$/, ''), year: +x.year || null, subject: x.subject, description: stripHtml(x.description), thumb: x.thumb, source: { kind: 'archive', id: x.id } }));
      if (r) { addBtn.textContent = '✓ On shelf'; addBtn.disabled = true; toast(`Added “${r.title}” — not downloaded yet`); await loadLibrary(); }
    } });
  return el('div', { class: 'iacard' }, el('img', { src: x.thumb, loading: 'lazy' }),
    el('div', { class: 'tt', text: x.title }), el('div', { class: 'small muted', text: `${x.year || ''}${x.year ? ' · ' : ''}${(x.downloads || 0).toLocaleString()} downloads` }),
    el('div', { class: 'ds', text: stripHtml(x.description) }),
    el('div', { class: 'row', style: 'gap:6px' }, el('button', { class: 'btn sm primary', 'data-nav': '', text: '⬇ Get', onclick: toggle }), addBtn), files);
}
async function startDownload(x, f, ghostId) {
  if (!ghostId) { const g = S.items.find(i => i.virtual && i.source && i.source.id === x.id); if (g) ghostId = g.id; }
  if (dlState.has(x.id)) return toast('Already downloading');
  const title = x.title.replace(/\s*\(.*?\)\s*$/, '') + (x.year ? ` (${x.year})` : '');
  const card = el('div', { class: 'dl' }, el('div', { text: title }), el('div', { class: 'small muted', text: 'Starting…' }), el('div', { class: 'bar' }, el('i')), el('button', { class: 'btn sm', style: 'margin-top:6px', text: 'Cancel', onclick: () => api.iaCancel(x.id) }));
  $('#tray').append(card); dlState.set(x.id, card); toast('Download started — it will appear on your shelf when done');
  const r = await api.iaDownload(x.id, f.name, title, { subject: x.subject, description: stripHtml(x.description), year: x.year }, ghostId).catch(e => ({ err: e.message }));
  dlState.delete(x.id); setTimeout(() => card.remove(), r.err ? 4000 : 500);
  if (r.err) { if (!/cancel/i.test(r.err)) toast('⚠ Download failed: ' + r.err); return; }
  SFX.jingle(); toast(`✔ ${title} added to your shelf`); await loadLibrary(r.id);
}
api.onProgress(p => {
  const card = dlState.get(p.id); if (!card) return;
  if (p.got != null) { card.children[1].textContent = p.total ? `${fmtSize(p.got)} of ${fmtSize(p.total)} (${Math.round(p.got / p.total * 100)}%)` : fmtSize(p.got); card.querySelector('.bar i').style.width = p.total ? (p.got / p.total * 100) + '%' : '50%'; }
  if (p.error) card.children[1].textContent = p.error;
});

/* ---- updates: asks first, never installs on its own ---- */
let updM = null, updBar = null, updLabel = null;
const REPO = 'https://github.com/quinkom/pc-movie-theater';
function openUpdateAvailable(e) {
  if (updM) closeModal(updM);
  const notes = stripHtml(e.notes || '').slice(0, 700);
  const go = () => { closeModal(updM); showUpdateProgress(); api.updateDownload().catch(err => toast('⚠ ' + err.message)); };
  updM = simpleModal('Update available', [
    el('p', { html: `<b>PC Movie Theater ${e.version}</b> is available — you have ${e.current}.` }),
    notes ? el('div', { class: 'small muted', style: 'white-space:pre-wrap;max-height:180px;overflow:auto;margin:6px 0 4px', text: notes }) : null,
    el('div', { class: 'btns' },
      el('button', { class: 'btn primary', 'data-autofocus': '', text: '⬇ Update now', onclick: go }),
      el('button', { class: 'btn', text: 'Later', onclick: () => closeModal(updM) }),
      el('button', { class: 'btn', text: 'Skip this version', onclick: () => { S.settings.skipVersion = e.version; api.setSettings({ skipVersion: e.version }); closeModal(updM); } }),
      el('button', { class: 'btn sm', text: "What's new", onclick: () => api.openExternal(`${REPO}/releases/tag/v${e.version}`) })),
  ], { cls: '', onClose: () => { updM = null; } });
}
function showUpdateProgress() {
  updLabel = el('div', { class: 'small muted', text: 'Starting download…' }); updBar = el('i', { style: 'width:0' });
  updM = simpleModal('Downloading update', [updLabel, el('div', { class: 'dl', style: 'margin-top:10px' }, el('div', { class: 'bar' }, updBar)), el('div', { class: 'small muted', style: 'margin-top:10px', text: 'You can keep using the app while this downloads.' })], { dismiss: true, onClose: () => { updM = null; updBar = null; } });
}
function openUpdateReady(e) {
  if (updM) closeModal(updM);
  updM = simpleModal('Update ready', [
    el('p', { text: `Version ${e.version} has been downloaded. Restart PC Movie Theater to finish updating — your library and settings are kept.` }),
    el('div', { class: 'btns' }, el('button', { class: 'btn primary', 'data-autofocus': '', text: '↻ Restart & update', onclick: () => api.updateInstall() }),
      el('button', { class: 'btn', text: 'Later (installs when you close the app)', onclick: () => closeModal(updM) })),
  ], { onClose: () => { updM = null; } });
}
api.onUpdate(e => {
  if (e.type === 'available') { if (!e.manual && S.settings.skipVersion === e.version) return; openUpdateAvailable(e); }
  else if (e.type === 'none') { if (e.manual) toast(`✔ You're up to date (v${e.current})`); }
  else if (e.type === 'progress') { if (updBar) { updBar.style.width = e.percent + '%'; updLabel.textContent = `${e.percent}%  ·  ${(e.speed / 1e6).toFixed(1)} MB/s`; } }
  else if (e.type === 'ready') openUpdateReady(e);
  else if (e.type === 'error') { if (e.manual) toast('⚠ Update check: ' + e.message); }
});

/* ---- settings ---- */
function openSettings() {
  SFX.open(); let m; const s = S.settings;
  const save = async (k, v) => { s[k] = v; await api.setSettings({ [k]: v }); };
  const sw = (k, after) => { const i = el('input', { type: 'checkbox', checked: !!s[k], 'data-nav': '' }); i.addEventListener('change', async () => { await save(k, i.checked); after && after(); }); return el('span', { class: 'sw' }, i, el('i')); };
  const row = (l, c, h) => el('div', { class: 'field' }, el('label', { class: 'l', text: l }), c, h ? el('div', { class: 'hint2', text: h }) : null);
  const sel = (k, opts, after) => { const e = el('select', { 'data-nav': '' }, ...opts.map(([v, t]) => el('option', { value: v, text: t, selected: s[k] === v }))); e.addEventListener('change', async () => { await save(k, e.value); after && after(); }); return e; };
  const txt = (k, type = 'text', after) => { const e = el('input', { type, value: s[k] ?? '', 'data-nav': '' }); e.addEventListener('change', async () => { await save(k, type === 'number' ? +e.value : e.value.trim()); after && after(); }); return e; };
  const selS = (k, opts, after) => { const e = el('select', { 'data-nav': '' }, ...opts.map(([v, t]) => el('option', { value: v, text: t, selected: String(s[k] ?? '') === v }))); e.addEventListener('change', async () => { await save(k, e.value); after && after(); }); return e; };
  const slider = (k, min, max, step, unit) => { const i = el('input', { type: 'range', min, max, step, value: s[k] || 0, 'data-nav': '' }), lab = el('span', { class: 'small muted', style: 'min-width:64px;text-align:right', text: (s[k] || 0) + unit }); i.addEventListener('input', () => { lab.textContent = i.value + unit; }); i.addEventListener('change', () => save(k, +i.value)); return el('div', { class: 'row', style: 'flex-wrap:nowrap' }, i, lab); };
  const devSel = (k, offValue, offLabel) => {
    const e = el('select', { 'data-nav': '' }, el('option', { value: offValue, text: offLabel }));
    e.addEventListener('change', () => save(k, e.value));
    api.audioDevices().then(list => { for (const d of list) e.append(el('option', { value: d.id, text: d.name })); e.value = s[k] ?? offValue; if (e.value !== (s[k] ?? offValue)) e.value = offValue; }).catch(() => {});
    return e;
  };
  const folder = el('input', { type: 'text', value: s.moviesPath, 'data-nav': '' });
  const setFolder = async v => { folder.value = v; await save('moviesPath', v); await loadLibrary(); toast('Folder updated'); };
  folder.addEventListener('change', () => setFolder(folder.value.trim()));
  const vol = el('input', { type: 'range', min: 0, max: 1, step: .05, value: s.sfxVolume, 'data-nav': '' }); vol.addEventListener('input', async () => { await save('sfxVolume', +vol.value); }); vol.addEventListener('change', () => SFX.select());
  const themeOpts = [['auto', 'Automatic (by date)'], ...S.themes.map(t => [t.id, `${t.icon || ''} ${t.name}${t.season ? '' : ''}`])];
  const body = [
    el('div', { class: 'sec', text: 'Library' }),
    row('Movies & shows folder', el('div', { class: 'row', style: 'flex-wrap:nowrap' }, folder, el('button', { class: 'btn sm', 'data-nav': '', text: 'Browse…', onclick: async () => { const p = await api.pickFolder(); if (p) setFolder(p); } })), 'Subfolders are scanned. Shows: use “Show Name/Season 1/S01E01 …” or “Show.S01E01.mkv”.'),
    row('Sort by', sel('sort', [['title', 'Title A–Z'], ['added', 'Recently added'], ['year', 'Year (newest)'], ['recent', 'Recently watched']], () => { applyFilter((cur() || {}).id); renderAll(true); })),
    row('Button hints', sel('hints', [['auto', 'Automatic (keyboard; Xbox when a controller is connected)'], ['keyboard', 'Always keyboard'], ['xbox', 'Always Xbox controller']], renderHints)),
    row('Mouse edge-scroll', sw('mouseScroll'), 'Carousel scrolls when the mouse is left or right of the selected box'),
    row('Layout', sel('layout', [['flow', 'Cover-flow shelf'], ['wall', 'Wall of boxes']], () => renderAll(true))),
    el('div', { class: 'small muted', style: 'margin-top:6px', text: (() => { const real = S.items.filter(i => !i.virtual), bytes = real.reduce((a, i) => a + (i.size || 0), 0), g = S.items.length - real.length; return `Storage: ${real.length} title(s) on this PC · ${fmtSize(bytes)} used` + (g ? ` · ${g} not downloaded` : ''); })() }),
    el('div', { class: 'btns' }, el('button', { class: 'btn', 'data-nav': '', text: '↻ Rescan library', onclick: () => loadLibrary().then(() => toast('Library rescanned')) }), el('button', { class: 'btn', 'data-nav': '', text: '🖼 Find missing covers', onclick: () => { for (const i of S.items) { i.coverAsked = false; S.askedThisSession.delete(i.id); } closeModal(m); askMissingCovers(); } })),
    el('div', { class: 'btns' }, el('button', { class: 'btn', 'data-nav': '', text: '✎ Rename files to match their titles…', onclick: async () => {
      const plan = await guard(() => api.renameFiles(true)); if (!plan) return;
      if (!plan.length) return toast('Every file already matches its title');
      const ex = plan.slice(0, 6).map(([a, b]) => `${a}  →  ${b}`).join('\n') + (plan.length > 6 ? `\n…and ${plan.length - 6} more` : '');
      if (!await confirmBox('Rename files?', `${plan.length} file(s) will be renamed on disk to “Title (Year)”. Matching subtitle files are renamed too.\n\n${ex}`, 'Rename them')) return;
      const n = await guard(() => api.renameFiles(false)); await loadLibrary(); toast(`Renamed ${n} file(s)`);
    } }), el('span', { class: 'small muted', text: 'Titles on the shelf are already corrected automatically; this also fixes the file names.' })),
    el('div', { class: 'sec', text: 'Look & feel' }),
    row('Theme', sel('theme', themeOpts, applyTheme), 'Automatic switches with the season (Halloween Oct 1–Nov 2, Christmas Dec, etc.)'),
    row('Animated effects', sw('fx', () => FX.restart()), 'Fog, bats, embers, snow… per theme'),
    row('Theme decorations', sw('decor', () => document.body.classList.toggle('no-decor', S.settings.decor === false)), 'Pumpkin patch, cobwebs, moon… (static art for the season)'),
    el('div', { class: 'btns' }, el('button', { class: 'btn sm', 'data-nav': '', text: '📂 Open my themes folder', onclick: () => api.openThemes() }), el('span', { class: 'small muted', text: 'Drop a folder with theme.json + theme.css to add a new seasonal theme.' })),
    el('div', { class: 'sec', text: 'Covers & info' }),
    row('Ask about missing covers', sw('askCovers'), 'Prompts when a title has no box art'),
    row('Auto-fetch genres & descriptions', sw('autoMeta'), 'Fills genres so you can browse by genre (no images downloaded)'),
    row('TMDB API key (optional)', txt('tmdbKey', 'password', () => toast('Saved')), 'Free at themoviedb.org → Settings → API. Improves matches. Works without it (iTunes + Archive.org).'),
    el('div', { class: 'sec', text: 'Audio' }),
    row('Output device', el('div', { class: 'row', style: 'flex-wrap:nowrap' }, devSel('audioDevice', 'auto', 'Windows default'), el('button', { class: 'btn sm', 'data-nav': '', text: '🔔 Test', onclick: () => api.testAudio(s.audioDevice || 'auto') })), 'Where movie sound plays. “Windows default” follows your system setting.'),
    row('Second headphones', el('div', { class: 'row', style: 'flex-wrap:nowrap' }, devSel('audioDevice2', '', 'Off'), el('button', { class: 'btn sm', 'data-nav': '', text: '🔔 Test', onclick: () => s.audioDevice2 ? api.testAudio(s.audioDevice2) : toast('Pick a second device first') })), 'Plays the same sound on another device at the same time — e.g. two Bluetooth headsets. Pair both in Windows first. (Beta)'),
    row('Second device timing', slider('audioDelay2', -500, 500, 10, ' ms'), 'Bluetooth headsets differ by ~100–300 ms. If the second pair sounds early or late, nudge it here.'),
    row('Default volume', txt('playerVolume', 'number'), '0–100'),
    row('Max volume boost', selS('volumeMax', [['100', 'None (100%)'], ['130', 'Up to 130%'], ['200', 'Up to 200%']])),
    row('Night mode', sw('nightMode'), 'Evens out loud scenes and quiet dialogue'),
    row('Downmix to stereo', sw('downmix'), 'Best for headphones — folds 5.1 / 7.1 sound into two channels'),
    row('Audio sync', slider('audioDelay', -1000, 1000, 10, ' ms'), 'If voices lag or lead the picture, shift the sound. In the player: [ and ] adjust it, Ctrl+Backspace resets.'),
    row('Preferred audio language', selS('audioLang', [['en,eng,jpn', 'English (then Japanese)'], ['jpn,ja,en,eng', 'Japanese original (then English)'], ['', 'Whatever the file says']])),
    row('Menu sound effects', sw('sfx'), 'Clicks, creaking doors, thunder'),
    row('Effects volume', vol),
    row('Ambient wind', sw('ambience', () => SFX.setAmbience(s.ambience && s.sfx)), 'Quiet background loop'),
    el('div', { class: 'sec', text: 'Player' }),
    row('Start fullscreen', sw('fullscreen')), row('Autoplay next episode', sw('autoplayNext')),
    row('Subtitle languages', txt('subLang'), 'e.g. en,eng or es,spa'), row('Subtitle size', txt('subSize', 'number'), 'Default 45'),
    el('div', { class: 'sec', text: 'Controls' }),
    controlsEditor(),
    el('div', { class: 'sec', text: 'About' }),
    row('Version', (() => { const v = el('span', { text: '…' }); api.appVersion().then(x => { v.textContent = 'v' + x; }); return v; })(), 'Free & open source (MIT).'),
    row('Check for updates on startup', sw('autoUpdate'), 'Looks for a new version when you launch while online, and asks before installing anything.'),
    el('div', { class: 'btns' },
      el('button', { class: 'btn', 'data-nav': '', text: '⟳ Check for updates now', onclick: () => { toast('Checking for updates…'); S.settings.skipVersion = ''; api.setSettings({ skipVersion: '' }); api.updateCheck(); } }),
      el('button', { class: 'btn', 'data-nav': '', text: 'GitHub page', onclick: () => api.openExternal(REPO) }),
      el('button', { class: 'btn', 'data-nav': '', text: 'Report a problem', onclick: () => api.openExternal(REPO + '/issues') }),
      el('button', { class: 'btn', 'data-nav': '', text: 'Licenses & credits', onclick: () => api.openExternal(REPO + '/blob/main/THIRD_PARTY_NOTICES.md') })),
    el('div', { class: 'small muted', style: 'margin-top:12px;line-height:1.6', text: 'Video playback by mpv. Cover art and info from Wikipedia, iTunes and (optionally) TMDB — this product uses the TMDB API but is not endorsed or certified by TMDB. Free movies courtesy of the Internet Archive. You are responsible for only downloading content you have the right to.' }),
    el('div', { class: 'btns' }, el('button', { class: 'btn', 'data-nav': '', text: 'Open data folder', onclick: () => api.openData() }), el('button', { class: 'btn danger', 'data-nav': '', text: 'Quit PC Movie Theater', onclick: () => api.quit() })),
  ];
  const groups = []; let cg = null;
  for (const n of body) { if (n.classList && n.classList.contains('sec')) { cg = { title: n.textContent, nodes: [] }; groups.push(cg); } else if (cg) cg.nodes.push(n); }
  const icons = { 'Library': '📁', 'Look & feel': '🎨', 'Covers & info': '🖼', 'Audio': '🔊', 'Player': '▶', 'Controls': '🎮', 'About': 'ℹ' };
  const stabs = el('div', { class: 'seg stabs' }), panel = el('div', { class: 'spanel' });
  const showTab = i => { S.settingsTab = i; panel.textContent = ''; panel.append(...groups[i].nodes); [...stabs.children].forEach((b, k) => b.classList.toggle('on', k === i)); };
  groups.forEach((g, i) => stabs.append(el('button', { 'data-nav': '', text: `${icons[g.title] || ''} ${g.title}`, onclick: () => showTab(i) })));
  m = openModal(el('div', {}, mkHead('Settings', () => m), el('div', { class: 'body' }, [stabs, panel])), { cls: 'mid' });
  showTab(Math.min(S.settingsTab || 0, groups.length - 1));
}

/* ============ hints bar ============ */
/* ============ input: keyboard / mouse / gamepad ============ */
/* ============ keys & controller buttons — every one remappable in Settings → Controls ============ */
// [id, label, group, default keyboard combos, default controller buttons]
const SHELF_ACTIONS = [
  ['left', 'Move left', 'Browsing', ['arrowleft', 'a'], ['DLeft']],
  ['right', 'Move right', 'Browsing', ['arrowright', 'd'], ['DRight']],
  ['up', 'Move up', 'Browsing', ['arrowup', 'w'], ['DUp']],
  ['down', 'Move down', 'Browsing', ['arrowdown', 's'], ['DDown']],
  ['select', 'Select / open details', 'Browsing', ['enter', 'space'], ['A']],
  ['back', 'Back / close', 'Browsing', ['escape'], ['B']],
  ['nextView', 'Next view (All, Movies, TV…)', 'Browsing', ['tab'], ['RB']],
  ['prevView', 'Previous view', 'Browsing', ['shift+tab'], ['LB']],
  ['jumpBack', 'Jump back 10 titles', 'Browsing', ['pageup'], ['LT']],
  ['jumpFwd', 'Jump forward 10 titles', 'Browsing', ['pagedown'], ['RT']],
  ['first', 'First title', 'Browsing', ['home'], []],
  ['last', 'Last title', 'Browsing', ['end'], []],
  ['filters', 'Filters', 'Shelf', ['g'], ['X']],
  ['surprise', 'Surprise me', 'Shelf', ['r'], ['Y']],
  ['search', 'Search', 'Shelf', ['/', 'ctrl+f'], []],
  ['getMovies', 'Get movies (Archive.org)', 'Shelf', ['m'], []],
  ['favorite', 'Favorite / unfavorite', 'Shelf', ['f'], ['R3']],
  ['cover', 'Change cover', 'Shelf', ['c'], []],
  ['play', 'Play / resume', 'Shelf', ['p'], []],
  ['layout', 'Switch shelf / wall', 'App', ['l'], ['View']],
  ['settings', 'Settings', 'App', ['o'], ['Menu']],
  ['rescan', 'Rescan library', 'App', ['f5'], []],
  ['fullscreen', 'Window fullscreen', 'App', ['f11'], []],
];
const PAD_NAMES = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, L3: 10, R3: 11, DUp: 12, DDown: 13, DLeft: 14, DRight: 15 };
const PAD_LABEL = { View: '⧉', Menu: '☰', DUp: '▲', DDown: '▼', DLeft: '◀', DRight: '▶' };
const padText = n => PAD_LABEL[n] || n;
const padCls = n => ['A', 'B', 'X', 'Y'].includes(n) ? n : 'k';
const NICE = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', space: 'Space', enter: 'Enter', escape: 'Esc', tab: 'Tab', pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', backspace: 'Backspace', delete: 'Del', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
const prettyCombo = c => c.split('+').map(p => NICE[p] || (/^f\d+$/.test(p) ? p.toUpperCase() : p.length === 1 ? p.toUpperCase() : p)).join('+');
const MPV_NICE = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓', SPACE: 'Space', ENTER: 'Enter', ESC: 'Esc', BS: 'Backspace', DEL: 'Del', INS: 'Ins', PGUP: 'PgUp', PGDWN: 'PgDn', TAB: 'Tab' };
const prettyMpv = c => c.split('+').map(p => MPV_NICE[p] || p).join('+');

const bindOf = (ctx, type, id, defaults) => { const b = S.settings.binds && S.settings.binds[ctx] && S.settings.binds[ctx][type] && S.settings.binds[ctx][type][id]; return Array.isArray(b) ? b : defaults; };
let KEYMAP = new Map(), PADACT = [];
function rebuildMaps() {
  KEYMAP = new Map(); PADACT = [];
  for (const [id, , , keys, pad] of SHELF_ACTIONS) {
    for (const k of bindOf('shelf', 'key', id, keys)) if (!KEYMAP.has(k)) KEYMAP.set(k, id);
    PADACT.push([id, bindOf('shelf', 'pad', id, pad)]);
  }
}
function comboOf(e) {
  let k = e.key; if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(k)) return null;
  k = k === ' ' ? 'space' : k.toLowerCase();
  const m = []; if (e.ctrlKey) m.push('ctrl'); if (e.altKey) m.push('alt');
  if (e.shiftKey && (k.length > 1 || /^[a-z]$/.test(k))) m.push('shift');
  return [...m, k].join('+');
}
const MPVK = { ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', ' ': 'SPACE', Enter: 'ENTER', Backspace: 'BS', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDWN', Tab: 'TAB' };
function mpvKeyOf(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const k = MPVK[e.key] || (/^F\d+$/.test(e.key) ? e.key : e.key.length === 1 ? e.key : null); if (!k) return null;
  const m = []; if (e.ctrlKey) m.push('Ctrl'); if (e.altKey) m.push('Alt'); if (e.shiftKey && k.length > 1) m.push('Shift');
  return [...m, k].join('+');
}

const MODAL_OK = new Set(['left', 'right', 'up', 'down', 'select', 'back', 'nextView', 'prevView']);
// returns true when the action consumed the key press
function runAction(act, e, src) {
  const mod = S.modals.length > 0;
  if (mod && !MODAL_OK.has(act) && !(src === 'pad' && act === 'settings')) return false;
  switch (act) {
    case 'left': nav(-1, 0); return true; case 'right': nav(1, 0); return true;
    case 'up': nav(0, -1); return true; case 'down': nav(0, 1); return true;
    case 'select':
      if (mod && src === 'key' && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== document.body) return false;   // let a focused button handle it natively
      activate(); return true;
    case 'back': back(); return true;
    case 'nextView': mod ? modalNav(1, 0) : cycleCat(1); return true;
    case 'prevView': mod ? modalNav(-1, 0) : cycleCat(-1); return true;
    case 'jumpBack': move(-10); return true; case 'jumpFwd': move(10); return true;
    case 'first': S.idx = 0; update(); return true; case 'last': S.idx = Math.max(0, S.view.length - 1); update(); return true;
    case 'filters': openFilters(); return true;
    case 'surprise': surprise(); return true;
    case 'search': $('#search').focus(); return true;
    case 'getMovies': openArchive(); return true;
    case 'favorite': if (cur()) toggleFav(cur()); return true;
    case 'cover': if (cur()) openCoverPicker(cur()); return true;
    case 'play': if (cur()) startPlay(cur(), null, cur().resume ? cur().resume.pos : 0); return true;
    case 'layout': toggleLayout(); return true;
    case 'settings': if (mod) closeAll(); else openSettings(); return true;
    case 'rescan': loadLibrary().then(() => toast('Library rescanned')); return true;
    case 'fullscreen': api.setFullscreen(!S._fs).then(v => S._fs = v); return true;
  }
  return false;
}

addEventListener('keydown', e => {
  if (S.playing || S.capturing) return;
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (inField) { if (e.key === 'Escape') { e.preventDefault(); back(); } else if (e.key === 'Enter' && document.activeElement === $('#search')) document.activeElement.blur(); return; }
  const c = comboOf(e), act = c && KEYMAP.get(c);
  if (act) { if (runAction(act, e, 'key')) e.preventDefault(); return; }
  if (!S.modals.length && !e.ctrlKey && !e.altKey && !e.metaKey && /^[a-z0-9]$/i.test(e.key)) jumpAlpha(e.key.toLowerCase());   // type a letter to jump
});

/* ---- Xbox / standard gamepad ---- */
const GP = { prev: {}, hold: {}, t0: 0 };
const REPEAT = new Set(['left', 'right', 'up', 'down', 'jumpBack', 'jumpFwd']);
function padDown(pad, buttonsOnly) {
  const b = i => pad.buttons[i] && pad.buttons[i].pressed, a = i => pad.axes[i] || 0, d = new Set();
  for (const [n, i] of Object.entries(PAD_NAMES)) if (b(i)) d.add(n);
  if (!buttonsOnly) {   // sticks act as a d-pad for browsing
    const ax = a(0), ay = a(1), rx = a(2), ry = a(3);
    if (ax < -.55 || rx < -.7) d.add('DLeft'); if (ax > .55 || rx > .7) d.add('DRight'); if (ay < -.6 || ry < -.7) d.add('DUp'); if (ay > .6 || ry > .7) d.add('DDown');
  }
  return d;
}
const firstPad = () => [...(navigator.getGamepads() || [])].find(p => p && p.connected);
function gpLoop() {
  requestAnimationFrame(gpLoop);
  if (S.playing || S.capturing || document.hidden) return;
  const pad = firstPad(); if (!pad) return;
  const now = performance.now(), down = padDown(pad);
  const dir = down.has('DLeft') || down.has('DRight') || down.has('DUp') || down.has('DDown');
  if (dir && !GP.prev.__dir) GP.t0 = now; GP.prev.__dir = dir;
  for (const [act, btns] of PADACT) {
    const on = btns.some(n => down.has(n));
    if (on) {
      if (!GP.prev[act]) { GP.hold[act] = now + 380; runAction(act, null, 'pad'); }
      else if (REPEAT.has(act) && now > GP.hold[act]) { GP.hold[act] = now + Math.max(55, 110 - (now - GP.t0) / 40); runAction(act, null, 'pad'); }
    }
    GP.prev[act] = on;
  }
}

/* ---- hints bar (reflects your current bindings) ---- */
const padConnected = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(p => p && p.connected);
const showPadHints = () => { const m = S.settings.hints || 'auto'; return m === 'xbox' || (m === 'auto' && S.pad); };
const syncHintH = () => document.documentElement.style.setProperty('--hintH', ($('#hints').offsetHeight || 64) + 'px');
addEventListener('resize', () => syncHintH());
const actOf = id => SHELF_ACTIONS.find(a => a[0] === id);
const firstKeyOf = id => { const k = bindOf('shelf', 'key', id, actOf(id)[3])[0]; return k ? prettyCombo(k) : null; };
const firstPadOf = id => bindOf('shelf', 'pad', id, actOf(id)[4])[0] || null;
function renderHints() {
  const h = $('#hints'); h.textContent = '';
  const fns = { select: () => activate(), back, filters: openFilters, surprise, nextView: () => cycleCat(1), prevView: () => cycleCat(-1), search: () => $('#search').focus(), getMovies: openArchive, favorite: () => cur() && toggleFav(cur()), settings: openSettings, layout: toggleLayout };
  const add = (cap, cls, label, fn) => h.append(el('button', { class: 'hint', onclick: fn }, el('span', { class: 'pad ' + cls, text: cap }), label));
  if (showPadHints()) {
    for (const [id, label] of [['select', 'Select'], ['back', 'Back'], ['filters', 'Filters'], ['surprise', 'Surprise Me'], ['prevView', 'View ◂'], ['nextView', '▸'], ['favorite', 'Favorite'], ['settings', 'Settings']]) {
      const b = firstPadOf(id); if (b) add(padText(b), padCls(b), label, fns[id]);
    }
  } else {
    const l = firstKeyOf('left'), r = firstKeyOf('right'); if (l || r) add([l, r].filter(Boolean).join(' '), 'k', 'Browse', () => move(1));
    for (const [id, label] of [['select', 'Select'], ['back', 'Back'], ['filters', 'Filters'], ['surprise', 'Surprise Me'], ['nextView', 'Next view'], ['search', 'Search'], ['getMovies', 'Get Movies'], ['favorite', 'Favorite'], ['settings', 'Settings']]) {
      const k = firstKeyOf(id); if (k) add(k, 'k', label, fns[id]);
    }
  }
  syncHintH();
}

/* ---- favorites ---- */
async function toggleFav(it) {
  const r = await guard(() => api.update(it.id, { fav: !it.fav })); if (!r) return;
  refreshItem(r); SFX.select(); toast(r.fav ? `♥ Added “${r.title}” to favorites` : `Removed “${r.title}” from favorites`);
}

/* ---- rebinding editor (Settings → Controls) ---- */
function captureInput(kind, forPlayer) {
  return new Promise(res => {
    S.capturing = true;
    const ov = el('div', { class: 'capture' }, el('div', { class: 'cbox' }, el('div', { class: 'cbig', text: kind === 'key' ? '⌨ Press the key you want' : '🎮 Press a button on your controller' }), el('div', { class: 'muted', text: kind === 'key' ? 'Combos work too (Ctrl+…, Alt+…). Esc cancels.' : (firstPad() ? 'Esc cancels.' : 'No controller detected — connect one (and press any button), or press Esc to cancel.') })));
    document.body.append(ov);
    let done = false, raf = 0, armed = false;
    const finish = v => { if (done) return; done = true; cancelAnimationFrame(raf); removeEventListener('keydown', onKey, true); removeEventListener('keyup', swallow, true); ov.remove(); setTimeout(() => { S.capturing = false; }, 300); res(v); };
    const swallow = e => { e.preventDefault(); e.stopPropagation(); };
    const onKey = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return finish(null);
      if (kind !== 'key') return;
      const c = forPlayer ? mpvKeyOf(e) : comboOf(e); if (c) finish(c);
    };
    addEventListener('keydown', onKey, true); addEventListener('keyup', swallow, true);
    if (kind === 'pad') {
      const poll = () => {
        raf = requestAnimationFrame(poll); const p = firstPad(); if (!p) return;
        const d = padDown(p, true);
        if (!armed) { if (!d.size) armed = true; return; }          // wait until everything is released first
        if (d.size) finish([...d][0]);
      };
      raf = requestAnimationFrame(poll);
    }
  });
}

function controlsEditor() {
  const wrap = el('div'), tabs = el('div', { class: 'seg stabs' }), list = el('div', { class: 'blist' });
  const kinds = [['shelf-key', 'Shelf · Keyboard'], ['shelf-pad', 'Shelf · Controller'], ['player-key', 'Player · Keyboard'], ['player-pad', 'Player · Controller']];
  let current = S.ctlTab || 'shelf-key', playerSpec = null;
  const save = () => { api.setSettings({ binds: S.settings.binds }); rebuildMaps(); renderHints(); };
  const setList = (ctx, type, id, defaults, arr) => {
    const b = S.settings.binds = S.settings.binds || {}; b[ctx] = b[ctx] || {}; b[ctx][type] = b[ctx][type] || {};
    if (JSON.stringify(arr) === JSON.stringify(defaults)) delete b[ctx][type][id]; else b[ctx][type][id] = arr;
  };
  async function draw() {
    const [ctx, type] = current.split('-'), player = ctx === 'player';
    if (player && !playerSpec) playerSpec = await guard(() => api.playerSpec()) || [];
    const spec = player ? playerSpec.map(a => ({ id: a.id, label: a.label, group: a.group, def: type === 'key' ? a.keys : a.pad })) : SHELF_ACTIONS.map(a => ({ id: a[0], label: a[1], group: a[2], def: type === 'key' ? a[3] : a[4] }));
    const fmt = b => type === 'pad' ? padText(b) : (player ? prettyMpv(b) : prettyCombo(b));
    [...tabs.children].forEach((b, i) => b.classList.toggle('on', kinds[i][0] === current));
    list.textContent = '';
    if (type === 'pad' && !firstPad()) list.append(el('div', { class: 'muted small', style: 'margin-bottom:8px', text: 'Tip: connect your Xbox controller and press a button so Windows wakes it up before adding bindings.' }));
    if (player) list.append(el('div', { class: 'muted small', style: 'margin-bottom:8px', text: 'Player controls apply the next time a movie starts.' }));
    let grp = null;
    for (const a of spec) {
      if (a.group !== grp) { grp = a.group; list.append(el('div', { class: 'bgroup', text: grp })); }
      const cur_ = bindOf(ctx, type, a.id, a.def), changed = JSON.stringify(cur_) !== JSON.stringify(a.def);
      const chips = cur_.map(b => el('span', { class: 'bchip' }, fmt(b), el('button', { class: 'bx', 'data-nav': '', title: 'Remove', text: '×', onclick: () => { setList(ctx, type, a.id, a.def, cur_.filter(x => x !== b)); save(); draw(); } })));
      list.append(el('div', { class: 'brow' }, el('div', { class: 'blabel', text: a.label }), el('div', { class: 'bchips' }, ...chips, !cur_.length ? el('span', { class: 'muted small', text: 'unassigned' }) : null,
        el('button', { class: 'badd', 'data-nav': '', text: '＋', title: 'Add a binding', onclick: async () => {
          const v = await captureInput(type, player); if (!v) return;
          // a key/button can only do one thing: take it from any other action
          for (const o of spec) if (o.id !== a.id) { const ol = bindOf(ctx, type, o.id, o.def); if (ol.includes(v)) { setList(ctx, type, o.id, o.def, ol.filter(x => x !== v)); toast(`Moved ${fmt(v)} from “${o.label}”`); } }
          const mine = bindOf(ctx, type, a.id, a.def); if (!mine.includes(v)) setList(ctx, type, a.id, a.def, [...mine, v]);
          save(); draw();
        } }),
        changed ? el('button', { class: 'bx reset', 'data-nav': '', title: 'Reset to default', text: '↺', onclick: () => { setList(ctx, type, a.id, a.def, a.def.slice()); save(); draw(); } }) : null)));
    }
    list.append(el('div', { class: 'btns' },
      el('button', { class: 'btn', 'data-nav': '', text: 'Reset this list', onclick: () => { const b = S.settings.binds; if (b && b[ctx] && b[ctx][type]) delete b[ctx][type]; save(); draw(); toast('Reset to defaults'); } }),
      el('button', { class: 'btn danger', 'data-nav': '', text: 'Reset all controls', onclick: async () => { if (!await confirmBox('Reset all controls?', 'Every key and controller button goes back to its default.', 'Reset all')) return; S.settings.binds = {}; save(); draw(); } })));
  }
  kinds.forEach(([k, label]) => tabs.append(el('button', { 'data-nav': '', text: label, onclick: () => { current = S.ctlTab = k; draw(); } })));
  wrap.append(tabs, el('div', { class: 'muted small', style: 'margin:4px 0 10px', text: 'Click ＋ then press the key or button you want. Taking a key that’s already used moves it to the new action.' }), list);
  draw();
  return wrap;
}

$('#search').addEventListener('input', e => { S.q = e.target.value; applyFilter(); renderAll(true); });
$('#btnFilters').addEventListener('click', openFilters);
$('#btnGhost').addEventListener('click', () => { SFX.move(); setStatus(S.f.status === 'downloaded' ? 'all' : 'downloaded'); });
$('#btnLayout').addEventListener('click', toggleLayout); $('#btnRandom').addEventListener('click', surprise);
$('#btnArchive').addEventListener('click', openArchive); $('#btnSettings').addEventListener('click', openSettings);
let wheelT = 0;
$('#stage').addEventListener('wheel', e => { if (S.settings.layout === 'wall') return; e.preventDefault(); const n = Date.now(); if (n - wheelT < 70) return; wheelT = n; move(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1); }, { passive: false });

/* ---- carousel: mouse left/right of the selected box scrolls that way ---- */
const MS = { x: 0, in: false, active: false, acc: 0, last: 0, dir: 0 };
$('#stage').addEventListener('mousemove', e => { MS.x = e.clientX; MS.in = true; MS.active = true; });
$('#stage').addEventListener('mouseleave', () => { MS.in = false; MS.acc = 0; MS.dir = 0; $('#flow').classList.remove('scrolling'); });
function mouseScrollLoop(t) {
  requestAnimationFrame(mouseScrollLoop);
  const dt = Math.min(.05, (t - MS.last) / 1000); MS.last = t;
  const flow = $('#flow');
  if (S.settings.mouseScroll === false || S.settings.layout !== 'flow' || S.modals.length || S.playing || !MS.in || !MS.active || !S.view.length || document.hidden) { MS.acc = 0; MS.dir = 0; flow.classList.remove('scrolling'); return; }
  const W = innerWidth, cb = $('.box.center'), bw = cb ? cb.offsetWidth : 220, dead = bw * .55, dx = MS.x - W / 2;
  if (Math.abs(dx) < dead) { MS.acc = 0; MS.dir = 0; flow.classList.remove('scrolling'); return; }
  const dir = Math.sign(dx);
  if (dir !== MS.dir) { MS.dir = dir; MS.acc = dir; }                       // react instantly the moment the mouse leaves the middle
  const f = Math.min(1, (Math.abs(dx) - dead) / Math.max(60, W / 2 - dead));
  MS.acc += dir * (2.6 + f * f * 11) * dt;                                   // ~2.6 to ~13 boxes per second, faster the further out the mouse is
  flow.classList.add('scrolling');
  while (Math.abs(MS.acc) >= 1) {
    const st = Math.sign(MS.acc); MS.acc -= st; const n = S.idx + st;
    if (n < 0 || n >= S.view.length) { MS.acc = 0; break; }
    S.idx = n; SFX.move(); update();
  }
}
requestAnimationFrame(mouseScrollLoop);

addEventListener('gamepadconnected', e => { S.pad = true; renderHints(); toast('🎮 Controller connected: ' + e.gamepad.id.replace(/\(.*?\)/g, '').slice(0, 40)); SFX.jingle(); });
addEventListener('gamepaddisconnected', () => { setTimeout(() => { S.pad = padConnected(); renderHints(); }, 50); toast('🎮 Controller disconnected'); });

/* ============ boot ============ */
async function loadLibrary(selectId) {
  const keep = selectId || (cur() || {}).id;
  S.items = await api.scan(); applyFilter(keep); renderAll(true);
}
api.onPlayer(p => { S.playing = p.playing; $('#playing').hidden = !p.playing; if (!p.playing) { setTimeout(() => {}, 0); } });
api.onChanged(n => refreshItem(n));

(async function boot() {
  S.settings = await api.getSettings();
  S.f.status = S.settings.status || 'all';
  rebuildMaps();
  S.pad = padConnected();
  S.themes = await api.themes();
  applyTheme();
  renderHints();
  document.fonts && document.fonts.load('40px Creepster');
  await loadLibrary();
  gpLoop();
  if (S.settings.sfx && S.settings.ambience) { document.addEventListener('pointerdown', () => SFX.setAmbience(true), { once: true }); }
  setTimeout(() => { askMissingCovers().then(() => autoCategorize(false)); }, 800);
})();

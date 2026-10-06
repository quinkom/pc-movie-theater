const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts', '.ogv', '.ogm', '.3gp', '.divx', '.vob', '.asf', '.rmvb']);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

if (process.env.HS_DATA) app.setPath('userData', process.env.HS_DATA);   // test hook: isolated settings/library
const DATA = app.getPath('userData');
const COVERS = path.join(DATA, 'covers');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const DB_FILE = path.join(DATA, 'library.json');
const USER_THEMES = path.join(DATA, 'themes');
fs.mkdirSync(COVERS, { recursive: true });
fs.mkdirSync(USER_THEMES, { recursive: true });

const APP_DIR = app.getAppPath();
const MPV_CANDIDATES = [
  path.join(process.resourcesPath || '', 'vendor', 'mpv', 'mpv.exe'),
  path.join(APP_DIR, 'vendor', 'mpv', 'mpv.exe'),
  path.join(path.dirname(process.execPath), 'vendor', 'mpv', 'mpv.exe'),
];
const mpvPath = () => MPV_CANDIDATES.find(p => fs.existsSync(p));

// ---------- persistence ----------
const defaultSettings = () => ({
  moviesPath: path.join(os.homedir(), 'Videos', 'movies'),   // legacy (1.0.0): migrated into libraryPaths
  libraryPaths: [], downloadPath: '', legacyRoot: '', setupDone: false,
  theme: 'auto',
  layout: 'flow',          // flow | wall
  sort: 'title',           // title | added | year | recent
  fx: true,                // animated effects (fog, bats...)
  sfx: true,               // sound effects
  sfxVolume: 0.5,
  askCovers: true,
  tmdbKey: '',
  autoplayNext: true,
  playerVolume: 80,
  subLang: 'en,eng',
  subSize: 45,
  fullscreen: true,
  hints: 'auto',
  mouseScroll: true,
  decor: true,
  binds: {},
  autoUpdate: true, skipVersion: '', showWelcome: true,
  audioDevice: 'auto', audioDevice2: '', audioDelay: 0, audioDelay2: 0, volumeMax: '130', nightMode: false, downmix: false, audioLang: 'en,eng,jpn',
  playerWin: null,
  autoMeta: true,
  ambience: false,
});
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1)); fs.renameSync(t, f); };

const rawSettings = readJson(SETTINGS_FILE, null);
let settings = { ...defaultSettings(), ...(rawSettings || {}) };
if (rawSettings) {   // existing install (e.g. upgraded from 1.0.0): keep their folder and skip the first-run setup
  if (!Array.isArray(settings.libraryPaths) || !settings.libraryPaths.length) settings.libraryPaths = settings.moviesPath ? [settings.moviesPath] : [];
  if (!settings.legacyRoot) settings.legacyRoot = settings.moviesPath || settings.libraryPaths[0] || '';
  if (!settings.downloadPath) settings.downloadPath = settings.libraryPaths[0] || '';
  if (rawSettings.setupDone === undefined) settings.setupDone = true;
}
let db = readJson(DB_FILE, { items: {} });
const saveSettings = () => writeJson(SETTINGS_FILE, settings);
const saveDb = () => writeJson(DB_FILE, db);

// ---------- title parsing ----------
const JUNK = /\b(2160p|1080p|1080i|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|dvdrip|dvd|webrip|web-dl|webdl|hdtv|hdrip|x264|x265|h264|h265|hevc|xvid|divx|aac|ac3|dts|remux|extended|unrated|directors cut|ia|yify|yts|rarbg)\b/i;
function cleanTitle(raw) {
  let s = raw.replace(/\[[^\]]*\]/g, ' ');
  if (!/\s/.test(s.trim())) s = s.replace(/[._]/g, ' ');
  s = s.replace(/\./g, m => m); // keep dots inside spaced names
  s = s.replace(/^\s*\d{1,2}\s*-\s+/, '');
  let year = null;
  const ym = s.match(/[\(\[\s.](19\d\d|20\d\d)[\)\]\s.]?(?=\s|$|\)|\.|\[)/);
  if (ym) { year = +ym[1]; }
  const j = s.search(JUNK);
  if (j > 0) s = s.slice(0, j);
  if (year) s = s.replace(new RegExp('[\\(\\[]?\\b' + year + '\\b[\\)\\]]?.*$'), '');
  s = s.replace(/\s+/g, ' ').replace(/[\s\-–._(]+$/, '').trim();
  return { title: s || raw, year };
}
const EP_RE = [/[sS](\d{1,2})[ ._-]*[eE](\d{1,3})/, /\b(\d{1,2})x(\d{2,3})\b/];
function parseEpisode(name) {
  for (const re of EP_RE) { const m = name.match(re); if (m) return { season: +m[1], episode: +m[2], index: m.index }; }
  return null;
}
const hashId = s => crypto.createHash('sha1').update(s.toLowerCase()).digest('hex').slice(0, 12);

// ---------- scanning ----------
function walk(dir, depth, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 5 && !/^(subs?|subtitles?|extras?|featurettes?|\$RECYCLE\.BIN|System Volume Information)$/i.test(e.name)) walk(p, depth + 1, out); }
    else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (/sample/i.test(e.name) && st.size < 80e6) continue;
      out.push({ path: p, size: st.size, mtime: st.mtimeMs, birth: st.birthtimeMs || st.mtimeMs });
    }
  }
}

const libRoots = () => [...new Set((settings.libraryPaths || []).filter(Boolean).map(p => path.resolve(p)))];
const rootOnline = r => { try { return fs.statSync(r).isDirectory(); } catch { return false; } };
const inside = (child, parent) => { const c = path.resolve(child).toLowerCase(), p = path.resolve(parent).toLowerCase(); return c === p || c.startsWith(p + path.sep); };
// folder that used to be the only library keeps the old ids (so favorites/resume survive the upgrade); extra folders get their own id space
const movieId = (root, file) => 'm_' + hashId(settings.legacyRoot && path.resolve(settings.legacyRoot).toLowerCase() === root.toLowerCase() ? path.relative(root, file) : root.toLowerCase() + '|' + path.relative(root, file));

function scanLibrary() {
  const roots = libRoots(), online = roots.filter(rootOnline), offline = new Set(roots.filter(r => !rootOnline(r)).map(r => r.toLowerCase()));
  const files = [], seen = new Set();
  for (const root of online) {
    const part = []; walk(root, 0, part);
    for (const f of part) { const k = f.path.toLowerCase(); if (seen.has(k)) continue; seen.add(k); f.root = root; files.push(f); }
  }
  const found = new Map();
  for (const f of files) {
    const rel = path.relative(f.root, f.path);
    const parts = rel.split(path.sep);
    const base = path.basename(f.path, path.extname(f.path));
    const ep = parseEpisode(base) || (parts.length > 2 && /^season\s*\d+/i.test(parts[parts.length - 2]) ? (() => {
      const n = base.match(/(\d{1,3})/); return n ? { season: +parts[parts.length - 2].match(/\d+/)[0], episode: +n[1], index: -1 } : null;
    })() : null);
    if (ep) {
      let showName;
      if (parts.length > 1) showName = parts[0];
      else showName = ep.index > 0 ? base.slice(0, ep.index) : base;
      const { title, year } = cleanTitle(showName);
      const id = 's_' + hashId(title);
      let it = found.get(id);
      if (!it) found.set(id, it = { id, type: 'show', title, year, episodes: [], size: 0, added: 0 });
      it.episodes.push({ path: f.path, season: ep.season, episode: ep.episode, size: f.size, root: f.root });
      it.added = Math.max(it.added, f.birth); it.size += f.size;
    } else {
      let nameSrc = base;
      if (parts.length > 1 && (/^(movie|video|film|main|title)\d*$/i.test(base) || parts.length === 2 && /(^|\W)(cd|disc|part)\s*\d/i.test(base))) nameSrc = parts[0];
      const { title, year } = cleanTitle(nameSrc);
      const id = movieId(f.root, f.path);
      found.set(id, { id, type: 'movie', title, year, path: f.path, size: f.size, added: f.birth, root: f.root });
    }
  }
  const items = [];
  for (const [id, f] of found) {
    const rec = db.items[id] || (db.items[id] = { id });
    // user edits win over parsed values
    rec.type = f.type;
    if (!rec.edited) { rec.title = rec.title && rec.titleFromMeta ? rec.title : f.title; if (f.year && !rec.year) rec.year = f.year; }
    if (f.type === 'movie') { rec.path = f.path; rec.root = f.root; } else {
      // keep episodes that live on a drive that isn't plugged in right now
      const away = (rec.episodes || []).filter(e => e.root && offline.has(e.root.toLowerCase()) && !f.episodes.some(x => x.path === e.path)).map(e => ({ ...e, offline: true }));
      rec.episodes = f.episodes.concat(away).sort((a, b) => a.season - b.season || a.episode - b.episode);
    }
    rec.added = f.added;
    rec.size = f.size;
    rec.virtual = false; rec.offline = false;
    items.push(rec);
  }
  // a file that matches a not-downloaded entry (same title/year) fills it in, keeping its cover and info
  const ghosts = Object.values(db.items).filter(r => r.virtual && !found.has(r.id));
  for (const rec of items) {
    const g = ghosts.find(v => !v.merged && v.type === rec.type && norm(v.title) === norm(rec.title) && (!v.year || !rec.year || v.year === rec.year));
    if (g) { mergeGhost(rec, g); delete db.items[g.id]; g.merged = true; }
  }
  for (const id of Object.keys(db.items)) {
    const rec = db.items[id]; if (found.has(id) || rec.virtual) continue;
    const onAway = e => e.root && offline.has(e.root.toLowerCase());
    const away = rec.type === 'movie' ? onAway(rec) : (rec.episodes || []).some(onAway);
    if (away) {   // its drive is unplugged: keep the title on the shelf (faded) until the drive comes back
      rec.offline = true;
      if (rec.type === 'show') rec.episodes = rec.episodes.filter(onAway).map(e => ({ ...e, offline: true }));
      items.push(rec);
    } else delete db.items[id];
  }
  for (const r of Object.values(db.items)) if (r.virtual) items.push(r);
  saveDb();
  return items.map(publicItem);
}

function mergeGhost(real, g) {
  if (g.cover && !real.cover) { try { const nc = real.id + path.extname(g.cover); fs.renameSync(path.join(COVERS, g.cover), path.join(COVERS, nc)); real.cover = nc; real.coverVer = Date.now(); } catch {} }
  for (const k of ['genres', 'overview', 'rating', 'source', 'coverAsked', 'noCoverAsk', 'genresEdited', 'watched', 'fav']) if (g[k] != null && real[k] == null) real[k] = g[k];
  if (g.year && !real.year) real.year = g.year;
  if (g.edited || g.titleFromMeta) { real.title = g.title; real.edited = g.edited || real.edited; real.titleFromMeta = g.titleFromMeta || real.titleFromMeta; }
  real.virtual = false;
}

function publicItem(r) {
  const cover = r.cover && fs.existsSync(path.join(COVERS, r.cover)) ? r.cover : null;
  return { ...r, cover, coverUrl: cover ? 'hs-cover://c/' + encodeURIComponent(cover) + '?v=' + (r.coverVer || 0) : null };
}

// ---------- covers / metadata ----------
const UA = 'PCMovieTheater/1.0 (personal media library)';
async function getJson(url, opts = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
// accepts either the v3 "API Key" (32 hex chars) or the v4 "Read Access Token" (long eyJ... JWT)
const tmdb = path => {
  const k = settings.tmdbKey.trim(), jwt = k.startsWith('eyJ') || k.length > 60;
  return getJson('https://api.themoviedb.org/3' + path + (jwt ? '' : (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(k)), jwt ? { headers: { Authorization: 'Bearer ' + k } } : {});
};
let tmdbGenres = {};
async function tmdbLoadGenres(key) {
  if (tmdbGenres.__k === key) return;
  tmdbGenres = { __k: key };
  for (const kind of ['movie', 'tv']) {
    const j = await tmdb(`/genre/${kind}/list`);
    for (const g of j.genres) tmdbGenres[g.id] = g.name;
  }
}
const norm = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
function score(q, title, year, wantYear) {
  const a = norm(q), b = norm(title);
  let s = a === b ? 100 : (b.startsWith(a) || a.startsWith(b)) ? 70 : b.includes(a) || a.includes(b) ? 50 : 0;
  if (!s) { const A = new Set(a.split(' ')), B = b.split(' '); s = 40 * B.filter(w => A.has(w)).length / Math.max(A.size, B.length); }
  if (wantYear && year) s += wantYear === year ? 15 : -Math.min(20, Math.abs(wantYear - year));
  return s;
}

async function searchCovers(title, year, kind) {
  const out = [];
  const tasks = [];
  if (settings.tmdbKey) tasks.push((async () => {
    await tmdbLoadGenres(settings.tmdbKey);
    const tv = kind === 'show';
    const j = await tmdb(`/search/${tv ? 'tv' : 'movie'}?query=${encodeURIComponent(title)}${year && !tv ? '&year=' + year : ''}`);
    for (const r of j.results.slice(0, 8)) if (r.poster_path) out.push({
      source: 'TMDB', title: r.title || r.name, year: +((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
      url: 'https://image.tmdb.org/t/p/w500' + r.poster_path, thumb: 'https://image.tmdb.org/t/p/w185' + r.poster_path,
      genres: (r.genre_ids || []).map(i => tmdbGenres[i]).filter(Boolean), overview: r.overview || '', rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    });
  })());
  tasks.push((async () => {
    const ent = kind === 'show' ? 'tvShow' : 'movie';
    const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(title.normalize('NFD').replace(/[̀-ͯ]/g, ''))}&media=${kind === 'show' ? 'tvShow' : 'movie'}&entity=${ent}&limit=8`);
    for (const r of j.results) if (r.artworkUrl100) out.push({
      source: 'iTunes', title: r.trackName || r.collectionName, year: +((r.releaseDate || '').slice(0, 4)) || null,
      url: r.artworkUrl100.replace('100x100bb', '600x900bb'), thumb: r.artworkUrl100.replace('100x100bb', '200x300bb'),
      genres: r.primaryGenreName ? [r.primaryGenreName] : [], overview: r.longDescription || r.shortDescription || '', rating: null,
    });
  })());
  tasks.push((async () => {
    const t = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const q = `${t}${year ? ' ' + year : ''} ${kind === 'show' ? 'television series' : 'film'}`;
    const j = await getJson(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5`);
    await Promise.allSettled(j.query.search.slice(0, 4).map(async hit => {
      const sm = await getJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(hit.title.replace(/ /g, '_')));
      const d = sm.description || '';
      if (!sm.thumbnail || !/film|television|series|anime|movie/i.test(d) || /^list of/i.test(sm.title)) return;
      const ym = d.match(/^(\d{4})\b/);
      out.push({ source: 'Wikipedia', title: sm.title.replace(/\s*\(.*?\)\s*$/, ''), year: ym ? +ym[1] : null, url: (sm.originalimage || sm.thumbnail).source, thumb: sm.thumbnail.source, genres: [], overview: sm.extract || '', rating: null, _film: true });
    }));
  })());
  tasks.push((async () => {
    if (kind === 'show') return;
    const q = `title:(${title.replace(/["()]/g, ' ')}) AND mediatype:movies`;
    const j = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=subject&fl[]=description&rows=5&sort[]=downloads+desc&output=json`);
    for (const d of j.response.docs) out.push({
      source: 'Archive.org', title: d.title, year: +d.year || null, url: 'https://archive.org/services/img/' + d.identifier, thumb: 'https://archive.org/services/img/' + d.identifier,
      genres: [].concat(d.subject || []).slice(0, 3), overview: [].concat(d.description || [])[0] || '', rating: null,
    });
  })());
  await Promise.allSettled(tasks);
  const pri = { TMDB: 3, iTunes: 2, Wikipedia: 1, 'Archive.org': -10 };
  out.forEach(o => o._s = score(title.normalize('NFD').replace(/[̀-ͯ]/g, ''), (o.title || '').normalize('NFD').replace(/[̀-ͯ]/g, ''), o.year, year) + pri[o.source] + (o._film ? 8 : 0) - (o.source === 'Wikipedia' && !o._film ? 25 : 0));
  out.sort((a, b) => b._s - a._s);
  return out;
}

async function saveCoverFromUrl(id, url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('cover download failed: ' + r.status);
  const ct = r.headers.get('content-type') || '';
  const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  const buf = Buffer.from(await r.arrayBuffer());
  return storeCover(id, buf, ext);
}
function storeCover(id, buf, ext) {
  const rec = db.items[id]; if (!rec) throw new Error('unknown item');
  if (rec.cover) try { fs.unlinkSync(path.join(COVERS, rec.cover)); } catch {}
  const name = `${id}${ext}`;
  fs.writeFileSync(path.join(COVERS, name), buf);
  rec.cover = name; rec.coverVer = Date.now(); rec.coverAsked = true;
  saveDb();
  return publicItem(rec);
}
const GENRES = [['horror', 'Horror'], ['comedy', 'Comedy'], ['drama', 'Drama'], ['sci-fi', 'Sci-Fi'], ['science fiction', 'Sci-Fi'], ['scifi', 'Sci-Fi'], ['thriller', 'Thriller'], ['suspense', 'Thriller'], ['western', 'Western'], ['animation', 'Animation'], ['animated', 'Animation'], ['anime', 'Anime'], ['documentary', 'Documentary'], ['romance', 'Romance'], ['action', 'Action'], ['adventure', 'Adventure'], ['fantasy', 'Fantasy'], ['family', 'Family'], ['kids', 'Family'], ['mystery', 'Mystery'], ['crime', 'Crime'], ['war', 'War'], ['musical', 'Musical'], ['film noir', 'Film Noir'], ['noir', 'Film Noir'], ['silent', 'Silent'], ['biograph', 'Biography'], ['history', 'History'], ['sport', 'Sport'], ['superhero', 'Action'], ['reality', 'Reality'], ['sitcom', 'Comedy'], ['monster', 'Horror'], ['zombie', 'Horror']];
const cleanGenres = arr => { const o = []; for (const g of arr || []) { const l = String(g).toLowerCase(); for (const [k, v] of GENRES) if (l === k || (k.length > 4 && l.includes(k)) || l.split(/[\s&,/-]+/).includes(k)) { if (!o.includes(v)) o.push(v); break; } } return o.slice(0, 4); };
const stripDia = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
// Adopt the proper title once a trusted source (not archive.org) clearly matches. Never touches titles the user edited by hand.
function maybeRename(rec, cand, force) {
  if (!cand || !cand.title || rec.edited || cand.source === 'Archive.org') return;
  const a = norm(stripDia(rec.title)), b = norm(stripDia(cand.title));
  if (!a || !b) return;
  if (cand.year && rec.year && Math.abs(cand.year - rec.year) > 1) return;
  const close = a === b || b.includes(a) || a.includes(b);
  if (!force && !close) return;
  if (!force && a !== b && b.length > a.length * 4 + 12) return;   // e.g. "Alien" -> some long unrelated title
  rec.title = cand.title.replace(/\s+/g, ' ').trim(); rec.titleFromMeta = true;
  if (cand.year && !rec.year) rec.year = cand.year;
}
const mergeMeta = (rec, m, all) => {
  if (m && all) { const g = all.map(c => cleanGenres(c.genres)).find(x => x.length); if (g) m = { ...m, genres: g }; else m = { ...m, genres: [] }; }
  else if (m) m = { ...m, genres: cleanGenres(m.genres) };
  if (!m) return;
  if (m.genres && m.genres.length && !rec.genresEdited) rec.genres = m.genres;
  if (m.overview && !rec.overview) rec.overview = m.overview.replace(/<[^>]+>/g, '').slice(0, 1200);
  if (m.rating && !rec.rating) rec.rating = m.rating;
  if (m.year && !rec.year) rec.year = m.year;
};

// ---------- themes ----------
function listThemes() {
  const out = [];
  for (const [dir, builtin] of [[path.join(APP_DIR, 'themes'), true], [USER_THEMES, false]]) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const jf = path.join(dir, d, 'theme.json');
      if (!fs.existsSync(jf)) continue;
      const t = readJson(jf, null); if (!t) continue;
      let css = ''; try { css = fs.readFileSync(path.join(dir, d, 'theme.css'), 'utf8'); } catch {}
      let decor = ''; try { decor = fs.readFileSync(path.join(dir, d, 'decor.html'), 'utf8'); } catch {}
      out.push({ id: d, builtin, ...t, css, decor, base: pathToFileURL(path.join(dir, d)).href });
    }
  }
  return out;
}

// ---------- archive.org ----------
// "safe" = hide adult material and junk (huge compilations, tiny clips) but still find mainstream movies.
const IA_ADULT = /\b(hentai|porn\w*|xxx|erotic\w*|nsfw|futanari|yaoi|sukebe|ecchi|lewd|uncensored|r-?18|18\+|nude|nudity|bdsm|fetish|milf|(adult (video|film|movie|only))|sex tape|inmon|inran|ero ?anime|oppai|tentacles?|lolicon|shotacon|doujin\w*|bukkake|creampie|hardcore|softcore|stripper|stripping|orgy|onanie|harem ova)\b/i;
const IA_BAD_COLL = /(nsfw|adult|hentai|erotic|deemphasize)/i;
const IA_GOOD_COLL = /^(feature_films|opensource_movies|moviesandfilms|vhsmovies|vhsvault|film_noir|silent_films|scifi_horror|classic_tv|classic_cartoons|movie_trailers|prelinger|animationandcartoons|saturdaymorningcartoons|vhskids|film_scifi|film_horror|film_comedy|film_drama|film_western)$/i;
const IA_JUNK_TITLE = /(complete (series|collection)|all episodes|season \d|compilation|commercials?|longplays?|megapack|collection of|\d+ ?(movies|films)\b)/i;
async function iaSearch(q, safe) {
  const clean = String(q).replace(/["()\[\]{}:\\\/!^~*?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const t = clean.split(' ').join(' AND ');
  const BADQ = 'hentai OR porn OR porno OR pornography OR xxx OR erotic OR erotica OR nsfw OR futanari OR yaoi OR sukebe OR ecchi OR lewd OR inmon OR inran OR oppai OR tentacle OR doujin OR bukkake';
  const build = bounded => [`(title:(${t}) OR subject:(${t}))`, 'mediatype:movies']
    .concat(safe ? [`-title:(${BADQ})`, `-subject:(${BADQ})`, '-collection:(deemphasize OR nsfw)', bounded ? 'item_size:[150000000 TO 12000000000]' : ''] : []).filter(Boolean).join(' AND ');
  const run = async query => (await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads&fl[]=description&fl[]=subject&fl[]=collection&rows=80&sort[]=downloads+desc&output=json`)).response.docs;
  let docs = await run(build(true));
  if (safe && !docs.length) docs = await run(build(false));      // nothing big enough? fall back to smaller items rather than "no results"
  const nq = norm(clean), arr = x => [].concat(x || []);
  if (safe) docs = docs.filter(d => !(IA_ADULT.test((d.title || '') + ' ' + arr(d.subject).join(' ')) || IA_ADULT.test(String(arr(d.description)[0] || '').slice(0, 400)) || arr(d.collection).some(c => IA_BAD_COLL.test(c))));
  const rank = d => {
    const nt = norm(d.title || ''); let r = 0;
    if (nt === nq) r += 60; else if (nt.startsWith(nq)) r += 40; else if (nt.includes(nq)) r += 25;
    if (arr(d.collection).some(c => IA_GOOD_COLL.test(c))) r += 20;
    if (d.year) r += 5;
    if (IA_JUNK_TITLE.test(d.title || '')) r -= 30;
    return r;
  };
  docs.sort((a, b) => rank(b) - rank(a) || (b.downloads || 0) - (a.downloads || 0));
  return docs.slice(0, 40).map(d => ({
    id: d.identifier, title: d.title, year: d.year || null, downloads: d.downloads || 0,
    description: arr(d.description)[0] || '', subject: arr(d.subject).slice(0, 5),
    thumb: 'https://archive.org/services/img/' + d.identifier,
  }));
}
async function iaFiles(id) {
  const j = await getJson('https://archive.org/metadata/' + encodeURIComponent(id));
  const files = (j.files || []).filter(f => VIDEO_EXT.has(path.extname(f.name).toLowerCase()) && +f.size > 1e6)
    .map(f => ({ name: f.name, size: +f.size, source: f.source, format: f.format }));
  files.sort((a, b) => (a.source === 'original' ? 0 : 1) - (b.source === 'original' ? 0 : 1) || b.size - a.size);
  const subs = (j.files || []).filter(f => /\.(srt|vtt)$/i.test(f.name)).map(f => f.name);
  return { files, subs, meta: j.metadata || {} };
}
const downloads = new Map();
async function iaDownload(sender, id, fileName, title) {
  if (downloads.has(id)) throw new Error('already downloading');
  const ctrl = new AbortController(); downloads.set(id, ctrl);
  const dlDir = path.resolve(settings.downloadPath || libRoots()[0] || path.join(os.homedir(), 'Videos', 'PC Movie Theater'));
  try { fs.mkdirSync(dlDir, { recursive: true }); } catch { downloads.delete(id); throw new Error("The download folder isn't available — plug in the drive or choose another folder in Settings → Library."); }
  if (!libRoots().some(r => inside(dlDir, r))) { settings.libraryPaths = [...(settings.libraryPaths || []), dlDir]; saveSettings(); }   // make sure new downloads appear on the shelf
  const safe = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  const ext = path.extname(fileName);
  const dest = path.join(dlDir, `${safe(title) || id}${ext}`);
  const part = dest + '.part';
  const send = o => { try { sender.send('ia:progress', { id, ...o }); } catch {} };
  try {
    const r = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${fileName.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    let got = 0, last = 0;
    const ws = fs.createWriteStream(part);
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ws.write(value)) await new Promise(res => ws.once('drain', res));
      got += value.length;
      if (Date.now() - last > 250) { last = Date.now(); send({ got, total }); }
    }
    await new Promise((res, rej) => ws.end(e => e ? rej(e) : res()));
    fs.renameSync(part, dest);
    send({ got, total, done: true, dest });
    return dest;
  } catch (e) {
    try { fs.unlinkSync(part); } catch {}
    send({ error: ctrl.signal.aborted ? 'cancelled' : e.message });
    throw e;
  } finally { downloads.delete(id); }
}

// ---------- playback (mpv) ----------
let playing = null;
function mpvCommand(sock, cmd) { try { sock.write(JSON.stringify({ command: cmd }) + '\n'); } catch {} }

// ---------- player controls (remappable in Settings -> Controls) ----------
const MPV_PAD = { A: 'GAMEPAD_ACTION_DOWN', B: 'GAMEPAD_ACTION_RIGHT', X: 'GAMEPAD_ACTION_LEFT', Y: 'GAMEPAD_ACTION_UP', LB: 'GAMEPAD_LEFT_SHOULDER', RB: 'GAMEPAD_RIGHT_SHOULDER', LT: 'GAMEPAD_LEFT_TRIGGER', RT: 'GAMEPAD_RIGHT_TRIGGER',
  View: 'GAMEPAD_BACK', Menu: 'GAMEPAD_START', L3: 'GAMEPAD_LEFT_STICK', R3: 'GAMEPAD_RIGHT_STICK', DUp: 'GAMEPAD_DPAD_UP', DDown: 'GAMEPAD_DPAD_DOWN', DLeft: 'GAMEPAD_DPAD_LEFT', DRight: 'GAMEPAD_DPAD_RIGHT' };
// [id, label, group, mpv command, default keys (mpv names), default controller buttons]
const PLAYER_ACTIONS = [
  ['pause', 'Play / pause', 'Playback', 'cycle pause', ['SPACE', 'k'], ['A']],
  ['back', 'Leave fullscreen / back to theater', 'Playback', 'script-binding pmt/esc', ['ESC'], ['B']],
  ['fullscreen', 'Fullscreen', 'Playback', 'cycle fullscreen', ['f', 'F11'], ['Menu']],
  ['seekBack5', 'Back 5 seconds', 'Seeking', 'seek -5', ['LEFT'], []],
  ['seekFwd5', 'Forward 5 seconds', 'Seeking', 'seek 5', ['RIGHT'], []],
  ['seekBack10', 'Back 10 seconds', 'Seeking', 'seek -10', ['j'], ['DLeft']],
  ['seekFwd10', 'Forward 10 seconds', 'Seeking', 'seek 10', ['l'], ['DRight']],
  ['seekBack60', 'Back 1 minute', 'Seeking', 'seek -60', ['PGDWN'], []],
  ['seekFwd60', 'Forward 1 minute', 'Seeking', 'seek 60', ['PGUP'], []],
  ['frameBack', 'Previous frame', 'Seeking', 'frame-back-step', [','], []],
  ['frameStep', 'Next frame', 'Seeking', 'frame-step', ['.'], []],
  ['volUp', 'Volume up', 'Sound', 'add volume 5', ['UP'], ['DUp']],
  ['volDown', 'Volume down', 'Sound', 'add volume -5', ['DOWN'], ['DDown']],
  ['mute', 'Mute', 'Sound', 'cycle mute', ['m'], ['View']],
  ['audioTrack', 'Next audio track', 'Sound', 'cycle audio', ['a'], ['Y']],
  ['audioDelayMinus', 'Audio earlier (sync)', 'Sound', 'add audio-delay -0.1', ['['], []],
  ['audioDelayPlus', 'Audio later (sync)', 'Sound', 'add audio-delay 0.1', [']'], []],
  ['audioDelayReset', 'Reset audio sync', 'Sound', 'set audio-delay 0', ['Ctrl+BS'], []],
  ['captions', 'Next subtitle track', 'Subtitles', 'cycle sub', ['c'], ['X']],
  ['captionsPrev', 'Previous subtitle track', 'Subtitles', 'cycle sub down', ['C'], []],
  ['subEarlier', 'Subtitles earlier', 'Subtitles', 'add sub-delay -0.1', ['z'], []],
  ['subLater', 'Subtitles later', 'Subtitles', 'add sub-delay 0.1', ['x'], []],
  ['subBigger', 'Subtitles bigger', 'Subtitles', 'add sub-scale 0.1', ['+'], []],
  ['subSmaller', 'Subtitles smaller', 'Subtitles', 'add sub-scale -0.1', ['-'], []],
  ['speedDown', 'Slower', 'Speed & episodes', 'add speed -0.25', ['<'], []],
  ['speedUp', 'Faster', 'Speed & episodes', 'add speed 0.25', ['>'], []],
  ['speedReset', 'Normal speed', 'Speed & episodes', 'set speed 1', ['BS'], []],
  ['nextEp', 'Next episode', 'Speed & episodes', 'playlist-next', ['N', 'n'], ['RB']],
  ['prevEp', 'Previous episode', 'Speed & episodes', 'playlist-prev', ['P', 'p'], ['LB']],
  ['stats', 'Show stats', 'Other', 'script-binding stats/display-stats-toggle', ['i'], []],
  ['quit', 'Close player now', 'Other', 'quit', ['q'], []],
].map(([id, label, group, cmd, keys, pad]) => ({ id, label, group, cmd, keys, pad }));

function buildPlayerInput(playerDir) {
  const base = fs.readFileSync(path.join(playerDir, 'input.conf'), 'utf8');
  const ov = (settings.binds && settings.binds.player) || {};
  const ignores = [], binds = [];
  for (const a of PLAYER_ACTIONS) {
    const keys = ov.key && Array.isArray(ov.key[a.id]) ? ov.key[a.id] : a.keys;
    const pads = ov.pad && Array.isArray(ov.pad[a.id]) ? ov.pad[a.id] : a.pad;
    for (const k of a.keys) if (!keys.includes(k)) ignores.push(`${k} ignore`);
    for (const p of a.pad) if (!pads.includes(p) && MPV_PAD[p]) ignores.push(`${MPV_PAD[p]} ignore`);
    for (const k of keys) binds.push(`${k} ${a.cmd}`);
    for (const p of pads) if (MPV_PAD[p]) binds.push(`${MPV_PAD[p]} ${a.cmd}`);
  }
  const f = path.join(DATA, 'player-input.conf');
  fs.writeFileSync(f, [base, '', '# --- controls from Settings ---', ...ignores, ...binds].join('\n'));   // unbinds first, binds last, so a re-used key wins
  return f;
}

// ---------- audio: shared options + optional second output (e.g. two pairs of headphones) ----------
function audioArgs() {
  const a = [];
  if (settings.downmix) a.push('--audio-channels=stereo', '--audio-normalize-downmix=yes');
  if (settings.nightMode) a.push('--af=lavfi=[dynaudnorm=f=250:g=15:p=0.9:m=8:s=5]');   // evens out loud scenes vs. quiet dialogue
  return a;
}

// A second audio-only mpv plays the same soundtrack on another device and is kept locked to the main player's clock
// (pause, seek, speed, volume, audio track and episode changes are mirrored; drift is corrected a few times a second).
// onFail(reason) is called once if the second output could not be opened (device missing/busy, mpv died); the log is DATA/second-audio.log.
function startDual(state, onFail) {
  const dev = settings.audioDevice2;
  if (!dev || dev === 'auto' || dev === settings.audioDevice) return null;
  const exe = mpvPath(); if (!exe) return null;
  const L = state.live, pipe2 = `\\\\.\\pipe\\pcmovietheater-b-${process.pid}-${Date.now()}`;
  const d = { sT: 0, sAt: 0, sPaused: true, ready: false, lastFix: 0, stopped: false, path: state.path, sock: null, proc: null, timer: null, failed: false };
  const pNow = () => L.paused ? L.t : L.t + (Date.now() - L.at) / 1000 * (L.speed || 1);
  const send = (c, id) => { try { d.sock && d.sock.write(JSON.stringify(id ? { command: c, request_id: id } : { command: c }) + '\n'); } catch {} };
  const fail = why => { if (d.failed || d.stopped) return; d.failed = true; d.stop(); try { onFail && onFail(why); } catch {} };
  const args = ['--no-config', '--no-terminal', '--vid=no', '--force-window=no', '--idle=no', '--keep-open=yes', '--no-input-default-bindings', '--no-input-terminal',
    `--log-file=${path.join(DATA, 'second-audio.log')}`, '--msg-level=all=info,ao=v',
    `--audio-device=${dev}`, `--volume=${L.volume}`, `--volume-max=${+settings.volumeMax || 130}`, '--pause=yes', `--audio-delay=${((+settings.audioDelay2 || 0) + (+settings.audioDelay || 0)) / 1000}`,
    `--alang=${settings.audioLang || ''}`, `--input-ipc-server=${pipe2}`, ...audioArgs(), `--start=${Math.max(0, L.t).toFixed(2)}`, d.path];
  d.proc = spawn(exe, args, { stdio: 'ignore' });
  d.proc.on('exit', code => { clearInterval(d.timer); fail('player exited (code ' + code + ')'); d.stopped = true; });
  let tries = 0;
  const connect = () => {
    if (d.stopped) return;
    d.sock = net.connect(pipe2);
    d.sock.on('connect', () => send(['observe_property', 1, 'time-pos']));
    let buf = '';
    d.sock.on('data', chunk => {
      buf += chunk; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.event === 'property-change' && m.name === 'time-pos' && m.data != null) {
            d.sT = m.data; d.sAt = Date.now();
            if (!d.ready) {                                    // first position after (re)load: snap to the main player and start together
              d.ready = true; send(['seek', pNow(), 'absolute+exact']); d.sT = pNow(); d.sAt = Date.now();
              send(['set_property', 'pause', !!L.paused]); d.sPaused = !!L.paused;
              if (L.aid != null) send(['set_property', 'aid', L.aid]);
              if (L.mute) send(['set_property', 'mute', true]);
              setTimeout(() => send(['get_property', 'current-ao'], 77), 2500);   // did the audio output actually open?
            }
          } else if (m.request_id === 77 && (m.error !== 'success' || !m.data)) fail('audio device could not be opened');
        } catch {}
      }
    });
    d.sock.on('error', () => { if (!d.stopped && ++tries < 40) setTimeout(connect, 250); });
  };
  setTimeout(connect, 400);
  d.timer = setInterval(() => {
    if (!d.ready || d.stopped) return;
    const now = Date.now(), sNow = d.sPaused ? d.sT : d.sT + (now - d.sAt) / 1000 * (L.speed || 1), diff = sNow - pNow();
    if (process.env.HS_DEBUG) console.log('[dual] drift ms =', Math.round(diff * 1000));
    if (Math.abs(diff) > 0.15 && now - d.lastFix > 1200) { send(['seek', pNow(), 'absolute+exact']); d.lastFix = now; d.sT = pNow(); d.sAt = now; }
  }, 400);
  d.onPrimary = (name, data, predicted) => {
    if (d.stopped) return;
    if (name === 'time-pos') { if (d.ready && !L.paused && Math.abs(data - predicted) > 0.8) { send(['seek', data, 'absolute+exact']); d.lastFix = Date.now(); d.sT = data; d.sAt = Date.now(); } return; }   // user seeked
    if (name === 'pause') { d.sPaused = !!data; send(['set_property', 'pause', !!data]); if (data && d.ready) send(['seek', L.t, 'absolute+exact']); return; }
    if (name === 'speed') return send(['set_property', 'speed', data]);
    if (name === 'volume') return send(['set_property', 'volume', data]);
    if (name === 'mute') return send(['set_property', 'mute', !!data]);
    if (name === 'aid') { if (d.ready) send(['set_property', 'aid', data]); return; }
    if (name === 'path') {                                    // next episode / new file
      const p = path.normalize(data); if (p === d.path) return; d.path = p; d.ready = false; d.sPaused = true;
      send(['set_property', 'pause', true]); send(['loadfile', p, 'replace']);
    }
  };
  d.stop = () => { d.stopped = true; clearInterval(d.timer); try { d.sock && d.sock.destroy(); } catch {} try { d.proc && d.proc.kill(); } catch {} };
  return d;
}

function play(item, startFile, startPos) {
  const exe = mpvPath();
  if (!exe) throw new Error('mpv.exe not found (expected in vendor/mpv)');
  if (playing) return;
  const rec = db.items[item.id];
  if (!rec || rec.virtual) throw new Error('This one is not downloaded yet');
  if (rec.offline) throw new Error('Plug in the drive this movie is on, then try again');
  let list;
  if (rec.type === 'movie') list = [rec.path];
  else {
    const eps = rec.episodes.filter(e => !e.offline).map(e => e.path);
    if (!eps.length) throw new Error('Plug in the drive these episodes are on, then try again');
    const i = Math.max(0, eps.indexOf(startFile || eps[0]));
    list = settings.autoplayNext ? eps.slice(i) : [eps[i]];
  }
  const pipe = `\\\\.\\pipe\\pcmovietheater-${process.pid}-${Date.now()}`;
  const playerDir = path.join(path.dirname(path.dirname(exe)), 'player');   // vendor/player: ModernZ (YouTube-style) UI, key bindings, Esc dialog
  const args = [
    `--config-dir=${playerDir}`, `--input-conf=${buildPlayerInput(playerDir)}`,
    settings.fullscreen ? '--fs' : '--no-fs', '--input-gamepad=yes', '--title=${media-title}',
    `--input-ipc-server=${pipe}`, '--force-window=yes', '--keep-open=no', '--osc=no', '--osd-bar=no', '--autofit-larger=92%x92%', '--no-keepaspect-window', '--auto-window-resize=no', '--snap-window=yes', '--window-dragging=yes',
    '--hwdec=auto-safe', `--volume=${settings.playerVolume}`, '--sub-auto=fuzzy', `--slang=${settings.subLang}`,
    '--sub-file-paths=Subs:subs:Subtitles:Sub', `--alang=${settings.audioLang || ''}`, `--volume-max=${+settings.volumeMax || 130}`, ...audioArgs(), '--save-position-on-quit=no', '--cursor-autohide=2500',
    // YouTube-style captions: white text on a translucent box
    '--sub-font=Segoe UI', `--sub-font-size=${settings.subSize}`, '--sub-color=#FFFFFFFF', '--sub-back-color=#B0000000', '--sub-border-style=background-box', '--sub-border-size=1.5', '--sub-shadow-offset=0',
    '--screenshot-directory=' + path.join(os.homedir(), 'Pictures'),
  ];
  if (settings.audioDevice && settings.audioDevice !== 'auto') args.push(`--audio-device=${settings.audioDevice}`);
  if (+settings.audioDelay) args.push(`--audio-delay=${settings.audioDelay / 1000}`);
  // one group per file so each gets its own on-screen title (and the start offset only applies to the first one)
  if (settings.playerWin && settings.playerWin.w > 320) args.push(`--geometry=${settings.playerWin.w}x${settings.playerWin.h}`);
  else args.push('--autofit=70%x70%');
  list.forEach((f, i) => {
    const ep = rec.type === 'show' ? rec.episodes.find(e => e.path === f) : null;
    const t = ep ? `${rec.title}  ·  S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}` : `${rec.title}${rec.year ? ' (' + rec.year + ')' : ''}`;
    args.push('--{', `--force-media-title=${t}`);
    if (i === 0 && startPos > 5) args.push(`--start=${Math.floor(startPos)}`);
    args.push(f, '--}');
  });
  const proc = spawn(exe, args, { stdio: 'ignore' });
  const state = { item: rec, pos: {}, dur: {}, path: list[0], cur: 0, live: { t: Math.max(0, startPos || 0), at: Date.now(), paused: false, speed: 1, volume: +settings.playerVolume, mute: false, aid: null } };
  let dual = null;
  playing = { proc, state };
  win?.webContents.send('player:state', { playing: true, id: rec.id });
  win?.hide();

  let sock, tries = 0;
  const connect = () => {
    sock = net.connect(pipe);
    sock.on('connect', () => {
      mpvCommand(sock, ['observe_property', 1, 'time-pos']);
      mpvCommand(sock, ['observe_property', 2, 'duration']);
      mpvCommand(sock, ['observe_property', 3, 'path']);
      mpvCommand(sock, ['observe_property', 4, 'fullscreen']);
      mpvCommand(sock, ['observe_property', 5, 'osd-width']);
      mpvCommand(sock, ['observe_property', 6, 'osd-height']);
      for (const [id, nm] of [[7, 'pause'], [8, 'volume'], [9, 'mute'], [10, 'speed'], [11, 'aid']]) mpvCommand(sock, ['observe_property', id, nm]);
    });
    let buf = '';
    sock.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.event === 'property-change' && m.data != null) {
            const L = state.live;
            if (m.name === 'time-pos') { const pred = L.paused ? L.t : L.t + (Date.now() - L.at) / 1000 * (L.speed || 1); L.t = m.data; L.at = Date.now(); dual && dual.onPrimary('time-pos', m.data, pred); }
            else if (['pause', 'volume', 'mute', 'speed', 'aid', 'path'].includes(m.name)) { if (m.name !== 'path') L[m.name] = m.data; dual && dual.onPrimary(m.name, m.data); }
            if (m.name === 'path') state.path = path.normalize(m.data);
            else if (m.name === 'time-pos') state.pos[state.path] = m.data;
            else if (m.name === 'duration') state.dur[state.path] = m.data;
            else if (m.name === 'fullscreen') state.fs = m.data;
            else if (m.name === 'osd-width') { state.ow = m.data; trackWin(state); }
            else if (m.name === 'osd-height') { state.oh = m.data; trackWin(state); }
          }
        } catch {}
      }
    });
    sock.on('error', () => { if (!proc.killed && proc.exitCode == null && ++tries < 40) setTimeout(connect, 250); });
  };
  if (process.env.HS_DEBUG_SEQ) { for (const [ms, c] of [[7000, ['seek', 900, 'absolute']], [10000, ['set_property', 'pause', true]], [12500, ['set_property', 'pause', false]], [17000, ['quit']]]) setTimeout(() => mpvCommand(sock, c), ms); }   // test hook
  setTimeout(connect, 300);
  // Bluetooth headsets sleep when idle and can take a few seconds to wake, so retry the second output a couple of times before giving up.
  const launchDual = (attempt = 1) => {
    if (proc.exitCode != null) return;
    try {
      dual = startDual(state, why => {
        console.log('second audio output failed (try ' + attempt + '):', why);
        if (attempt < 3) setTimeout(() => launchDual(attempt + 1), 2500);
        else if (sock) mpvCommand(sock, ['show-text', 'Second headphones unavailable - is it connected and set as a Windows output?', 6000]);
      });
    } catch (e) { console.log('second audio output failed:', e.message); }
  };
  setTimeout(launchDual, 1800);
  proc.on('exit', () => {
    try { sock?.destroy(); } catch {}
    try { dual && dual.stop(); } catch {}
    finishPlayback(state);
    playing = null;
    if (win) { win.show(); win.focus(); win.webContents.send('player:state', { playing: false, id: rec.id }); win.webContents.send('library:changed', publicItem(rec)); }
  });
}

function trackWin(st) {
  if (!st.fs && st.ow > 320 && st.oh > 200) st.win = { w: st.ow, h: st.oh };
}

function finishPlayback(st) {
  if (st.win && (!settings.playerWin || settings.playerWin.w !== st.win.w || settings.playerWin.h !== st.win.h)) { settings.playerWin = st.win; saveSettings(); }
  const rec = st.item;
  rec.watched = rec.watched || {};
  const paths = Object.keys(st.pos);
  for (const p of paths) {
    const key = rec.type === 'movie' ? 'movie' : p;
    const pos = st.pos[p], dur = st.dur[p];
    if (!(pos > 0)) continue;
    if (dur && pos / dur > 0.93) { rec.watched[key] = true; if (rec.resume && rec.resume.file === p) rec.resume = null; if (rec.type === 'show') rec.resume = null; }
    else if (pos > 15) { rec.resume = { file: p, pos, dur: dur || 0 }; rec.lastPlayed = Date.now(); delete rec.watched[key]; }
  }
  if (paths.length) rec.lastPlayed = Date.now();
  saveDb();
}

// ---------- auto-update (GitHub Releases via electron-updater; installed copies only) ----------
let autoUpdater = null, updManual = false;
try { autoUpdater = require('electron-updater').autoUpdater; } catch {}
const sendUpd = d => { try { win && win.webContents.send('update:event', d); } catch {} };
function setupUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;            // always ask first
  autoUpdater.autoInstallOnAppQuit = true;     // if an update was downloaded and the user picked "Later", install it when the app closes
  autoUpdater.allowPrerelease = false;
  if (process.env.PMT_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.PMT_UPDATE_URL });   // testing only: point the updater at a local folder/server
  const notes = i => typeof i.releaseNotes === 'string' ? i.releaseNotes : (i.releaseNotes || []).map(n => n.note).join('\n');
  autoUpdater.on('update-available', i => sendUpd({ type: 'available', version: i.version, notes: notes(i), current: app.getVersion(), manual: updManual }));
  autoUpdater.on('update-not-available', () => sendUpd({ type: 'none', current: app.getVersion(), manual: updManual }));
  autoUpdater.on('download-progress', p => sendUpd({ type: 'progress', percent: Math.round(p.percent), speed: p.bytesPerSecond }));
  autoUpdater.on('update-downloaded', i => sendUpd({ type: 'ready', version: i.version }));
  autoUpdater.on('error', e => sendUpd({ type: 'error', message: String((e && e.message) || e).split('\n')[0].slice(0, 200), manual: updManual }));
}
async function checkForUpdates(manual) {
  updManual = !!manual;
  if (!app.isPackaged || !autoUpdater) { if (manual) sendUpd({ type: 'error', message: 'Updates work in the installed app (not when running from source).', manual: true }); return; }
  if (!electronNet.isOnline()) { if (manual) sendUpd({ type: 'error', message: "You're offline.", manual: true }); return; }
  try { await autoUpdater.checkForUpdates(); } catch { /* reported through the 'error' event */ }
}

// ---------- window ----------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0b0612', title: 'PC Movie Theater', autoHideMenuBar: true,
    icon: path.join(APP_DIR, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  if (process.env.HS_SHOT) {
    win.webContents.on('console-message', (_, l, m) => console.log('[renderer]', m));
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, +process.env.HS_WAIT || 3000));
      for (const step of (process.env.HS_JS || '').split('||').filter(Boolean)) { try { const r = await win.webContents.executeJavaScript(step); if (r !== undefined) console.log('[js]', JSON.stringify(r)); } catch (e) { console.log('[js err]', e.message); } await new Promise(r => setTimeout(r, +process.env.HS_STEP || 900)); }
      const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.HS_SHOT, img.toPNG()); app.quit();
    });
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'hs-cover', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const gotLock = process.env.HS_SHOT ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('hs-cover', req => {
    const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
    return electronNet.fetch(pathToFileURL(path.join(COVERS, path.basename(name))).href);
  });

  const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, v: await fn(e, ...a) }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });

  h('settings:get', () => settings);
  h('settings:set', (_, patch) => { Object.assign(settings, patch); saveSettings(); return settings; });
  h('themes:list', () => listThemes());
  h('library:scan', () => scanLibrary());
  h('library:update', (_, id, patch) => {
    const rec = db.items[id]; if (!rec) throw new Error('unknown item');
    const allowed = ['title', 'year', 'genres', 'overview', 'rating', 'coverAsked', 'watched', 'resume', 'noCoverAsk', 'fav'];
    for (const k of allowed) if (k in patch) rec[k] = patch[k];
    if ('title' in patch || 'year' in patch) rec.edited = true;
    if ('genres' in patch) rec.genresEdited = true;
    saveDb(); return publicItem(rec);
  });
  h('library:markWatched', (_, id, val) => {
    const rec = db.items[id];
    rec.watched = rec.watched || {};
    if (rec.type === 'movie') { if (val) rec.watched.movie = true; else delete rec.watched.movie; }
    else for (const e of rec.episodes) { if (val) rec.watched[e.path] = true; else delete rec.watched[e.path]; }
    rec.resume = null; saveDb(); return publicItem(rec);
  });
  h('library:markEpisode', (_, id, file, val) => {
    const rec = db.items[id]; rec.watched = rec.watched || {};
    if (val) rec.watched[file] = true; else delete rec.watched[file];
    saveDb(); return publicItem(rec);
  });
  h('library:reveal', (_, id) => { const r = db.items[id]; shell.showItemInFolder(r.type === 'movie' ? r.path : r.episodes[0].path); });
  h('cover:search', (_, title, year, kind) => searchCovers(title, year, kind));
  h('cover:apply', async (_, id, cand) => {
    const rec = db.items[id];
    const out = await saveCoverFromUrl(id, cand.url);
    mergeMeta(rec, cand); maybeRename(rec, cand, true); saveDb(); return publicItem(rec);
  });
  h('cover:auto', async (_, id) => {
    const rec = db.items[id];
    const c = (await searchCovers(rec.title, rec.year, rec.type)).filter(x => x.source !== 'Archive.org' || x._s >= 60);
    if (!c.length || c[0]._s < 40) { rec.coverAsked = true; saveDb(); return { found: false, item: publicItem(rec) }; }
    for (const cand of c.slice(0, 3)) { try { await saveCoverFromUrl(id, cand.url); mergeMeta(rec, cand, c); maybeRename(rec, cand, false); saveDb(); return { found: true, cand, item: publicItem(rec) }; } catch {} }
    return { found: false, item: publicItem(rec) };
  });
  h('meta:auto', async (_, id, force) => {
    const rec = db.items[id]; if (!rec) return null;
    rec.metaTried = Date.now();
    try { const c = await searchCovers(rec.title, rec.year, rec.type); if (c.length && c[0]._s >= 45) { mergeMeta(rec, c[0], c); maybeRename(rec, c[0], false); } } catch {}
    saveDb(); return publicItem(rec);
  });
  h('library:renameFiles', (_, dry) => {
    const plan = [];
    const safe = t => t.replace(/[<>:"\/\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
    for (const rec of Object.values(db.items)) {
      if (rec.type !== 'movie' || !rec.path || rec.offline || !(rec.titleFromMeta || rec.edited)) continue;
      const dir = path.dirname(rec.path), ext = path.extname(rec.path), want = safe(rec.title + (rec.year ? ` (${rec.year})` : '')) + ext;
      if (!want || path.basename(rec.path) === want || fs.existsSync(path.join(dir, want))) continue;
      plan.push({ id: rec.id, from: rec.path, to: path.join(dir, want) });
    }
    if (dry) return plan.map(p => [path.basename(p.from), path.basename(p.to)]);
    let n = 0;
    for (const p of plan) {
      try {
        const oldBase = path.basename(p.from, path.extname(p.from)), newBase = path.basename(p.to, path.extname(p.to)), dir = path.dirname(p.from);
        fs.renameSync(p.from, p.to);
        for (const f of fs.readdirSync(dir)) if (f.startsWith(oldBase + '.') && /\.(srt|ass|ssa|sub|idx|vtt|sup)$/i.test(f)) { try { fs.renameSync(path.join(dir, f), path.join(dir, newBase + f.slice(oldBase.length))); } catch {} }
        const rec = db.items[p.id], nid = movieId(rec.root || libRoots().find(r => inside(p.to, r)) || path.dirname(p.to), p.to);
        db.items[nid] = { ...rec, id: nid, path: p.to }; delete db.items[p.id];
        if (rec.cover) { try { const ext = path.extname(rec.cover), nc = nid + ext; fs.renameSync(path.join(COVERS, rec.cover), path.join(COVERS, nc)); db.items[nid].cover = nc; } catch {} }
        n++;
      } catch {}
    }
    saveDb(); return n;
  });
  h('library:addGhost', async (_, d) => {
    const key = d.source && d.source.id ? 'v_' + hashId('ia:' + d.source.id) : 'v_' + hashId(norm(d.title) + (d.year || ''));
    if (db.items[key]) return publicItem(db.items[key]);
    const dup = Object.values(db.items).find(r => !r.virtual && norm(r.title) === norm(d.title) && (!r.year || !d.year || r.year === d.year));
    if (dup) throw new Error(`“${dup.title}” is already on your shelf`);
    db.items[key] = { id: key, type: 'movie', virtual: true, title: d.title, year: d.year || null, genres: cleanGenres(d.subject), overview: String(d.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) || undefined, source: d.source || null, added: Date.now(), titleFromMeta: true, size: 0 };
    saveDb();
    if (d.thumb) { try { await saveCoverFromUrl(key, d.thumb); } catch {} }
    return publicItem(db.items[key]);
  });
  h('library:delete', async (_, id, permanent) => {
    const rec = db.items[id]; if (!rec || rec.virtual) throw new Error('Nothing to delete');
    if (rec.offline) throw new Error('Plug in the drive first so the file can be deleted');
    const files = rec.type === 'movie' ? [rec.path] : rec.episodes.filter(e => !e.offline).map(e => e.path);
    for (const f of files) if (!libRoots().some(r => inside(f, r))) throw new Error('Refusing to delete a file outside your library folders');
    let freed = 0;
    for (const f of files) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      freed += st.size;
      const dir = path.dirname(f), base = path.basename(f, path.extname(f));
      const subs = fs.readdirSync(dir).filter(n => n.startsWith(base + '.') && /\.(srt|ass|ssa|sub|idx|vtt|sup)$/i.test(n)).map(n => path.join(dir, n));
      for (const p of [f, ...subs]) { if (permanent) fs.unlinkSync(p); else await shell.trashItem(p); }
    }
    rec.virtual = true; delete rec.path; rec.episodes = []; rec.resume = null; rec.size = 0; rec.removedAt = Date.now();
    saveDb(); return { item: publicItem(rec), freed };
  });
  h('library:forget', (_, id) => {
    const rec = db.items[id]; if (!rec || !rec.virtual) throw new Error('Only not-downloaded entries can be removed this way');
    if (rec.cover) try { fs.unlinkSync(path.join(COVERS, rec.cover)); } catch {}
    delete db.items[id]; saveDb(); return true;
  });
  h('cover:fromFile', (_, id, file) => {
    const ext = path.extname(file).toLowerCase();
    if (!IMG_EXT.has(ext)) throw new Error('Not an image file');
    return storeCover(id, fs.readFileSync(file), ext);
  });
  h('cover:fromUrl', (_, id, url) => saveCoverFromUrl(id, url));
  h('cover:remove', (_, id) => { const rec = db.items[id]; if (rec.cover) try { fs.unlinkSync(path.join(COVERS, rec.cover)); } catch {} rec.cover = null; rec.coverAsked = true; saveDb(); return publicItem(rec); });
  h('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a cover image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose your movies folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('play', (_, id, file, pos) => { play(db.items[id], file, pos); });
  h('ia:search', (_, q, f) => iaSearch(q, f));
  h('ia:files', (_, id) => iaFiles(id));
  h('ia:download', async (e, id, file, title, info, ghostId) => {
    const dest = await iaDownload(e.sender, id, file, title);
    const files = scanLibrary();
    const rec = Object.values(db.items).find(r => r.path === dest);
    if (rec && ghostId && db.items[ghostId] && db.items[ghostId].virtual && ghostId !== rec.id) { mergeGhost(rec, db.items[ghostId]); delete db.items[ghostId]; }
    if (rec) {
      rec.source = { kind: 'archive', id };
      mergeMeta(rec, { genres: info?.subject?.slice(0, 3), overview: info?.description, year: +info?.year || null });
      if (!rec.cover) { try { await saveCoverFromUrl(rec.id, 'https://archive.org/services/img/' + id); } catch {} }
      saveDb();
    }
    return { dest, id: rec?.id };
  });
  h('ia:cancel', (_, id) => { downloads.get(id)?.abort(); });
  h('binds:playerSpec', () => PLAYER_ACTIONS.map(({ id, label, group, keys, pad }) => ({ id, label, group, keys, pad })));
  h('audio:devices', () => new Promise(res => {
    const exe = mpvPath(); if (!exe) return res([]);
    require('child_process').execFile(path.join(path.dirname(exe), 'mpv.com'), ['--audio-device=help'], { timeout: 8000, windowsHide: true }, (err, out) => {
      const list = [];
      for (const line of String(out || '').split(/\r?\n/)) { const m = line.match(/^\s*'([^']+)'\s+\((.*)\)\s*$/); if (m && m[1] !== 'auto' && !m[1].startsWith('openal')) list.push({ id: m[1], name: m[2] }); }
      res(list);
    });
  }));
  h('audio:test', (_, dev) => {
    const exe = mpvPath(); if (!exe) throw new Error('mpv not found');
    spawn(exe, ['--no-config', '--no-terminal', '--no-video', '--force-window=no', '--really-quiet', ...(dev && dev !== 'auto' ? [`--audio-device=${dev}`] : []), '--volume=30', 'av://lavfi:sine=frequency=660:duration=0.8'], { stdio: 'ignore', windowsHide: true });
  });
  h('app:version', () => app.getVersion());
  h('paths:status', () => libRoots().map(p => ({ path: p, exists: rootOnline(p) })));
  h('paths:suggest', () => {
    const v = path.join(os.homedir(), 'Videos');
    const existing = ['movies', 'Movies', 'Films', 'TV', 'Shows'].map(n => path.join(v, n)).filter(rootOnline);
    return { videos: v, existing, fresh: path.join(v, 'PC Movie Theater') };
  });
  h('paths:ensure', (_, p) => { fs.mkdirSync(p, { recursive: true }); return true; });
  h('qr:svg', (_, text) => { const q = require('qrcode-generator')(0, 'M'); q.addData(String(text).slice(0, 400)); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); });
  h('update:check', () => { checkForUpdates(true); });
  h('update:download', () => autoUpdater && autoUpdater.downloadUpdate());
  h('update:install', () => { if (autoUpdater) autoUpdater.quitAndInstall(true, true); });
  h('app:openThemes', () => shell.openPath(USER_THEMES));
  h('app:openData', () => shell.openPath(DATA));
  h('app:openExternal', (_, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  h('app:fullscreen', (_, on) => { win.setFullScreen(on); return win.isFullScreen(); });
  h('app:isFullscreen', () => win.isFullScreen());
  h('app:quit', () => app.quit());

  createWindow();
  setupUpdater();
  if ((!process.env.HS_SHOT || process.env.PMT_UPDATE_URL) && settings.autoUpdate !== false) win.webContents.once('did-finish-load', () => setTimeout(() => checkForUpdates(false), 5000));   // quietly, a few seconds after launch
});
app.on('window-all-closed', () => { if (!playing) app.quit(); });

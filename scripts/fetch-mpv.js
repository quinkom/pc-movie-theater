// Downloads the mpv player (Windows x64 build by shinchiro) into vendor/mpv. Skipped if it is already there.
// Pin a different build with:  MPV_TAG=20261002 npm run fetch-mpv
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const TAG = process.env.MPV_TAG || '20261002';
const dest = path.join(__dirname, '..', 'vendor', 'mpv');

async function main() {
  if (fs.existsSync(path.join(dest, 'mpv.exe'))) { console.log('mpv already present:', dest); return; }
  const api = `https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/${TAG}`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;   // authenticated calls avoid GitHub's low anonymous rate limit (CI runners share IPs)
  const headers = { 'User-Agent': 'pc-movie-theater-build', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let rel;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(api, { headers }); rel = await res.json();
    if (res.ok) break;
    console.error(`GitHub API ${res.status}: ${rel.message || 'error'} (attempt ${attempt}/3)`);
    if (attempt === 3) throw new Error(`Could not look up mpv release ${TAG}: ${rel.message || res.status}`);
    await new Promise(r => setTimeout(r, 4000 * attempt));
  }
  const asset = (rel.assets || []).find(a => /^mpv-x86_64-\d+-git-[0-9a-f]+\.7z$/.test(a.name));
  if (!asset) throw new Error(`No mpv-x86_64 asset found for tag ${TAG}`);
  console.log('Downloading', asset.name, `(${(asset.size / 1e6).toFixed(0)} MB)…`);
  const tmp = path.join(__dirname, '..', 'vendor', asset.name);
  fs.mkdirSync(dest, { recursive: true });
  const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'pc-movie-theater-build' } });
  if (!dl.ok) throw new Error(`mpv download failed: HTTP ${dl.status}`);
  fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
  execFileSync('tar', ['-xf', tmp, '-C', dest], { stdio: 'inherit' });   // bsdtar ships with Windows 10+ and reads .7z
  fs.unlinkSync(tmp);
  console.log('mpv ready in', dest);
}
main().catch(e => { console.error(e); process.exit(1); });

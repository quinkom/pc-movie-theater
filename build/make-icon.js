// Renders build/icon.png + build/icon.ico (multi-size) from an SVG. Run: npm run icon   (uses Electron, no extra tools)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');

const RED = '#d0212b', CREAM = '#fff4d6', GOLD = '#ffc933';
function svg() {
  // popcorn bucket (stripes converge toward the base)
  const cx = 256, ytop = 238, ybase = 436, tl = cx - 112, tr = cx + 112, bl = cx - 82, br = cx + 82, n = 8;
  let stripes = '';
  for (let i = 0; i < n; i++) {
    const a = tl + (tr - tl) * i / n, b = tl + (tr - tl) * (i + 1) / n, c = bl + (br - bl) * i / n, d = bl + (br - bl) * (i + 1) / n;
    stripes += `<polygon points="${a},${ytop} ${b},${ytop} ${d},${ybase} ${c},${ybase}" fill="${i % 2 ? CREAM : RED}"/>`;
  }
  // popcorn heap — fixed positions so the icon is identical every build
  const P = [[256, 118, 38], [206, 140, 36], [306, 140, 36], [160, 172, 34], [352, 172, 34], [234, 168, 40], [284, 170, 40], [186, 204, 36], [330, 204, 36], [256, 196, 42], [140, 214, 30], [372, 214, 30], [214, 226, 34], [300, 228, 34]];
  const cols = ['#fff3cf', '#ffeab0', '#ffe39a', '#fff8e0'];
  let corn = '';
  P.forEach(([x, y, r], i) => {
    const c = cols[i % 4];
    corn += `<g fill="${c}" stroke="#e3bd62" stroke-opacity=".6" stroke-width="2.5"><circle cx="${x}" cy="${y}" r="${r}"/><circle cx="${x - r * .7}" cy="${y + r * .3}" r="${r * .72}"/><circle cx="${x + r * .72}" cy="${y + r * .25}" r="${r * .7}"/><circle cx="${x}" cy="${y - r * .62}" r="${r * .66}"/></g>`;
  });
  // marquee bulbs along the top
  let bulbs = '';
  for (let i = 0; i < 9; i++) bulbs += `<circle cx="${96 + i * 40}" cy="64" r="9" fill="#fff0a8"/><circle cx="${96 + i * 40}" cy="64" r="20" fill="url(#glow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0609"/><stop offset="1" stop-color="#070304"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#ffc933" stop-opacity=".55"/><stop offset="1" stop-color="#ffc933" stop-opacity="0"/></radialGradient>
    <radialGradient id="spot" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#d0212b" stop-opacity=".55"/><stop offset="1" stop-color="#d0212b" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="8" y="8" width="496" height="496" rx="112" fill="url(#bg)"/>
  <rect x="8" y="8" width="496" height="496" rx="112" fill="url(#spot)"/>
  <rect x="22" y="22" width="468" height="468" rx="98" fill="none" stroke="${GOLD}" stroke-width="10"/>
  ${bulbs}
  <ellipse cx="${cx}" cy="446" rx="150" ry="14" fill="#000" opacity=".45"/>
  <ellipse cx="${cx}" cy="${ytop}" rx="116" ry="16" fill="#b3191f"/>
  ${stripes}
  <polygon points="${tr - 26},${ytop} ${tr},${ytop} ${br},${ybase} ${br - 18},${ybase}" fill="#000" opacity=".16"/>
  ${corn}
  <path d="M${tl - 4} ${ytop + 2} Q${cx} ${ytop + 34} ${tr + 4} ${ytop + 2}" fill="none" stroke="#a0141b" stroke-width="10" stroke-linecap="round"/>
  <rect x="${cx - 62}" y="318" width="124" height="74" rx="14" fill="${RED}" stroke="${GOLD}" stroke-width="5"/>
  <polygon points="${cx - 14},336 ${cx - 14},374 ${cx + 22},355" fill="${GOLD}"/>
</svg>`;
}

function ico(pngs) {   // PNG-compressed ICO container
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length; const dir = [], data = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16); e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12); offset += buf.length; dir.push(e); data.push(buf);
  }
  return Buffer.concat([head, ...dir, ...data]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg()}</body></html>`));
  await new Promise(r => setTimeout(r, 600));
  const big = (await win.webContents.capturePage()).resize({ width: 512, height: 512, quality: 'best' });
  const out = path.join(__dirname);
  fs.writeFileSync(path.join(out, 'icon-512.png'), big.toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(path.join(out, 'icon.png'), big.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(sizes.map(size => ({ size, buf: big.resize({ width: size, height: size, quality: 'best' }).toPNG() }))));
  console.log('icons written to', out);
  app.quit();
});

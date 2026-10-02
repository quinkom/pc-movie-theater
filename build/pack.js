// Packages the app (with mpv bundled) into dist/PC Movie Theater-win32-x64/.
//   node build/pack.js               -> also (re)creates the desktop shortcut (local dev convenience)
//   node build/pack.js --no-shortcut -> used by the installer build / CI
const { packager } = require('@electron/packager');
const path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');

async function pack({ shortcut = true } = {}) {
  const out = await packager({
    dir: root, out: path.join(root, 'dist'), overwrite: true, platform: 'win32', arch: 'x64',
    name: 'PC Movie Theater', icon: path.join(__dirname, 'icon.ico'), prune: true,
    extraResource: [path.join(root, 'vendor')],
    ignore: [/^\/dist/, /^\/release/, /^\/vendor/, /^\/build\/pack\.js/, /^\/scripts/, /^\/\.git/, /^\/\.github/, /^\/docs/],
    asar: true,
  });
  const exe = path.join(out[0], 'PC Movie Theater.exe');
  console.log('Built:', exe);
  if (shortcut) {
    const ps = '$s=New-Object -ComObject WScript.Shell; $p=Join-Path ([Environment]::GetFolderPath("Desktop")) "PC Movie Theater.lnk"; $l=$s.CreateShortcut($p); ' +
      '$l.TargetPath=$env:PMT_EXE; $l.WorkingDirectory=$env:PMT_DIR; $l.IconLocation=$env:PMT_EXE+",0"; $l.Description="PC Movie Theater"; $l.Save(); Write-Output $p';
    console.log('Shortcut:', execFileSync('powershell', ['-NoProfile', '-Command', ps], { env: { ...process.env, PMT_EXE: exe, PMT_DIR: out[0] } }).toString().trim());
  }
  return out[0];
}
module.exports = { pack };
if (require.main === module) pack({ shortcut: !process.argv.includes('--no-shortcut') }).catch(e => { console.error(e); process.exit(1); });

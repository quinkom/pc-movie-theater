// Builds the Windows installer (release/PC-Movie-Theater-Setup-<version>.exe + latest.yml for the auto-updater).
//   npm run dist      -> build only
//   npm run release   -> build and publish to a GitHub Release (needs GH_TOKEN)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { pack } = require('../build/pack.js');
(async () => {
  execFileSync('node', [path.join(__dirname, 'fetch-mpv.js')], { stdio: 'inherit' });
  const dir = await pack({ shortcut: false });
  // tells the installed app where to look for updates (electron-updater reads this at runtime)
  const pub = require('../package.json').build.publish[0];
  fs.writeFileSync(path.join(dir, 'resources', 'app-update.yml'), `provider: ${pub.provider}
owner: ${pub.owner}
repo: ${pub.repo}
updaterCacheDirName: ${require('../package.json').name}-updater
`);
  const publish = process.argv.includes('--publish') ? 'always' : 'never';
  execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--prepackaged', dir, '--publish', publish], { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });

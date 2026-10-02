# Third-party software & credits

PC Movie Theater's own code is MIT-licensed (see `LICENSE`). It uses and redistributes the following:

| Component | License | Notes |
|---|---|---|
| [mpv](https://mpv.io) — video/audio player | GPL-2.0-or-later (LGPL-2.1-or-later if built without GPL parts) | Run as a **separate program**, unmodified. The Windows build comes from [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) and is fetched at build time (`npm run fetch-mpv`) and shipped alongside the app in the installer. Source code: https://github.com/mpv-player/mpv — build recipes and exact versions: https://github.com/shinchiro/mpv-winbuild-cmake (it also bundles FFmpeg, libass and other libraries under their own licenses). |
| [ModernZ](https://github.com/Samillion/ModernZ) — on-screen player controls (`vendor/player/scripts/modernz.lua`, `modernz-icons.ttf`) | LGPL-2.1 | Included with a custom config (`script-opts/modernz.conf`). Full license text: `vendor/player/LICENSE-ModernZ.txt`. |
| [Electron](https://www.electronjs.org) | MIT | Application runtime (includes Chromium and its licenses — see the `LICENSES.chromium.html` shipped with the app). |
| [electron-updater](https://www.electron.build/auto-update) / electron-builder | MIT | Auto-update and installer build. |
| [Creepster](https://fonts.google.com/specimen/Creepster) (Sam Parrett) and [Limelight](https://fonts.google.com/specimen/Limelight) (Eben Sorkin) fonts | SIL Open Font License 1.1 | Used for the Halloween and Movie Theater themes. |

## Data sources

- **TMDB** — *This product uses the TMDB API but is not endorsed or certified by TMDB.* Used only if you add your own API key.
- **Internet Archive** (archive.org) — search and downloads in the "Get Movies" screen. Content there has its own licenses/rights status; see the note in the README.
- **Wikipedia / Wikimedia** and **Apple's iTunes Search API** — cover art and film metadata lookups. Images belong to their respective rights holders and are cached locally on your PC for personal display only.

All trademarks and cover art belong to their respective owners.

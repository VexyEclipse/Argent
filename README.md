# Argent

A premium, cinematic frontend for [Jellyfin](https://jellyfin.org). Argent replaces Jellyfin's presentation layer (home, browsing, details, search and playback) and keeps Jellyfin as the backend for everything else: media, metadata, users, authentication, permissions, playback sessions and library management.

The app is branded Argent throughout. Its mark is the Jellyfin logo shape recoloured silver (credited below, as its licence requires). The palette is near-black, charcoal and silver.

## What's in it

- **Homepage.** A full-bleed featured header (MediaBar), then Continue Watching, Next Up, Recommended For You, Recently Added, Your Movies, Your Series, Your Anime, Collections, Discover, Genres, and up to three personalised sections ("Because you watched…", "From the director…", your favourite genre pairing or decade).
- **MediaBar.** Re-implements the [Jellyfin Media Bar](https://github.com/MakD/Jellyfin-Media-Bar) plugin's behaviour without needing the plugin at runtime. See [MediaBar parity](#mediabar-parity).
- **Recommendation engine.** Weighted, per-user scoring over your real viewing history. It only recommends titles in your library. See [docs/RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md).
- **Anime.** Libraries whose name contains "Anime" get their own section (top navigation, mobile tab bar, TV rail) and a homepage row. Series then means your other TV libraries. Jellyfin has no anime library type, so the name is what marks one.
- **Library browsing.** Separate Movies, Series and Anime views with library tabs, sorting, genre/decade/status/favourite filters, a title filter, A–Z jump, three poster densities and infinite scroll.
- **Details pages.** Movies, series (seasons and episodes, next-episode targeting), episodes (previous/next), collections and people. Cast and crew, media info, trailers, favourite and watched toggles.
- **Search.** Movies, series, episodes, actors, directors and writers, genres and collections. Debounced and cancellable, with type filters and sorting.
- **Player.** Direct Play, Direct Stream and Transcoding (HLS via hls.js), chosen by a device profile built from what the browser can decode. Also: audio and subtitle selection, subtitle sync offset, quality and speed, fullscreen, picture-in-picture, volume, seeking with trickplay thumbnails and chapter marks, resume, skip intro/recap (media segments), previous/next episode, Up Next with autoplay (it pauses to ask "Are you still watching?" after three unattended episodes), progress reporting to the server, Media Session keys, and keyboard and remote control. Every card has a play button; on a series it plays the episode in progress, otherwise the next one.
- **Three interfaces, one design system.** Desktop (top navigation), mobile (bottom tab bar, touch layouts, double-tap seeking) and TV (focus rail, D-pad spatial navigation, 10-foot sizing). The platform is detected automatically and can be overridden in Profile → Display, or with `?platform=tv|mobile|desktop|auto`.

## Running it

Requirements: Node 20+ and a Jellyfin 10.10+ server (developed against 10.11.6).

```bash
npm install
npm run dev        # http://localhost:5173
```

Sign in with the server address and your Jellyfin username and password, or use **Quick Connect**: approve the code from any signed-in Jellyfin client.

```bash
npm test           # recommendation engine + MediaBar logic
npm run build      # type-check and build to dist/
```

### Deploying

`dist/` is a static site; any web server can host it. Jellyfin allows cross-origin API calls, so Argent can be served from a different host or port than the server. To pre-fill the server address for users, edit `dist/argent.config.json` (no rebuild needed):

```json
{ "defaultServerUrl": "https://jellyfin.example.com", "mediaBar": { "lock": [] } }
```

If you serve it under a sub-path, build with `npx vite build --base=/argent/`.

## Playback notes

- **ASS/SSA subtitles** (common on anime) are drawn in the browser by [JASSUB](https://github.com/ThaUnknown/jassub), libass compiled to WebAssembly, with the file's embedded fonts. Playback keeps Direct Play and starts instantly. The renderer (~1 MB gzipped) loads only when an ASS track is shown. If a browser can't run it, the server burns the subtitles in instead.
- **Image subtitles (PGS, VobSub)** are burned in by the server, which needs a full video transcode, so they're slower to start (about 20–45 s on a typical server). Text subtitles (SRT/VTT) are shown by the browser and keep Direct Play.
- **Closing the tab mid-playback.** Browsers won't send the final "stopped" report to a server on another origin while the page unloads, so Jellyfin ends the session itself after a few minutes. Progress is saved every 10 seconds, so nothing is lost. Leaving the player inside the app reports straight away.

## MediaBar parity

The functional reference is the plugin's own source: [MakD/Jellyfin-Media-Bar](https://github.com/MakD/Jellyfin-Media-Bar) v6 (`slideshowpure.js`) and the [IAmParadox27/jellyfin-plugin-media-bar](https://github.com/IAmParadox27/jellyfin-plugin-media-bar) wrapper. Argent re-implements the behaviour. It contains none of the plugin's code.

| Plugin behaviour                                                                                                                                                                                                              | Argent                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Random unwatched movies and series that have overview, logo and backdrop; items without logo art dropped                                                                                                                      | ✓ same query and filter                                                                          |
| `libraries`, `trailerLibraries`, `maxItems`, `maxMovies`/`maxSeries` quotas, round-robin across libraries                                                                                                                     | ✓                                                                                                |
| Curated `avatars/list.txt`: item ids, `genre:` `tag:` `studio:` `year:` `person:` `rating:` filters, comma = or, `#` comments/title, fallback to random                                                                       | ✓ read from the same server path (including the plugin's playlist mode, which serves through it) |
| Plugin server config (`/MediaBar/WebConfig`, `-1` = unset)                                                                                                                                                                    | ✓ applied when the plugin is installed                                                           |
| Server-wide defaults and `lock` (`window.SlideshowConfig`)                                                                                                                                                                    | ✓ `argent.config.json` → `mediaBar`                                                              |
| Per-viewer settings via the gear panel (same fields, same order)                                                                                                                                                              | ✓ stored per Jellyfin user                                                                       |
| Layouts: marquee (default), plate (BlurHash-tinted panel, spec table), classic                                                                                                                                                | ✓                                                                                                |
| Logo, tagline, spec line (year, community rating, critic score, runtime/seasons, certificate), plot, Play / Details / Favourite                                                                                               | ✓                                                                                                |
| Crossfade, Ken Burns and logo blur-in (`slideAnimationEnabled`), BlurHash placeholders                                                                                                                                        | ✓                                                                                                |
| Rotation timer, pause on hover (resumes mid-period), pause button, scrolled-away and hidden-tab pausing                                                                                                                       | ✓                                                                                                |
| Pagination dots capped at `maxDots` with proportional mapping, marquee progress rule                                                                                                                                          | ✓                                                                                                |
| Trailers: local trailer preferred, else YouTube (ranked official > final/main > trailer > teaser, alternate cuts demoted), start delay, watchdog, muted with volume toggle, ended → next slide, errors fall back to the timer | ✓                                                                                                |
| No trailers on touch layout unless `allowTrailersOnTouch`; data-saver respected; opt-in SponsorBlock                                                                                                                          | ✓                                                                                                |
| Swipe (`minSwipeDistance`), keyboard (←/→ through buttons then slides, Space pause, Enter play, Esc)                                                                                                                          | ✓                                                                                                |
| `mixTypesInFirst` type mixing, `rememberOrderForSession` order and position                                                                                                                                                   | ✓                                                                                                |
| `syncPageBackdrop`                                                                                                                                                                                                            | ✓ mirrors the slide into a blurred ambient page background                                       |
| `preloadCount`                                                                                                                                                                                                                | ✓ preloads neighbouring backdrops                                                                |

Plugin options that only exist to cope with being injected into jellyfin-web (auth polling, loading screen, retry intervals, `measureStartup`) don't apply to a standalone app and are not reproduced.

## Project layout

```
src/
  api/            Typed Jellyfin client, endpoints, image + format helpers
  auth/           Sign-in (password, Quick Connect), saved accounts, user switching
  design/         Tokens (colour, type, spacing, sizing, motion), base, components, layout
  components/     Artwork, MediaCard, Row (carousel), Button, Icon, Jellyfin logo, states
  platform/       Desktop/mobile/TV detection, D-pad spatial navigation
  layouts/        Shell with per-platform navigation
  features/
    mediabar/         MediaBar: config model, pure logic, data loading, trailers, UI
    recommendations/  engine/ (pure, tested), data loading, feedback, React hook
    home/ library/ details/ search/ player/ profile/
docs/             Architecture and recommendation engine notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.

## Credits and licences

- Jellyfin logo: © Jellyfin contributors, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), from [jellyfin-ux](https://github.com/jellyfin/jellyfin-ux). Argent's silver version (`public/jellyfin-silver.svg`, `src/components/JellyfinLogo.tsx`) is an adaptation under the same licence.
- MediaBar behaviour is modelled on the Jellyfin Media Bar by **MakD** (with IAmParadox27 & M0RPH3US), which builds on work by BobHasNoSoul, SethBacon and TedHinklater.
- Fonts: Inter and Inter Tight (SIL OFL), loaded from Google Fonts.
- Subtitle rendering: [JASSUB](https://github.com/ThaUnknown/jassub) and libass (LGPL-2.1+ and others; see the package's licence), used unmodified as a separate, dynamically loaded module.

## Desktop app (Windows)

Argent also runs as its own desktop app: an Electron shell around the same build, with the silver mark as its icon, a dark integrated title bar and a modern engine that plays H.264, HEVC and AV1.

```bash
npm run desktop        # build and open the app
npm run desktop:dev    # open the app against the running dev server (npm run dev)
npm run desktop:pack   # build release/Argent-Setup-<version>.exe (per-user installer)
npm run icons          # regenerate build/icon.ico and build/icon.png from the logo
```

The installer adds Start menu and desktop shortcuts named Argent. Keys: F11 toggles full screen, Ctrl+R reloads, Ctrl+Shift+I opens developer tools.

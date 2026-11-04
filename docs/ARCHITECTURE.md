# Architecture

## Starting point

The Argent repository was empty, so there was no existing frontend code to preserve. The things that did exist, and that this design is built around, are:

- **Jellyfin 10.11.6** (the development server), with Quick Connect enabled, CORS open (`Access-Control-Allow-Origin: *`) and users hidden from the login screen.
- The **Media Bar plugin 2.4.8.1**, which exposes `GET /MediaBar/WebConfig` (public) and serves its curated list at `/web/avatars/list.txt`. The other installed plugins (Jellyfin Enhanced, JavaScript Injector, File Transformation) only modify jellyfin-web, so Argent ignores them.
- The **Jellyfin HTTP API**, read from the official OpenAPI spec. Argent uses only the non-deprecated 10.9+ routes (`/UserViews`, `/UserItems/Resume`, `/UserFavoriteItems`, `/UserPlayedItems`, `/Items?userId=`).

## Decisions

**A standalone SPA, not a jellyfin-web theme.** The brief asks for a separate frontend that owns the whole presentation layer. Argent is a static React app that talks to Jellyfin over HTTP. It can be hosted anywhere, and leaves jellyfin-web, the dashboard and other clients untouched. Admin functions link out to the server's own dashboard, and only for administrators.

**A small dependency set.** `react`, `react-router`, `@tanstack/react-query` (request de-duplication and caching), `hls.js` (HLS on browsers without native HLS, lazy-loaded) and `blurhash` (artwork placeholders). There is no UI kit and no CSS framework, so the design system is fully under our control. Argent uses a thin typed fetch client rather than `@jellyfin/sdk`, which keeps the bundle small and the calls explicit.

**One design system, three shells.** `src/design/tokens.css` defines the palette, type scale, spacing, poster and backdrop sizes, radii, elevation and motion. `html[data-platform]` re-tunes sizes per platform and never changes the palette. `layouts/Shell.tsx` renders a different navigation per platform: a top bar on desktop, a header plus tab bar on mobile, and a focus-expanding rail on TV. Screens adapt layout per platform in CSS, while data, components and services are shared.

**TV navigation.** `platform/spatialNavigation.ts` implements geometric D-pad focus movement. It prefers targets aligned on the cross axis, keeps rows (`[data-nav-row]`) self-contained, and traps focus in dialogs and the player (`[data-nav-trap]`). Back is mapped to Escape and Backspace, plus the remote's back key on Tizen (10009) and webOS (461).

**Caching.** React Query caches each request with a stale time suited to its data: seconds for resume and next-up, minutes for library rows, an hour for genre artwork. Image URLs carry Jellyfin's image tags, so browsers cache artwork indefinitely. Large grids page through results 60 at a time and use `content-visibility`, so libraries of thousands of titles stay smooth. After playback stops, the caches that depend on watch state are invalidated so Continue Watching and recommendations update straight away.

**Authentication.** `/Users/AuthenticateByName` or Quick Connect. Tokens are stored per account in `localStorage`, so several users and servers can be kept and switched between. Every request carries the standard `MediaBrowser` authorization header with a stable device id. A 401 anywhere signs the user out. Permissions are enforced by the server, and the UI hides admin links from non-administrators.

## Playback

1. `resolvePlayable` turns a series, season or collection into the actual episode or film to play.
2. `buildDeviceProfile` probes `canPlayType` and `MediaSource.isTypeSupported` (H.264, HEVC, AV1, VP9, AAC, AC-3, E-AC-3, Opus, FLAC, MKV support) and posts it to `/Items/{id}/PlaybackInfo`. The server then decides between Direct Play, Direct Stream and Transcoding.
3. Precedence matches jellyfin-web: static stream for Direct Play and Direct Stream, otherwise the server's `TranscodingUrl` (HLS through hls.js, or natively on Safari and TVs). If the browser fails on a file it claimed to support, the player retries automatically with direct play disabled.
4. Changing the audio track, choosing an image-based subtitle (which gets burned in) or changing quality rebuilds the stream at the current position. Text subtitles arrive as WebVTT tracks and Argent renders them itself, so styling is consistent and the sync offset can be adjusted.
5. `PlaybackReporter` reports start, progress every 10 s and on pause, seek or volume change, and stop (sent with `keepalive` on page hide). It pings transcodes and tears them down on exit, so resume points, the Jellyfin dashboard and other clients stay accurate.

## MediaBar

`features/mediabar` is split into:

- `config.ts`: option set, validation ranges and precedence, mirroring the plugin.
- `logic.ts`: pure, testable behaviour (list parsing, ordering, dot mapping, trailer choice, plate colours).
- `data.ts`: queries mirroring the plugin's, plus the session order.
- `trailers.ts`: local and YouTube players behind one interface.
- `MediaBar.tsx` and `Slide.tsx`: the stage, timer and input handling.

The README has the parity table.

## Recommendations

See [RECOMMENDATIONS.md](RECOMMENDATIONS.md).

## Where to extend

- **More platforms.** The TV shell runs in Tizen and webOS browsers as-is, and `android/` packages it for Android TV, Google TV and Fire TV (see the README). A packaged Tizen or webOS app would be the same kind of wrapper around the built `dist/`, with the remote's Back key already handled.
- **Tuning recommendations.** Change `DEFAULT_WEIGHTS` in `features/recommendations/engine/score.ts`. The engine has no UI dependencies, and `engine.test.ts` covers the intended behaviours.

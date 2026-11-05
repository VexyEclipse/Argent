# Argent

A premium, cinematic frontend for [Jellyfin](https://jellyfin.org). Argent replaces Jellyfin's presentation layer (home, browsing, details, search and playback) and keeps Jellyfin as the backend for everything else: media, metadata, users, authentication, permissions, playback sessions and library management.

The app is branded Argent throughout. Its mark is the Jellyfin logo shape recoloured silver (credited below, as its licence requires). The palette is near-black, charcoal and silver.

## Install

**You need a Jellyfin server** (version 10.10 or newer) and its address, for example `http://192.168.1.20:8096`. Argent is only the app you watch on: your films, shows and accounts stay on the server. If you don't have a server yet, set one up first with [Jellyfin's guide](https://jellyfin.org/docs/general/installation/).

Downloads are on the [Releases page](https://github.com/VexyEclipse/Argent/releases/latest).

| Device                                   | How                                        |
| ---------------------------------------- | ------------------------------------------ |
| Windows PC                               | Install app (`Argent-Setup-<version>.exe`) |
| Android TV, Google TV, Fire TV           | Install app (`Argent-<version>.apk`)       |
| Android phone or tablet                  | Install app (`Argent-<version>.apk`)       |
| iPhone, iPad, Mac, Linux                 | In a web browser                           |
| Samsung (Tizen) and LG (webOS) smart TVs | In the TV's web browser                    |

The browser options need the web version hosted somewhere, usually by whoever runs the server: see [Hosting the web version](#hosting-the-web-version).

### Windows

1. Download `Argent-Setup-<version>.exe` from the Releases page and open it.
2. Windows may warn that the app is from an unknown publisher (the installer isn't code-signed). Choose **More info → Run anyway**.
3. Argent installs and opens. It's in the Start menu and on the desktop, and updates itself from then on.

### Android TV, Google TV and Fire TV

TV apps that aren't from the Play Store are installed with the free **Downloader** app by AFTVnews:

1. On the TV, install **Downloader** from the Play Store (on Fire TV, from the Amazon Appstore).
2. Allow it to install apps. Google TV: **Settings → Apps → Security & restrictions → Unknown sources → Downloader** (older Android TV: **Settings → Device Preferences → Security & restrictions**). Fire TV: **Settings → My Fire TV → Developer options → Install unknown apps → Downloader** (if Developer options is hidden, open **Settings → My Fire TV → About** and click the device name seven times).
3. Open Downloader, enter the link to `Argent-<version>.apk` from the Releases page, and choose **Install** when it has downloaded.
4. Argent appears on the home screen (Google TV: under **Apps**, or **Your apps → See all**).

From a computer with [adb](https://developer.android.com/tools/adb) instead: turn on **Developer options → USB/network debugging** on the TV, then `adb connect <tv-ip>` and `adb install Argent-<version>.apk`.

The remote works throughout: the arrows move, OK selects and Back goes back (on the home screen it closes Argent). The TV needs an up-to-date **Android System WebView**, which Google TV and Android TV update through the Play Store.

### Android phones and tablets

Open the Releases page on the phone, download `Argent-<version>.apk` and open it. Android asks once to allow installs from your browser; allow it, then tap **Install**. The app uses the touch layout.

### In a browser

Open the address of your Argent web version (ask whoever runs your server) in any modern browser: Chrome, Edge, Firefox or Safari. On an iPhone or iPad you can choose **Share → Add to Home Screen** for an icon. Samsung and LG TVs switch to the remote-friendly TV layout by themselves.

### Signing in

Enter your server address, then your Jellyfin username and password. Or use **Quick Connect**, which is easier with a remote: Argent shows a code, and you approve it from any device where you're already signed in to Jellyfin (in Jellyfin's own app: your user menu → Quick Connect). Several accounts and servers can be saved and switched between (Profile → Switch user).

## What's in it

- **Homepage.** A full-bleed featured header (MediaBar), then Continue Watching, Next Up, Your Watchlist, Recommended For You, Recently Added, Coming Up (new episodes and announced seasons, see below), Your Movies, Your Series, Your Anime, Collections, Discover, Genres, and up to three personalised sections ("Because you watched…", "From the director…", your favourite genre pairing or decade).
- **MediaBar.** Re-implements the [Jellyfin Media Bar](https://github.com/MakD/Jellyfin-Media-Bar) plugin's behaviour without needing the plugin at runtime. See [MediaBar parity](#mediabar-parity).
- **Recommendation engine.** Weighted, per-user scoring over your real viewing history. It only recommends titles in your library. See [docs/RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md).
- **Anime.** Libraries whose name contains "Anime" get their own section (top navigation, mobile tab bar, TV rail) and a homepage row. Series then means your other TV libraries. Jellyfin has no anime library type, so the name is what marks one.
- **Library browsing.** Separate Movies, Series and Anime views with library tabs, sorting, genre/decade/status/favourite filters, a title filter, A–Z jump, three poster densities and infinite scroll. **Shuffle play** starts a random title from what's shown.
- **Play something and shuffle.** **Play something** on Recommended For You starts a title picked for you. **Shuffle** on a show plays random episodes, one after another.
- **Remove from row.** The × on a Continue Watching card clears its resume point on the server, so every app agrees. On Next Up it hides the show until you watch more of it. Both can be undone.
- **NEW badges.** Series posters say **New season**, **New episodes** or **New series** when episodes that aired in the last month arrived in the last two weeks and you haven't watched them.
- **Remind me.** The bell on a show (its page, or its Coming Up card) checks it daily even before you start it. You're notified when an episode airs and again when it reaches your library. Desktop app, Android app (it asks for permission) and browsers that allow notifications; otherwise a message shows while Argent is open. Reminders sync through your account.
- **Downloads.** Save films, episodes or whole seasons to watch offline, in the Windows and Android apps or the web version over https. Choose **Original** (the file as is, when the device plays it) or a copy the server converts to MP4 (High 1080p, Standard 720p, Data saver 480p). Text subtitles and artwork are saved too. Downloads continue from where they stopped, and **Downloads** in the account menu shows progress and space. If the server can't be reached at start-up, Argent opens to your downloads. What you watch offline syncs back to the server when it's reachable again.
- **Watchlist.** Save films and shows for later from any poster or details page. The list syncs through your Jellyfin account (DisplayPreferences), so it follows you to every device; titles you finish move to a Watched section.
- **Ratings.** Score anything 1–10 with an optional note; notes that give the plot away stay blurred until clicked. When you finish a film or series, Argent asks what you'd rate it (optionally after every season too), and your score can show as a badge on posters. Rewatches keep a diary of earlier scores. **Edit order** on your top 10 sets the order of titles that share a score (your 10s always stay above your 9s). Ratings sync through your Jellyfin account and are also saved as Jellyfin's own rating, so other clients see them.
- **Letterboxd import and export.** Back up your ratings as JSON (everything) or as a CSV that Letterboxd's importer reads. Letterboxd's own exports (ratings.csv, reviews.csv, diary.csv) can be imported, with their 0.5–5 stars converted to 1–10.
- **Your profile.** All-time favourites, estimated watch time, top genres by hours, how you score, your most-watched title, and "Your taste": the genres you score highest, the actors and directors you keep rating, and the titles where you disagree most with everyone else. **Year in Review** tells one year as a story (hours watched, genres, your biggest binge, your best). **Export image** draws your top-rated titles as a poster grid to copy or save.
- **Coming Up.** New episodes and announced seasons of the shows you follow (started, favourited or on your watchlist). Episodes Jellyfin already knows about come from the server; once a day Argent also checks [TVmaze](https://www.tvmaze.com/api) for everything else, so a "Season 3 announced" appears without a metadata refresh. Only each show's TVDB or IMDb id is sent (no cookies, token or referrer), results are cached on the device, and nothing is written to Jellyfin. It can be turned off in Profile → Settings → Coming Up. The desktop app can also notify you when an episode airs today or a new season is announced.
- **Details pages.** Movies, series (seasons and episodes, next-episode targeting), episodes (previous/next), collections and people. Cast and crew, media info, trailers, extras (behind the scenes, deleted scenes, featurettes), favourite and watched toggles. Mark a whole season watched in one click, and marking an episode watched offers to mark the unwatched ones before it too. A title with several files (4K and 1080p, theatrical and extended) gets a **Version** picker; the choice is remembered for that title.
- **Library management (administrators).** Right-click any poster, episode or details page (or use the ⋯ button, which also works on TV and touch) for: play, mark watched, favourite, watchlist, select several, add to a collection or playlist, download, copy the stream URL, edit metadata, identify (fix a wrong match by searching providers by title, year or IMDb/TMDb/TVDB id, then applying the right one), edit images (upload, search providers, remove), edit subtitles (search providers, upload, delete), media info, refresh metadata, and delete. Saving metadata starts from the item's full current data, so anything the editor doesn't show (cast, other provider ids, locked fields) is kept. Deleting a series, a season or several titles asks you to type "delete". Other users don't see any of it.
- **Search.** Movies, series, episodes, actors, directors and writers, genres and collections. Debounced and cancellable, with type filters and sorting.
- **Skipping.** A Skip card comes up for each intro, recap and the credits, filling as it plays. **S** presses it, and during the credits S goes to the next episode. Profile → Settings → Skipping can skip intros and credits automatically (a film's credits always play). Auto-skip works in the native players too.
- **Filler.** Anime episodes outside the source story get a **Filler** badge in the episode list, on episode pages and in the player. Each show's MyAnimeList episode list is read through [jikan-edge](https://jikan.lucashdo.com), a free, open-source service in the format of the former Jikan API, with [Tenrai](https://tenrai.org) as a backup. Shows are found by their MyAnimeList or AniList id, or a careful title match. Only those ids and titles are sent, and results are cached for a week. **Skip all filler** makes next episode, autoplay and a show's Play button pass over them.
- **Paused.** After a few seconds paused, the picture dims to show what you're watching, the synopsis and the cast (Settings → Display can turn this off).
- **Sound.** Dialogue boost and volume levelling in the player's Sound menu. They work in the page's player (Web Audio), mpv (ffmpeg filters) and the Android player (Android 9 and later), but not when surround sound goes to a receiver as is.
- **Player.** Direct Play, Direct Stream and Transcoding (HLS via hls.js), chosen by a device profile built from what the browser can decode. Also: audio and subtitle selection, subtitle sync offset, quality and speed, fullscreen, picture-in-picture, volume, seeking with trickplay thumbnails and chapter marks, resume, skip intro/recap (media segments), previous/next episode, Up Next with autoplay (it pauses to ask "Are you still watching?" after three unattended episodes), progress reporting to the server, Media Session keys, and keyboard and remote control. Every card has a play button; on a series it plays the episode in progress, otherwise the next one. Playback info shows the method and why the server converts, and switching version keeps your place.
- **Native players.** In the Android app, titles play in a native Media3 (ExoPlayer) player: HDR10, HLG and Dolby Vision reach the TV, Dolby and DTS audio pass through to a receiver, every subtitle format inside the file is shown without converting, and the TV can switch to the video's frame rate (24p, 25p…). In the Windows app you can choose to play in [mpv](https://mpv.io) instead. Either way Argent still reports progress, offers Up Next and asks for ratings. Both can be turned off in Settings.
- **Play on and remote control.** Choose another device in Devices (the cast icon) and Play sends titles there; Argent becomes its remote (play, pause, seek, volume, audio and subtitles). Other Jellyfin apps can control Argent the same way.
- **Watch Together.** Jellyfin's SyncPlay: start or join a group and everyone plays, pauses and seeks in sync on their own screen, with clock sync and drift correction. People in jellyfin-web and other Jellyfin apps can join too. An administrator has to allow SyncPlay for each user.
- **Three interfaces, one design system.** Desktop (top navigation), mobile (bottom tab bar, touch layouts, double-tap seeking) and TV (focus rail, D-pad spatial navigation, 10-foot sizing). The platform is detected automatically and can be overridden in Profile → Display, or with `?platform=tv|mobile|desktop|auto`. Apps for Windows and Android (TV and phone) wrap the same build.
- **Settings.** In Profile → Settings: autoplay of the next episode, default audio track, remembering audio and subtitle choices, the interface, hiding watched titles from Recently Added, Coming Up, ratings prompts and poster badges, and restoring titles you marked "Not interested" in recommendations. **Help → Diagnostics** copies or saves a report for bug reports: what the device can play, how it's set up and what the player did recently (no passwords or tokens). Also links to the server dashboard (administrators), your Jellyfin password and profile picture, and Quick Connect.

## Hosting the web version

For people who run a Jellyfin server and want their users to open Argent in a browser. The web version is a static site: it doesn't need a database or its own backend, and it runs alongside Jellyfin's own web app without changing it.

1. Install [Node.js](https://nodejs.org) 20 or newer.
2. Download the source (the **Source code (zip)** on the Releases page, or `git clone`), open a terminal in that folder and build it:

   ```bash
   npm install
   npm run build
   ```

3. Serve the `dist/` folder. On the Jellyfin machine, the simplest way is:

   ```bash
   npx serve -s dist -l 8090
   ```

   Argent is then at `http://<server-ip>:8090`. To use a web server you already run instead, copy `dist/` to it and send unknown paths to `index.html`, since Argent's pages are client-side routes. With nginx that's `try_files $uri /index.html;`, and with Caddy it's `try_files {path} /index.html`.

4. Optional: to fill in the server address for your users, edit `dist/argent.config.json` (no rebuild needed):

   ```json
   { "defaultServerUrl": "http://192.168.1.20:8096", "mediaBar": { "lock": [] } }
   ```

Things to know:

- **HTTPS.** If Argent is served over `https://`, the Jellyfin address must be `https://` too, because browsers block plain-http requests from secure pages. Serve both the same way.
- **Another host or port.** Jellyfin allows cross-origin API calls, so Argent can be on a different host or port than the server.
- **A sub-path.** To serve it under a path such as `/argent/`, build with `npx vite build --base=/argent/`.
- **Updating.** Download the new source, build again and replace `dist/` (keep your `argent.config.json`).

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
  platform/       Desktop/mobile/TV detection, D-pad spatial navigation, app bridges
  layouts/        Shell with per-platform navigation
  features/
    mediabar/         MediaBar: config model, pure logic, data loading, trailers, UI
    recommendations/  engine/ (pure, tested), data loading, feedback, React hook
    home/ library/ details/ search/ player/ profile/
docs/             Architecture and recommendation engine notes
electron/         Windows desktop app shell (window, tray, updates)
android/          Android TV and phone app shell (WebView)
scripts/          Icon rendering, Android packaging
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.

## Credits and licences

- Jellyfin logo: © Jellyfin contributors, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), from [jellyfin-ux](https://github.com/jellyfin/jellyfin-ux). Argent's silver version (`public/jellyfin-silver.svg`, `src/components/JellyfinLogo.tsx`) is an adaptation under the same licence.
- MediaBar behaviour is modelled on the Jellyfin Media Bar by **MakD** (with IAmParadox27 & M0RPH3US), which builds on work by BobHasNoSoul, SethBacon and TedHinklater.
- Fonts: Inter and Inter Tight (SIL OFL), loaded from Google Fonts.
- Subtitle rendering: [JASSUB](https://github.com/ThaUnknown/jassub) and libass (LGPL-2.1+ and others; see the package's licence), used unmodified as a separate, dynamically loaded module.

## Building from source

### Development

Requirements: Node 20+ and a Jellyfin 10.10+ server (developed against 10.11.6).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # recommendation engine, MediaBar, ratings, watchlist and other logic
npm run build      # type-check and build to dist/
```

### Desktop app (Windows)

Argent also runs as its own desktop app: an Electron shell around the same build, with the silver mark as its icon, a dark integrated title bar and a modern engine that plays H.264, HEVC and AV1.

```bash
npm run desktop        # build and open the app
npm run desktop:dev    # open the app against the running dev server (npm run dev)
npm run desktop:pack   # build release/Argent-Setup-<version>.exe (per-user installer)
npm run icons          # regenerate the desktop and Android icons from the logo
```

The installer adds Start menu and desktop shortcuts named Argent. Keys: F11 toggles full screen, Ctrl+R reloads, Ctrl+Shift+I opens developer tools.

Desktop-only features, set in Profile → Settings → Desktop app:

- **Automatic updates.** The installed app checks the GitHub releases of `VexyEclipse/Argent` every six hours, downloads new versions in the background and installs them on quit (or straight away with "Restart now"). Publish a release with `GH_TOKEN=<token> npm run desktop:release`, which uploads the installer and the `latest.yml` the updater reads. The repository's releases must be public for installed apps to see them.
- **mpv.** Play in mpv instead of the app's own player, when mpv is installed (Argent looks in the usual places, or choose mpv.exe).
- **System tray.** What's playing, play/pause and next/previous episode, and "Check for updates". Optionally keep Argent running in the tray when the window is closed (playback pauses).

The web libraries are bundled into `dist/` by Vite, so they're listed as dev dependencies; `dependencies` holds only what the Electron shell needs at runtime (`electron-updater`), which keeps the installer small.

### Android app (TV and phone)

`android/` is a small native app: the built `dist/` is bundled into the APK and shown in a full-screen WebView, served as `http://localhost` straight from the APK. Being plain http (but still a secure context) lets it show images and video from http servers on the home network, which an https page could not. One APK covers Android TV, Google TV, Fire TV, phones and tablets. On a TV it adds `ArgentTV` to the user agent so the web app picks the TV interface. The remote's Back button is passed to the page as Escape, which closes whatever is open and otherwise goes back a page; on the home screen it closes the app (`window.argentAndroid.exit()`, see `src/platform/android.ts`).

Requirements: [Android Studio](https://developer.android.com/studio), or JDK 17–24 with the Android SDK command-line tools (with `platforms;android-36` and `build-tools;35.0.0` installed, and `ANDROID_HOME` or `android/local.properties` pointing at the SDK). Gradle downloads itself on the first build.

```bash
npm run android:pack   # build dist/, then release/Argent-<version>.apk
```

Or open `android/` in Android Studio and run it on a TV emulator or device (run `npm run build` first, since the app bundles `dist/`). The version comes from `package.json`.

**Signing.** Android only installs an update signed with the same key as the installed version. To sign releases with your own key, create one once:

```bash
keytool -genkeypair -v -keystore android/argent.jks -alias argent -keyalg RSA -keysize 4096 -validity 10000
```

and add `android/keystore.properties` (both files are ignored by git, so keep a backup):

```properties
storeFile=argent.jks
storePassword=<password>
keyAlias=argent
keyPassword=<password>
```

Without it, release builds are signed with your machine's debug key, which is fine for trying it on your own TV.

Attach the APK to the same GitHub release as the desktop installer. The Android app checks the latest release every six hours and offers the new APK; it downloads it and hands it to Android's installer, which asks to confirm (and, the first time, for permission to install apps). Updates must be signed with the same key as the installed version.

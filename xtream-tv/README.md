# Xtream Samsung TV build

This is the maintained source for the customised Samsung Jellyfin app. Version 0.1.5 targets the UA50AU7000 running Tizen 6.0 / Chromium 76. The server's shared theme and plugins are not edited by this build.

The `tv-customizations` folder contains the local plugin/theme sources, bundled fonts and TV adapters. The build converts CSS and JavaScript for the TV, keeps Bonfire and the other plugins, and verifies that the original web assets are unchanged. TV adapters correct the profile layout, replace square outlines with rounded theme focus, size banner artwork for the app's viewport, defer banner initialization while the Bonfire gate covers it, and pause/resume existing hidden playback without changing the user's Pause preference.

## Build and check

From the `jellyfin-tizen` project:

```powershell
npm run build:xtream-tv
npm run check:xtream-tv
```

The custom build reads the project's existing `.buildResult` as its base and writes `xtream-tv/jellyfin-tv-custom-build`. Refresh that base through the project's standard web/Tizen build when updating Jellyfin itself. It is never overwritten by the custom build.

Build tooling defaults to the adjacent `jellyfin-tizen.build-deps/jellyfin-web` project. Set `JELLYFIN_WEB_PROJECT` to use another checkout with the Babel, PostCSS, esbuild and core-js dependencies installed. The additional Intl polyfill dependencies are pinned in `tv-polyfill-deps/package-lock.json`; restore them with `npm ci --prefix xtream-tv/tv-polyfill-deps` when setting up another computer.

## Sign and update the TV

Use the existing Samsung `JellyfinTV` signing profile and the same app ID `AprZAARz4r.Jellyfin`. Package the custom staging directory, then install the signed package as an update. The SDK's signing profile and certificates stay outside this source directory.

```powershell
tizen package -t wgt -s JellyfinTV -o <output-directory> -- <project>/xtream-tv/jellyfin-tv-custom-build
tizen install -n Jellyfin.wgt -t UA50AU7000KXXA -- <output-directory>
```

The compatibility and lifecycle checks exercise plugin loading, endpoint routing, CSS conversion, bundled fonts, focused relational rules, hidden timer guards, automatic pause/resume, preservation of manual pause and artwork sizing. They do not establish physical remote-to-screen latency; that also needs testing on the TV.

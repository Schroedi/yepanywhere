# Android WebView system theme validation

The host wizard's Auto appearance followed its fixed light Android theme.
The companion's web UI followed its fixed dark Android theme, even though its
native Compose host management already followed the system. Both shells now
provide a day/night-qualified `android:isLightTheme` value to WebView.
The companion qualifies the public attribute for API 29+, retaining its
existing pre-Android-10 theme. No JavaScript bridge or forced page darkening
is needed.

## Pixel 7a acceptance

Physical Android 17 / WebView 154 checks passed:

- Host Auto rendered dark, light and dark again through actual system theme
  changes while the app remained running. Its ordinary Activity recreation
  remounted the authenticated local page each time.
- In each system mode, explicit Light, Dark and Very Dark retained their
  requested colors. The twelve observations covered the actual media query,
  selected `data-theme` and computed body background.
- Full-device captures of the shared onboarding wizard showed Auto selected
  with the appropriate light/dark palette, readable controls and no horizontal
  overflow. Native toolbar and system-bar styling remained independent.
- Companion `webColorSchemeMatchesSystemAfterRecreation` and
  `darkNativeSystemBarsKeepLightIconsAfterRecreation` passed in both system
  modes. Each two-test instrumentation run took about 2.3 seconds. The new
  regression compares both media-query results with Android configuration,
  before and after Activity recreation.
- The original system mode and saved YA appearance preference were restored.

The host observation used the debug WebView's CDP endpoint with
`page.emulateMedia({ colorScheme: null })`. Playwright's default light media
emulation otherwise masks the native preference and gives a false failure.
Visual evidence used the actual phone display rather than a desktop browser,
which cannot exercise this Android theme boundary. Captures and device
selectors remain private under the host package's ignored `.local/` directory.

## Other checks

Both Android apps built and passed lint; companion JVM unit tests passed.
Host Debug/Release builds and the shared Alpine smoke passed, including
authenticated API access, frontend serving, SQLite and restart persistence.
Root lint, formatter verification, typechecking and the full workspace tests
passed. An initial full run hit the existing file-completion inventory test's
30-second timeout; its focused rerun passed, followed by a passing full run.

The native behavior was validated on Android only. Linux, macOS and Windows
native clients were not changed or qualified by these phone checks.

# Mobile store preparation

Initial store assets reuse the existing green Y identity. The English copy in
[`listing.en-US.txt`](listing.en-US.txt) is shared across stores; keep claims
consistent with the shipped build. Private console identifiers, developer
account details, credentials and signing configuration belong in the private
dotfiles runbooks, not here.

## Reusable assets

| Asset | Source / dimensions |
| --- | --- |
| Apple app icon | [`packages/ios/App/Assets.xcassets/AppIcon.appiconset/icon.png`](../../../packages/ios/App/Assets.xcassets/AppIcon.appiconset/icon.png), 1024 × 1024 opaque PNG, bundled in the app |
| Google Play icon | [`packages/android/artwork/play-store-icon.png`](../../../packages/android/artwork/play-store-icon.png), 512 × 512 PNG |
| Google Play feature graphic | [`feature-graphic.png`](feature-graphic.png), 1024 × 500 opaque PNG; editable [`SVG`](feature-graphic.svg) |

Regenerate the feature graphic with librsvg and ImageMagick:

```sh
rsvg-convert docs/distribution/mobile/feature-graphic.svg \
  -o docs/distribution/mobile/feature-graphic.png
magick docs/distribution/mobile/feature-graphic.png -alpha off \
  PNG24:docs/distribution/mobile/feature-graphic.png
```

The graphic is branding, not a simulated app screenshot. Capture actual native
apps against owned sample hosts for store screenshots; do not resize unrelated
browser screenshots or expose real projects, credentials or notification tokens.
Use the console's current accepted device sizes, including iPad for the
universal iOS app. Real screenshot capture remains a later listing task.
See [Google's preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151)
and [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/).

## Initial internal distribution

As of October 3, 2026, both store draft records exist. Apple has saved initial
metadata and an internal TestFlight group. Google Play has saved the English
listing text, app icon and feature graphic as a draft, plus a dedicated internal
tester list. No signed build has been uploaded or internal release activated.
Google Play category and contact settings remain open; Developer Tools is saved
on Apple. Console links and account-specific inventory live in private dotfiles.

A full public listing is not the first internal-testing prerequisite.
[Google permits internal testing before completing app setup](https://support.google.com/googleplay/android-developer/answer/9845334).
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
requires an uploaded, processed build and testers; external testing introduces
additional review requirements. Initial draft records and artwork do not mean
either app is installable through a store.

Prepare signed production-channel artifacts with matching application IDs,
increasing build numbers, bundled Firebase configuration and reviewed export
compliance. The existing CI verifies apps but does not upload signed mobile
artifacts. Production APNs configuration is separate from the proven sandbox
key; Debug delivery cannot prove TestFlight delivery.

Before broader distribution, finish real screenshots, privacy/data-safety
disclosures (including optional native Firebase/broker push), age/content
ratings, review access to an owned sample server, pricing and availability.
Do not mark encryption absent merely because transport uses standard crypto:
the shared Rust core uses SRP and libsodium outside OS-only TLS. Resolve the
applicable declaration/documentation before distributing a build.

Keep initial releases internal. App Store review submission and public Play
rollout are separate actions from preparing draft records and internal tracks.

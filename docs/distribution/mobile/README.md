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
tester list. The first local upload artifacts are built from committed source:
Android 0.1.0 / version code 1000 is active and available to the selected
internal testers; its opt-in page was verified with the maintainer account.
On October 4, the first installed Android release exposed a UI-initiated TLS
login failure: the OS verifier attempted certificate revocation network work
on Main before SRP started. Android 0.1.1 / version code 1001 moves native
connection setup to IO without relaxing certificate verification. Its signed
bundle from committed source is now published to the existing internal track;
Google Play shows **Available to internal testers** with 1001 as the latest
release. Physical acceptance covers Main-initiated public TLS relay login,
the bundled WebView, and a separate isolated package built with production
Release shrinking rules. The earlier background/plaintext probes missed this.
The updated Google Play-signed installation still needs a login retest.
iOS 0.1.0 / build 1 uploaded through Xcode's TestFlight Internal Only flow and
now shows **Ready to Test** after saving the encryption questionnaire with
France excluded. iOS tester enrollment remains open.
Google Play category and contact settings remain open; Developer Tools is saved
on Apple. Console links and account-specific inventory live in private dotfiles.

A full public listing is not the first internal-testing prerequisite.
[Google permits internal testing before completing app setup](https://support.google.com/googleplay/android-developer/answer/9845334).
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
requires an uploaded, processed build and testers; external testing introduces
additional review requirements. A saved draft or processed upload alone does
not make a build installable; the testing track and tester enrollment must also
be active.

### Local upload path

The maintainer selected platform-managed distribution signing on October 3.
Initial uploads are local; release CI automation is a later step, while existing
CI continues to verify the apps. Keep upload preparation separate from public
rollout and use a clean, committed source snapshot.

For Android, build the bundled Release AAB with the existing native/core and
frontend preparation. Sign the bundle with a dedicated upload key, then let
Google generate and retain the app signing key when configuring Play App
Signing. The upload key authenticates submissions; its certificate is not the
certificate Google uses for installed apps. Do not register the upload-key
fingerprint as the production password-manager association.

```sh
node packages/mobile-core/scripts/run.mjs android
pnpm --filter @yep-anywhere/android prepare-frontend
cd packages/android
./gradlew :app:bundleBundledRelease
jarsigner -keystore "$YA_UPLOAD_KEYSTORE" \
  -storepass:env YA_UPLOAD_STORE_PASSWORD \
  -keypass:env YA_UPLOAD_KEY_PASSWORD \
  -signedjar app/build/outputs/bundle/bundledRelease/yepanywhere-upload.aab \
  app/build/outputs/bundle/bundledRelease/app-bundled-release.aab upload
jarsigner -verify app/build/outputs/bundle/bundledRelease/yepanywhere-upload.aab
```

Provide the SDK/JDK environment and upload passwords privately; never place
passwords in command-line arguments, tracked Gradle properties or build logs.
Verify the AAB's signer against the upload certificate and retain its source
commit, version code and SHA-256 alongside the artifact. Upload the signed AAB
to the internal track; subsequent uploads need increasing version codes.
See [Google's signing guide](https://developer.android.com/studio/publish/app-signing).

For iOS, prepare the generated project and device Rust library, then archive
locally using the existing Apple Development identity and automatic
provisioning. Set the team through ignored `Config/Signing.xcconfig` or the
command environment. The archive is an input to distribution; the existing
unsigned CI device build is not an uploadable IPA.

```sh
node packages/ios/scripts/run.mjs prepare
node packages/mobile-core/scripts/run.mjs build
cd packages/ios
xcodebuild -project YepAnywhere.xcodeproj -scheme YepAnywhere \
  -configuration Release -destination generic/platform=iOS \
  -archivePath build/YepAnywhere.xcarchive \
  -onlyUsePackageVersionsFromResolvedFile -allowProvisioningUpdates \
  "DEVELOPMENT_TEAM=$YA_APPLE_TEAM" archive
open build/YepAnywhere.xcarchive
```

Use Xcode Organizer's **Distribute App → TestFlight Internal Only** for the first
internal upload, or **App Store Connect** for a build intended for later review.
Use automatic distribution signing and Apple's cloud-managed certificate. An
App Store Connect API key authenticates uploads; it is not an app signing key.
Do not copy JSTorrent's manual certificate/profile or its AltStore notarization
pipeline for this path. See [Apple's cloud signing guidance](https://developer.apple.com/help/account/certificates/cloud-managed-certificates).

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

### Apple encryption declaration

The October 3 questionnaire uses the standard-encryption-outside-Apple-OS option:
the shared core implements SRP with SHA-512 and libsodium secretbox
(XSalsa20-Poly1305), in addition to TLS. These are published cryptographic
algorithms; the app must not be declared OS-only or encryption-free.
[Apple's overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
distinguishes proprietary/unpublished cryptography from published algorithms.

The maintainer deferred France on October 3. App Store availability is saved
for 174 countries or regions, with France **Not Available** and automatic
availability in future countries disabled. The build questionnaire retains the
standard-encryption option and answers **No** to France distribution; Apple
required no attachment and the build now shows **Ready to Test**. No Info.plist
encryption setting was changed.

**Deferred to-do — enable France:** clarify with ANSSI whether this app requires
a declaration or qualifies for an exemption, complete any required filing, and
obtain the documentation Apple accepts before enabling France and revisiting
the questionnaire. Apple's
[documentation matrix](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption)
explains the French documentation gate. The unsigned technical draft is retained
in private dotfiles; it is not an approval form and has not been filed or
uploaded. Private filing details and console inventory belong in that runbook.
Keep France excluded when configuring broader Android distribution as well.

Keep initial releases internal. App Store review submission and public Play
rollout are separate actions from preparing draft records and internal tracks.

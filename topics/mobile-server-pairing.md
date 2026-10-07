# Mobile Server Pairing And Native Connection Ownership

> A mobile companion pairs with one logical YA server independently of the
> route used to reach it. Native login and background work use a native secure
> connection core. The bundled web UI is the main foreground; native hands it
> the profile's resume credential, and it connects through the ordinary web
> transport without ever showing a login.

Topic: mobile-server-pairing

Status: Approved architecture direction. This document fixes the product and
ownership boundaries agreed on 2026-08-02 and revised to a WebView-first foreground on 2026-09-30. The unified security-client wire,
continuity-key, audit, revocation, capability, and stable-release compatibility
contract is approved in [`security-client-audit.md`](security-client-audit.md).
On 2026-10-07 the WebView's native data bridge was replaced by the shared
resume credential in
[Bundled Web Client Transport](#bundled-web-client-transport); the bridge
design is kept in
[Retired: native WebView data bridge](#retired-native-webview-data-bridge).

Related:

- [Mobile companion app](../docs/project/mobile-companion-app.md)
- [Android FCM push](android-fcm-push.md)
- [Security clients and authentication audit](security-client-audit.md)
- [Android wrapper and notification integration](../docs/tactical/071-android-wrapper-notification-integration.md)
- [First-class Android shell](../docs/tactical/080-first-class-android-shell.md)
- [Trusted client packaging](trusted-client-packaging.md)
- [Client source runtime topology](client-source-runtime-topology.md)
- [WebSocket auth state](../docs/project/ws-auth-state-model.md)
- [Connection matrix](../docs/project/connection-matrix.md)

## Accepted Product Shape

The ordinary Android app uses the complete bundled web client for projects,
sessions, transcripts, input, tools and settings. Native Compose owns pairing,
login, reauthentication, the saved-server catalog, host selection, removal and
platform notification controls. Native SRP, secure credential storage and the
native connection managers used by native work remain authoritative; the web
client owns its own foreground connection with the credential native hands it.
The duplicate native dashboard and Conversation UI have been removed; they are
no longer release prerequisites or an alternate presentation to maintain.

The initial mobile release supports server-owner login. Native limited-user
sign-in, including separate relay-server and SRP-user identities, is explicitly
deferred by the maintainer on 2026-10-01. Existing web limited-user support
remains available; this is a mobile release-scope decision.

Android's launcher returns to the selected native tab in the bundled web UI.
Without a saved server it shows native pairing. Switching hosts opens native
management; ordinary selection focuses an existing tab for that profile or
creates one. Explicit New tab may duplicate a profile. Host selection never
modifies another host's credentials, and web code does not maintain a second
paired-host catalog.

Switch Host disconnects the foreground consumer without signing out the saved
server. Returning to management during resume must not turn a temporarily absent
on-disk credential into a persistent sign-in warning. While the source is
connecting or retrying, management reports that connection state; after it stops,
management recomputes credential availability. A restored valid credential shows
an idle saved host and reopens without a password. Missing or expired credentials
require reauthentication; revocation always wins. Management observes these
changes without acquiring a connection or background subscription.

Android's WebView container owns system-bar and display-cutout spacing once,
including side cutouts in landscape. It forwards zero for those handled insets
to web CSS while continuing to deliver keyboard inset changes. Opening, closing,
or recreating the view must not retain duplicate or stale safe-area padding.
The shared web client's safe-area rules remain available to browsers and PWAs;
Android does not override those rules globally.

Native background work cannot depend on the WebView. The native connection core
must support Compose and an explicitly enabled foreground activity
service without allocating a WebView or JavaScript runtime. Native FCM receipt
continues to remain independent of either foreground presentation.

The bundled web client is trusted application code when its assets are inside
the signed APK and served through Android's app-assets HTTPS origin. It does
not inherit ordinary Chrome extensions, and its integrity follows the APK's
signing and update path. The separately built hosted-`latest` channel remains a
weaker, mutable-code testing channel and does not inherit bundled-code trust
merely because the same Android shell displays it.

## Identity And Credential Layers

Do not collapse these concepts into one `deviceId`, browser profile, or push
record:

| Concept | Meaning | Secret? | Lifetime owner |
| --- | --- | --- | --- |
| Local paired-server id | App-generated key for one saved server relationship; it has no server-authentication meaning | No | Native mobile app |
| Paired server profile | Phone-side record for one trusted YA server | Contains secret children | Native mobile app |
| Paired device | Server-side durable record for one mobile installation | Contains credential handles and revocation state | YA server |
| SRP resume credential | `sessionId` plus shared base key proving a previous SRP login | Yes, bearer-equivalent | One client/server auth session |
| Transport key | Per-WebSocket key derived from the resume/base key and fresh server nonce | Yes | One live connection |
| Route candidate | Relay or direct location through which the same server may be reached | No credentials | Paired server profile |
| Broker installation | One mobile app installation's FCM target-management capability | Yes | Native app and push broker |
| Device push subscription | One server's ability to request push to one mobile installation | Send secret is secret | Paired device relationship |
| Browser profile | Browser-local label for tabs, origin history, and Web Push | Identifier is not auth | Browser profile and YA UI |

The existing `browserProfileId` is generated in browser `localStorage` and is
client-asserted metadata. It is not proof of device identity and must not
become the native pairing credential. The current Devices UI and browser
profile deletion also do not provide the cascading auth and push revocation
required for a paired mobile device.

## Pairing Versus General Authentication

General authentication and device pairing are separate but connected:

1. Existing SRP username/password authentication proves that the user may add
   the device to a YA server.
2. Successful enrollment creates a durable paired-device relationship with a
   server-generated opaque device id, user-visible label, platform metadata,
   creation/last-seen timestamps, and revocation state.
3. Expiring connection credentials and optional push subscriptions belong to
   that relationship.
4. Disabling push removes only the push child. Forgetting the device revokes
   all connection credentials and push subscriptions associated with it.

This is not a new multi-user account system. YA remains single-user oriented;
the separation exists so authentication sessions can expire or rotate without
silently deleting notification preferences and so one lost phone can be
revoked without changing the server-wide password.

A paired-device record is not itself authorization merely because it has an id.
Every operation that creates, changes, or uses it still needs proof from the
appropriate authenticated connection or device credential. Exact credential
types and grant rules remain protocol-design work.

## Deferred Installation Identity And Route Continuity

A public or fingerprinted YA installation id is not required for native
pairing and is explicitly deferred. Do not add an Android-specific identity,
expose the relay-ownership `installId`, populate `SavedHost.serverInstanceId`,
or add a server-proof field merely to label an installation.

The Android app assigns its own local id to each paired-server profile. While
an SRP resume credential is valid, successful resume already proves that an
endpoint possesses that profile's shared base key and live server-side session.
The app may therefore attach a direct or relay route candidate to the local
profile only after the candidate completes resume and returns a valid,
challenge-bound server proof. Acceptance through both routes is sufficient
continuity evidence for that credential's lifetime.

If resume is missing, expired, evicted, or lost after a server restart, Android
must not automatically merge a discovered or newly entered endpoint into an
existing profile. The user explicitly selects the profile or creates a new one,
enters the SRP password, and confirms the route. Full SRP authenticates that
endpoint but does not claim that two independent installations using the same
credentials are one installation.

A future durable paired-device credential may extend route continuity beyond
the current resume-session lifetime. That is part of paired-device enrollment
and revocation, not a global public server-identity contract.

The server may later keep a high-entropy installation secret or id entirely for
its own persistence, token binding, or diagnostics. If it ever exposes a hash
or fingerprint of that value, the fingerprint is itself a public identifier
and requires a separately motivated compatibility and migration review. The
existing web `SavedHost.serverInstanceId` seam remains unused for now, and no
route-scoped web caches or saved hosts are automatically merged.

## Current SRP Resume Facts

Current full SRP derives a 32-byte base session key. The client stores that key
with a `sessionId`; the server stores the same base key. Resume proves
possession of the unchanged base key using a one-time server challenge. Both
sides derive a fresh per-connection transport key from the base key and server
nonce.

The current implementations discard that transport nonce after derivation.
Security-client proof requires both server and Android to retain the plaintext
nonce for the authenticated connection lifetime, then clear it at teardown.
Freshness rather than secrecy is its property; retaining the literal wire value
keeps the signed proof transcript independently auditable.

The fresh transport key prevents ciphertext replay across connection
boundaries. It is not a newly minted short-lived authentication session and it
has no time TTL; it lives until that WebSocket connection ends. The underlying
resume credential currently has:

- a seven-day sliding idle expiry, refreshed by successful resume;
- a thirty-day absolute lifetime from full SRP login;
- a maximum of five active sessions per username, with the oldest evicted when
  full SRP creates another; and
- in-memory-only server storage by default, so a server restart invalidates it
  unless remote-session persistence is explicitly enabled.

These limits make the resume session a credential under the durable pairing,
not the durable pairing itself. If it expires, the paired device remains a
known device but must reauthenticate before reconnecting. Pairing work may
later change credential lifetime, rotation, or device binding, but it must do
so explicitly rather than retroactively redefining the current SRP resume
contract.

## Native Paired-Server Storage

Android should keep one app-private profile per paired YA server. Conceptual
state includes:

- app-generated local profile id and a display label derived from the SRP
  username;
- opaque server-issued security-client id, continuity-key alias, and revoked
  state;
- SRP username and current native resume credential;
- explicit relay configuration and direct route candidates;
- last successful route and connection timestamps;
- broker subscription mapping and safe notification destination; and
- local revocation or reauthentication state.

Non-secret metadata can use app-private DataStore. Passwords are used only for
the visible SRP login and are not persisted. Resume base keys and broker
capabilities are encrypted under Android Keystore-backed keys and excluded
from backup/device transfer. The iOS shell applies this ownership model with Keychain-backed storage.

The native store is independent of browser `localStorage`. Native Compose and
background operation must never require a WebView profile to exist.

### Android storage contract

Android persists versioned, non-secret paired-server metadata in one
Preferences DataStore. Each resume credential is serialized separately and
encrypted with AES-256-GCM under an app-owned Android Keystore key. The local
profile id is authenticated as additional data, so an encrypted credential
cannot be reassigned to a different profile. Neither the SRP password nor a
plaintext resume session id or base key is written to app storage.

The current Android manifest excludes all app domains from cloud backup and
device transfer. Process restart reopens the same DataStore and Keystore key.
Missing keys, malformed ciphertext, profile/credential username mismatch, and
explicit resume rejection all make the profile require visible SRP
reauthentication; they do not delete the paired-server metadata. Forgetting a
profile atomically removes its metadata, encrypted credential, and selection.

The existing paired-server codec is strict schema v1, but no Android build has
been released. Security-client registration bumps development storage to v2
without a v1 migration. Existing Pixel/AVD profiles are disposable and must be
cleared and paired again; migration compatibility begins only once distributed
builds create user-owned state. V2 adds the continuity-key alias, pending
idempotent registration request id, server-issued client id, and local revoked
state. A successful full-SRP `pair()` performs initial registration on that
still-open authenticated connection before closing it and committing the
profile, so server security settings can show the phone immediately. A lost registration
response reuses the pending request id and same key rather than prompting for
the password again.

Android uses the current seven-day idle and thirty-day absolute server limits
as a conservative local eligibility check before resume. The server remains
authoritative: restart, explicit logout, password change, session eviction, or
future policy may invalidate the credential sooner. A successful resume must
advance the stored last-resumed timestamp.

## Kotlin Connection Core

The Android-native core owns, per paired server:

- full SRP and resume negotiation;
- base-credential access and per-connection key derivation;
- relay and direct secure WebSocket establishment;
- encrypted request/response multiplexing and subscriptions;
- connection state, wake checks, bounded reconnect, and route selection;
- typed repositories used by Compose; and
- deterministic cancellation and teardown.

The intended ownership is:

```text
Compose UI ------------------+
Foreground activity service -+--> Kotlin connection core --> YA server
Notification-open refresh ---+
```

The core is not itself an always-running service. A visible Compose surface or
explicit foreground service owns live demand. When no owner requires a
connection, sockets, subscriptions, heartbeats, retry timers, and discovery
work quiesce. FCM receipt alone does not start the foreground activity service
or a persistent YA connection.

### Android connection ownership contract

The Android application owns at most one connection manager for each local
paired-server profile. UI and future service consumers acquire explicit
leases. Leases share one authenticated socket, while each request and
subscription remains attributable to its owning lease. Releasing one lease
closes only its subscriptions. Releasing the final lease cancels the socket,
pending requests, subscription work, and any retry delay, and returns the
manager to idle.

Requests use the existing encrypted `request`/`response` protocol and are
never replayed automatically after a disconnect. Live subscriptions use the
existing `subscribe`/`event`/`unsubscribe` protocol, remember their most recent
event id, and are restored after a successful reconnect. Native inbound and
per-subscription queues are bounded; a consumer that falls behind loses that
subscription instead of growing process memory without limit.

While a lease exists, an unexpected disconnect gets three bounded retries
after 250 ms, 1 second, and 3 seconds. The manager has no recurring retry or
heartbeat of its own. A new explicit request after a terminal failure may
start a new bounded cycle; no work restarts after the final lease is gone.

Routes are tried in deterministic order: the last successful/preferred route,
then remaining direct routes, then remaining legacy relay routes. Every
automatic candidate must prove the saved SRP resume credential. A successful
fallback becomes preferred. Eligible relay routes use the native relay-mux runtime described below,
with exact legacy fallback when the relay does not support mux. Direct routes
remain ordinary secure WebSockets.

If every reachable route rejects resume, Android deletes only the encrypted
credential and requires visible SRP login. Network failure does not silently
become password authentication, and a failed request is not rerouted or
replayed. Full SRP onboarding targets exactly the route the user entered and
persists a profile only after the authenticated server proof succeeds.

Native management consumes profile/connection state; notification and optional
foreground work consume domain-facing repositories. The raw multiplexed protocol remains internal
transport plumbing rather than becoming the UI's permanent data model.

### Native login and host-management contract

The launcher opens the bundled web UI for a saved selected profile, or native
pairing when no profiles exist. A native host-management request prevents that
automatic launch so the user can select, add, reauthenticate or remove a host.
Native management observes stored profiles and connection status without
acquiring activity or session-list subscriptions. Only explicit authentication,
selection or server revocation actions acquire connection demand.

The default native onboarding surface asks only for the remote-access username
and password. It matches the web relay login by using
`wss://relay.yepanywhere.com/ws` when no custom relay is supplied and by using
the normalized lowercase username as both relay target and SRP identity. The
username also becomes the local profile's display label; onboarding does not
ask for a second name.

An advanced disclosure permits an explicit custom relay WebSocket URL or an
exact direct WebSocket URL. Explicitly entered endpoints remain authoritative:
onboarding does not probe or silently replace them. This default affects only
new pairings and does not change any saved profile's route or preferred-route
history. The password is held only in the visible field and full-login attempt,
cleared from Compose state on submission, and never placed in saved instance
state, a ViewModel field, DataStore, or the web bridge. A profile is persisted
only after the authenticated server proof succeeds.

Native management selects, adds, reauthenticates and removes saved profiles.
Removing a registered device first attempts server revocation and then local
credential/key deletion; an explicit Forget anyway confirmation handles an
unreachable server. A rejected or expired resume keeps the non-secret profile
visible and offers full SRP reauthentication. Selection opens the complete web
app, which connects with the profile's resume credential
([Bundled Web Client Transport](#bundled-web-client-transport)).

Native management does not acquire summary/activity leases, and opening a
document acquires none: the document reads the stored credential and owns its
own connection. Backgrounding and host management keep the selected document;
document navigation/destruction retires its control channel. This does not
start or emulate the separately reviewed foreground activity service.

Password-bearing App Links are parsed by Android into transient visible UI
state, cleared from the Intent, and never forwarded as web URLs/fragments.
Submission clears the prefill before the native login attempt. No password is
saved in a ViewModel, instance state or profile. A WebView without the native
control channel cannot receive its credential and shows a native
unavailable/back surface rather than falling through to browser login.

### Native secure-transport checkpoint

The initial Kotlin connection foundation proved the existing contract without
adding a server route or involving the relay. A disposable YA server can expose
the existing `/api/ws` route on host loopback, accept full SRP, authenticate its
server-info proof, exchange binary secretbox protocol frames, close, and accept
challenge-bound resume on a second socket. `RelayClientService` does not need
to run, and no relay registration is required. The current server configuration
still stores the SRP identity beside relay-shaped configuration; decoupling that
storage is product follow-up, not a prerequisite for direct negotiation.

The selected Android foundation is:

- Nimbus SRP6a 2.1.0 with the fixed YA 2048-bit/SHA-512 profile;
- LazySodium Android 5.2.0 and the JNA 5.17.0 Android AAR for TweetNaCl-
  compatible XSalsa20-Poly1305 secretbox;
- OkHttp 4.12.0 for WebSocket ownership; and
- Kotlin coroutines 1.9.0 for cancellable suspension.

`YaNativeSecureConnection` is deliberately a bounded protocol probe, not the
finished connection manager. It keeps the password only inside a full-login
attempt, verifies Nimbus `M2` and the encrypted YA server proof before accepting
a resume credential, derives a fresh transport key per socket, sends encrypted
capabilities and ping, validates the sequenced encrypted pong, and returns only
after the normal WebSocket close handshake. Resume credentials defensively copy
their base key rather than exposing a mutable byte array. Attempt-local raw SRP,
base, transport, and copied resume-key buffers are cleared when their use ends
where the underlying libraries expose those bytes.

The checked-in fixture is generated by the production TypeScript SRP,
secretbox, key-derivation, and binary-framing libraries. Android JVM/device
tests must continue to match it byte for byte, and Android CI regenerates it
when Android, shared framing, or server crypto code changes. This checkpoint
does not yet persist credentials, reconnect, select routes, expose repositories,
or run a foreground service.

## Multiple Native Hosts And Selection

One paired profile is one logical source with its own username, routes, resume
credential, security-client binding, connection manager, SRP/NaCl state,
readiness, retry, and revocation lifecycle. The process runtime may keep several
such sources active concurrently when Compose, notification aggregation or
foreground work holds demand for them.

The selected profile is presentation state, not connection ownership. Changing
the visible host must not disconnect another profile that still has a lease,
and one host's offline, reauthentication, revocation, or retry state must not
block healthy peers. Adding or forgetting a profile changes the native host
catalog; forgetting also releases its native demand and destroys its protected
credentials and continuity key as already specified.

Relay mux is an optimization below those source boundaries. A native pool is
keyed by normalized relay base, discovers `client-mux-v1`, and may provide one
logical circuit to each independently authenticated profile. Direct profiles,
old relays, failed mux discovery, and overflow retain ordinary independent
sockets. A physical mux failure fans out a reconnect signal, but each profile
still reports and recovers its own logical state.

Android considers even one demanded relay profile eligible for mux when the
relay advertises `client-mux-v1`. A profile uses one logical source connection
for its native traffic rather than opening a second dedicated relay socket; the
source and connection-manager APIs must not expose the physical policy. The
bundled document's own web connection uses the web client's relay mux pool,
which shares sockets only within that document.

## Bundled Web Client Transport

Opening the bundled full web client from an already authenticated native
profile never presents another login. Native hands the document the profile's
existing SRP resume credential over the control plane, and the document
connects through the ordinary web secure transport, resuming that same server
session. The maintainer chose this on 2026-10-07 to replace the native data
bridge ([retired record](#retired-native-webview-data-bridge)). The connection
is the code browsers use: relay or direct `SecureConnection` with its reconnect
manager, registered in the source runtime under `native:<profileId>`, so drafts
and caches keyed by source carry over.

The handoff has three control-plane operations:

- `session.credential` returns the profile id and label, the SRP username,
  session id, base session key and resume protocol version, and the routes in
  native's order: the preferred route, then direct before relay. The document
  tries them in order. An unreachable route falls through, and the credential
  counts as rejected only when no route succeeded and at least one reachable
  route rejected it. Network failure never becomes reauthentication.
- `session.reauthenticate` reports a rejected session id. Native answers with
  its current credential when that is already a different session. Otherwise
  native's own resume decides: if it is also rejected, native opens its sign-in
  and answers once sign-in stores a new credential. If native still accepts the
  session the document saw rejected, the document waits for a recovery signal
  instead of retrying in a loop. The document never shows a web login.
- `host.switch` opens native host management.

Native answers from its stored credential, which it rewrites after every
verified resume. A request arriving during a native resume waits for it to
settle, because native clears the stored copy while a resume is in flight. The
document holds the credential in memory only, never writes it to web storage,
and requests it again on every document boot. All Android tabs share one
WebView origin, so a persisted web credential would collide across profiles.

Only signed bundled code bound to a profile receives these operations. Android
installs the control channel for hosted-`latest` documents too, so the bundled
check is made where the operations are installed, not by the channel's
existence. iOS accepts control messages only from the bundled origin. Mutable
hosted-`latest` content and debug URL overrides keep their own web login.

Security review: the bundled assets are signed application code (see Accepted
Product Shape). A password saved in the WebView would grant full SRP login,
which is strictly stronger than an expiring resume credential, so copying the
credential crosses no new boundary. It carries the same script-injection
exposure every browser login already accepts. The server needs no change:
resume is a per-connection challenge proof against the stored session key, and
concurrent connections already share one session from browser tabs. Sharing
consumes no second per-user session slot, and activity on either side refreshes
the idle expiry.

The server sees the document as an ordinary browser connection on the native
session. Per-connection device-key verification applies to native's own
connections, not the document's, and the document appears among connected
browsers. Revoking the device invalidates the session, which the document sees
as a rejected resume.

Native keeps its own connection for push enrollment, notification-open refresh,
host management and foreground work, so native background work still never
depends on a WebView. iOS resumes natively before showing a document to verify
the credential, register the installation and resolve push routes, then
releases that session. Android opens documents without a native resume.

`window.yaNative` is the only native channel the document uses; it carries
small JSON operations under a 16 KiB request limit, and no application traffic.
Requests, subscriptions, uploads, downloads and media use the web transport's
normal paths. The bundled Android page is HTTPS and opens its own server
socket, so release builds reach servers over `wss`; they forbid cleartext
entirely. Debug builds allow mixed content so instrumented probes can reach
disposable `ws://` servers.

Ordinary Android background/foreground transitions, including a platform file
chooser, retain the selected WebView, JavaScript heap, DOM, draft and scroll
state. The document's own connection recovers through the web transport's
visibility and network recovery; pending requests fail cleanly and existing
streams recover. Local draft storage remains the web draft owner.

### Android native tabs and launcher lifetime

One launcher Activity owns host management and native tabs. Reopening from the
launcher or recents must not navigate to Projects, show a login sheet, or reload
a healthy retained document. Orientation/window-size changes preserve it too.
Android may kill the process or renderer: this fallback restores the selected
profile and safe route with a fresh document, not a promised JavaScript snapshot.
Persistent tab records contain identity, profile and route paths; they exclude
credential-bearing queries/fragments and credentials. Forgotten profiles lose
their tabs.

A permanent 48dp native toolbar below system/cutout insets shows the host, a
one-tap tab-count picker, and New tab. Picker rows show host, page, selection and
close controls. Merely opening or dismissing the picker preserves the WebView.
New tab chooses a saved host directly or opens native pairing. Ordinary host
selection reuses an existing tab; explicit new tabs may share a profile while
retaining independent navigation. The toolbar is an explicitly approved
2026-10-04 default-visible mobile affordance.

Only the selected tab retains a live WebView. Switching away saves in-memory
navigation history and destroys that tab's document and its connection; switching
back reconstructs it lazily. Background-open tabs have metadata only. There are
at most 32 tabs, with an explicit close-first message at the limit.

Long-pressing an internal YA link offers Open in new tab in the background.
User-initiated new-window internal links open a foreground native tab. Exact
bundled-origin navigation alone qualifies as internal; external HTTPS links
open the system browser, and unsupported schemes remain blocked. A temporary
new-window URL resolver never receives a native bridge. Each tab's document
capability is bound to its original native profile and cannot be rebound to
another host by changing selection.

## Bundled client offline entry and refresh

A saved native profile mounts the bundled page before its network connection is
ready. Cold acquisition and network failure keep Projects/session navigation,
available content and local drafts usable. Failed reads appear within the page;
they must not replace its shell. The top connection bar is exceptional-state
feedback, independent of developer diagnostics, and disappears when healthy.
The first successful activity subscription revalidates reads from cold entry.

The document's connection recovers like any web client: the secure transport
retries a dropped socket itself, and once it gives up, a new acquisition runs on
visible demand, network restoration or a visible 60-second backstop. There is
no hidden retry timer. A rejected resume asks native to reauthenticate and is
distinct from network failure; it does not enter that recovery loop. Recovery
updates the mounted page without a document reload.

Bundled native pages support pull-down refresh beginning at the top of the page
or transcript, including pages that fit without overflow. Release after an
84 CSS-pixel pull reloads the current route; local draft storage retains drafts.
Inputs, nested scrolling, horizontal drags, multitouch and cancelled gestures do
not trigger refresh. The existing upward bottom-edge reload and its session
route restriction are unchanged; mobile browsers supply their own top gesture.

## Retired: native WebView data bridge

From the first-class shells until 2026-10-07, bundled documents held no
credential. Every request, subscription and upload crossed a native data
bridge (`window.yaNativeTransport`, client `NativeSourceTransport`, Android
`YaNativeTransportHost`/`YaWebTransportSession`, iOS `NativeBridge` source
channel) to a lease on the native connection core. Revision `cb0513350` is the
last that contains it; the following commits removed it, then the native upload
path only it used.

It provided three things. The first, no second login, is kept by the
credential handoff. The second, no credential in the WebView, was judged not to
be a real boundary, because a saved password would be stronger. The third, one
relay mux socket shared with native consumers, was given up.

It was retired because it gave documents a second connection state machine
whose reconnect behavior diverged from the web transport. Native transport
failures reached the page as synthetic server 503s before the document learned
of the reconnect (`gaps/android-native-unavailable-fake-503.md`). The bridges
also dropped web subscription fields, such as the live tool-output preference.

Reviving it, if a credential-free WebView becomes a requirement, means restoring
the removed files from that revision plus at least: a typed retryable bridge
error instead of synthetic responses, holding requests while native reconnects,
and forwarding every web subscription field. The two subsections below describe
the bridge as it stood, in their original present tense.

### Former baseline transport

Opening the bundled full web client from an already authenticated Android
profile should not present another login. Its baseline transport is therefore
a `NativeSourceTransport` adapter over a dedicated, exact-origin Android
message channel. The WebView acquires its own lease from the same process-level
Kotlin connection manager used by Compose and foreground work. Requests and
subscriptions receive adapter-local identifiers while Kotlin remains the sole
owner of wire identifiers, SRP credentials, connection capabilities,
encryption, reconnect, and route selection.

The bridge is multi-source even while the first web presentation shows one
host at a time. Native supplies document-scoped opaque source handles for its
paired-profile catalog; every request, subscription, upload, and cancellation
is scoped to one handle. WebView "Switch Host" selects or opens another native
source and changes the client source runtime. It does not enter the browser
login/profile flow. Opening native host management suspends the old WebView
consumer; returning to that tab resumes the same document, while selecting a
cold tab creates its own profile-bound document capability. Unrelated native
demand remains untouched, including a sibling lease on the same source.

This is a logical-consumer boundary, not a new server session or authentication
layer. Compose, a foreground service, and the WebView may make concurrent
requests and hold independent subscriptions on one SRP mux connection.
Releasing or overflowing the WebView lease must clean up only its work and must
not close a connection still demanded by a native consumer.

The existing small `window.yaNative` host remains the bounded control plane for
explicit Android operations such as notification permission. Its 16 KiB
request limit is a YA guard for small JSON commands, not a WebView, WebSocket,
SRP, or file-size limit. Application transport uses a separate channel with
binary messages, fragmentation, cancellation, and byte-based flow control.

Upload behavior preserves the existing relay contract:

- the WebView reads each `File` as a stream and emits the established 64 KiB
  upload chunks rather than materializing the complete file in Kotlin;
- each chunk crosses the bridge as an ArrayBuffer when the installed WebView
  supports it, receives the existing upload id and offset header, is
  independently encrypted, and is written by the server before completion;
- bridge credits and a 512 KiB native socket queue threshold bound resident data and suspend
  the WebView reader when the native or network consumer falls behind; and
- abort, navigation, process teardown, invalid offset, and queue overflow fail
  the one upload or WebView lease without retaining the remaining file.

Chunked does not mean resumable: loss of the authenticated socket discards the
server's connection-owned upload state, so the current upload fails and a user
retry starts again at byte zero. Cross-connection upload resume would require a
separate server contract and is not invented by the WebView adapter.

A 100 MiB upload is consequently 1,600 ordinary 64 KiB data chunks, not one
100 MiB bridge message. Downloads and blob responses use the same bounded
fragment discipline on the local bridge, but the current relay response
contract still base64-encodes a complete binary response inside one JSON
message. Removing that upstream whole-response/base64 cost would be a separate
capability-gated server protocol change. Ordinary response and event JSON can
be larger than one bridge frame and is reassembled by logical message id. A
single encrypted server WebSocket message must still be decrypted as a whole
under the current wire protocol; bridge fragmentation controls queue growth but
does not make JSON parsing incremental. Representative large transcript and
blob responses therefore remain an explicit memory and latency benchmark
rather than being conflated with streaming uploads.

The transport handshake advertises whether ArrayBuffer messages are available.
An older installed WebView may use bounded base64 string chunks as a functional
compatibility path, accepting the usual size and copy overhead; it does not
fall back to exposing credentials. Recent supported WebViews should use binary
messages and avoid that expansion.

The privileged transport channel is available only to signed, bundled
app-assets code and is removed on document/navigation teardown. Mutable
hosted-`latest` content never receives it and continues to authenticate with
its own web-owned session.

### Former implemented bridge contract

`window.yaNativeTransport` is restricted to the bundled app-assets origin and
accepts messages only from its main frame. Hosted-latest and debug URL overrides retain their independent web
login and do not receive the native data plane. The signed client registers a
custom source transport under the native profile id; it receives an opaque
document handle and display metadata, never password, resume material, transport
keys, native installation secrets or server-side authentication session ids.

Protocol 1 frames have a 16-byte header and at most 64 KiB payload. One frame
per direction awaits a matching handle/id/offset acknowledgement. ArrayBuffer
is preferred; an explicit negotiated base64 string fallback has the same
limits. Each direction reassembles one logical message of at most 32 MiB; the
outbound bridge retains at most 32 messages and 64 MiB. Requests are limited to
32 concurrent operations, subscriptions to 64, and uploads to four per consumer.
Wrong-origin and subframe messages are ignored. Stale handles, invalid
kind/sequence/size/offset and queue overflow reject traffic and close only the
document's consumer. No bridge limit is lifted
by changing the separate 16 KiB notification/control-plane guard.

The adapter preserves response headers, status, setup-required errors, same-API
redirects, media, request abort, and session/activity/watch/glossary/worktree
subscriptions. Native generates wire request, subscription and upload ids.
Browser profile metadata is not forwarded as native identity. Native alone
restores subscriptions and owns bounded source reconnect. Speech and device
signaling capabilities are absent until their native adapters are implemented.

Uploads stream at most 100 MiB in 64 KiB chunks, with exact offsets and the
established encrypted binary upload format. Acknowledging a local upload frame
waits for the native socket queue to have room. Cancellation releases only that
upload; the existing server has no cancel frame, so native sends its existing
end frame to close server state. An incomplete upload fails size validation;
a fully transferred upload may complete server-side after the client aborts,
with the normal staged-upload expiry. Network loss fails in-flight
uploads; they never resume midway on a replacement connection. A late queued
chunk fails only its upload; ordinary upload/network failure must not close the
local document bridge or replace the page with a native failure screen.

Document replacement, Activity destruction, renderer loss and backgrounding
release the WebView lease. Ordinary Android background/foreground transitions,
including a platform file chooser, retain the selected WebView, document handle,
JavaScript heap, DOM, draft and scroll state. They resume transport independently;
pending requests/uploads fail cleanly and existing streams recover. Frame credit
waits must not expire solely because the WebView is stopped. Inactive consumers
must not maintain source subscriptions or retries. Local draft storage remains
the web draft owner.

## Direct, Relay, And LAN Discovery

A paired server owns a set of routes rather than one route-shaped identity:

- configured relay location and username;
- manually entered direct endpoint;
- VPN/Tailscale endpoint;
- previously authenticated direct endpoint; and
- foreground-discovered LAN candidate.

The connection core may prefer a working direct path and fall back to relay,
but explicit operator configuration stays authoritative. Route selection does
not create a second paired device, source cache, inbox, or notification record.
A new candidate joins an existing profile automatically only after successful
resume with that profile's credential. Otherwise it requires explicit SRP
reauthentication and user selection.

mDNS/Bonjour is discovery, never authentication. A bounded foreground scan may
advertise or discover a service name, port, and protocol/capability hints. It
must not advertise credentials, sessions, installation identity, project
names, or push state. A copied or spoofed advertisement is merely an endpoint
candidate; resume must prove continuity before automatic attachment, while
full SRP plus explicit user selection can establish a new route/profile.

Discovery work is lifecycle-owned and bounded. Opening an onboarding or server
connection surface may scan; closing it releases the scan. The design does not
add an indefinite background mDNS watcher.

## QR And Passwordless Pairing

The safe first QR flow is discovery-only. It can encode a relay locator, direct
route hints, and SRP username so the user does not type URLs. Android still
asks for the SRP password and full SRP authorizes the pairing.

Merely opening an unlocked desktop Settings page must not mint durable remote
access. A future passwordless QR grant requires a separate security and
compatibility review and step-up authorization, such as:

- re-entering the YA remote-access password;
- operating-system biometric/system authentication; or
- approval from an already-paired device.

Any such grant must be single-use, short-lived, visibly name the proposed
device, and require explicit confirmation. Password-first remains the normal
pairing posture unless that stronger flow is deliberately approved.

## Security Client Registration And Continuity

The server-side paired-device idea is implemented as the Android kind of the
cross-platform security-client registry rather than a mobile-only namespace.
After SRP succeeds and the exact capability is present, Android registers a
per-server Android Keystore P-256 public key, signed device/app/environment
descriptor, and user-visible label. It checks in once per authenticated
connection with a proof bound to the fresh SRP transport nonce.

The stable key, not mutable OS/app metadata, anchors continuity. Android
updates, security patches, locale/timezone changes, and app releases update the
signed audit snapshot without password login or re-pairing. A copied resume
credential cannot impersonate the existing Android client without its
Keystore key; a password-only attacker creates a new visible client record.

The same API admits capable browser WebCrypto keys and a future extension-free
desktop WebView or native-shell key. Existing browser-profile and remote-session
state remains visible as a legacy projection. Exact routes, schemas, proof
transcript, history bounds, assurance labels, and compatibility fallback live
in the security-client topic.

## Push As A Pairing Capability

The broker installation belongs to the Android app installation. A
server-specific broker subscription belongs to one paired-device relationship.
Push does not create or authenticate that relationship.

After authenticated pairing, enabling notifications creates or reuses the
server-specific subscription and transfers its send capability to the trusted
YA server. The server records it under the paired device, applies notification
policy, and can revoke it independently. Generic FCM payloads carry only an
opaque subscription id and intent; the native app resolves that id through its
own paired-server map.

Revocation is hierarchical:

- disabling notifications revokes only that push subscription;
- forgetting a server on the phone revokes or tombstones the phone-side
  relationship and its broker mapping;
- forgetting a device on the server revokes its connection credentials and
  push subscriptions; and
- changing the server-wide SRP password continues to invalidate current SRP
  sessions without silently serving as the only lost-device control.

Exact offline revocation, tombstone, retry, and cross-side acknowledgement
semantics remain implementation decisions.

## iOS And Shared Rust Direction

On 2026-10-01 the maintainer accepted the shared Rust mobile connection core
and pinned RustCrypto `srp 0.7.0-rc.3` after the crypto/native-build proof and
Daybreak Blue engineering review. The
[iOS implementation plan](../docs/tactical/138-ios-native-core-proof.md)
records evidence, remaining production gates and the next checkpoint.
`packages/mobile-core-proof` remains isolated fixture tooling; it is not the
production connection core. The current Android core remains Kotlin until its
later migration demonstrates parity.

The selected ownership is:

| Layer | Responsibility |
| --- | --- |
| Shared Rust core, exposed through UniFFI | SRP/server proofs, resume, encryption, direct/relay connections, route selection, bounded native request/subscription work, reconnect and teardown |
| SwiftUI shell | Native owner login, host management, Keychain, WKWebView control channel and credential handoff, Apple lifecycle and notification adapters |
| Kotlin/Compose shell | Native owner login, host management, Keystore-backed storage, WebView control channel and credential handoff, Android lifecycle and notification adapters |
| Bundled React client | Full foreground application over its own web connection, resuming the native profile's credential held in memory; never a password or web login |

### Existing-server compatibility

This is a mobile implementation change, not an authentication migration.
The server retains its existing SRP-6a/SHA-512 profile, verifier storage,
proof encodings, key derivation, secretbox framing and resume versions. The
Rust adapter must match that wire contract and supported legacy fallbacks;
the library's high-level default profile is not a drop-in replacement. No new
server route, field, capability or protocol version is required. Existing
clients keep working; owners do not reset passwords or re-enroll credentials.
The initial native release remains owner-only, with limited-user login deferred.

The 0.7 release candidate is accepted with known limits: no independent SRP
audit, no claim of whole-adapter constant-time behavior or complete secret
erasure, and the inherited offline-guessing risk after salt/verifier theft.
Acceptance does not waive bounded hostile-input validation, OS randomness,
server authentication before credential persistence, secure native storage,
bundled-only credential handoff or deterministic cancellation/teardown. Verify these
through the production adapter and live disposable-server tests before real
credentials. SRP 0.6 and BigUint secret arithmetic stay in differential test
tooling, outside the shipping core; dependency upgrades require review.

OPAQUE is a possible later protocol investment, not current implementation
scope. A migration would need a separately authenticated full-handshake suite
selection and password-dependent enrollment; `resumeProtocolVersion` does not
select the authentication algorithm. The current Rust/iOS work does not require
that migration or any server credential conversion.

### Current iOS implementation and platform sequence

The iOS 17+ consumer shell and production Rust core are implemented and verified
on an owned simulator against unchanged disposable YA servers. Owner login
verifies M2 and encrypted server-info before saving a native credential. Resume
requires authenticated protocol 3 or later, binds both nonces and persists the
highest authenticated version, including advances during reconnect, before
capability negotiation or continuity check-in can fail. The old stored credential
is invalidated before resume; cancellation before a verified proof can restore
it, while a verified newer pin can never restore an older one. Swift task
cancellation cancels and frees its Rust future, including a stalled handshake.
Missing
security-client audit capability preserves owner operation without registration
requests; supported servers receive native SecKey continuity proofs tied to the
current authenticated transport nonce.

The shell atomically stores profiles and credentials in protected native state,
keeps mutations disabled while Keychain is unavailable, and separates persistent
WebKit data by profile. Showing a document resumes natively to verify the
credential, check continuity and resolve push routes, then releases that native
session; the document resumes the stored credential over its own connection.
Launch/foreground resume restore the application route and React-owned draft;
iOS provides no Android foreground-service promise.
A new profile and credential are durable before security-client registration,
so registration/storage failure remains recoverable with the same request/key.
Known revocation prevents fresh owner login from silently re-enrolling that
installation. Forget revokes on the server before local tombstoned cleanup;
unreachable servers require an explicit local-only Forget Anyway decision.

The Rust actor bounds requests, subscriptions and queued event bytes.
Disconnect fails pending requests without replay, then makes three
bounded resume attempts and restores owned subscriptions. Closing cancels writes
and retry/restoration work and erases retained native credential exports. A
saturated subscription loses that subscription instead of unrelated work. The
native upload path was removed with the WebView data bridge; documents upload
over their own web connection.

Direct, negotiated relay mux and exact custom/legacy relay endpoints are tested.
The shared Rust wire now pools concurrent relay profiles on one physical
socket per normalized eligible endpoint. Each circuit keeps its own SRP,
encryption, inbound queue and lifetime. The pool caps active relay endpoints at
32, circuits at the lesser of the relay limit and 64, queued frames at 32 per
circuit, and queued payload bytes at 64 MiB per physical socket. A lagging
circuit closes without closing healthy peers; a physical socket failure wakes
all affected circuits for independent bounded recovery. The final circuit
releases the socket. Direct/custom endpoints and mux setup/overflow failures
retain exact independent-socket fallback.

NativeRuntime now serializes each profile's authentication and supplies
independent NativeSourceLease owners. It caps active profiles and owners per
profile at 64. Subscription identifiers are scoped to an owner; releasing
one owner cancels its pending work and retires only its resources. Lease event
queues cap at 64 events / 32 MiB each and 64 MiB aggregate per source; aggregate
pressure retires the largest lagging owner before an innocent producer. Pending
resource cleanup retains bounded admission. The final owner closes its source,
and explicit profile/runtime retirement cancels all corresponding owners.

Android production transport now uses this Rust runtime through UniFFI. Kotlin
retains Keystore/profile encoding, security-client adapters, platform demand,
foreground/background ownership, native login/hosts and the WebView control
channel with its credential handoff.
Its former SRP/crypto/socket backend is retained only for differential tests.
Saved credentials are converted inside native protected storage without changing
Keystore aliases or records. The native route adapter respects Android network
security policy. Rust tries the preferred candidate, then direct-first fallback,
authenticates the saved identity on every attempt and persists the highest proof
version before consumers. Authenticated reconnect stays limited to three attempts;
Kotlin does not add another retry cycle after Rust exhausts them.

Android connection setup accepts callers on the UI dispatcher: full login,
profile pairing and resume perform their native future polling and protected
credential persistence off the main thread. OS certificate and revocation
verification stays enabled; it must never require relaxing Android's main-thread
network policy. Live acceptance starts pairing from Main, including an opt-in
public `wss://` relay run against a disposable server. Plaintext local relay
acceptance alone does not establish that the shipping TLS login path works.

The iOS shell displays one selected foreground profile while other native owners
can retain independent source demand. Switch Host and replacement documents
retire the document and its own connection. Background suspension retires the
foreground runtime and creates a fresh runtime for activation; it cannot retain
Android foreground-service demand. Each current iOS profile still configures one exact
route, using common mux-to-legacy fallback. SwiftUI, Keychain, WebKit and Apple
notification/lifecycle behavior remain platform adapters.

The notification foundation owns Apple permission/FCM token handling and
protected broker credentials, but common per-server native push enrollment is
still pending. Unconfigured builds report unavailable and registration alone
never reports delivery enabled. The broader phone/tablet/network matrix, live
APNs, signing and store publication remain release gates. See
[the iOS README](../packages/ios/README.md) for reproducible acceptance commands.

The [shared transport migration](../docs/tactical/139-shared-mobile-transport-migration.md)
tracks Android/iOS acceptance and release evidence. Existing manager and
legacy differential tests remain, alongside live production Rust execution.
Android release work continues independently of iOS store work.

## Compatibility And Approval Gates

Native Android/iOS CI runs immediately for native/platform and shared-core
inputs, and daily for the complete default-branch source, including ordinary
bundled web changes. Manual dispatch remains available. The exact trigger and
release-verification policy lives in
[Native app CI cadence](../docs/development/testing.md#native-app-ci-cadence).

The optional `security-client-audit-v1` and
`native-push-subscriptions-v1` contracts, reviewed stable releases, and exact
old-server fallbacks are approved in
[`security-client-audit.md`](security-client-audit.md). An older server remains
usable through current SRP/native summaries and the bundled/hosted web client;
Android reports that registration/push requires an update and makes no
unsupported request. Native projection/inbox APIs, passwordless grants,
plaintext browser-profile cleanup, and optional attestation retain their own
future compatibility reviews. The bundled document resumes an existing session
with the ordinary web protocol and adds no server route or capability.

## Recommended Implementation Order

1. **Prove Kotlin SRP and secure transport — complete:** checked-in
   cross-language fixtures and the direct physical-device probe establish the
   connection foundation without adding a server contract.
2. **Store native paired-server profiles — complete:** Keystore/DataStore
   boundaries, forget/reauthentication states, expiry, and backup exclusions
   are implemented and tested.
3. **Own native connection demand — complete:** a lease-controlled
   request/subscription manager supplies bounded reconnect and deterministic
   teardown.
4. **Select direct and relay routes — complete:** attach a candidate automatically only
   after resume proves credential continuity; otherwise require explicit SRP
   reauthentication and profile selection.
5. **Bind native host management — complete:** onboarding, selection,
   reauthentication and connection state remain native without dashboard demand.
6. **Register security clients and revocation:** attach expiring native
   sessions to a Keystore-key-verified cross-platform security-client record,
   retain legacy web audit visibility, and cascade explicit revocation.
7. **Use the full web foreground — complete:** ordinary sessions, transcripts,
   input and settings run in the bundled web client; duplicate native
   dashboard/Conversation presentation is removed.
8. **Attach native push subscriptions:** make broker subscriptions children of
   the paired device and validate notification presentation/taps end to end.
9. **Add bounded LAN discovery:** discover candidates in foreground and accept
   them only after expected-server authentication.
10. **Add optional foreground activity:** let an explicit user action keep the
   native core subscribed, with a persistent notification and complete stop.
11. **Own multiple native hosts and relay mux:** keep source demand concurrent,
    make selection presentation-only, pool one or more eligible relay circuits,
    carry ordinary/full traffic through each logical circuit, preserve exact
    legacy fallback, and prove per-profile failure isolation and fairness.
12. **Bind the bundled WebView to the native profile — complete:** first
    through a native data bridge, replaced on 2026-10-07 by the credential
    handoff ([Bundled Web Client Transport](#bundled-web-client-transport));
    host switching opens native management and never a web login.

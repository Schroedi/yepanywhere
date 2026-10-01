# YA native connection core

This is the credential-bearing core for the iOS app. It is separate from
`mobile-core-proof`, which remains a differential experiment. Shipping
arithmetic uses pinned RustCrypto SRP 0.7.0-rc.3 and crypto-bigint, not SRP 0.6
or num-bigint. The accepted limits and ownership contract are in
[mobile pairing](../../topics/mobile-server-pairing.md#ios-and-shared-rust-direction).

The existing server needs no migration: owner SRP uses YA's existing
2048-bit/SHA-512 password hash, padded scrambling input and minimal integer
proofs. M2 and authenticated server-info precede credential persistence.
Resume binds both nonces, session id and the previously authenticated minimum
protocol version. OS randomness supplies private scalars and secretbox nonces.
Owned secret buffers and big integers use zeroize; minimal wire encodings do
not imply that the entire profile is constant-time or independently audited.

Tokio owns one bounded session actor per native lease. It handles encrypted
requests, subscriptions, uploads, resume and three bounded reconnect attempts.
The final lease closes its socket and cancels its work. No web login or key
material is part of the source bridge. Direct routes and eligible relay mux
routes use the same authentication; unavailable mux setup falls back to the
exact configured legacy relay endpoint. Explicit custom URLs remain authoritative.
TLS uses rustls with the platform verifier and OS certificate trust.

The native app uses the stored entry points with a CredentialPersistence owner.
A verified full-login credential is durable before capabilities or continuity
registration. Resume invalidates the older stored credential before connecting
and persists the authenticated high-water before capabilities. A storage failure
or cancellation can require full login; it cannot silently reuse an older pin.
Reconnect follows the same rule. The memory-only entry points remain available
for diagnostics, whose callers own any persistence.

Subscription queue pressure is attributed to queued owners; the offending owner
is removed and receives a bounded error. Progress/state events coalesce, and
server-rejected subscriptions are not restored. Cancelling requests releases
pending slots without waiting for the request deadline. Generated Swift bindings
apply a version-checked cancellation adapter to UniFFI 0.32.2's exposed
rust_future_cancel/free API, since its Swift template lacks cancellation support.
The lifetime gate serializes cancellation and free; blackholed simulator login
and resume tests verify actual socket release.

Run from the repository root with Node 24 LTS and the pinned Rust toolchain:

```sh
node packages/mobile-core/scripts/run.mjs rust
node packages/mobile-core/scripts/live.mjs
node packages/ios/scripts/run.mjs test
node packages/ios/scripts/run.mjs build
```

The live runner owns a disposable unchanged YA server and public fixture
credentials. It kills that process when finished. Its tests are explicitly
ignored in ordinary Cargo runs; the runner enables them. No developer YA
configuration, projects or actual credentials are used. The sodium source is
pinned by SHA-256 and its upstream signature; Cargo builds never download an
unpinned latest libsodium archive. Native generated files and archives are
ignored. iOS tests use a disposable simulator and ad-hoc signing for Keychain;
the device build is unsigned and is not a publication or physical-device claim.

The initial native app supports owner login. Limited-user sign-in, OPAQUE,
Android migration, App Store signing and server-native push enrollment are
separate work; the existing server and Kotlin Android app remain compatible.

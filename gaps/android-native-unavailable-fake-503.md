# Android reports native transport failures as server 503 responses

`YaRustProfileConnector.execute`
(`packages/android/app/src/main/java/com/yepanywhere/mobile/connection/YaRustProfileConnector.kt`,
the `catch (_: CoreException)` in the `"request"` branch) turns every native
request failure into a synthetic HTTP 503 `Native connection unavailable`.
The failures it covers are a full command queue or in-flight limit, a timeout,
a failed send, `fail_pending` during an internal reconnect, and a closed lease.
`YaServerConnectionManager.request` then throws that as a `YaApiException`, as
if the server had answered.

The visible symptom is gone: bundled WebViews no longer route traffic through
native. They resume the native credential over the web transport, so the
roughly 20 `API error: 503` banners after a relogin (2026-10-07) cannot recur
there. What remains affects only native consumers: push enrollment and tests,
security-client registration and revocation, and host removal. Those callers
cannot tell a transport failure from a server 503, and get no typed retryable
error.

Fix: complete the request with a transport exception instead of a synthetic
response, and let callers distinguish "server never answered" from server
errors. The Kotlin half builds and unit-tests locally (`./gradlew test` in
`packages/android`).

Found 2026-10-07 while fixing relay sign-in after a rejected saved session.

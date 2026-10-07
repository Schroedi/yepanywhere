# Native subscription setup failures still invent HTTP statuses

The Android request-error repair preserves native operation codes instead of
manufacturing server responses. Subscription setup still has a separate path:

- `YaRustMessageTransport` in `YaRustProfileConnector.kt` catches a failed
  `subscribe` command and creates a response with status 400 and
  `Native subscription rejected`.
- `NativeSourceTransport.send` maps a failed bridge `subscribe` operation to a
  protocol response with status 503. Its `subscriptionError` event handler also
  substitutes 503 when native has no status.

These statuses may represent native connection loss or overload rather than a
server response. This finding is from source inspection, not a newly observed
page banner. Actual server subscription rejections must keep their status.

Keep the request repair bounded: subscription setup and replay have different
owners and managed-stream retry behavior. Reproduce interruption during setup
at the Kotlin manager and managed-stream boundaries, preserve a typed operation
failure through the bridge, then exercise subscription catch-up on the emulator.
Do not disguise authentication or verification failures as reconnectable loss.

Found 2026-10-07 while repairing fabricated native request 503 responses.

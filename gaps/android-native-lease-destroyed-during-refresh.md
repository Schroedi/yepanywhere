# Android refresh can dispatch through an already destroyed native lease

The Android live acceptance suite crashed in
`YaNativeReconnectInstrumentedTest.refreshingRepeatedlyStaysConnected` on
two independent Renovate PRs on 2026-10-08:

- [Actions pinning run](https://github.com/kzahel/yepanywhere/actions/runs/37723290976/job/113140210013), head `f1d6ad6c0`.
- [bn.js patch run](https://github.com/kzahel/yepanywhere/actions/runs/37723629953/job/113140420281), head `64870a001`.

Both report `IllegalStateException: NativeSourceLease object has already been
destroyed` from the generated UniFFI `dispatch` wrapper, called by the lazy
request coroutine in `YaRustMessageTransport.execute`. The uncaught coroutine
failure kills the instrumentation process and prevents the remaining cases
from running. Neither PR changes the Kotlin adapter or Rust lease lifecycle.

`YaRustMessageTransport.finish` releases the session, cancels its coroutine
scope, and immediately calls `Disposable.destroy` without awaiting the scope's
children. Cancellation alone does not establish that no child is still about
to enter a native method. This is a concrete lifetime race candidate, not an
emulator timeout or evidence that the dependency patches caused the defect.

Repair needs an explicit lifetime boundary between adapter operations and
native destruction, including requests started outside the adapter scope.
Add a deterministic teardown regression test and rerun the live minified
Android suite, retaining its refresh and sequential typing assertions. Do not
hide the exception, weaken acceptance, or repeatedly retry until green.

The runtime repair was kept separate from the dependency maintenance pass
because it changes Android transport ownership behavior. Failure logs and
downloaded instrumentation reports are retained in
`tasks/renovate-babysit/` on the diagnosing checkout.

Found 2026-10-08 while following Renovate PRs through CI and merge.

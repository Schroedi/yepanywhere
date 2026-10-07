# Interrupted validation misreports or clears draft attachments

`SessionPage` and `NewSessionForm` interpret rejected attachment validation as
missing files. With draft sync they preserve references but show an unavailable
notice; the legacy path also clears references. A failed connection check
proves neither expiry nor loss. Retain references and their visible chips,
quiet known transport interruptions, and keep accurate feedback for genuine
validation failures and completed missing-file responses.

Android CI 498 and 499 first exposed attachment toasts, but tracing found an
additional fixture defect: native uploads were wired while the HTTP staging
validation route was absent. It returned a real 404 after reconnecting. The
fixture correction must remain separate from the client repair; do not hide
that setup problem by suppressing arbitrary server errors.

With the complete fixture, the in-flight experiment waits for a validation
request specifically. Native connection replacement and browser socket closure
reproduce the feature error in owning-layer component tests. The browser also
retains its separately recorded raw socket page-error gap.

See the [hardening report](../docs/testing/android-lifecycle-hardening-2026-10-07.md)
for corrected attribution, retained failed runs and red/green checks.

Found 2026-10-07 while investigating Android lifecycle hardening.

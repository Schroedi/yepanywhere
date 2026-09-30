# Nightly draft release creation returned 403 despite contents write

[Nightly 36693001696](https://github.com/kzahel/yepanywhere/actions/runs/36693001696)
selected CI 35533096516 at `9fc89e537` and failed creating the private draft
with HTTP 403, “Resource not accessible by integration”. The job log explicitly
reports `Contents: write`; both caller and reusable workflow declare it.
That source already has the published `desktop-latest-v0.3.1601` tag, so the
[documented missing-ref workflow-scope restriction](https://github.blog/changelog/2023-11-02-github-actions-enforcing-workflow-scope-when-creating-a-release/)
does not by itself explain this failure. No release/App token secret is
configured. The API denial has not been classified; do not blindly widen token
permissions or replace the exact verified SHA with current HEAD.

A separate definite selector defect is repaired: the source was an ancestor
of the already published September 29 Latest (`d6d312785`), so publishing it
would have rolled code backward under a higher nightly version. Such candidates
now skip even under force; equal/newer verified source remains eligible.
The historical attempt would therefore skip before draft creation. Verify a
forward-source nightly; if 403 recurs, retain GitHub response/request IDs and
inspect repository release/tag policies or use a deliberately configured
release App credential after establishing the missing authority.

Found 2026-09-30 while investigating remaining CI failures.

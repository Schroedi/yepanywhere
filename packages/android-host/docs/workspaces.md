# Android workspace direction

Status: implemented in the experimental host, 2026-10-18. Physical acceptance
and remaining limits are recorded below.
Owning topic: [durable user-owned workspace](../../../topics/android-host.md#durable-user-owned-workspace).

## One collection of folders, two access methods

Users should be able to save several named folder shortcuts, such as `docs`
for `Documents/FolderB` and `downloads` for a child of Downloads. Select each
through Android's folder picker. A shortcut records a selected root; it does
not copy files, grant broad authority or create a Unix symlink.

**Pick folder** opens Android's picker immediately, without a name field. The
selected folder's display name becomes its shortcut name, preserving case,
spaces and Unicode. If that name is already used, append the first available
`-1`, `-2`, `-3`, and so on. Names are bounded to 48 UTF-16 code units; trim the
base as needed to fit a suffix without splitting a surrogate pair. Replace
slashes, backslashes, colons and control characters with `-`, trim outer
whitespace, and use `folder` if the result is empty, `.` or `..`.

**Rename** remains an optional action after selection and changes only the
shortcut. **Reselect** repairs an existing registration while keeping its
shortcut name and requested direct access. Existing registrations keep their
names after an app update. Selecting an already registered folder reports its
existing shortcut instead of adding a second registration. Canceling the picker
leaves registrations unchanged.

| Access method | Authority | Agent interface |
| --- | --- | --- |
| Direct filesystem | Explicit optional all-files permission plus a qualified local-folder selection | Ordinary paths such as `/workspaces/docs`; existing shell, Python and provider file tools |
| SAF documents | Individual persisted folder grants; no all-files permission required | Explicit `ya saf` operations against a named root |

The same folder can support both methods. A SAF-only root remains useful for
document operations even when it cannot be exposed as a filesystem directory.
Arbitrary document providers belong to that explicit SAF interface; their
content URIs are not converted into invented local paths.

The host must remain usable without all-files access. Private projects remain
an explicitly private choice with their existing app-data lifetime. They are
never a substitute for an unavailable durable folder.

## Optional direct filesystem access

Request broad authority only when the user chooses direct access, separately
from selecting folders. Explain that this permits reading, modifying and
deleting files throughout accessible shared storage, including Downloads and
Documents. It does not limit the app to the saved shortcuts or expose other
apps' private internal storage. The picker chooses workspaces; all-files
permission supplies raw-path authority. PRoot supplies no extra Android
authority and is not a folder-confinement boundary.

Qualify each local root independently using MC's existing native resolver.
Use distinct PRoot targets under `/workspaces/<name>` so multiple selected
folders can be accessed simultaneously. Writes must reach the actual external
files directly, with no app-private working copy, publish step or asynchronous
synchronization. Projects/sessions select an available direct path as their
working directory and use the existing provider tools unchanged.

Names must be unique, safe single path components; reject traversal, ambiguous
aliases and colliding mount targets. Preserve names across ordinary restarts.
Changing a name changes the agent-facing path and must be explicit. Source
folders may overlap; detect duplicate/overlapping selections and surface their
shared file identity instead of presenting them as independent copies. Direct
targets remain disjoint. These mappings do not depend on shared storage
supporting symlinks.

Android restricts selecting the Downloads directory itself on modern versions;
children such as `Downloads/FolderA` remain the intended selection. Only
provider/volume routes actually qualified by MC may receive direct mappings.
The current resolver qualifies the built-in primary external-storage provider;
removable storage is not established by this direction.

Mapping changes apply through a controlled runtime
restart. Show pending changes and active-session consequences before applying;
do not abruptly stop provider work or claim an existing process adopted a new
mapping. Recheck availability before admitting work. One unavailable root must
not disable healthy roots, or become an empty directory that accepts private
writes. Missing paths must fail visibly. Running-handle/session revocation
requires separate implementation and validation.

## SAF CLI/document access

The installed `ya saf` CLI uses the same shortcut names. Native operations live
in MC's `SafDocuments`; YA owns the saved roots and a foreground-host bridge.
The bridge accepts only the actual Android app UID, and the CLI verifies the
server UID. Its random endpoint is private runtime state. It closes with the
host; start the local host before using the CLI.

```sh
ya saf roots
ya saf ls docs
ya saf ls "Shared Files"
ya saf stat docs notes.txt
ya saf mkdir docs drafts
ya saf put docs drafts/notes.txt /home/user/notes.txt
ya saf get docs drafts/notes.txt /home/user/notes-copy.txt
ya saf rename docs drafts/notes.txt revised.txt
ya saf rm docs drafts/revised.txt
ya saf rm docs drafts --recursive
```

`put` and `get` refuse an existing destination unless `--replace` is supplied.
`rename` accepts a new leaf name within the same parent and refuses replacement;
there is no cross-root move. Selected roots cannot be renamed/deleted by these
document commands. The native UI's Rename changes only the shortcut.

The registry supports 16 roots and shortcut names of 1–48 UTF-16 code units
excluding `.`, `..`, slashes, backslashes, colons and control characters. Quote
shortcut names containing spaces or shell metacharacters in shell commands;
use `--` before positional arguments beginning with `-`.
Document paths allow 32 relative path components/4096 characters,
2048 children per listing and 64 MiB transfers. The native bridge has four
workers, four queued clients and a 30-second request deadline. Provider queries
receive cancellation; an uncooperative provider may still occupy a bounded
worker until it returns. No persistent descriptor cache is used. Uploads are
fully received into a bounded private temporary file before external mutation;
a partial transport upload does not modify the document. Once provider writing
starts, cancellation/errors can leave a partial destination. Downloads complete
and fsync a local temporary file before publication. Temporary files are removed
on request cleanup; app reset removes any residue from abrupt process death.

Each operation uses the root's actual persisted grant and current provider
capabilities. Listing, reading, writing and provider-supported namespace changes
must report their own results. A local edit changes the external document only
after explicit successful transfer. Never describe cached bytes, a queued
transfer or a failed export as a completed durable write. Do not promise POSIX
rename/replace, random I/O, locks or fsync for arbitrary providers.

Bound listings, transfers, open descriptors and cancellation cleanup. Reject
ambiguous duplicate names, traversal and unsupported operations rather than
selecting an arbitrary document or silently changing semantics. Grant loss,
offline/provider errors and partial writes must be visible. Cloud upload and
durability guarantees remain provider-specific and require separate evidence.
JSTorrent's seekable-descriptor patterns are a reference, not proof of a
general filesystem namespace.

## Identity, permissions and recovery

Keep root registration, shortcut name, requested access methods and provider/
document identity separate from current grant health and derived local path.
Display availability per root and method: a healthy SAF root can have direct
access disabled/unavailable, while another root remains fully usable. Losing
all-files access invalidates direct access without deleting registrations or
files; SAF access can remain available under its own grant.

Removing a shortcut unregisters it and releases grants no remaining registration
needs. It must not delete the selected folder's contents. Releasing SAF access
can enforce YA admission policy, but cannot revoke raw-path authority while
all-files remains active. Removing a PRoot mapping is likewise not a security
boundary against code running as the app UID. No transition silently switches
a project to another access method or a private copy.

Files in selected external folders must survive clearing app data and
reinstallation. Registrations, names and grants may be erased. Recovery means
selecting the existing folders, granting access again and recreating their
shortcuts; it cannot depend solely on the erased registry, a hidden YA project
marker or a matching display name. A moved/missing folder requires explicit
repair. Recreating the same names restores intended paths but does not restore
erased credentials, provider sessions or internal databases.

Runtime binaries, provider homes, credentials, YA databases, logs and caches
remain private by default. Selecting a root creates no YA metadata or Git
configuration inside it. Any future Git compatibility configuration must respect
the [project storage contract](../../../topics/project-directory-storage.md) and
use explicit repository trust rather than wildcard `safe.directory`.

## Physical acceptance and limits

The [completed single-root spike](../workspace-spike/README.md#evidence) measured
ordinary CRUD, positional writes, rename/replace and fsync on Pixel 7a/API 37.
Its shared filesystem was case-insensitive, did not support symlinks/execution,
ignored executable bits and returned ENOSYS for `flock`. POSIX record locking
and bounded SQLite WAL contention passed. Git required rename-based object
publication, disabled file-mode tracking and explicit repository trust. Those
measurements are a bounded fixture, not crash/power-loss safety or a complete
Linux filesystem contract. Keep installed runtimes, executables, credentials and
YA's live internal databases private. No automatic Git trust/configuration or
project marker is written by workspace onboarding.

Multi-root host acceptance uses the production HostService/server/provider code
in an isolated `-PworkspaceFixture` Debug application. Only that build includes
its test receiver and typing instrumentation; normal host builds include neither.
It creates two exclusively owned UUID trees under Documents and Download,
records a private recovery receipt, uses actual picker/Settings controls, and
checks files from independent Android shell byte/hash reads. Temporary AAR
credentials and ADB forwards/reverses are removed in cleanup; receipts remain on
failure. Never reuse this fixture ID for the signed-in host.

```sh
# Prepare the shared runtime first, then build the isolated native fixture.
packages/android-host/gradlew -PworkspaceFixture :app:assembleDebug :app:lint
cp packages/android-host/app/build/outputs/apk/debug/app-debug.apk \
  packages/android-host/.local/workspaces-fixture.apk
python3 packages/android-host/tools/workspaces_live.py \
  --device-file <private-device-json> --machine-control <MC-checkout> \
  --aar-checkout <AAR-checkout>
```

The private device JSON holds an explicitly selected serial. The runner uses
MC doctor and verifies the explicitly selected model (Pixel 7a by default)
before mutation. On failure, inspect
its ignored evidence and use `--resume <private-evidence-directory>` to verify
ownership witnesses, replace only the failed fixture resources, and repeat.
The [instrumentation revocation gap](../../../gaps/android-notification-test-revocation-kills-runner.md)
informs permission changes from a separate controller. Signed-in host data and
existing documents must remain untouched by reset/reinstall tests.

For a focused native picker/naming check, add `--picker-only --model 'Pixel 9'`
and omit `--aar-checkout`. This mode needs the fixture APK/native libraries but
no staged Alpine runtime or provider credentials. It uses three exclusively
owned folders with matching display names under Documents, Download and Pictures,
including spaces and uppercase letters. It checks automatic suffix allocation,
reuse of a freed suffix, cancellation, duplicate identity rejection, optional
rename, reselect, process restart and sequential typing with 16 visible roots.
External byte/hash checks and exact-resource cleanup apply in both modes.

**Picker-first follow-up passed on Pixel 9 over Wi-Fi ADB, 2026-10-18:**
three actual picked roots preserved their display names, spaces and case;
collisions used `-1` and `-2`, and removal made `-1` available again. Cancel,
duplicate rejection, Rename, Reselect and process restart preserved registrations
as expected. Sixteen sequential keys during a 16-root refresh acknowledged in
at most 36 ms. Independent hashes of all three external witnesses stayed
unchanged, and the disposable app and exact owned trees were removed. A separate
actual PRoot binding check preserved spaces, Unicode and trailing `!` names in
owned private-cache fixtures. The normal APK update preserved all 571 existing
private-state file hashes; no runtime restaging or user-document mutation occurred.

**Passed on explicitly selected Pixel 7a/API 37, 2026-10-18:**

- Two actual folder selections, separate all-files Settings consent, simultaneous
  direct mappings and two normal YA projects rooted in different folders.
- Real Codex and Claude YA sessions each wrote into both roots, including Python
  positional writes and fsync; independent Android byte reads and SHA-256 checks
  verified 10 external files. The guest retained its private runtime/provider home.
- SAF CRUD and binary get/put round trips on both roots without broad access;
  existing-file overwrite and traversal refusal; incomplete transport upload
  preserved an existing external destination.
- Host force-stop/restart, independent per-root grant revocation/refusal and real
  reselection repair; broad access disabled while SAF metadata operations remained
  available after host restart. Other roots stayed usable under their own grants.
- Explicit controlled mapping restart, picker cancellation, native shortcut rename
  and removal, and unchanged external hashes after those registration changes.
- Both data-clear/reselection and uninstall/reinstall/reselection of the disposable
  fixture recovered the existing external bytes through both methods.
- Real sequential typing of 16 characters while asynchronous status refreshed:
  no lost keys, maximum acknowledgement 24 ms in the two-root acceptance run.
  A supplementary instrumented run refreshed status during every character with
  16 registrations (synthetic unavailable roots filling the UI to its limit):
  no lost keys, maximum acknowledgement 29 ms. Its temporary registry was removed.
- Unchanged accessibility settings; temporary AAR clients rejected with 401 after
  revocation; owned transports, fixture app and both owned external trees removed.

A separate Linux abstract-socket check exercised fragmented response framing and
fresh rejection after revocation in the server's actual admission helper. Android
Debug/Release builds and lint, root lint/format/typecheck/test, MC Android tests,
Python compilation and the shared Alpine auth/SQLite restart smoke passed. An
intermittent unrelated glossary scan-count assertion is recorded in
[its gap](../../../gaps/glossary-concurrent-join-extra-refresh.md); the subsequent
full server and full workspace runs passed unchanged. Existing negative-path
suite diagnostics remain tracked in the [warning gap](../../../gaps/unit-failure-path-log-warnings.md).

The updated normal host APK/runtime was then installed on the same device;
all 135 pre-existing private-state file hashes matched before and after staging.
No user folder was registered or modified in that host. Its native launcher was
opened with the service stopped for the user's next launch.

The implementation does not establish arbitrary cloud/removable-provider behavior,
provider power-loss durability, cancellation rollback, descriptor-leak soak
coverage, duplicate-name-provider conformance, or revocation of already running
sessions/handles. Duplicate-name rejection and provider-specific failure paths
are implemented but not qualified by a synthetic hostile DocumentsProvider.

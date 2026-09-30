# A file vhost should serve the project content its root page links to

**Intended use (maintainer direction, 2026-09-30).** A file vhost row usually
names one file inside a registered project as the site's root page. When that
page refers to project-local content, the address should serve that content
too, in the spirit of the public share view: the reader follows the page's
own links without being handed a login or the whole machine.

**Observed.** `https://speech-recognition-tail-report.graehl.org/` serves
`~/draft/research/speech-recognition/report.html`. Its **speech-MT topic**
link is `<a href="../../topics/speech-mt.md">`, meaning the project's
`topics/speech-mt.md`. The browser resolves it from `/` to
`/topics/speech-mt.md`, and the vhost answers 404.

Two independent things refuse it
(`packages/server/src/artifacts/VhostSiteServer.ts`, `serveVhostSite` and
`htmlRootAsset`):

1. **URL space.** The root answers at `/` and its own directory is the site
   root, so every reference above that directory collapses at `/` before a
   request is made. `htmlRootAsset` passes `basename(root)` as the root's
   path, so `resolveHtmlRootAssetPath` also treats the file's directory as the
   project floor and refuses `../` element assets that a live file share of
   the same file serves.
2. **Authority.** Only element-loaded assets
   (`findHtmlRootAssetReferences`) are served. An `<a href>` document is
   excluded by the same rule the live file share follows
   (`topics/relay-origin-and-share-gating.md` § Public File Views: a share
   "never authorizes another linked document"). The maintainer's "same as the
   public share view" therefore asks for more than the file share grants
   today, not just parity with it.

## Direction

**Project-rooted URL space.** When the row's file lies inside a registered
project (the owner lookup `public-file-shares.ts` uses through
`listProjectRoots`), make the project root the site root. Redirect `/` with
308 to the root's project path (`/research/speech-recognition/report.html`).
Browsers keep the fragment across a redirect that names none, so
`/#feeding-translation-…` still lands on its section. Relative links then
resolve as they do in the working tree. A file outside every registered
project keeps today's directory-rooted behavior.

**Authority: selective link traversal (maintainer choice, 2026-09-30).**

- **Reachable-link allowlist, the chosen route.** Serve the root, and the
  transitive closure of project-local targets reachable from it: element
  assets, `<a href>` targets, and CSS `url()` in HTML documents; links and
  images in Markdown documents. Resolve each reference against its own
  document's project path. Traverse only HTML and Markdown. Other targets
  (images, PDFs, data) are leaves. Bound depth, document count and bytes, and
  recompute from live files, caching by path and mtime, as today's per-request
  root reread does. A fragment, another origin, or a path above the project
  root contributes nothing.
- **Whole-project mount, not chosen.** Serving any file under the project
  root that passes the local file policy was acceptable to the maintainer but
  is less preferred. It is simpler, but on a Public row it publishes anything
  a visitor can guess. In `~/draft` that includes PII annotation data under
  `data/pii-annotations/`. If it is ever added, make it an explicit per-row
  choice.

**Rendering Markdown (maintainer direction, 2026-09-30).** By default, a
navigated `.md` target, or a Markdown root, should appear as YA's rich,
dynamic Markdown rendering, the one the File Viewer and public file view
show, rather than raw bytes. Today it is served as `text/markdown`, which
browsers show as plain text or download. The page runs on the artifact
origin under its CSP sandbox. It therefore needs a standalone read-only
renderer entry, like the hosted client's separate `play.html` entry, that
fetches the raw Markdown from the same vhost. It must not load the
authenticated app. The Markdown's own links and images feed the allowlist
above. A `?raw` form, or a subresource fetch rather than a navigation, should
still get the bytes.

## Open questions

- Should the live public file share adopt the same closure? One shared
  decision in `packages/shared` would keep the two surfaces from disagreeing,
  as `findHtmlRootAssetReferences` does now. The share topic reserves "all
  linked project files" for a separate explicit capability, so extending the
  share needs its own decision.
- Settings needs a way to show which files a row serves: a count, or a list
  of the reachable closure.
- The public name should survive the redirect. One option is to serve the
  root at both `/` and its project path and redirect only if the page has
  `../` references.

Found 2026-09-30 while the maintainer shared the speech-recognition tail
report at its own vhost address.

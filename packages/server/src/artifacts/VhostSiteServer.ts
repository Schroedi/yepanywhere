import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  type LinkedSite,
  linkedDocumentKind,
  walkLinkedSite,
} from "@yep-anywhere/shared";
import { getMimeType } from "hono/utils/mime";
import { renderMarkdownFilePreview } from "../augments/markdown-file-preview.js";
import { renderMarkdownDocument } from "../routes/local-file.js";
import {
  isPathInsideDirectory,
  type createLocalResourcePathPolicy,
} from "../routes/local-resource-policy.js";
import { openMutableFileSnapshot } from "../routes/mutable-file-cache.js";
import { fileBytesResponse } from "./fileResponse.js";
import type { ArtifactVhostSite } from "./vhosts.js";

type PathPolicy = ReturnType<typeof createLocalResourcePathPolicy>;

const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Largest document read for its links, or rendered as Markdown. */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
/** How long a walk is reused before the files it inspected are rechecked. */
const LINKED_SITE_RECHECK_MS = 2000;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Request path segments, or null for any traversal, hidden or encoded escape. */
function requestSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  return segments.some((part) => part === ".." || part.startsWith("."))
    ? null
    : segments;
}

async function canonicalWithin(
  candidate: string,
  root: string,
): Promise<string | null> {
  try {
    const canonical = await realpath(candidate);
    return isPathInsideDirectory(canonical, root) ? canonical : null;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return null;
    throw error;
  }
}

/**
 * Serve one request for a file or directory vhost, reading current contents.
 * A file answers at `/` and at every URL of the files it links to,
 * transitively (`linkedVhostSite`); a Markdown file opened as a page is
 * rendered, and `?raw` gives its bytes. A directory serves the files under
 * it, `index.html` for a folder. Every served path must also pass the local
 * file policy. Access was decided by the caller.
 */
export async function serveVhostSite(
  request: Request,
  site: ArtifactVhostSite,
  policy: PathPolicy,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return text("Read only", 405);
  const url = new URL(request.url);
  let root: string;
  try {
    root = await realpath(site.path);
  } catch {
    return text("This address has nothing to serve", 404);
  }
  const rootStats = await stat(root);
  let target: string | null;
  if (rootStats.isDirectory()) {
    const segments = requestSegments(url.pathname);
    if (!segments) return text("Invalid path", 400);
    target = await canonicalWithin(resolve(root, ...segments), root);
    if (target && (await stat(target)).isDirectory()) {
      // Relative asset URLs resolve against the folder only with its slash.
      if (!url.pathname.endsWith("/"))
        return new Response(null, {
          status: 308,
          headers: { Location: `${url.pathname}/${url.search}` },
        });
      target = await canonicalWithin(resolve(target, "index.html"), root);
    }
  } else {
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return text("Invalid path", 400);
    }
    if (pathname.includes("\\") || pathname.includes("\0"))
      return text("Invalid path", 400);
    target =
      (await linkedVhostSite(root, policy)).urls.get(
        pathname.replace(/\/{2,}/g, "/"),
      ) ?? null;
  }
  if (!target) return text("Not found", 404);
  const allowed = await policy.resolveAllowedFilePath(target);
  if (!allowed.ok) return text(allowed.error, allowed.status);
  if (
    linkedDocumentKind(target) === "markdown" &&
    opensAsPage(request, url) &&
    allowed.file.stats.size <= MAX_DOCUMENT_BYTES
  )
    return renderedMarkdownPage(request, allowed.file.resolvedPath, url);
  const snapshot = await openMutableFileSnapshot(target);
  if (!snapshot) return text("Not found", 404);
  if (snapshot.stats.size > MAX_FILE_BYTES) {
    await snapshot.handle.close();
    return text("File exceeds 64 MiB", 413);
  }
  const mime =
    linkedDocumentKind(target) === "markdown"
      ? "text/plain; charset=utf-8"
      : (getMimeType(target) ?? "application/octet-stream");
  return fileBytesResponse(request, snapshot.handle, snapshot.stats, mime);
}

/** A browser navigation rather than a script's fetch or a `?raw` request. */
function opensAsPage(request: Request, url: URL): boolean {
  if (url.searchParams.has("raw")) return false;
  const destination = request.headers.get("sec-fetch-dest");
  return destination
    ? destination === "document"
    : (request.headers.get("accept") ?? "").includes("text/html");
}

async function renderedMarkdownPage(
  request: Request,
  path: string,
  url: URL,
): Promise<Response> {
  const markdown = await readFile(path, "utf8");
  const body = await renderMarkdownFilePreview(
    markdown,
    {
      siteRelativeReferences: true,
      quartoMarkdown: extname(path).toLowerCase() === ".qmd",
    },
    1,
    null,
    "full",
  );
  const html = renderMarkdownDocument(
    basename(path),
    body,
    `${url.pathname}?raw=1`,
    undefined,
  );
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

interface CachedLinkedSite {
  site: LinkedSite;
  checkedAt: number;
  /** Every path the walk inspected, with what it found there. */
  stamps: Map<string, string>;
}

const linkedSites = new Map<string, CachedLinkedSite>();

/**
 * What a file vhost rooted at `rootPath` serves: everything the file links
 * to, transitively, that the local file policy admits. A walk is reused for a
 * moment, then again for as long as no file it inspected has changed,
 * appeared or disappeared.
 */
export async function linkedVhostSite(
  rootPath: string,
  policy: PathPolicy,
): Promise<LinkedSite> {
  const cached = linkedSites.get(rootPath);
  const now = Date.now();
  if (
    cached &&
    (now - cached.checkedAt < LINKED_SITE_RECHECK_MS ||
      (await stampsCurrent(cached.stamps)))
  ) {
    cached.checkedAt = now;
    return cached.site;
  }
  const stamps = new Map<string, string>();
  const site = await walkLinkedSite(rootPath, async (path, document) => {
    stamps.set(path, await fileStamp(path));
    const allowed = await policy.resolveAllowedFilePath(path);
    if (!allowed.ok) return null;
    const { resolvedPath, stats } = allowed.file;
    if (!document || stats.size > MAX_DOCUMENT_BYTES) return {};
    try {
      return { content: await readFile(resolvedPath, "utf8") };
    } catch (error) {
      // Still served; its links just are not followed.
      console.warn(`[VhostSite] Cannot read ${resolvedPath} for links`, error);
      return {};
    }
  });
  linkedSites.set(rootPath, { site, checkedAt: now, stamps });
  return site;
}

async function fileStamp(path: string): Promise<string> {
  try {
    const stats = await stat(path);
    return `${stats.mtimeMs}:${stats.size}:${stats.isFile()}`;
  } catch {
    return "missing";
  }
}

async function stampsCurrent(stamps: Map<string, string>): Promise<boolean> {
  for (const [path, stamp] of stamps)
    if ((await fileStamp(path)) !== stamp) return false;
  return true;
}

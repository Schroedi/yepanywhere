/**
 * Play for public share viewers: the shared HTML with its directly referenced
 * stylesheets, scripts, images, and media inlined as data URLs, so a
 * sandboxed opaque-origin frame can run it with no network reach back to the
 * share. Assets the share does not serve stay as written and simply fail to
 * load inside the sandbox.
 */

const INLINE_ATTRIBUTES: ReadonlyArray<[selector: string, attribute: string]> =
  [
    ["link[rel~='stylesheet'][href]", "href"],
    ["link[rel~='icon'][href]", "href"],
    ["script[src]", "src"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["audio[src]", "src"],
    ["video[poster]", "poster"],
  ];
const MAX_INLINED_BYTES = 48 * 1024 * 1024;

export const PLAY_HANDSHAKE_READY = "ya-public-share-play-ready";
export const PLAY_HANDSHAKE_DOCUMENT = "ya-public-share-play-document";

export interface PlayDocumentMessage {
  type: typeof PLAY_HANDSHAKE_DOCUMENT;
  id: string;
  title: string;
  html: string;
}

/** Local reference the share can serve: relative, no scheme, no host. */
export function isInlinableReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))
    return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

/** Resolve a reference against the root file's project-relative directory. */
export function resolveShareReference(
  rootPath: string,
  reference: string,
): string {
  const clean = reference.trim().split(/[?#]/, 1)[0] ?? "";
  const base = clean.startsWith("/")
    ? []
    : rootPath.split("/").slice(0, -1).filter(Boolean);
  const parts = [...base];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function buildPlayableHtml(
  html: string,
  rootPath: string,
  fetchAsset: (projectRelativePath: string) => Promise<Blob>,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const base of doc.querySelectorAll("base")) base.remove();
  let inlined = 0;
  const cache = new Map<string, Promise<string | null>>();
  const inline = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      pending = fetchAsset(path)
        .then(async (blob) => {
          if (inlined + blob.size > MAX_INLINED_BYTES) return null;
          inlined += blob.size;
          return await toDataUrl(blob);
        })
        .catch(() => null);
      cache.set(path, pending);
    }
    return pending;
  };
  const work: Promise<void>[] = [];
  for (const [selector, attribute] of INLINE_ATTRIBUTES) {
    for (const element of doc.querySelectorAll(selector)) {
      const reference = element.getAttribute(attribute);
      if (!reference || !isInlinableReference(reference)) continue;
      const path = resolveShareReference(rootPath, reference);
      work.push(
        inline(path).then((dataUrl) => {
          if (dataUrl) element.setAttribute(attribute, dataUrl);
        }),
      );
    }
  }
  await Promise.all(work);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * Open the hosted play page first, inside the user's click, then hand it the
 * document once built. The page is same-origin chrome; the document itself
 * only ever runs inside that page's opaque-origin sandboxed frame.
 */
export function openPublicSharePlay(
  playUrl: string,
  title: string,
  build: () => Promise<string>,
): boolean {
  const id = crypto.randomUUID();
  const opened = window.open(`${playUrl}#${id}`, "_blank");
  if (!opened) return false;
  const document = build();
  const deliver = (event: MessageEvent) => {
    if (
      event.source !== opened ||
      event.origin !== window.location.origin ||
      event.data?.type !== PLAY_HANDSHAKE_READY ||
      event.data.id !== id
    )
      return;
    window.removeEventListener("message", deliver);
    void document.then((html) => {
      const message: PlayDocumentMessage = {
        type: PLAY_HANDSHAKE_DOCUMENT,
        id,
        title,
        html,
      };
      opened.postMessage(message, window.location.origin);
    });
  };
  window.addEventListener("message", deliver);
  return true;
}

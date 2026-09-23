/**
 * Entry for play.html: full-window host for a public share's play document.
 *
 * The URL carries the share grant exactly as a file share link does. This
 * page fetches the shared HTML and its directly referenced assets through
 * the share's own relay routes, inlines the assets, and runs the result only
 * inside the sandboxed frame below, which lacks allow-same-origin and so has
 * an opaque origin. The page holds nothing but the document text.
 */
import {
  DEFAULT_RELAY_URL,
  type FileContentResponse,
  normalizeRelayUrl,
} from "@yep-anywhere/shared";
import enMessages from "./i18n/en.json";
import {
  buildPlayableHtml,
  parsePublicSharePlayUrl,
} from "./lib/publicSharePlay";
import {
  fetchPublicShareBlobViaRelay,
  fetchPublicShareJsonViaRelay,
} from "./lib/publicShareRelay";

export const PLAY_FRAME_SANDBOX =
  "allow-scripts allow-popups allow-downloads allow-forms allow-modals";

const notice = document.getElementById("notice") as HTMLParagraphElement;

async function main(): Promise<void> {
  const target = parsePublicSharePlayUrl(window.location.href);
  if (!target) {
    notice.textContent = enMessages.publicSharePlayInvalid;
    return;
  }
  notice.textContent = enMessages.publicSharePlayWaiting;
  const relayUrl = normalizeRelayUrl(target.relayUrl ?? DEFAULT_RELAY_URL);
  const relayUsername = target.relayUsername;
  const sharePath = (route: string, path: string) =>
    `/public-api/shares/${encodeURIComponent(target.secret)}/files${route}?${new URLSearchParams({ path })}`;
  const root = await fetchPublicShareJsonViaRelay<FileContentResponse>({
    relayUrl,
    relayUsername,
    path: sharePath("", target.path),
  });
  if (typeof root.content !== "string")
    throw new Error(enMessages.publicSharePlayNoContent);
  const html = await buildPlayableHtml(root.content, target.path, (path) =>
    fetchPublicShareBlobViaRelay({
      relayUrl,
      relayUsername,
      path: sharePath("/raw", path),
    }),
  );
  const title = target.path.split("/").at(-1) ?? target.path;
  document.title = title;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", PLAY_FRAME_SANDBOX);
  frame.referrerPolicy = "no-referrer";
  frame.title = title;
  frame.srcdoc = html;
  notice.remove();
  document.body.append(frame);
}

main().catch((error: unknown) => {
  notice.textContent = `${enMessages.publicSharePlayFailed} ${
    error instanceof Error ? error.message : String(error)
  }`;
});

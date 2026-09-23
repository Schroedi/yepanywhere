/**
 * Entry for play.html: full-window host for a public share's play document.
 *
 * The document arrives from the opener over a same-origin handshake keyed by
 * the id in the URL fragment and runs only inside the sandboxed frame below,
 * which lacks allow-same-origin and so has an opaque origin. This page holds
 * nothing but the document text and never contacts the share itself.
 */
import enMessages from "./i18n/en.json";
import {
  PLAY_HANDSHAKE_DOCUMENT,
  PLAY_HANDSHAKE_READY,
  type PlayDocumentMessage,
} from "./lib/publicSharePlay";

export const PLAY_FRAME_SANDBOX =
  "allow-scripts allow-popups allow-downloads allow-forms allow-modals";

const notice = document.getElementById("notice") as HTMLParagraphElement;
const id = window.location.hash.slice(1);
const opener = window.opener as Window | null;

if (!id || !opener) {
  notice.textContent = enMessages.publicSharePlayNoOpener;
} else {
  notice.textContent = enMessages.publicSharePlayWaiting;
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source !== opener ||
      event.origin !== window.location.origin ||
      event.data?.type !== PLAY_HANDSHAKE_DOCUMENT ||
      event.data.id !== id ||
      typeof event.data.html !== "string"
    )
      return;
    const message = event.data as PlayDocumentMessage;
    document.title = message.title;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", PLAY_FRAME_SANDBOX);
    frame.referrerPolicy = "no-referrer";
    frame.title = message.title;
    frame.srcdoc = message.html;
    notice.remove();
    document.body.append(frame);
  });
  opener.postMessage(
    { type: PLAY_HANDSHAKE_READY, id },
    window.location.origin,
  );
}

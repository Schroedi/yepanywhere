import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  PLAY_HANDSHAKE_DOCUMENT,
  PLAY_HANDSHAKE_READY,
  type PlayDocumentMessage,
} from "../lib/publicSharePlay";
import styles from "./PublicSharePlayPage.module.css";

/**
 * Full-window host for a public share's play document. The page is trusted
 * hosted-client chrome; the document arrives from the opener over a
 * same-origin handshake and runs only in the opaque-origin sandboxed frame,
 * which has no reach to this origin's storage or to the share.
 */
export const PLAY_FRAME_SANDBOX =
  "allow-scripts allow-popups allow-downloads allow-forms allow-modals";

export function PublicSharePlayPage() {
  const { t } = useI18n();
  const [document, setDocument] = useState<PlayDocumentMessage | null>(null);
  const id = window.location.hash.slice(1);
  const hasOpener = Boolean(window.opener);

  useEffect(() => {
    if (!id || !hasOpener) return;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.opener ||
        event.origin !== window.location.origin ||
        event.data?.type !== PLAY_HANDSHAKE_DOCUMENT ||
        event.data.id !== id ||
        typeof event.data.html !== "string"
      )
        return;
      setDocument(event.data as PlayDocumentMessage);
    };
    window.addEventListener("message", receive);
    (window.opener as Window).postMessage(
      { type: PLAY_HANDSHAKE_READY, id },
      window.location.origin,
    );
    return () => window.removeEventListener("message", receive);
  }, [id, hasOpener]);

  useEffect(() => {
    if (document) window.document.title = document.title;
  }, [document]);

  if (!id || !hasOpener)
    return <p className={styles.notice}>{t("publicSharePlayNoOpener")}</p>;
  if (!document)
    return <p className={styles.notice}>{t("publicSharePlayWaiting")}</p>;
  return (
    <iframe
      className={styles.frame}
      title={document.title}
      sandbox={PLAY_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={document.html}
    />
  );
}

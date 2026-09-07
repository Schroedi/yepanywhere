import {
  serverHasCapability,
  type ArtifactViewerGrant,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  artifactAudience,
  artifactOrigin,
  probeArtifactOrigin,
} from "../lib/artifactPreview";
import { createScriptlessHtmlPreviewDocument } from "../lib/scriptlessHtmlPreview";
import styles from "./ArtifactPreview.module.css";

interface Props {
  html: string;
  path: string;
  projectId?: string;
  title: string;
  className?: string;
}

export function ArtifactPreview(props: Props) {
  const { t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const share = usePublicShareContext();
  const config = version?.artifactViewer;
  const audience = artifactAudience(window.location.hostname);
  const origin =
    config && share === null && serverHasCapability(version, "artifact-viewer")
      ? artifactOrigin(config, audience, window.location.href)
      : undefined;
  const [attempt, setAttempt] = useState(0);
  const [grant, setGrant] = useState<ArtifactViewerGrant | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGrant(null);
    setFailed(false);
    setBusy(false);
    if (!attempt || !origin) return;
    let cancelled = false;
    let admitted: ArtifactViewerGrant | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    setBusy(true);
    const revoke = (id: string) => {
      // Grants also expire server-side if closing while offline prevents revocation.
      void runtime.transport
        .fetch(`/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" })
        .catch(() => {});
    };
    void (async () => {
      try {
        await probeArtifactOrigin(origin, controller.signal);
        clearTimeout(timer);
        if (cancelled) return;
        admitted = await runtime.transport.fetch<ArtifactViewerGrant>(
          "/artifacts",
          {
            method: "POST",
            body: JSON.stringify({
              path: props.path,
              projectId: props.projectId,
              audience,
            }),
          },
        );
        if (new URL(admitted.url).origin !== origin)
          throw new Error("Unexpected artifact origin");
        if (cancelled) {
          revoke(admitted.id);
          return;
        }
        setGrant(admitted);
      } catch {
        if (admitted) revoke(admitted.id);
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      if (admitted) revoke(admitted.id);
    };
  }, [attempt, origin, audience, props.path, props.projectId, runtime]);

  return (
    <div className={`${styles.preview} ${props.className ?? ""}`}>
      {origin && (
        <div className={styles.toolbar}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              grant ? setAttempt(0) : setAttempt((value) => value + 1)
            }
          >
            {t(
              grant
                ? "artifactStop"
                : busy
                  ? "artifactChecking"
                  : failed
                    ? "artifactRetry"
                    : "artifactRun",
            )}
          </button>
          {failed && <span role="status">{t("artifactUnavailable")}</span>}
        </div>
      )}
      {grant ? (
        <iframe
          key={grant.id}
          className={styles.frame}
          title={props.title}
          aria-label={props.title}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          src={grant.url}
        />
      ) : (
        <iframe
          className={styles.frame}
          title={props.title}
          aria-label={props.title}
          data-tooltip=""
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={createScriptlessHtmlPreviewDocument(props.html)}
        />
      )}
    </div>
  );
}

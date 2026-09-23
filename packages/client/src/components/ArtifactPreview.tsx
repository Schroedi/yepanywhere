import { useState } from "react";
import { createPortal } from "react-dom";
import { ViewerModeToggle } from "./ViewerModeToggle";
import { useArtifactGrant } from "../hooks/useArtifactGrant";
import { useI18n } from "../i18n";
import { createScriptlessHtmlPreviewDocument } from "../lib/scriptlessHtmlPreview";
import styles from "./ArtifactPreview.module.css";

interface Props {
  html: string;
  path: string;
  projectId?: string;
  title: string;
  className?: string;
  /** Start only when the owning viewer received an explicit preview click. */
  autoStart?: boolean;
  /** The owning viewer may supply the source/preview toggle in its header. */
  showControls?: boolean;
  toolbarHost?: HTMLElement | null;
}

export function ArtifactPreview(props: Props) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(props.autoStart ? 1 : 0);
  const { origin, grant, busy, failed, frameBlocked } = useArtifactGrant(
    props.path,
    props.projectId,
    attempt,
  );

  const controls = origin && (props.showControls !== false || failed) && (
    <div className={styles.toolbar}>
      <ViewerModeToggle
        mode="interactive"
        source={{ path: props.path, projectId: props.projectId }}
        artifact
        active={Boolean(grant)}
        disabled={busy}
        onToggle={() =>
          grant ? setAttempt(0) : setAttempt((value) => value + 1)
        }
        label={t(
          grant
            ? "artifactStop"
            : busy
              ? "artifactChecking"
              : failed
                ? "artifactRetry"
                : "artifactRun",
        )}
      />
      {failed && <span role="status">{t("artifactUnavailable")}</span>}
    </div>
  );
  return (
    <div className={`${styles.preview} ${props.className ?? ""}`}>
      {props.toolbarHost ? createPortal(controls, props.toolbarHost) : controls}
      {props.showControls === false && busy && (
        <div className={styles.notice} role="status">
          {t("artifactChecking")}
        </div>
      )}
      {props.autoStart && !origin && (
        <div className={styles.notice} role="status">
          {t("artifactUnavailable")}
        </div>
      )}
      {grant && frameBlocked ? (
        <div className={styles.notice} role="alert">
          <p>{t("artifactFrameBlocked")}</p>
          <a href={grant.url} target="_blank" rel="noopener noreferrer">
            {t("artifactOpenTab")}
          </a>
        </div>
      ) : grant ? (
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

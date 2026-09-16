import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useSessionRightPane } from "../hooks/useSessionRightPane";
import { useI18n } from "../i18n";
import { createLocalStorageValue } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";
import styles from "./SessionRightPane.module.css";
import { ViewerWindowActions } from "./ViewerWindowActions";

type Pane = ReturnType<typeof useSessionRightPane>;
const widthStore = createLocalStorageValue(
  UI_KEYS.sessionRightPaneWidth,
  480,
  (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 280 && value <= 1600
      ? value
      : undefined;
  },
);

export function SessionAppAction({ pane }: { pane: Pane }) {
  const { t } = useI18n();
  const app = pane.apps.at(-1);
  if (!app) return null;
  return pane.enabled ? (
    <button
      className={styles.launcher}
      type="button"
      onClick={() => pane.select(app.url)}
      title={app.label}
    >
      {t("sessionRightPaneApps")}
    </button>
  ) : (
    <a
      className={styles.launcher}
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      title={app.label}
    >
      {t("sessionRightPaneApps")} ↗
    </a>
  );
}

/** A session right pane keeps its selected frame mounted while hidden. */
export function SessionRightPane({
  pane,
  wide,
}: {
  pane: Pane;
  wide: boolean;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(widthStore.read);
  const [dragging, setDragging] = useState(false);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const url = pane.selected?.url;
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    parent?.style.setProperty("--session-right-pane-width", `${width}px`);
    return () => {
      parent?.style.removeProperty("--session-right-pane-width");
    };
  }, [width, url]);
  useEffect(() => {
    if (!url) return;
    const blocked = (event: SecurityPolicyViolationEvent) => {
      if (
        event.effectiveDirective === "frame-src" &&
        (event.blockedURI === url || event.blockedURI === new URL(url).origin)
      )
        setBlockedUrl(url);
    };
    document.addEventListener("securitypolicyviolation", blocked);
    return () =>
      document.removeEventListener("securitypolicyviolation", blocked);
  }, [url]);
  useEffect(() => {
    if (wide || !pane.expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") pane.hide();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [wide, pane.expanded, pane.hide]);
  if (!pane.selected) return null;
  function resize(value: number) {
    const next = Math.max(280, Math.min(1600, value));
    setWidth(next);
    return next;
  }
  return (
    <>
      {!wide && pane.expanded && (
        <button
          type="button"
          className={styles.backdrop}
          onClick={pane.hide}
          aria-label={t("sessionRightPaneHide")}
        />
      )}
      <aside
        ref={root}
        aria-label={t("sessionRightPaneLabel")}
        className={`${styles.pane} ${!pane.expanded ? styles.hidden : ""}`}
      >
        {wide && (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={t("sessionRightPaneResize")}
            aria-valuemin={280}
            aria-valuemax={1600}
            aria-valuenow={width}
            className={styles.splitter}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              const right = root.current?.getBoundingClientRect().right;
              if (right !== undefined) resize(right - event.clientX);
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              widthStore.set(width);
              setDragging(false);
            }}
            onLostPointerCapture={() => setDragging(false)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowLeft"
                  ? width + 20
                  : event.key === "ArrowRight"
                    ? width - 20
                    : event.key === "Home"
                      ? 280
                      : event.key === "End"
                        ? 1600
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              widthStore.set(resize(next));
            }}
          />
        )}
        <header className={styles.header}>
          <span className={styles.title}>{pane.selected.label}</span>
          <ViewerWindowActions
            url={pane.selected.url}
            onMinimize={pane.hide}
            onClose={pane.close}
            minimizeLabel={t("sessionRightPaneHide")}
            closeLabel={t("sessionRightPaneClose")}
          />
        </header>
        {blockedUrl === url ? (
          <p className={styles.error}>{t("sessionRightPaneFrameBlocked")}</p>
        ) : (
          <iframe
            key={url}
            src={url}
            title={pane.selected.label}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            className={styles.frame}
          />
        )}
        {dragging && <div className={styles.dragShield} />}
      </aside>
    </>
  );
}

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { getChrome } from "../chrome";
import styles from "./SidePanel.module.css";
import type { CurrentTab } from "./useCurrentTab";

/** Site permission is independent of issue recognition and host sign-in. */
export function SiteAccess({ tab }: { tab: CurrentTab }) {
  let origin: string | undefined;
  if (tab.url) {
    try {
      const url = new URL(tab.url);
      // Chrome cannot grant access to its own pages or other extensions.
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      origin = url.origin;
    } catch {
      return null;
    }
  }
  if (!getChrome() || (!origin && tab.tabId === undefined)) return null;
  return (
    <SiteAccessRequest
      key={`${tab.tabId}:${origin}`}
      origin={origin}
      tabId={tab.tabId}
    />
  );
}

function SiteAccessRequest({
  origin,
  tabId,
}: {
  origin?: string;
  tabId?: number;
}) {
  const { t } = useI18n();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [request, setRequest] = useState<
    "idle" | "waiting" | "requested" | "denied" | "error"
  >("idle");
  const chrome = getChrome();

  useEffect(() => {
    if (!chrome || !origin) return;
    let disposed = false;
    let revision = 0;
    const check = () => {
      const current = ++revision;
      void chrome.permissions.contains({ origins: [`${origin}/*`] }).then(
        (value) => {
          if (!disposed && current === revision) setGranted(value);
        },
        () => {
          if (!disposed && current === revision) setGranted(false);
        },
      );
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      disposed = true;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [chrome, origin]);

  if (!chrome || (origin && granted !== false)) return null;
  const needsToolbar = !origin && !chrome.permissions.addHostAccessRequest;
  const site = origin ? new URL(origin).host : undefined;
  const requestSite = () => {
    setRequest("waiting");
    // Keep permissions.request in the click's gesture; no preceding await.
    const result = origin
      ? chrome.permissions.request({ origins: [`${origin}/*`] })
      : tabId !== undefined && chrome.permissions.addHostAccessRequest
        ? chrome.permissions.addHostAccessRequest({ tabId })
        : undefined;
    void result?.then(
      (accepted) => {
        if (origin && accepted) setGranted(true);
        setRequest(accepted === false ? "denied" : "requested");
      },
      () => setRequest("error"),
    );
  };

  return (
    <section className={`${styles.context} ${styles.siteAccess}`}>
      <h2>{t("extensionPanelSiteAccessTitle")}</h2>
      <p>
        {site
          ? t("extensionPanelSiteAccessKnownHint", { site })
          : t("extensionPanelSiteAccessUnknownHint")}
      </p>
      {needsToolbar ? (
        <p>{t("extensionPanelSiteAccessToolbarHint")}</p>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={requestSite}
          disabled={request === "waiting"}
        >
          {site
            ? t("extensionPanelAllowNamedSite", { site })
            : t("extensionPanelAllowCurrentSite")}
        </button>
      )}
      {!origin && request === "requested" && (
        <p role="status">{t("extensionPanelSiteAccessRequested")}</p>
      )}
      {(request === "error" || request === "denied") && (
        <p role="alert">
          {t(
            request === "denied"
              ? "extensionPanelSiteAccessDenied"
              : "extensionPanelSiteAccessFailed",
          )}
        </p>
      )}
    </section>
  );
}

import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import type { Message } from "../types";
import {
  sessionToolUrls,
  sessionVhostApp,
  type SessionVhostApp,
} from "../lib/sessionVhostApps";
import { useSessionRightPaneSetting } from "./useSessionRightPaneSetting";
import {
  clearSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
  useSessionViewerController,
} from "../lib/sessionViewerController";

function emptyPane(key: string) {
  return {
    key,
    apps: [] as SessionVhostApp[],
  };
}

/** Session right pane discovery and selection; parked routes do no discovery. */
export function useSessionRightPane(
  key: string,
  messages: readonly Message[],
  config: ArtifactViewerStatus | undefined,
  active: boolean,
  sessionId: string,
) {
  const { sessionRightPaneEnabled } = useSessionRightPaneSetting();
  const controller = useSessionViewerController();
  const [state, setState] = useState(() => emptyPane(key));
  const current = state.key === key ? state : emptyPane(key);
  if (state.key !== key) setState(current);

  useEffect(() => {
    if (!active || !config?.vhosts?.length) return;
    const found = new Map<string, SessionVhostApp>();
    for (const message of messages) {
      for (const raw of sessionToolUrls(message)) {
        const app = sessionVhostApp(raw, config, window.location.href);
        if (app) found.set(app.url, app);
      }
    }
    setState((previous) => {
      if (previous.key !== key) return previous;
      const known = new Set(previous.apps.map((app) => app.url));
      const added = [...found.values()].filter((app) => !known.has(app.url));
      const latest = added.at(-1);
      if (!latest) return previous;
      return {
        ...previous,
        apps: [...previous.apps, ...added],
      };
    });
  }, [active, config, key, messages, sessionRightPaneEnabled]);

  const apps = current.apps.filter(
    (app) =>
      sessionVhostApp(app.sourceUrl, config, window.location.href)?.url ===
      app.url,
  );
  const latest = apps.at(-1);
  const announced = useRef(new Set<string>());
  const latestId = latest ? `vhost:${key}:${latest.url}` : undefined;
  useEffect(() => {
    if (!active || !latest || !latestId || announced.current.has(latestId))
      return;
    announced.current.add(latestId);
    if (sessionRightPaneEnabled)
      presentSessionViewer({
        id: latestId,
        kind: "vhost",
        sessionId,
        label: latest.label,
        url: latest.url,
      });
  }, [active, latest, latestId, sessionId, sessionRightPaneEnabled]);
  const owned =
    controller?.kind === "vhost" &&
    controller.sessionId === sessionId &&
    controller.id.startsWith(`vhost:${key}:`)
      ? controller
      : undefined;
  const selected =
    sessionRightPaneEnabled && owned
      ? apps.find((app) => app.url === owned.url)
      : undefined;
  useEffect(() => {
    if (owned && !selected) clearSessionViewer(owned.id);
  }, [owned, selected]);
  const select = (url: string) => {
    const app = apps.find((app) => app.url === url);
    if (!app || !sessionRightPaneEnabled) return;
    const id = `vhost:${key}:${url}`;
    presentSessionViewer({
      id,
      kind: "vhost",
      sessionId,
      label: app.label,
      url,
    });
    restoreSessionViewer(id);
  };
  return {
    apps,
    selected,
    expanded: !!selected && !owned?.minimized,
    enabled: sessionRightPaneEnabled,
    select,
    hide: () => owned?.minimize(),
    close: () => owned?.close(),
  };
}

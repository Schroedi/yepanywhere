import {
  NON_HUMAN_USER_TURN_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { useVersion } from "./useVersion";

interface NavigationOptions {
  sessionId: string | undefined;
  messages: readonly { id?: string; uuid?: string }[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  olderCursor?: string;
  loadOlder(): Promise<void>;
  jump(messageId: string, onResolved: (found: boolean) => void): void;
  onError(kind: "unavailable" | "acknowledgement"): void;
}

export function useNonHumanUserTurnNavigation(options: NavigationOptions) {
  const location = useLocation();
  const sourceKey = useClientSummarySourceKey();
  const { version } = useVersion();
  const target = new URLSearchParams(location.search).get("nonHumanTurn");
  const key = JSON.stringify([
    sourceKey,
    options.sessionId,
    location.key,
    target,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const handled = useRef<string | undefined>(undefined);
  const attemptedPage = useRef<string | undefined>(undefined);
  const inFlightPage = useRef<string | undefined>(undefined);
  const [completedLoads, setCompletedLoads] = useState(0);

  useEffect(() => {
    currentKey.current = key;
    return () => {
      currentKey.current = "";
    };
  }, [key]);

  useEffect(() => {
    if (
      !target ||
      !options.sessionId ||
      options.loading ||
      options.loadingOlder ||
      handled.current === key ||
      !serverHasCapability(version, NON_HUMAN_USER_TURN_CAPABILITY)
    )
      return;
    if (
      !options.messages.some(
        (message) => (message.uuid ?? message.id) === target,
      )
    ) {
      const pageKey = JSON.stringify([key, options.olderCursor]);
      if (inFlightPage.current === key) return;
      if (
        options.hasOlder &&
        options.olderCursor &&
        attemptedPage.current !== pageKey
      ) {
        attemptedPage.current = pageKey;
        inFlightPage.current = key;
        void options
          .loadOlder()
          .catch(() => {
            if (currentKey.current === key) {
              handled.current = key;
              options.onError("unavailable");
            }
          })
          .finally(() => {
            if (inFlightPage.current === key) inFlightPage.current = undefined;
            if (currentKey.current === key)
              setCompletedLoads((count) => count + 1);
          });
        return;
      }
      handled.current = key;
      options.onError("unavailable");
      return;
    }
    handled.current = key;
    const sessionId = options.sessionId;
    options.jump(target, (found) => {
      if (currentKey.current !== key) return;
      if (!found) {
        options.onError("unavailable");
        return;
      }
      void api
        .markSessionSeen(sessionId, undefined, target, target)
        .catch(() => {
          if (currentKey.current === key) options.onError("acknowledgement");
        });
    });
  }, [key, target, version, options, completedLoads]);
}

import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.sessionRightPane, false);

export function useSessionRightPaneSetting() {
  const sessionRightPaneEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { sessionRightPaneEnabled, setSessionRightPaneEnabled: store.set };
}

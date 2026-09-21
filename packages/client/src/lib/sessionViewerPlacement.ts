import { createLocalStorageBoolean } from "./localStorageValue";
import type { SessionViewerRegistration } from "./sessionViewerController";
import { UI_KEYS } from "./storageKeys";

export const sessionRightPaneSetting = createLocalStorageBoolean(
  UI_KEYS.sessionRightPane,
  false,
);

/**
 * Right pane viewers leave the session transcript live beside them.
 *
 * Every session-owned viewer the setting covers answers here, so a detail
 * panel published from a tool row lands in the pane on the same terms as a
 * file viewer rather than covering the transcript.
 */
export function sessionViewerUsesRightPane(
  viewer: SessionViewerRegistration,
): boolean {
  if (viewer.kind === "vhost") return true;
  if (!viewer.sessionId || !sessionRightPaneSetting.read()) return false;
  if (viewer.kind === "panel") return true;
  return viewer.kind === "file" && !!viewer.supportsRightPane;
}

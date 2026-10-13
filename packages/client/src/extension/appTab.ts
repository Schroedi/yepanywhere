/**
 * Opening YA routes in the extension's app tab from the side panel or the
 * background worker. The tab navigates inside the app, keeping its
 * connections and state, rather than reloading.
 */

import { getChrome, type ChromeTab } from "./chrome";

export const NAVIGATE_MESSAGE = "ya-extension-navigate";

/**
 * `chrome.storage.session` record of the tab the toolbar button was clicked
 * on, written by the background worker for the side panel.
 */
export const CLICKED_TAB_KEY = "ya.clickedTab";

export interface NavigateMessage {
  type: typeof NAVIGATE_MESSAGE;
  tabId: number;
  path: string;
}

export function isNavigateMessage(value: unknown): value is NavigateMessage {
  const message = value as Partial<NavigateMessage> | null;
  return (
    !!message &&
    message.type === NAVIGATE_MESSAGE &&
    typeof message.tabId === "number" &&
    typeof message.path === "string" &&
    message.path.startsWith("/")
  );
}

/**
 * `chrome.storage.session` list of tab ids showing the YA app. Without the
 * `tabs` permission Chrome hides even this extension's own tab URLs, so app
 * tabs register themselves instead of being found by URL.
 */
const APP_TABS_KEY = "ya.appTabs";

async function appTabIds(): Promise<number[]> {
  const chrome = getChrome();
  const stored = chrome
    ? (await chrome.storage.session.get(APP_TABS_KEY))[APP_TABS_KEY]
    : undefined;
  return Array.isArray(stored)
    ? stored.filter((id): id is number => typeof id === "number")
    : [];
}

/** Record the calling page's tab as an app tab until it unloads. */
export async function registerAppTab(): Promise<() => void> {
  const chrome = getChrome();
  const tab = await chrome?.tabs.getCurrent().catch(() => undefined);
  if (!chrome || tab?.id === undefined) return () => {};
  const id = tab.id;
  await chrome.storage.session.set({
    [APP_TABS_KEY]: [
      ...(await appTabIds()).filter((other) => other !== id),
      id,
    ],
  });
  const unregister = () =>
    void appTabIds().then((ids) =>
      chrome.storage.session.set({
        [APP_TABS_KEY]: ids.filter((other) => other !== id),
      }),
    );
  window.addEventListener("pagehide", unregister);
  return () => {
    window.removeEventListener("pagehide", unregister);
    unregister();
  };
}

/** The most recently used tab showing the YA app, if any. */
export async function findAppTab(): Promise<ChromeTab | undefined> {
  const chrome = getChrome();
  if (!chrome) return undefined;
  // Never the caller's own tab (the panel page opened in a tab, say).
  const own = await chrome.tabs.getCurrent().catch(() => undefined);
  const tabs = await Promise.all(
    (await appTabIds())
      .filter((id) => id !== own?.id)
      .map((id) => chrome.tabs.get(id).catch(() => null)),
  );
  return tabs
    .filter((tab): tab is ChromeTab => tab?.id !== undefined)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/** Show `path` in the YA tab, or in a new one when asked or when none exists. */
export async function openInApp(
  path: string,
  options: { newTab?: boolean } = {},
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const tab = options.newTab ? undefined : await findAppTab();
  if (tab?.id === undefined) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    return;
  }
  const message: NavigateMessage = {
    type: NAVIGATE_MESSAGE,
    tabId: tab.id,
    path,
  };
  const handled = await chrome.runtime.sendMessage(message).catch(() => false);
  // A tab still loading, or on the sign-in page, does not answer: load the URL.
  await chrome.tabs.update(
    tab.id,
    handled === true
      ? { active: true }
      : { active: true, url: chrome.runtime.getURL(path) },
  );
  await chrome.windows.update(tab.windowId, { focused: true });
}

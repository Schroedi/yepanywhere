/**
 * Opening YA routes in the extension's app tab from the side panel or the
 * background worker. The tab navigates inside the app, keeping its
 * connections and state, rather than reloading.
 */

import { getChrome, type ChromeTab } from "./chrome";
import { loadExtensionSettings } from "./settings";

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

/**
 * `chrome.storage.session` key of an app tab's current route, which the app
 * tab publishes for the side panel for the same reason.
 */
export function appTabRouteKey(tabId: number): string {
  return `ya.appTabRoute.${tabId}`;
}

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

/**
 * `chrome.storage.local` size and place of the last YA popup window, saved by
 * the popup itself, since Chrome does not remember them for created windows.
 */
const POPUP_BOUNDS_KEY = "ya.popupBounds";

interface PopupBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_POPUP_SIZE = { width: 480, height: 860 };

function isPopupBounds(value: unknown): value is PopupBounds {
  const bounds = value as Partial<PopupBounds> | null;
  return (
    !!bounds &&
    [bounds.left, bounds.top, bounds.width, bounds.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  );
}

/**
 * Open `path` in a new app page: a tab, or a popup window when preferred or
 * asked for.
 */
export async function createAppPage(
  path: string,
  options: { popup?: boolean } = {},
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const url = chrome.runtime.getURL(path);
  if (!options.popup && (await loadExtensionSettings()).appWindow !== "popup") {
    await chrome.tabs.create({ url });
    return;
  }
  const saved = (await chrome.storage.local.get(POPUP_BOUNDS_KEY))[
    POPUP_BOUNDS_KEY
  ];
  const popup = { url, type: "popup", focused: true } as const;
  // Chrome rejects bounds mostly off every display, as after unplugging one.
  await chrome.windows
    .create({
      ...popup,
      ...(isPopupBounds(saved) ? saved : DEFAULT_POPUP_SIZE),
    })
    .catch(() => chrome.windows.create({ ...popup, ...DEFAULT_POPUP_SIZE }));
}

/** Bring the YA tab forward as it is, or open a new app page. */
export async function focusOrOpenApp(): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const tab = await findAppTab();
  if (tab?.id === undefined) {
    await createAppPage("/");
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/** In a YA popup window, save its size and place for the next popup. */
export function rememberPopupBounds(): () => void {
  const chrome = getChrome();
  if (!chrome) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    const bounds: PopupBounds = {
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    };
    void chrome.storage.local
      .set({ [POPUP_BOUNDS_KEY]: bounds })
      .catch(() => {});
  };
  const resized = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  let attached = false;
  let disposed = false;
  void chrome.windows
    .getCurrent()
    .catch(() => undefined)
    .then((current) => {
      if (disposed || current?.type !== "popup") return;
      attached = true;
      // Moving a window fires no event a page can see; closing saves it.
      window.addEventListener("resize", resized);
      window.addEventListener("pagehide", save);
    });
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (!attached) return;
    window.removeEventListener("resize", resized);
    window.removeEventListener("pagehide", save);
  };
}

/** Show `path` in the YA tab, or in a new page when asked or when none exists. */
export async function openInApp(
  path: string,
  options: { newTab?: boolean } = {},
): Promise<void> {
  const chrome = getChrome();
  if (!chrome) return;
  const tab = options.newTab ? undefined : await findAppTab();
  if (tab?.id === undefined) {
    await createAppPage(path);
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

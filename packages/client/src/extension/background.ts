/**
 * Background worker of the Chrome extension (docs/tactical/151).
 *
 * - Serves the app shell for path navigations, so reloads and deep links
 *   work under BrowserRouter.
 * - Runs the toolbar button: open the side panel, or focus the YA tab.
 * - Looks up issue pages on granted sites as tabs navigate and puts the
 *   session count on the toolbar badge.
 *
 * Chrome stops this worker when idle. It holds no state it cannot rebuild:
 * saved hosts come from the pages' mirror in `chrome.storage.local`, and
 * host connections are reopened on demand.
 */

import { issueLookupUrl } from "@yep-anywhere/shared";
import { CLICKED_TAB_KEY, findAppTab } from "./appTab";
import { getChrome } from "./chrome";
import { countIssueSessions } from "./lookup";
import {
  activeHosts,
  loadMirroredHosts,
  mirroredHostCredentials,
} from "./savedHosts";
import {
  allowlistPermits,
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
  loadExtensionSettings,
  subscribeExtensionSettings,
} from "./settings";

/** The parts of the service-worker scope used here; the client has no WebWorker lib. */
interface FetchEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
const worker = globalThis as unknown as {
  location: Location;
  addEventListener(
    type: "fetch",
    listener: (event: FetchEventLike) => void,
  ): void;
};

const APP_ENTRY = "/index.html";
const LOOKUP_DELAY_MS = 800;
const COUNT_TTL_MS = 2 * 60_000;
const COUNT_CACHE_PREFIX = "ya.count.";

const chrome = getChrome()!;

// The toolbar click must open the side panel within its user gesture, so
// the setting it consults is kept in memory rather than read on click.
let settings: ExtensionSettings = DEFAULT_EXTENSION_SETTINGS;
const settingsReady = loadExtensionSettings().then((loaded) => {
  settings = loaded;
});
subscribeExtensionSettings((next) => {
  settings = next;
  if (next.badge === "off" || !next.automaticLookup) void clearAllBadges();
});

// The client routes by path (/-/relay/<user>/projects/...), but the extension
// holds only packaged files. Answer navigations to any other path with the app
// shell, as a web host's SPA fallback would, so reloads and deep links work.
worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return;
  event.respondWith(fetch(APP_ENTRY));
});

chrome.runtime.onInstalled.addListener(() => {
  // The worker decides per click, since the toolbar setting can change.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener((tab) => {
  if (settings.toolbarAction === "side-panel") {
    // Call open first: it must run inside the click's user gesture.
    const opening = chrome.sidePanel.open({ windowId: tab.windowId });
    // The click grants activeTab, so the URL is readable now even on a site
    // without granted access; the panel looks that page up once.
    if (tab.id !== undefined)
      void chrome.storage.session.set({
        [CLICKED_TAB_KEY]: { tabId: tab.id, url: tab.url },
      });
    void opening.catch(() => {});
    return;
  }
  void focusAppTab();
});

async function focusAppTab(): Promise<void> {
  const tab = await findAppTab();
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("/") });
}

// --- Automatic lookup and the badge ---------------------------------------

const pending = new Map<number, ReturnType<typeof setTimeout>>();
const shown = new Map<number, string>();

async function setBadge(tabId: number, text: string): Promise<void> {
  if (shown.get(tabId) === text) return;
  shown.set(tabId, text);
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function clearAllBadges(): Promise<void> {
  for (const tabId of [...shown.keys()]) await setBadge(tabId, "");
}

async function cachedCount(
  identity: string,
  compute: () => Promise<number | null>,
): Promise<number | null> {
  const key = `${COUNT_CACHE_PREFIX}${identity}`;
  const cached = (await chrome.storage.session.get(key))[key] as
    | { count: number; at: number }
    | undefined;
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;
  const count = await compute();
  if (count !== null)
    await chrome.storage.session.set({ [key]: { count, at: Date.now() } });
  return count;
}

async function lookUpTab(tabId: number, url: string | undefined) {
  await settingsReady;
  const reference = url ? issueLookupUrl(url) : null;
  if (
    !url ||
    !reference ||
    !settings.automaticLookup ||
    settings.badge === "off" ||
    !allowlistPermits(settings.lookupAllowlist, reference.key)
  ) {
    await setBadge(tabId, "");
    return;
  }
  const hosts = activeHosts(await loadMirroredHosts(), settings);
  if (hosts.length === 0) return;
  const count = await cachedCount(reference.identity, () =>
    countIssueSessions(url, hosts, {
      includeDismissed: settings.includeDismissed,
      credentials: mirroredHostCredentials,
    }),
  );
  // The tab may have moved on while the hosts answered.
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.url !== url) return;
  await setBadge(tabId, count ? String(count) : "");
}

function schedule(tabId: number, url: string | undefined): void {
  clearTimeout(pending.get(tabId));
  pending.set(
    tabId,
    setTimeout(() => {
      pending.delete(tabId);
      void lookUpTab(tabId, url).catch(() => {});
    }, LOOKUP_DELAY_MS),
  );
}

// `tab.url` is present only for sites the user granted, so this sees nothing
// else. GitHub and Jira change URLs in place; each change is a new lookup.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "loading") {
    // A navigation ends the toolbar click's one-page grant, and with it the
    // address this worker recorded for the side panel.
    void chrome.storage.session.get(CLICKED_TAB_KEY).then((stored) => {
      const clicked = stored[CLICKED_TAB_KEY] as { tabId?: number } | undefined;
      if (clicked?.tabId === tabId)
        void chrome.storage.session.remove(CLICKED_TAB_KEY);
    });
  }
  if (change.url !== undefined || change.status === "complete")
    schedule(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(pending.get(tabId));
  pending.delete(tabId);
  shown.delete(tabId);
});

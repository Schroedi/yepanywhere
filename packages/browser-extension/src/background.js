// Extension service worker for the Chrome extension client (tactical 151).

const APP_ENTRY = "/index.html";

// Focus an open YA tab, or open one.
chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({
    url: chrome.runtime.getURL("*"),
  });
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("/") });
});

// The client routes by path (/-/relay/<user>/projects/...), but the extension
// holds only packaged files. Answer navigations to any other path with the app
// shell, as a web host's SPA fallback would, so reloads and deep links work.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return;
  event.respondWith(fetch(APP_ENTRY));
});

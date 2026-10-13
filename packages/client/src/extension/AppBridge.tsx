import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNavigateMessage, registerAppTab } from "./appTab";
import { getChrome } from "./chrome";
import { installSavedHostsMirror } from "./savedHosts";

/**
 * Mounted only in the extension's app tab: mirrors saved hosts for the
 * background worker and lets the side panel navigate this tab in place.
 */
export default function ExtensionAppBridge() {
  const navigate = useNavigate();
  useEffect(() => installSavedHostsMirror(), []);
  useEffect(() => {
    const registration = registerAppTab();
    return () => void registration.then((unregister) => unregister());
  }, []);
  useEffect(() => {
    const chrome = getChrome();
    if (!chrome) return;
    let ownTabId: number | undefined;
    void chrome.tabs.getCurrent().then((tab) => {
      ownTabId = tab?.id;
    });
    const onMessage = (
      message: unknown,
      _sender: unknown,
      respond: (response: unknown) => void,
    ) => {
      if (!isNavigateMessage(message) || message.tabId !== ownTabId) return;
      navigate(message.path);
      respond(true);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [navigate]);
  return null;
}

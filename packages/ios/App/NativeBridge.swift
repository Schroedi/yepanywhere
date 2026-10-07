import Foundation
import WebKit

enum BridgeFailure: Error {
  case staleDocument, overflow, closed, invalidCommand
}

/// The bundled document's native control channel. The document connects to
/// its server through the ordinary web transport with the profile's resume
/// credential (topics/mobile-server-pairing.md § Bundled Web Client
/// Transport), so no
/// application traffic crosses this bridge.
@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  private(set) var document = UUID().uuidString
  private(set) var closed = false
  private let profileID: String
  private var committed = false
  #if DEBUG
    private var keyboardObserver: NSObjectProtocol?
  #endif
  private var inboundJobs = 0
  weak var webView: WKWebView?
  var routeChanged: (String) -> Void = { _ in }
  var switchHost: () -> Void = {}
  var openExternal: (URL) -> Void = { UIApplication.shared.open($0) }
  var notificationStatus: () async -> [String: Any] = {
    [
      "firebase": "unavailable", "permission": "not_requested", "channel": "not_supported",
      "installation": "unavailable", "notificationsEnabled": false,
    ]
  }
  var requestPermission: () async -> [String: Any] = {
    [
      "firebase": "unavailable", "permission": "not_requested", "channel": "not_supported",
      "installation": "unavailable", "notificationsEnabled": false,
    ]
  }
  /// The profile's resume credential; nil leaves the session features unadvertised.
  var sessionCredential: (() async throws -> [String: Any])?
  /// Answers a rejected session: a newer credential, or nil while native
  /// sign-in or resume replaces this document.
  var reauthenticateSession: ((String) async throws -> [String: Any]?)?

  init(profileID: String) { self.profileID = profileID }

  func makeWebView(root: URL) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    configuration.allowsAirPlayForMediaPlayback = false
    #if DEBUG
      InputAcceptance.install(configuration)
    #endif
    configuration.setURLSchemeHandler(BundledAssets(root: root), forURLScheme: BundledAssets.scheme)
    if #available(iOS 17.0, *), let id = UUID(uuidString: profileID) {
      configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: id)
    } else {
      configuration.websiteDataStore = .nonPersistent()
    }
    configuration.userContentController.add(self, name: "ya")
    let token = String(
      data: try! JSONSerialization.data(withJSONObject: document, options: .fragmentsAllowed),
      encoding: .utf8)!
    let bootstrap = """
      (() => {
        const documentToken = \(token);
        const port = { onmessage: null, postMessage(data) {
          if (typeof data !== 'string') throw new Error('iOS native host requires string messages');
          window.webkit.messageHandlers.ya.postMessage({ document: documentToken, channel: 'control', data });
        }};
        Object.defineProperty(window, 'yaNative', { value: port, configurable: false });
        const reportRoute = () => window.webkit.messageHandlers.ya.postMessage({document:documentToken,channel:'route',data:location.pathname+location.search+location.hash});
        for (const method of ['pushState','replaceState']) {
          const original = history[method];
          history[method] = function(...args) { const result=original.apply(this,args);reportRoute();return result; };
        }
        window.addEventListener('popstate',reportRoute);
        window.addEventListener('DOMContentLoaded',reportRoute);
        Object.defineProperty(window, '__yaNativeReceive', { value(data, token) {
          if (token !== documentToken) return;
          window.yaNative.onmessage?.({ data });
        }});
      })();
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    if #available(iOS 16.4, *) { view.isInspectable = false }
    webView = view
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-qa-input-metrics") {
        keyboardObserver = NotificationCenter.default.addObserver(
          forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main
        ) { [weak view] _ in
          Task { @MainActor in
            _ = try? await view?.evaluateJavaScript(
              "window.dispatchEvent(new Event('yaKeyboardShown'))")
          }
        }
      }
    #endif
    return view
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard !closed, message.frameInfo.isMainFrame,
      let url = message.frameInfo.request.url,
      url.scheme == BundledAssets.scheme, url.host == BundledAssets.host,
      let body = message.body as? [String: Any], body["document"] as? String == document,
      let text = body["data"] as? String, let channel = body["channel"] as? String
    else { return }
    guard inboundJobs < 32 else { fail(); return }
    inboundJobs += 1
    Task {
      defer { inboundJobs -= 1 }
      guard !closed else { return }
      do {
        if channel == "control" {
          try await control(text)
        } else if channel == "route", text.utf8.count <= 4096, text.hasPrefix("/"),
          !text.hasPrefix("//")
        {
          routeChanged(text)
        }
      } catch { fail() }
    }
  }

  private func control(_ text: String) async throws {
    guard text.utf8.count <= 16_384,
      let command = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
      command["protocol"] as? Int == 1, let id = command["id"] as? String, id.utf8.count <= 128,
      let method = command["method"] as? String
    else { throw BridgeFailure.invalidCommand }
    let params = command["params"] as? [String: Any] ?? [:]
    let result: [String: Any]
    switch method {
    case "host.describe":
      result = [
        "protocol": 1, "platform": "ios",
        "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
          ?? "0.1.0", "buildVersion": 1,
        "features": ["notifications.status", "notifications.requestPermission"]
          + (sessionCredential == nil ? [] : NativeSessionCredential.features),
      ]
    case "notifications.status": result = await notificationStatus()
    case "notifications.requestPermission": result = await requestPermission()
    case "session.credential":
      guard let sessionCredential else { throw BridgeFailure.invalidCommand }
      do { result = try await sessionCredential() } catch {
        try await deliverUnavailable(id); return
      }
    case "session.reauthenticate":
      guard let reauthenticateSession, let rejected = params["rejectedSessionId"] as? String,
        !rejected.isEmpty
      else { throw BridgeFailure.invalidCommand }
      do {
        // Nil: native sign-in or resume replaces this document; no reply.
        guard let replacement = try await reauthenticateSession(rejected) else { return }
        result = replacement
      } catch {
        try await deliverUnavailable(id); return
      }
    case "host.switch":
      guard sessionCredential != nil else { throw BridgeFailure.invalidCommand }
      switchHost(); return
    default: throw BridgeFailure.invalidCommand
    }
    try await deliver(json(["protocol": 1, "id": id, "ok": true, "result": result]))
  }

  private func deliverUnavailable(_ id: String) async throws {
    try await deliver(
      json([
        "protocol": 1, "id": id, "ok": false,
        "error": ["code": "unavailable", "message": "Native session is unavailable"],
      ]))
  }

  private func json(_ value: [String: Any]) -> String {
    String(
      data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8), encoding: .utf8
    ) ?? "{}"
  }

  private func deliver(_ text: String) async throws {
    guard !closed, let view = webView else { throw BridgeFailure.closed }
    _ = try await view.callAsyncJavaScript(
      "window.__yaNativeReceive(data, token)",
      arguments: ["data": text, "token": document], in: nil, contentWorld: .page)
  }

  func close() {
    guard !closed else { return }
    closed = true
    #if DEBUG
      if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) }
      keyboardObserver = nil
    #endif
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "ya")
  }

  private func fail() { guard !closed else { return }; close(); switchHost() }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
    if navigationAction.targetFrame?.isMainFrame != false {
      if url.scheme != BundledAssets.scheme || url.host != BundledAssets.host {
        if navigationAction.navigationType == .linkActivated,
          ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil
        {
          openExternal(url)
        }
        decisionHandler(.cancel); return
      }
      if committed { close(); decisionHandler(.cancel); switchHost(); return }
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { committed = true }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { close(); switchHost() }
}

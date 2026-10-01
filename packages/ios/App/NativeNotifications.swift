import FirebaseCore
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

@MainActor
final class NativeNotifications: NSObject, UNUserNotificationCenterDelegate {
  var openHost: (String) -> Void = { _ in }
  private let store: HostStore
  private let broker: PushBroker
  private var observer: NSObjectProtocol?
  private var active = true
  private var registerAgain = false
  private var work: Task<Void, Never>?
  init(
    store: HostStore = HostStore(service: "com.yepanywhere.ios.push.v1"),
    broker: PushBroker = PushBroker()
  ) {
    self.store = store; self.broker = broker
    super.init()
    UNUserNotificationCenter.current().delegate = self
    observer = NotificationCenter.default.addObserver(
      forName: .yaPushToken, object: nil, queue: .main
    ) { [weak self] note in
      guard let token = note.object as? String else { return }
      Task { @MainActor [weak self] in self?.receiveToken(token) }
    }
  }
  deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; work?.cancel() }
  private func installation() -> BrokerInstallation? {
    guard let data = try? store.read("installation"), data.count <= 8192 else { return nil }
    guard let value = try? JSONDecoder().decode(BrokerInstallation.self, from: data),
      PushBroker.validOpaqueID(value.installationId),
      PushBroker.validSecret(value.installationSecret)
    else { return nil }
    return value
  }
  private func pendingToken() -> String? {
    guard let data = try? store.read("token"), data.count <= 4096 else { return nil }
    return String(data: data, encoding: .utf8)
  }
  func receiveToken(_ token: String) {
    guard !token.isEmpty, token.utf8.count <= 4096 else { return }
    do { try store.write("token", Data(token.utf8)); register() } catch { return }
  }
  private func register() {
    guard active else { return }
    guard work == nil else { registerAgain = true; return }
    work = Task { [weak self] in
      guard let self else { return }
      defer {
        self.work = nil
        if self.registerAgain, self.active { self.registerAgain = false; self.register() }
      }
      // Rotation is serialized. Persist every returned management secret
      // before processing a newer token; callbacks cannot orphan it.
      for _ in 0..<3 {
        guard !Task.isCancelled, let token = pendingToken() else { return }
        do {
          var record: BrokerInstallation
          if let prior = installation() {
            if prior.token == token { return }
            if try await broker.replace(prior, token: token) {
              record = prior; record.token = token
            } else {
              record = try await broker.create(token: token)
            }
          } else {
            record = try await broker.create(token: token)
          }
          do { try store.write("installation", JSONEncoder().encode(record)) } catch {
            await broker.delete(record); return
          }
          if pendingToken() == token { return }
        } catch { return }
      }
    }
  }
  func status() async -> [String: Any] {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    let permission: String
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral: permission = "granted"
    case .denied: permission = "denied"
    default: permission = "not_requested"
    }
    let configured = FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil
    let record = installation()
    let state =
      !configured
      ? "unavailable"
      : record == nil
        ? "not_registered" : record?.token == pendingToken() ? "ready" : "update_pending"
    // Per-server native push enrollment is still pending in YA. Do not
    // report delivery as enabled from OS permission/FCM registration alone.
    return [
      "firebase": configured ? "configured" : "unavailable", "permission": permission,
      "channel": "not_supported", "installation": state, "notificationsEnabled": false,
    ]
  }
  func requestPermission() async -> [String: Any] {
    let allowed =
      (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
        .alert, .badge, .sound,
      ])) ?? false
    if allowed, FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil {
      Messaging.messaging().isAutoInitEnabled = true
      UIApplication.shared.registerForRemoteNotifications()
      register()
    }
    return await status()
  }
  func background() { active = false; work?.cancel() }
  func foreground() {
    active = true;
    if FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil { register() }
  }
  func hostForPush(_ info: [AnyHashable: Any]) -> String? {
    let intents = ["approval_required", "input_required", "session_completed", "session_failed"]
    guard let intent = info["intent"] as? String, intents.contains(intent),
      let subscription = info["subscriptionId"] as? String, PushBroker.validOpaqueID(subscription),
      let bytes = try? store.read("routes"), bytes.count <= 16384,
      let routes = try? JSONDecoder().decode([String: String].self, from: bytes),
      routes.count <= 64,
      let profile = routes[subscription], UUID(uuidString: profile) != nil
    else { return nil }
    return profile
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    guard let intent = info["intent"] as? String,
      let subscription = info["subscriptionId"] as? String
    else { return }
    await MainActor.run {
      // Native saved bindings select the host. Payload URLs and host ids
      // never select credentials or navigation; resume precedes opening.
      if let id = hostForPush(["intent": intent, "subscriptionId": subscription]) { openHost(id) }
    }
  }
}

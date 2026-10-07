import Foundation

/// The resume credential the bundled document connects with, so it uses the
/// ordinary web transport instead of a native data bridge
/// (topics/mobile-server-pairing.md § Decided replacement).
enum NativeSessionCredential {
  static let features = ["session.credential", "session.reauthenticate", "host.switch"]

  /// Encode the Rust core's persisted credential for the web document.
  static func json(profile: HostProfile, stored: Data) throws -> [String: Any] {
    guard let value = (try JSONSerialization.jsonObject(with: stored)) as? [String: Any],
      let username = value["username"] as? String, !username.isEmpty,
      let sessionID = value["session_id"] as? String, !sessionID.isEmpty,
      let key = value["base_key"] as? [Int], key.count == 32,
      key.allSatisfy({ (0...255).contains($0) }),
      let version = value["resume_protocol_version"] as? Int
    else { throw BridgeFailure.invalidCommand }
    var keyBytes = Data(key.map { UInt8($0) })
    defer { keyBytes.resetBytes(in: 0..<keyBytes.count) }
    let route: [String: Any] =
      profile.relayTarget.map {
        ["kind": "relay", "wsUrl": profile.endpoint, "relayUsername": $0]
      } ?? ["kind": "direct", "wsUrl": profile.endpoint]
    return [
      "profileId": profile.id, "label": profile.label, "username": username,
      "sessionId": sessionID, "sessionKey": keyBytes.base64EncodedString(),
      "resumeProtocolVersion": version, "routes": [route],
    ]
  }

  static func sessionID(_ stored: Data) -> String? {
    ((try? JSONSerialization.jsonObject(with: stored)) as? [String: Any])?["session_id"] as? String
  }
}

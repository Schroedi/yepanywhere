import AppIntents
import XCTest
@testable import YepAnywhere

private final class BrokerProtocol: URLProtocol {
  static var responseCode = 201
  static var responseBody = Data()
  static var requests: [URLRequest] = []
  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "fixture.invalid"
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.append(request)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: Self.responseCode, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.responseBody)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor
final class PushTests: XCTestCase {
  private func broker() -> PushBroker {
    BrokerProtocol.requests = []
    let configuration = URLSessionConfiguration.ephemeral;
    configuration.protocolClasses = [BrokerProtocol.self]
    return PushBroker(
      endpoint: URL(string: "https://fixture.invalid/")!,
      session: URLSession(configuration: configuration))
  }
  func testInstallationAndRotationKeepManagementCapabilityNative() async throws {
    let broker = broker()
    let id = String(repeating: "a", count: 22); let secret = String(repeating: "b", count: 43)
    BrokerProtocol.responseCode = 201;
    BrokerProtocol.responseBody = try JSONSerialization.data(withJSONObject: [
      "installationId": id, "installationSecret": secret,
    ])
    let record = try await broker.create(token: "public-fixture-fcm-token")
    XCTAssertEqual(record.installationId, id)
    XCTAssertNil(BrokerProtocol.requests[0].value(forHTTPHeaderField: "Authorization"))
    BrokerProtocol.responseCode = 204; BrokerProtocol.responseBody = Data()
    let replaced = try await broker.replace(record, token: "public-new-fixture-token")
    XCTAssertTrue(replaced)
    XCTAssertEqual(
      BrokerProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer " + secret)
    XCTAssertFalse(BrokerProtocol.requests.last!.url!.absoluteString.contains(secret))
    BrokerProtocol.responseCode = 404
    let missing = try await broker.replace(record, token: "public-fixture-token")
    XCTAssertFalse(missing)
  }
  func testBrokerRejectsOversizeAndMalformedManagementRecords() async throws {
    let broker = broker(); BrokerProtocol.responseCode = 201
    for data in [
      Data(repeating: 32, count: 8193),
      Data("{\"installationId\":\"../../host\",\"installationSecret\":\"invalid\"}".utf8),
    ] {
      BrokerProtocol.responseBody = data
      do {
        _ = try await broker.create(token: "fixture-token");
        XCTFail("Hostile broker response accepted")
      } catch {}
    }
    let invalid = BrokerInstallation(
      installationId: "../host", installationSecret: "secret\r\nHeader: value",
      token: "fixture-token")
    do {
      _ = try await broker.replace(invalid, token: "fixture-token");
      XCTFail("Malformed persisted capability accepted")
    } catch {}
  }
}

import AppIntents
import XCTest

final class ShellTests: XCTestCase {
  func testNativeShellLaunches() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(
      app.staticTexts["Connect to your Yep Anywhere server"].waitForExistence(timeout: 10))
  }
}

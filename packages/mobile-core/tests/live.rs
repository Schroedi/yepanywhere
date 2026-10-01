use ya_mobile_core::{SessionOptions, native_login, native_resume};
#[tokio::test]
#[ignore = "requires disposable YA fixture; run scripts/live.mjs"]
async fn unchanged_server_login_resume_requests_and_teardown() {
    let Some(endpoint) = std::env::var("YA_TEST_ENDPOINT").ok() else {
        return;
    };
    let options = SessionOptions {
        endpoint,
        username: "ios-fixture".into(),
        relay_target: std::env::var("YA_TEST_RELAY_TARGET").ok(),
    };
    let session = native_login(options.clone(), "native-fixture-password".into())
        .await
        .unwrap();
    let response = session
        .dispatch(
            "request".into(),
            r#"{"method":"GET","path":"/api/projects"}"#.into(),
        )
        .await
        .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["status"], 200);
    assert!(!response["body"]["projects"].as_array().unwrap().is_empty());
    session
        .dispatch(
            "subscribe".into(),
            r#"{"subscriptionId":"test-activity","channel":"activity"}"#.into(),
        )
        .await
        .unwrap();
    let event = tokio::time::timeout(std::time::Duration::from_secs(10), session.next_event())
        .await
        .unwrap()
        .unwrap();
    assert!(event.contains("test-activity"));
    let credential = session.credential_data().unwrap();
    session.close();
    assert!(
        session
            .dispatch("request".into(), "{}".into())
            .await
            .is_err()
    );
    let resumed = native_resume(options.clone(), credential.clone())
        .await
        .unwrap();
    let version = resumed
        .dispatch(
            "request".into(),
            r#"{"method":"GET","path":"/api/version"}"#.into(),
        )
        .await
        .unwrap();
    assert!(version.contains("200"));
    resumed
        .dispatch("reconnect".into(), "{}".into())
        .await
        .unwrap();
    assert!(
        resumed
            .dispatch(
                "request".into(),
                r#"{"method":"GET","path":"/api/projects"}"#.into()
            )
            .await
            .unwrap()
            .contains("200")
    );
    resumed.close();
    let mut bad: serde_json::Value = serde_json::from_slice(&credential).unwrap();
    bad["base_key"][0] = serde_json::json!(255 - bad["base_key"][0].as_u64().unwrap());
    assert!(
        native_resume(options.clone(), serde_json::to_vec(&bad).unwrap())
            .await
            .is_err()
    );
    assert!(
        native_login(options, "wrong-fixture-password".into())
            .await
            .is_err()
    );
}

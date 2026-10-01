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
    let _ = rustls::crypto::ring::default_provider().install_default();
    if let Ok(status_url) = std::env::var("YA_TEST_RELAY_STATUS") {
        let status: serde_json::Value = serde_json::from_slice(
            &reqwest::get(status_url)
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        if std::env::var("YA_TEST_MUX").as_deref() == Ok("true") {
            assert_eq!(status["mux"]["liveCircuits"], 1);
            assert_eq!(status["mux"]["physicalSockets"], 1);
        } else {
            assert_eq!(status["pairs"], 1);
            assert_eq!(status["mux"]["liveCircuits"], 0);
        }
    }
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
    // The unchanged server uses upload_end for both completion and abort.
    // More than four sequential cancellations must release the native slots.
    for i in 0..6 {
        let id = uuid::Uuid::new_v4();
        let start = serde_json::json!({"type":"staged_upload_start","uploadId":id.to_string(),"filename":"fixture.txt","size":4,"mimeType":"text/plain"});
        session
            .dispatch("uploadStart".into(), start.to_string())
            .await
            .unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), session.next_event())
            .await
            .unwrap()
            .unwrap();
        assert!(event.contains(&id.to_string()), "{event}");
        let mut chunk = id.as_bytes().to_vec();
        chunk.extend_from_slice(&0_u64.to_be_bytes());
        chunk.extend_from_slice(if i % 2 == 0 { b"ab" } else { b"abcd" });
        session.upload_chunk(chunk.clone()).await.unwrap();
        session
            .dispatch(
                "uploadCancel".into(),
                serde_json::json!({"uploadId":id.to_string()}).to_string(),
            )
            .await
            .unwrap();
        assert!(session.upload_chunk(chunk).await.is_err());
    }
    let id = uuid::Uuid::new_v4();
    session.dispatch("uploadStart".into(), serde_json::json!({"type":"staged_upload_start","uploadId":id.to_string(),"filename":"fixture.txt","size":4,"mimeType":"text/plain"}).to_string()).await.unwrap();
    let mut chunk = id.as_bytes().to_vec();
    chunk.extend_from_slice(&0_u64.to_be_bytes());
    chunk.extend_from_slice(b"abcd");
    session.upload_chunk(chunk).await.unwrap();
    session
        .dispatch(
            "uploadEnd".into(),
            serde_json::json!({"uploadId":id.to_string()}).to_string(),
        )
        .await
        .unwrap();
    loop {
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), session.next_event())
            .await
            .unwrap()
            .unwrap();
        let event: serde_json::Value = serde_json::from_str(&event).unwrap();
        if event["uploadId"] == id.to_string() && event["type"] != "upload_progress" {
            assert_eq!(event["type"], "upload_complete", "{event}");
            assert_eq!(event["stagedRef"]["size"], 4);
            break;
        }
    }
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

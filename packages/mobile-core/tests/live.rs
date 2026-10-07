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

#[tokio::test]
#[ignore = "requires two disposable YA servers and relay; run scripts/live-relay.ts"]
async fn concurrent_hosts_share_mux_and_retire_independently() {
    let Ok(beta) = std::env::var("YA_TEST_SECOND_TARGET") else {
        return;
    };
    let endpoint = std::env::var("YA_TEST_ENDPOINT").unwrap();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let status_url = std::env::var("YA_TEST_RELAY_STATUS").unwrap();
    async fn status(url: &str) -> serde_json::Value {
        serde_json::from_slice(&reqwest::get(url).await.unwrap().bytes().await.unwrap()).unwrap()
    }
    async fn counts(url: &str, circuits: u64, sockets: u64) {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let value = status(url).await;
            if value["mux"]["liveCircuits"] == circuits
                && value["mux"]["physicalSockets"] == sockets
            {
                return;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "unexpected relay demand: {value}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }
    counts(&status_url, 0, 0).await;
    let alpha = native_login(
        SessionOptions {
            endpoint: endpoint.clone(),
            relay_target: Some("ios-fixture".into()),
            username: "ios-fixture".into(),
        },
        "native-fixture-password".into(),
    )
    .await
    .unwrap();
    let beta = native_login(
        SessionOptions {
            endpoint,
            relay_target: Some(beta.clone()),
            username: beta,
        },
        "native-fixture-password".into(),
    )
    .await
    .unwrap();
    counts(&status_url, 2, 1).await;
    let alpha_credential = alpha.credential_data().unwrap();
    let beta_credential = beta.credential_data().unwrap();
    assert_ne!(alpha_credential, beta_credential);
    let params = r#"{"method":"GET","path":"/api/projects"}"#;
    let (a, b) = tokio::join!(
        alpha.dispatch("request".into(), params.into()),
        beta.dispatch("request".into(), params.into())
    );
    assert!(a.unwrap().contains("200"));
    assert!(b.unwrap().contains("200"));
    alpha.close();
    counts(&status_url, 1, 1).await;
    assert!(
        beta.dispatch("request".into(), params.into())
            .await
            .unwrap()
            .contains("200")
    );
    beta.dispatch("reconnect".into(), "{}".into())
        .await
        .unwrap();
    counts(&status_url, 1, 1).await;
    assert!(
        beta.dispatch("request".into(), params.into())
            .await
            .unwrap()
            .contains("200")
    );
    beta.close();
    counts(&status_url, 0, 0).await;
}

#[derive(Default)]
struct Storage(std::sync::Mutex<Option<Vec<u8>>>);
impl ya_mobile_core::CredentialPersistence for Storage {
    fn begin_resume(&self) -> bool {
        *self.0.lock().unwrap() = None;
        true
    }
    fn persist(&self, data: Vec<u8>) -> bool {
        *self.0.lock().unwrap() = Some(data);
        true
    }
}
#[tokio::test]
#[ignore = "requires disposable YA fixture; run scripts/live.mjs"]
async fn profile_leases_scope_resources_and_preserve_sibling_demand() {
    use ya_mobile_core::{NativeRoute, NativeRuntime};
    let endpoint = std::env::var("YA_TEST_ENDPOINT").unwrap();
    let route = NativeRoute {
        route_id: "owned-route".into(),
        endpoint,
        relay_target: std::env::var("YA_TEST_RELAY_TARGET").ok(),
    };
    let runtime = NativeRuntime::new();
    let storage = std::sync::Arc::new(Storage::default());
    let alpha = runtime
        .login(
            "owned-profile".into(),
            route.clone(),
            "ios-fixture".into(),
            "native-fixture-password".into(),
            storage.clone(),
        )
        .await
        .unwrap();
    let credential = alpha.credential_data().unwrap();
    let mut invalid = route.clone();
    invalid.route_id.clear();
    assert!(
        runtime
            .acquire(
                "owned-profile".into(),
                vec![invalid],
                "ios-fixture".into(),
                credential.clone(),
                storage.clone()
            )
            .await
            .is_err()
    );
    let sibling = runtime
        .acquire(
            "owned-profile".into(),
            vec![route.clone()],
            "ios-fixture".into(),
            credential.clone(),
            storage.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        alpha.security_binding().unwrap().transport_nonce,
        sibling.security_binding().unwrap().transport_nonce
    );
    assert_eq!(alpha.route_id().unwrap(), "owned-route");
    for lease in [&alpha, &sibling] {
        lease
            .dispatch(
                "subscribe".into(),
                r#"{"subscriptionId":"same-local-id","channel":"activity"}"#.into(),
            )
            .await
            .unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), lease.next_event())
            .await
            .unwrap()
            .unwrap();
        assert!(event.contains("same-local-id"), "{event}");
    }
    alpha
        .dispatch(
            "unsubscribe".into(),
            r#"{"subscriptionId":"same-local-id"}"#.into(),
        )
        .await
        .unwrap();
    alpha.release();
    assert!(alpha.credential_data().is_err());
    assert!(
        sibling
            .dispatch(
                "request".into(),
                r#"{"method":"GET","path":"/api/projects"}"#.into()
            )
            .await
            .unwrap()
            .contains("200")
    );
    runtime.retire_profile("owned-profile".into());
    assert!(sibling.credential_data().is_err());
    let resumed = runtime
        .acquire(
            "owned-profile".into(),
            vec![route],
            "ios-fixture".into(),
            credential,
            storage,
        )
        .await
        .unwrap();
    runtime.shutdown();
    assert!(resumed.security_binding().is_err());
}

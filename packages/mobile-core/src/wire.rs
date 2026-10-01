use crate::{Error, Result, check, crypto::*};
use futures_util::{SinkExt, StreamExt};
use rustls_platform_verifier::BuilderVerifierExt;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{Message, protocol::WebSocketConfig},
};
use url::Url;

pub struct Wire {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    mux: bool,
}
fn tls() -> Result<Arc<rustls::ClientConfig>> {
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| Error::Unavailable)?;
    Ok(Arc::new(
        builder
            .with_platform_verifier()
            .map_err(|_| Error::Unavailable)?
            .with_no_client_auth(),
    ))
}
impl Wire {
    async fn open(url: &Url, mux: bool) -> Result<Self> {
        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(MAX_BYTES + 64);
        config.max_frame_size = Some(MAX_BYTES + 64);
        config.max_write_buffer_size = MAX_BYTES + 128 * 1024;
        let (socket, _) = timeout(
            Duration::from_secs(10),
            connect_async_tls_with_config(
                url.as_str(),
                Some(config),
                true,
                Some(Connector::Rustls(tls()?)),
            ),
        )
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|_| Error::Unavailable)?;
        Ok(Self { socket, mux })
    }
    pub async fn connect(endpoint: &str, target: Option<&str>) -> Result<Self> {
        let url = Url::parse(endpoint).map_err(|_| Error::InvalidMessage)?;
        check(
            matches!(url.scheme(), "ws" | "wss")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none(),
        )?;
        if let Some(target) = target {
            check(!target.is_empty() && target.len() <= 128)?;
            // Probe only eligible relay /ws URLs. An explicit custom endpoint
            // is authoritative; a failed setup falls back to that exact URL.
            if url.path().ends_with("/ws")
                && url.query().is_none()
                && Self::mux_capability(&url).await.unwrap_or(false)
                && let Ok(wire) = Self::open_mux(&url, target).await
            {
                return Ok(wire);
            }
            let mut wire = Self::open(&url, false).await?;
            wire.plain_send(&json!({"type":"client_connect","username":target}))
                .await?;
            check(wire.plain_receive().await?["type"] == "client_connected")?;
            Ok(wire)
        } else {
            Self::open(&url, false).await
        }
    }
    async fn mux_capability(url: &Url) -> Result<bool> {
        let mut health = url.clone();
        health
            .set_scheme(if url.scheme() == "wss" {
                "https"
            } else {
                "http"
            })
            .map_err(|_| Error::InvalidMessage)?;
        health.set_path(&format!("{}/health", url.path().trim_end_matches("/ws")));
        let client = reqwest::Client::builder()
            .use_preconfigured_tls((*tls()?).clone())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| Error::Unavailable)?;
        let response = client
            .get(health)
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        check(response.status().is_success())?;
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| Error::Unavailable)?;
            check(bytes.len() + chunk.len() <= 65536)?;
            bytes.extend_from_slice(&chunk);
        }
        let v: Value = serde_json::from_slice(&bytes)?;
        Ok(v["relayCapabilities"]
            .as_array()
            .is_some_and(|a| a.iter().any(|x| x == "client-mux-v1")))
    }
    async fn open_mux(url: &Url, target: &str) -> Result<Self> {
        let mut endpoint = url.clone();
        endpoint.set_path(&format!("{}/mux", url.path().trim_end_matches("/ws")));
        let mut wire = Self::open(&endpoint, false).await?;
        let ready = wire.plain_receive().await?;
        check(
            ready["type"] == "mux_ready"
                && ready["protocolVersion"] == 1
                && ready["maxCircuits"].as_u64().is_some_and(|n| n > 0)
                && ready["maxFrameBytes"].as_u64().is_some_and(|n| n >= 65536),
        )?;
        wire.plain_send(
            &json!({"type":"mux_open","circuitId":1,"username":target,"channel":"app"}),
        )
        .await?;
        let opened = wire.plain_receive().await?;
        check(opened["type"] == "mux_opened" && opened["circuitId"] == 1)?;
        wire.mux = true;
        Ok(wire)
    }
    async fn send(&mut self, bytes: Vec<u8>, binary: bool) -> Result<()> {
        check(bytes.len() <= MAX_BYTES + 48)?;
        let message = if self.mux {
            let mut frame = vec![1, u8::from(binary), 0, 0, 0, 1];
            frame.extend_from_slice(&bytes);
            Message::Binary(frame.into())
        } else if binary {
            Message::Binary(bytes.into())
        } else {
            Message::Text(
                String::from_utf8(bytes)
                    .map_err(|_| Error::InvalidMessage)?
                    .into(),
            )
        };
        timeout(Duration::from_secs(30), self.socket.send(message))
            .await
            .map_err(|_| Error::Timeout)?
            .map_err(|_| Error::Unavailable)
    }
    async fn receive(&mut self) -> Result<(Vec<u8>, bool)> {
        loop {
            let message = self
                .socket
                .next()
                .await
                .ok_or(Error::Unavailable)?
                .map_err(|_| Error::Unavailable)?;
            match message {
                Message::Ping(bytes) => self
                    .socket
                    .send(Message::Pong(bytes))
                    .await
                    .map_err(|_| Error::Unavailable)?,
                Message::Pong(_) => {}
                Message::Binary(bytes) if self.mux => {
                    check(
                        bytes.len() >= 6
                            && bytes[0] == 1
                            && bytes[1] <= 1
                            && bytes[2..6] == [0, 0, 0, 1],
                    )?;
                    return Ok((bytes[6..].to_vec(), bytes[1] == 1));
                }
                Message::Binary(bytes) => return Ok((bytes.to_vec(), true)),
                Message::Text(text) if !self.mux => return Ok((text.as_bytes().to_vec(), false)),
                _ => return Err(Error::Unavailable),
            }
        }
    }
    pub async fn plain_send(&mut self, v: &Value) -> Result<()> {
        self.send(serde_json::to_vec(v)?, false).await
    }
    pub async fn plain_receive(&mut self) -> Result<Value> {
        let (bytes, binary) = timeout(Duration::from_secs(15), self.receive())
            .await
            .map_err(|_| Error::Timeout)??;
        check(!binary && bytes.len() <= 65536)?;
        let v: Value = serde_json::from_slice(&bytes)?;
        if v["type"] == "srp_invalid" || v["type"] == "srp_resume_failed" {
            return Err(Error::ReauthenticationRequired);
        }
        check(v["type"] != "srp_error")?;
        Ok(v)
    }
    pub async fn encrypted_send(&mut self, bytes: &[u8], key: &[u8]) -> Result<()> {
        let nonce = random(24)?;
        let mut envelope = vec![1];
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&seal(bytes, &nonce, key)?);
        self.send(envelope, true).await
    }
    pub async fn encrypted_receive(&mut self, key: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        let (bytes, binary) = self.receive().await?;
        check(binary && bytes.len() >= 42 && bytes[0] == 1)?;
        open(&bytes[25..], &bytes[1..25], key)
    }
}
use zeroize::Zeroizing;

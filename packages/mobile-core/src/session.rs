use crate::{Error, Result, check, crypto::*, parse, wire::Wire};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{Mutex, mpsc, oneshot},
    time::{Instant, timeout},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, uniffi::Record)]
pub struct SessionOptions {
    pub endpoint: String,
    pub relay_target: Option<String>,
    pub username: String,
}
#[derive(Serialize, Deserialize)]
struct Credential {
    username: String,
    session_id: String,
    base_key: Vec<u8>,
    resume_protocol_version: u64,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.base_key.zeroize();
    }
}
struct Secure {
    wire: Wire,
    key: Zeroizing<Vec<u8>>,
    outbound: u64,
    inbound: Option<u64>,
}
impl Secure {
    async fn send(&mut self, v: &Value) -> Result<()> {
        let value = json!({"seq":self.outbound,"msg":v});
        self.outbound = self.outbound.checked_add(1).ok_or(Error::Overflow)?;
        let mut bytes = vec![1];
        bytes.extend_from_slice(&serde_json::to_vec(&value)?);
        self.wire.encrypted_send(&bytes, &self.key).await
    }
    async fn receive(&mut self) -> Result<Value> {
        let plain = self.wire.encrypted_receive(&self.key).await?;
        let payload = match plain.first() {
            Some(1) => Zeroizing::new(plain[1..].to_vec()),
            Some(3) => {
                let mut out = Zeroizing::new(Vec::new());
                flate2::read::GzDecoder::new(&plain[1..])
                    .take((MAX_BYTES + 1) as u64)
                    .read_to_end(&mut out)
                    .map_err(|_| Error::InvalidMessage)?;
                check(out.len() <= MAX_BYTES)?;
                out
            }
            _ => return Err(Error::InvalidMessage),
        };
        let v: Value = serde_json::from_slice(&payload)?;
        let seq = v["seq"].as_u64().ok_or(Error::InvalidMessage)?;
        check(
            v.as_object().is_some_and(|o| o.len() == 2)
                && self.inbound.is_none_or(|prev| seq > prev),
        )?;
        self.inbound = Some(seq);
        Ok(v["msg"].clone())
    }
}
fn validate(options: &SessionOptions) -> Result<()> {
    check(options.endpoint.len() <= 2048 && (3..=128).contains(&options.username.len()))
}
async fn establish(wire: Wire, credential: &Credential, nonce: &str) -> Result<Secure> {
    let key = transport_key(&credential.base_key, &unb64(nonce)?)?;
    let mut secure = Secure {
        wire,
        key,
        outbound: 0,
        inbound: None,
    };
    secure
        .send(&json!({"type":"client_capabilities","formats":[1]}))
        .await?;
    Ok(secure)
}
pub async fn login(
    options: SessionOptions,
    password: Zeroizing<String>,
) -> Result<Arc<NativeSession>> {
    validate(&options)?;
    check(!password.is_empty() && password.len() <= 4096)?;
    let mut wire = Wire::connect(&options.endpoint, options.relay_target.as_deref()).await?;
    wire.plain_send(&json!({"type":"srp_hello","identity":options.username}))
        .await?;
    let challenge = wire.plain_receive().await?;
    check(challenge["type"] == "srp_challenge")?;
    let proof = SrpProof::challenge(
        password.as_bytes(),
        field(&challenge, "salt")?,
        field(&challenge, "B")?,
    )?;
    drop(password);
    wire.plain_send(&json!({"type":"srp_proof","A":proof.a,"M1":proof.m1}))
        .await?;
    let verified = wire.plain_receive().await?;
    check(verified["type"] == "srp_verify")?;
    let base = proof.verify(field(&verified, "M2")?)?;
    let id = field(&verified, "sessionId")?;
    check(!id.is_empty() && id.len() <= 128)?;
    let nonce = field(&verified, "transportNonce")?;
    let info = json_open(field(&verified, "serverInfoProof")?, &base)?;
    check(
        info["type"] == "srp_verify_server_info"
            && info["sessionId"] == id
            && info["transportNonce"] == nonce,
    )?;
    let version = info["resumeProtocolVersion"]
        .as_u64()
        .ok_or(Error::InvalidMessage)?;
    check(version >= 3)?;
    let credential = Credential {
        username: options.username.clone(),
        session_id: id.into(),
        base_key: base.to_vec(),
        resume_protocol_version: version,
    };
    let secure = establish(wire, &credential, nonce).await?;
    Ok(NativeSession::start(options, credential, secure))
}
async fn resume_secure(options: &SessionOptions, credential: &Credential) -> Result<Secure> {
    let mut wire = Wire::connect(&options.endpoint, options.relay_target.as_deref()).await?;
    let client_nonce = b64(&random(24)?);
    wire.plain_send(&json!({"type":"srp_resume_init","identity":credential.username,"sessionId":credential.session_id,"clientNonce":client_nonce})).await?;
    let challenge = wire.plain_receive().await?;
    check(
        challenge["type"] == "srp_resume_challenge"
            && challenge["sessionId"] == credential.session_id,
    )?;
    let nonce = field(&challenge, "nonce")?;
    check(unb64(nonce)?.len() == 24)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::InvalidMessage)?
        .as_millis() as u64;
    let proof = json_seal(
        &json!({"timestamp":timestamp,"challenge":nonce,"sessionId":credential.session_id}),
        &credential.base_key,
    )?;
    wire.plain_send(&json!({"type":"srp_resume","identity":credential.username,"sessionId":credential.session_id,"proof":proof})).await?;
    let resumed = wire.plain_receive().await?;
    check(
        resumed["type"] == "srp_resumed"
            && resumed["sessionId"] == credential.session_id
            && resumed["transportNonce"] == nonce,
    )?;
    let proof = json_open(field(&resumed, "serverProof")?, &credential.base_key)?;
    check(
        proof["type"] == "srp_resume_server_proof"
            && proof["sessionId"] == credential.session_id
            && proof["serverNonce"] == nonce
            && proof["clientNonce"] == client_nonce
            && proof["resumeProtocolVersion"]
                .as_u64()
                .is_some_and(|v| v >= credential.resume_protocol_version),
    )?;
    establish(wire, credential, nonce).await
}
pub async fn resume(options: SessionOptions, data: &[u8]) -> Result<Arc<NativeSession>> {
    validate(&options)?;
    check(data.len() <= 4096)?;
    let credential: Credential = serde_json::from_slice(data)?;
    check(
        credential.username == options.username
            && credential.base_key.len() == 32
            && !credential.session_id.is_empty()
            && credential.session_id.len() <= 128
            && credential.resume_protocol_version >= 3,
    )?;
    let secure = resume_secure(&options, &credential).await?;
    Ok(NativeSession::start(options, credential, secure))
}
enum Command {
    Dispatch(String, Value, oneshot::Sender<Result<String>>),
    Upload(Vec<u8>, oneshot::Sender<Result<()>>),
}
#[derive(uniffi::Object)]
pub struct NativeSession {
    commands: mpsc::Sender<Command>,
    events: Mutex<mpsc::Receiver<String>>,
    credential: Zeroizing<Vec<u8>>,
    cancel: CancellationToken,
}
impl Drop for NativeSession {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
impl NativeSession {
    fn start(options: SessionOptions, credential: Credential, secure: Secure) -> Arc<Self> {
        let (commands, rx) = mpsc::channel(32);
        let (events, event_rx) = mpsc::channel(128);
        let cancel = CancellationToken::new();
        let session = Arc::new(Self {
            commands,
            events: Mutex::new(event_rx),
            credential: Zeroizing::new(
                serde_json::to_vec(&credential).expect("serializable credential"),
            ),
            cancel: cancel.clone(),
        });
        tokio::spawn(async move {
            Actor::new(options, credential, secure, rx, events, cancel)
                .run()
                .await;
        });
        session
    }
}
#[uniffi::export(async_runtime = "tokio")]
impl NativeSession {
    pub fn credential_data(&self) -> Result<Vec<u8>> {
        if self.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        Ok(self.credential.to_vec())
    }
    pub fn close(&self) {
        self.cancel.cancel();
    }
    pub async fn dispatch(&self, method: String, params: String) -> Result<String> {
        if self.cancel.is_cancelled() {
            return Err(Error::Closed);
        }
        let params = parse(&params, 512 * 1024)?;
        let (tx, rx) = oneshot::channel();
        self.commands
            .try_send(Command::Dispatch(method, params, tx))
            .map_err(|_| Error::Overflow)?;
        tokio::select! { _ = self.cancel.cancelled() => Err(Error::Closed), result = timeout(Duration::from_secs(30), rx) => result.map_err(|_| Error::Timeout)?.map_err(|_| Error::Closed)? }
    }
    pub async fn upload_chunk(&self, payload: Vec<u8>) -> Result<()> {
        check(payload.len() >= 24 && payload.len() <= 65536 + 24)?;
        let (tx, rx) = oneshot::channel();
        self.commands
            .try_send(Command::Upload(payload, tx))
            .map_err(|_| Error::Overflow)?;
        tokio::select! { _ = self.cancel.cancelled() => Err(Error::Closed), result = timeout(Duration::from_secs(30), rx) => result.map_err(|_| Error::Timeout)?.map_err(|_| Error::Closed)? }
    }
    pub async fn next_event(&self) -> Result<String> {
        tokio::select! { _ = self.cancel.cancelled() => Err(Error::Closed), event = async { self.events.lock().await.recv().await } => event.ok_or(Error::Closed) }
    }
}
struct Pending {
    reply: oneshot::Sender<Result<String>>,
    deadline: Instant,
}
struct Upload {
    wire_id: Uuid,
    offset: u64,
    size: u64,
}
struct Actor {
    options: SessionOptions,
    credential: Credential,
    secure: Secure,
    commands: mpsc::Receiver<Command>,
    events: mpsc::Sender<String>,
    cancel: CancellationToken,
    pending: HashMap<String, Pending>,
    subscriptions: HashMap<String, Value>,
    uploads: HashMap<String, Upload>,
}
impl Actor {
    fn new(
        options: SessionOptions,
        credential: Credential,
        secure: Secure,
        commands: mpsc::Receiver<Command>,
        events: mpsc::Sender<String>,
        cancel: CancellationToken,
    ) -> Self {
        Self {
            options,
            credential,
            secure,
            commands,
            events,
            cancel,
            pending: HashMap::new(),
            subscriptions: HashMap::new(),
            uploads: HashMap::new(),
        }
    }
    fn event(&self, v: Value) -> Result<()> {
        self.events
            .try_send(v.to_string())
            .map_err(|_| Error::Overflow)
    }
    fn fail_pending(&mut self) {
        for (_, p) in self.pending.drain() {
            let _ = p.reply.send(Err(Error::Unavailable));
        }
        for (id, _) in self.uploads.drain() {
            let _ = self.events.try_send(
                json!({"type":"upload_error","uploadId":id,"error":"Connection interrupted"})
                    .to_string(),
            );
        }
    }
    async fn reconnect(&mut self) -> Result<()> {
        self.fail_pending();
        self.event(json!({"type":"state","phase":"RETRYING"}))?;
        for delay in [250, 1000, 3000] {
            tokio::select! { _ = self.cancel.cancelled() => return Err(Error::Closed), _ = tokio::time::sleep(Duration::from_millis(delay)) => {} }
            let result = tokio::select! { _ = self.cancel.cancelled() => return Err(Error::Closed), r = resume_secure(&self.options, &self.credential) => r };
            match result {
                Ok(secure) => {
                    self.secure = secure;
                    for subscription in self.subscriptions.values() {
                        self.secure.send(subscription).await?;
                    }
                    self.event(json!({"type":"state","phase":"CONNECTED"}))?;
                    return Ok(());
                }
                Err(Error::ReauthenticationRequired) => {
                    return Err(Error::ReauthenticationRequired);
                }
                Err(_) => {}
            }
        }
        Err(Error::Unavailable)
    }
    async fn run(mut self) {
        let mut cleanup = tokio::time::interval(Duration::from_secs(1));
        loop {
            let outcome = tokio::select! {
                biased;
                _ = self.cancel.cancelled() => break,
                command = self.commands.recv() => match command { Some(c) => self.command(c).await, None => break },
                _ = cleanup.tick() => {
                    self.pending.retain(|_,p| !p.reply.is_closed() && p.deadline > Instant::now()); Ok(())
                },
                message = self.secure.receive() => match message {
                    Ok(v) => self.message(v),
                    Err(Error::InvalidMessage) => Err(Error::InvalidMessage),
                    Err(_) => self.reconnect().await,
                },
            };
            if let Err(error) = outcome {
                let phase = if matches!(error, Error::ReauthenticationRequired) {
                    "REAUTHENTICATION_REQUIRED"
                } else {
                    "FAILED"
                };
                let _ = self.event(json!({"type":"state","phase":phase}));
                break;
            }
        }
        self.fail_pending();
        // Drop the socket, keys, queues and subscriptions when its final lease closes.
    }
    async fn command(&mut self, c: Command) -> Result<()> {
        match c {
            Command::Upload(mut payload, reply) => {
                let id = Uuid::from_slice(&payload[..16])
                    .map_err(|_| Error::InvalidMessage)?
                    .to_string();
                let offset = u64::from_be_bytes(
                    payload[16..24]
                        .try_into()
                        .map_err(|_| Error::InvalidMessage)?,
                );
                let upload = self.uploads.get_mut(&id).ok_or(Error::InvalidMessage)?;
                check(
                    offset == upload.offset && offset + (payload.len() - 24) as u64 <= upload.size,
                )?;
                upload.offset += (payload.len() - 24) as u64;
                payload[..16].copy_from_slice(upload.wire_id.as_bytes());
                let mut inner = vec![2];
                inner.extend_from_slice(&payload);
                let result = self
                    .secure
                    .wire
                    .encrypted_send(&inner, &self.secure.key)
                    .await;
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    self.reconnect().await?;
                }
            }
            Command::Dispatch(method, mut p, reply) => {
                if self.pending.len() >= 32 {
                    let _ = reply.send(Err(Error::Overflow));
                    return Ok(());
                }
                let result: Result<Option<String>> = match method.as_str() {
                    "request" => {
                        let path = field(&p, "path")?;
                        check(
                            path.starts_with('/') && !path.starts_with("//") && path.len() <= 4096,
                        )?;
                        check(matches!(
                            field(&p, "method")?,
                            "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
                        ))?;
                        let id = Uuid::new_v4().to_string();
                        p["id"] = json!(id);
                        p["type"] = json!("request");
                        self.secure.send(&p).await?;
                        Ok(Some(id))
                    }
                    "subscribe" => {
                        check(self.subscriptions.len() < 64)?;
                        let id = field(&p, "subscriptionId")?.to_owned();
                        check(
                            !id.is_empty()
                                && id.len() <= 128
                                && !self.subscriptions.contains_key(&id),
                        )?;
                        p["type"] = json!("subscribe");
                        self.secure.send(&p).await?;
                        self.subscriptions.insert(id, p);
                        Ok(None)
                    }
                    "unsubscribe" => {
                        let id = field(&p, "subscriptionId")?.to_owned();
                        check(self.subscriptions.remove(&id).is_some())?;
                        p["type"] = json!("unsubscribe");
                        self.secure.send(&p).await?;
                        Ok(None)
                    }
                    "uploadStart" => {
                        check(self.uploads.len() < 4)?;
                        let id = field(&p, "uploadId")?.to_owned();
                        let _ = Uuid::parse_str(&id).map_err(|_| Error::InvalidMessage)?;
                        check(
                            !self.uploads.contains_key(&id)
                                && matches!(
                                    field(&p, "type")?,
                                    "upload_start" | "staged_upload_start"
                                ),
                        )?;
                        let wire_id = Uuid::new_v4();
                        let size = p["size"].as_u64().ok_or(Error::InvalidMessage)?;
                        check(size <= 100 * 1024 * 1024)?;
                        p["uploadId"] = json!(wire_id.to_string());
                        self.secure.send(&p).await?;
                        self.uploads.insert(
                            id,
                            Upload {
                                wire_id,
                                offset: 0,
                                size,
                            },
                        );
                        Ok(None)
                    }
                    "uploadEnd" | "uploadCancel" => {
                        let id = field(&p, "uploadId")?;
                        let upload = self.uploads.get(id).ok_or(Error::InvalidMessage)?;
                        if method == "uploadEnd" {
                            check(upload.offset == upload.size)?;
                        }
                        p["uploadId"] = json!(upload.wire_id.to_string());
                        p["type"] = json!(if method == "uploadEnd" {
                            "upload_end"
                        } else {
                            "upload_cancel"
                        });
                        self.secure.send(&p).await?;
                        Ok(None)
                    }
                    "reconnect" => {
                        self.reconnect().await?;
                        Ok(None)
                    }
                    _ => Err(Error::InvalidMessage),
                };
                match result {
                    Ok(Some(id)) => {
                        self.pending.insert(
                            id,
                            Pending {
                                reply,
                                deadline: Instant::now() + Duration::from_secs(30),
                            },
                        );
                    }
                    Ok(None) => {
                        let _ = reply.send(Ok("{}".into()));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                }
            }
        }
        Ok(())
    }
    fn message(&mut self, mut v: Value) -> Result<()> {
        match field(&v, "type")? {
            "response" => {
                if let Some(pending) = self.pending.remove(field(&v, "id")?) {
                    let _ = pending.reply.send(Ok(
                        json!({"status":v["status"],"headers":v["headers"],"body":v["body"]})
                            .to_string(),
                    ));
                }
            }
            "event" | "subscription_error" => {
                let id = field(&v, "subscriptionId")?.to_owned();
                if let Some(subscription) = self.subscriptions.get_mut(&id) {
                    if let Some(event_id) = v.get("eventId") {
                        subscription["lastEventId"] = event_id.clone();
                    }
                    self.event(v)?;
                }
            }
            "upload_progress" | "upload_complete" | "upload_error" => {
                let wire_id = field(&v, "uploadId")?;
                if let Some(id) = self
                    .uploads
                    .iter()
                    .find(|(_, u)| u.wire_id.to_string() == wire_id)
                    .map(|(id, _)| id.clone())
                {
                    let terminal = v["type"] != "upload_progress";
                    v["uploadId"] = json!(id);
                    if terminal {
                        self.uploads.remove(&id);
                    }
                    self.event(v)?;
                }
            }
            "pong" => {}
            _ => return Err(Error::InvalidMessage),
        }
        Ok(())
    }
}

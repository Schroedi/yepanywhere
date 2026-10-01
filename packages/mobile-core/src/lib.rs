//! Native-only owner sessions. The web bridge receives source operations only.
mod crypto;
mod session;
mod wire;
use serde_json::Value;
pub use session::{NativeSession, SessionOptions};
uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("Invalid or unauthenticated server message")]
    InvalidMessage,
    #[error("Connection unavailable")]
    Unavailable,
    #[error("Operation timed out")]
    Timeout,
    #[error("Session closed")]
    Closed,
    #[error("Native resource limit exceeded")]
    Overflow,
    #[error("Sign in again")]
    ReauthenticationRequired,
}
pub use CoreError as Error;
pub type Result<T> = std::result::Result<T, Error>;
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::InvalidMessage
    }
}
fn check(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidMessage)
    }
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn native_login(
    options: SessionOptions,
    password: String,
) -> Result<std::sync::Arc<NativeSession>> {
    session::login(options, zeroize::Zeroizing::new(password)).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn native_resume(
    options: SessionOptions,
    credential: Vec<u8>,
) -> Result<std::sync::Arc<NativeSession>> {
    let credential = zeroize::Zeroizing::new(credential);
    session::resume(options, &credential).await
}
fn parse(text: &str, limit: usize) -> Result<Value> {
    if text.len() > limit {
        return Err(Error::Overflow);
    }
    Ok(serde_json::from_str(text)?)
}

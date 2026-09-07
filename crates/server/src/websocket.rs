use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};

// Handlers send a ping during their 15-second authorization check. Bound both
// silent peers and stalled writes so they cannot retain connection permits.
pub(crate) const PONG_TIMEOUT: Duration = Duration::from_secs(45);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn send_before_expiry(
    socket: &mut WebSocket,
    message: Message,
    expires_at: chrono::DateTime<chrono::Utc>,
) -> bool {
    let Ok(remaining) = (expires_at - chrono::Utc::now()).to_std() else {
        return false;
    };
    if remaining.is_zero() {
        return false;
    }
    matches!(
        tokio::time::timeout(remaining.min(WRITE_TIMEOUT), socket.send(message)).await,
        Ok(Ok(()))
    )
}

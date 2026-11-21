//! Errors in the same JSON shape the app's native side returns
//! (`{"kind": ..., "message": ...}`), so the web page handles them unchanged.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BanInfo {
	pub kind: String,
	pub code: i32,
	pub message: String,
	pub reason: Option<String>,
	pub sub_reason: Option<String>,
	pub automated: Option<bool>,
}

impl From<grindr::BanInfo> for BanInfo {
	fn from(b: grindr::BanInfo) -> Self {
		let kind = match b.kind {
			grindr::BanKind::Profile => "profile",
			grindr::BanKind::Device => "device",
			grindr::BanKind::Network => "network",
			grindr::BanKind::Underage => "underage",
			_ => "unknown",
		};
		Self {
			kind: kind.to_owned(),
			code: b.code,
			message: b.message,
			reason: b.reason,
			sub_reason: b.sub_reason,
			automated: b.automated,
		}
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
	Http(String),
	Connect(String),
	Auth(String),
	Media(String),
	NotSignedIn,
	SessionStale,
	Api { code: i32, message: String },
	Unauthorized { code: i32, message: String },
	Banned(BanInfo),
	RateLimited,
	RequestBlocked,
	NetworkBlocked,
	NotInitialized,
	SessionCleared,
	ContentTooLarge,
	/// A command the web version does not have (yet).
	Unsupported(String),
}

impl From<grindr::GrindrError> for AppError {
	fn from(e: grindr::GrindrError) -> Self {
		match e {
			grindr::GrindrError::Http(msg) => AppError::Http(msg),
			grindr::GrindrError::Connect(msg) => AppError::Connect(msg),
			grindr::GrindrError::Auth(msg) => AppError::Auth(msg),
			grindr::GrindrError::Api { code, message } => {
				AppError::Api { code, message }
			}
			grindr::GrindrError::Unauthorized { code, message } => {
				AppError::Unauthorized { code, message }
			}
			grindr::GrindrError::Banned(info) => AppError::Banned(info.into()),
			grindr::GrindrError::RateLimited => AppError::RateLimited,
			grindr::GrindrError::Blocked(grindr::BlockKind::Cloudflare) => {
				AppError::RequestBlocked
			}
			grindr::GrindrError::Blocked(_) => AppError::NetworkBlocked,
			grindr::GrindrError::SessionCleared => AppError::SessionCleared,
			other => AppError::Http(other.to_string()),
		}
	}
}

impl AppError {
	/// Like the app: an auth failure means "signed out" or "still refreshing"
	/// depending on where the session is.
	pub fn from_client_error(
		error: grindr::GrindrError,
		client: &grindr::GrindrClient,
	) -> Self {
		let mapped = AppError::from(error);
		if !matches!(mapped, AppError::Auth(_)) {
			return mapped;
		}
		match client.session_receiver().borrow().as_ref() {
			None => AppError::NotSignedIn,
			Some(session) if session.token.is_none() => AppError::SessionStale,
			Some(_) => mapped,
		}
	}
}

impl std::fmt::Display for AppError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}", serde_json::to_string(self).unwrap_or_default())
	}
}

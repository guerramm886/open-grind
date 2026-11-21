//! The JSON shapes the page expects back, copied from the app's native side
//! (src-tauri/src/api/auth.rs and session_recovery.rs).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResult {
	pub profile_id: String,
	pub restriction: Option<Restriction>,
}

impl From<grindr::SignInResult> for SignInResult {
	fn from(r: grindr::SignInResult) -> Self {
		Self {
			profile_id: r.profile_id,
			restriction: r.restriction.map(Restriction::from),
		}
	}
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restriction {
	pub kind: String,
	pub region: Option<String>,
	pub reason: Option<String>,
	pub sub_reason: Option<String>,
	pub ends_at: Option<i64>,
}

impl Restriction {
	fn of_kind(kind: &str) -> Self {
		Self {
			kind: kind.to_owned(),
			..Self::default()
		}
	}
}

impl From<grindr::Restriction> for Restriction {
	fn from(r: grindr::Restriction) -> Self {
		match r {
			grindr::Restriction::AgeVerification { region, reason } => Self {
				region: Some(
					match region {
						grindr::VerificationRegion::Uk => "uk",
						grindr::VerificationRegion::Br => "br",
						grindr::VerificationRegion::Au => "au",
						_ => "other",
					}
					.to_owned(),
				),
				reason: Some(reason),
				..Self::of_kind("ageVerification")
			},
			grindr::Restriction::TimedBan(details) => Self {
				reason: details.reason,
				sub_reason: details.sub_reason,
				ends_at: details.expiry_time,
				..Self::of_kind("timedBan")
			},
			grindr::Restriction::TrustVendorRejected => {
				Self::of_kind("trustVendorRejected")
			}
			grindr::Restriction::Other(raw) => Self {
				reason: Some(raw),
				..Self::of_kind("other")
			},
			_ => Self::of_kind("other"),
		}
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionErrorPayload {
	pub message: String,
	pub unauthorized: bool,
	pub kind: String,
	pub attempts: u32,
	pub transient: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSession {
	pub profile_id: Option<u64>,
	pub expires_at: Option<u64>,
	pub stale: bool,
}

const REFRESH_BUFFER_SECS: u64 = 60;

pub fn current_session(session: Option<&grindr::Session>) -> CurrentSession {
	let Some(session) = session else {
		return CurrentSession::default();
	};
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs())
		.unwrap_or(0);
	let expires_at = session.token.as_ref().map(|token| token.expires_at);
	CurrentSession {
		profile_id: session
			.credentials
			.profile_id
			.as_ref()
			.and_then(|id| id.parse().ok()),
		expires_at,
		stale: expires_at.is_none_or(|at| at < now + REFRESH_BUFFER_SECS),
	}
}

#[derive(serde::Deserialize)]
struct FeatureFlagClaims {
	#[serde(default, rename = "featureFlags")]
	feature_flags: Vec<String>,
}

pub fn feature_flags_of(session_id: &str) -> Vec<String> {
	use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
	session_id
		.split('.')
		.nth(1)
		.and_then(|payload| URL_SAFE_NO_PAD.decode(payload).ok())
		.and_then(|json| serde_json::from_slice::<FeatureFlagClaims>(&json).ok())
		.map(|claims| claims.feature_flags)
		.unwrap_or_default()
}

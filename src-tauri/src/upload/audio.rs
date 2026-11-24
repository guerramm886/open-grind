//! Voice notes recorded in the page: the bytes come in as base64 and go to
//! Grindr's chat media upload as they are, under the recorder's audio type.

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::api::rest::{encode_response, RawResponse};
use crate::error::AppError;
use crate::state::AppState;
use crate::upload::file::{profile_of, signed_in_as, unless_session_changes, Race};
use crate::upload::UploadLock;

const MAX_AUDIO_BYTES: usize = 20 * 1024 * 1024;

/// Only an audio type, and nothing that could break out of the header.
fn audio_type(content_type: &str) -> Result<String, AppError> {
	let clean = content_type.trim().to_ascii_lowercase();
	let ok = clean.starts_with("audio/")
		&& clean.len() < 100
		&& clean
			.chars()
			.all(|c| c.is_ascii_alphanumeric() || "/.;=+-_ ,\"".contains(c));
	if ok {
		Ok(clean)
	} else {
		Err(AppError::Media("Ese archivo no es un audio".to_owned()))
	}
}

#[tauri::command]
pub async fn upload_audio(
	state: tauri::State<'_, AppState>,
	upload_lock: tauri::State<'_, UploadLock>,
	data: String,
	content_type: String,
	length_ms: u64,
) -> Result<String, AppError> {
	let content_type = audio_type(&content_type)?;
	let bytes = STANDARD
		.decode(data.trim())
		.map_err(|_| AppError::Media("El audio llegó dañado".to_owned()))?;
	if bytes.is_empty() {
		return Err(AppError::Media("El audio está vacío".to_owned()));
	}
	if bytes.len() > MAX_AUDIO_BYTES {
		return Err(AppError::ContentTooLarge);
	}
	let client = state.client()?;
	let mut sessions = client.session_receiver();
	let Some(profile_id) = profile_of(&sessions.borrow()).map(str::to_owned)
	else {
		return Err(AppError::NotSignedIn);
	};
	let _one_at_a_time = upload_lock.0.lock().await;
	if !signed_in_as(&sessions.borrow(), &profile_id) {
		return Err(AppError::SessionCleared);
	}
	let path = format!("/v5/chat/media/upload?takenOnGrindr=false&length={length_ms}");
	let request = client
		.request(grindr::Method::POST, &path)
		.bytes(&content_type, bytes);
	let raw = unless_session_changes(Race {
		sessions: &mut sessions,
		profile_id: &profile_id,
		send: request.send(),
	})
	.await?
	.map_err(|e| AppError::from_client_error(e, client))?;

	encode_response(&RawResponse {
		status: raw.status,
		body: raw.body,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_audio_types_pass() {
		assert_eq!(audio_type("audio/mp4").unwrap(), "audio/mp4");
		assert_eq!(
			audio_type("Audio/webm;codecs=opus").unwrap(),
			"audio/webm;codecs=opus"
		);
		assert!(audio_type("video/mp4").is_err());
		assert!(audio_type("audio/mp4\r\nX-Evil: 1").is_err());
	}
}

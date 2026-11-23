//! The phone app's automatic copy: every photo/video it saves and a snapshot
//! of its settings (phrases, notes, hearts and stars…) land here.
//!
//! - Media: `<media>/Martins Grindr/<persona>/<fecha>.jpg|mp4`, the same
//!   normal folder the web version writes to.
//! - Settings: `<data>/phone-sync/ajustes/` (dated copies, last 60 kept) and
//!   the latest one also as `<media>/Martins Grindr/_Ajustes del celular.json`.

use std::collections::HashMap;
use std::fs;
use std::io::Write as _;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures::StreamExt as _;

use crate::App;

const SYNC: &str = "phone-sync";
const LIST: &str = "media.txt";
const MAX_UPLOAD: usize = 512 * 1024 * 1024;
const KEEP_SETTINGS: usize = 60;

fn fail(error: impl ToString) -> Response {
	let message = error.to_string();
	tracing::warn!("[phone] {message}");
	(StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
}

fn sync_dir(app: &App) -> std::io::Result<std::path::PathBuf> {
	let dir = app.data_dir.join(SYNC);
	fs::create_dir_all(&dir)?;
	Ok(dir)
}

fn known(app: &App) -> Vec<String> {
	sync_dir(app)
		.ok()
		.and_then(|dir| fs::read_to_string(dir.join(LIST)).ok())
		.map(|text| text.lines().filter(|l| !l.is_empty()).map(str::to_owned).collect())
		.unwrap_or_default()
}

/// Names the phone already sent.
pub async fn list(State(app): State<App>) -> Json<Vec<String>> {
	Json(known(&app))
}

/// One saved photo/video, streamed to disk.
pub async fn upload(
	State(app): State<App>,
	Path(file_name): Path<String>,
	Query(query): Query<HashMap<String, String>>,
	body: Body,
) -> Response {
	let Ok(file_name) = crate::archive::checked_name(&file_name).map(str::to_owned) else {
		return (StatusCode::BAD_REQUEST, "nombre no válido").into_response();
	};
	let base = match crate::archive::clean_base(query.get("base").map_or("", String::as_str)) {
		Ok(base) => base,
		Err(error) => return (StatusCode::BAD_REQUEST, error).into_response(),
	};
	let is_video = query.get("video").is_some_and(|v| v == "1");
	let content_type = query.get("ct").cloned().filter(|ct| !ct.is_empty());

	let dir = match sync_dir(&app) {
		Ok(dir) => dir,
		Err(error) => return fail(error),
	};
	let partial = dir.join(format!("{file_name}.partial"));
	let mut file = match fs::File::create(&partial) {
		Ok(file) => file,
		Err(error) => return fail(error),
	};
	let mut stream = body.into_data_stream();
	let mut written = 0usize;
	let mut head = Vec::new();
	while let Some(chunk) = stream.next().await {
		let chunk = match chunk {
			Ok(chunk) => chunk,
			Err(error) => {
				let _ = fs::remove_file(&partial);
				return (StatusCode::BAD_REQUEST, error.to_string()).into_response();
			}
		};
		written += chunk.len();
		if written > MAX_UPLOAD {
			let _ = fs::remove_file(&partial);
			return (StatusCode::PAYLOAD_TOO_LARGE, "archivo demasiado grande").into_response();
		}
		if head.len() < 16 {
			head.extend_from_slice(&chunk[..chunk.len().min(16)]);
		}
		if let Err(error) = file.write_all(&chunk) {
			let _ = fs::remove_file(&partial);
			return fail(error);
		}
	}
	drop(file);
	if written == 0 {
		let _ = fs::remove_file(&partial);
		return (StatusCode::BAD_REQUEST, "el archivo llegó vacío").into_response();
	}
	let content_type = content_type.unwrap_or_else(|| crate::media::sniff(&head).to_owned());
	let ext = crate::archive::ext_for(Some(&content_type), is_video);
	if let Err(error) = crate::archive::move_to_gallery(&app, &base, ext, &partial) {
		let _ = fs::remove_file(&partial);
		return fail(error);
	}
	let line = format!("{file_name}\n");
	if let Err(error) = fs::OpenOptions::new()
		.create(true)
		.append(true)
		.open(dir.join(LIST))
		.and_then(|mut list| list.write_all(line.as_bytes()))
	{
		return fail(error);
	}
	StatusCode::NO_CONTENT.into_response()
}

/// The phone's settings, as one JSON object.
pub async fn settings(
	State(app): State<App>,
	Json(settings): Json<serde_json::Map<String, serde_json::Value>>,
) -> Response {
	let text = match serde_json::to_string_pretty(&settings) {
		Ok(text) => text,
		Err(error) => return fail(error),
	};
	let dir = match sync_dir(&app).and_then(|dir| {
		let dir = dir.join("ajustes");
		fs::create_dir_all(&dir).map(|()| dir)
	}) {
		Ok(dir) => dir,
		Err(error) => return fail(error),
	};
	let stamp = chrono_stamp();
	if let Err(error) = fs::write(dir.join(format!("ajustes-{stamp}.json")), &text) {
		return fail(error);
	}
	// Keep the newest ones (names sort by date).
	if let Ok(entries) = fs::read_dir(&dir) {
		let mut names: Vec<_> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
		names.sort();
		let extra = names.len().saturating_sub(KEEP_SETTINGS);
		for old in names.into_iter().take(extra) {
			let _ = fs::remove_file(old);
		}
	}
	let visible = app.media_dir.join("Martins Grindr");
	if fs::create_dir_all(&visible).is_ok() {
		let _ = fs::write(visible.join("_Ajustes del celular.json"), &text);
	}
	StatusCode::NO_CONTENT.into_response()
}

/// `YYYY-MM-DD_HHMMSS` in UTC, without a date crate.
fn chrono_stamp() -> String {
	let secs = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0);
	let days = secs.div_euclid(86_400);
	let rem = secs.rem_euclid(86_400);
	// Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
	let z = days + 719_468;
	let era = z.div_euclid(146_097);
	let doe = z.rem_euclid(146_097);
	let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
	let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
	let mp = (5 * doy + 2) / 153;
	let day = doy - (153 * mp + 2) / 5 + 1;
	let month = if mp < 10 { mp + 3 } else { mp - 9 };
	let year = yoe + era * 400 + i64::from(month <= 2);
	format!(
		"{year:04}-{month:02}-{day:02}_{:02}{:02}{:02}",
		rem / 3600,
		rem % 3600 / 60,
		rem % 60
	)
}

#[cfg(test)]
mod tests {
	#[test]
	fn stamp_looks_like_a_date() {
		let stamp = super::chrono_stamp();
		assert_eq!(stamp.len(), 17);
		assert!(stamp.starts_with("20"));
	}
}

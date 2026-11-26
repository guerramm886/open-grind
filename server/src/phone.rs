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

// ------------------------------------------------------------ two-way sync
// "Sincronizar con Home Assistant" on the phone: it asks what is here
// (`manifest`), sends what is missing here (`put_item`) and fetches what is
// missing there (`get_item`). Items from the phone are kept in the same
// working copy the web version uses, so they show in its Recibidos too.

const ENTRIES: &str = "entries.json";
const WEB_MANIFEST_KEY: &str = "received-archive-manifest-v1";
static ENTRIES_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn read_entries(app: &App) -> serde_json::Map<String, serde_json::Value> {
	sync_dir(app)
		.ok()
		.and_then(|dir| fs::read_to_string(dir.join(ENTRIES)).ok())
		.and_then(|text| serde_json::from_str(&text).ok())
		.unwrap_or_default()
}

fn has_file(app: &App, entry: &serde_json::Value) -> bool {
	entry
		.get("fileName")
		.and_then(serde_json::Value::as_str)
		.and_then(|name| crate::archive::stored_path(app, name).ok())
		.is_some_and(|path| path.is_file())
}

/// Entries the phone sent, whose files are here.
pub fn phone_entries(app: &App) -> Vec<serde_json::Value> {
	read_entries(app)
		.into_values()
		.filter(|entry| has_file(app, entry))
		.collect()
}

/// Everything kept here: the web version's own saves and the phone's.
pub async fn manifest(State(app): State<App>) -> Response {
	let mut all = serde_json::Map::new();
	if let Some(text) = app.store.read_app_data(WEB_MANIFEST_KEY) {
		if let Ok(serde_json::Value::Object(web)) = serde_json::from_str(&text) {
			all.extend(web);
		}
	}
	for (id, entry) in read_entries(&app) {
		all.entry(id).or_insert(entry);
	}
	let entries: Vec<serde_json::Value> = all
		.into_values()
		.filter(|entry| has_file(&app, entry))
		.collect();
	Json(serde_json::json!({ "entries": entries })).into_response()
}

/// Streams a request body into `target` (via a `.partial` next to it).
async fn receive(body: Body, target: &std::path::Path) -> Result<usize, Response> {
	let partial = target.with_extension("partial");
	let mut file = fs::File::create(&partial).map_err(fail)?;
	let mut stream = body.into_data_stream();
	let mut written = 0usize;
	while let Some(chunk) = stream.next().await {
		let chunk = match chunk {
			Ok(chunk) => chunk,
			Err(error) => {
				let _ = fs::remove_file(&partial);
				return Err((StatusCode::BAD_REQUEST, error.to_string()).into_response());
			}
		};
		written += chunk.len();
		if written > MAX_UPLOAD {
			let _ = fs::remove_file(&partial);
			return Err((StatusCode::PAYLOAD_TOO_LARGE, "archivo demasiado grande").into_response());
		}
		if let Err(error) = file.write_all(&chunk) {
			let _ = fs::remove_file(&partial);
			return Err(fail(error));
		}
	}
	drop(file);
	if written == 0 {
		let _ = fs::remove_file(&partial);
		return Err((StatusCode::BAD_REQUEST, "el archivo llegó vacío").into_response());
	}
	fs::rename(&partial, target).map_err(fail)?;
	Ok(written)
}

/// One item from the phone: the file plus its entry (as JSON in `entry`).
pub async fn put_item(
	State(app): State<App>,
	Path(file_name): Path<String>,
	Query(query): Query<HashMap<String, String>>,
	body: Body,
) -> Response {
	let Ok(file_name) = crate::archive::checked_name(&file_name).map(str::to_owned) else {
		return (StatusCode::BAD_REQUEST, "nombre no válido").into_response();
	};
	let Some(serde_json::Value::Object(mut entry)) = query
		.get("entry")
		.and_then(|text| serde_json::from_str(text).ok())
	else {
		return (StatusCode::BAD_REQUEST, "faltan los datos de la foto").into_response();
	};
	let Some(id) = entry.get("id").and_then(serde_json::Value::as_str).map(str::to_owned) else {
		return (StatusCode::BAD_REQUEST, "falta el id").into_response();
	};
	let target = match crate::archive::stored_path(&app, &file_name) {
		Ok(target) => target,
		Err(error) => return (StatusCode::BAD_REQUEST, error).into_response(),
	};
	if let Err(response) = receive(body, &target).await {
		return response;
	}

	// A copy in the visible folder too, unless the old automatic copy
	// already put one there.
	if !known(&app).contains(&file_name) {
		let base = crate::archive::clean_base(query.get("base").map_or("", String::as_str));
		let is_video = entry.get("kind").and_then(serde_json::Value::as_str) == Some("video");
		let content_type = entry
			.get("contentType")
			.and_then(serde_json::Value::as_str)
			.map(str::to_owned);
		if let Ok(base) = base {
			let ext = crate::archive::ext_for(content_type.as_deref(), is_video);
			if let Err(error) = crate::archive::copy_to_gallery(&app, &base, ext, &target) {
				tracing::warn!("[phone] gallery copy failed: {error}");
			}
		}
		if let Ok(dir) = sync_dir(&app) {
			let _ = fs::OpenOptions::new()
				.create(true)
				.append(true)
				.open(dir.join(LIST))
				.and_then(|mut list| list.write_all(format!("{file_name}\n").as_bytes()));
		}
	}

	entry.insert("fileName".to_owned(), serde_json::Value::String(file_name));
	entry.insert("inGallery".to_owned(), serde_json::Value::Bool(true));
	let _guard = ENTRIES_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
	let mut entries = read_entries(&app);
	entries.insert(id, serde_json::Value::Object(entry));
	let written = serde_json::to_string(&entries)
		.map_err(|e| e.to_string())
		.and_then(|text| {
			sync_dir(&app)
				.and_then(|dir| fs::write(dir.join(ENTRIES), text))
				.map_err(|e| e.to_string())
		});
	match written {
		Ok(()) => StatusCode::NO_CONTENT.into_response(),
		Err(error) => fail(error),
	}
}

/// One stored file, for the phone to take.
pub async fn get_item(State(app): State<App>, Path(file_name): Path<String>) -> Response {
	let path = match crate::archive::stored_path(&app, &file_name) {
		Ok(path) => path,
		Err(error) => return (StatusCode::BAD_REQUEST, error).into_response(),
	};
	let file = match tokio::fs::File::open(&path).await {
		Ok(file) => file,
		Err(_) => return (StatusCode::NOT_FOUND, "no está").into_response(),
	};
	let stream = futures::stream::unfold(file, |mut file| async move {
		use tokio::io::AsyncReadExt as _;
		let mut buffer = vec![0u8; 256 * 1024];
		match file.read(&mut buffer).await {
			Ok(0) => None,
			Ok(read) => {
				buffer.truncate(read);
				Some((Ok::<_, std::io::Error>(buffer), file))
			}
			Err(error) => Some((Err(error), file)),
		}
	});
	Response::builder()
		.header("content-type", "application/octet-stream")
		.body(Body::from_stream(stream))
		.unwrap_or_else(|error| fail(error))
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

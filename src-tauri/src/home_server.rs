//! Automatic copy to the user's own server (the Home Assistant add-on in
//! `server/`): every saved photo/video and a snapshot of the app's settings
//! (phrases, notes, hearts and stars…). Sent from Rust because the webview
//! (https) may not talk to a plain http address on the home network.

use std::time::Duration;

use tauri::AppHandle;
use wreq::{Client, Response};

fn text(error: impl ToString) -> String {
	error.to_string()
}

fn client() -> Result<Client, String> {
	Client::builder()
		.connect_timeout(Duration::from_secs(10))
		.read_timeout(Duration::from_secs(120))
		.build()
		.map_err(text)
}

/// `http://host:port` without a trailing slash; only http(s).
fn base(url: &str) -> Result<String, String> {
	let url = url.trim().trim_end_matches('/');
	if url.starts_with("http://") || url.starts_with("https://") {
		Ok(url.to_owned())
	} else {
		Err("la dirección tiene que empezar con http:// o https://".to_owned())
	}
}

fn encode(value: &str) -> String {
	value
		.bytes()
		.map(|b| match b {
			b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
				(b as char).to_string()
			}
			_ => format!("%{b:02X}"),
		})
		.collect()
}

async fn checked(response: Response) -> Result<Response, String> {
	let status = response.status();
	if status.is_success() {
		return Ok(response);
	}
	Err(match status.as_u16() {
		401 => "clave incorrecta".to_owned(),
		404 => "el servidor no tiene esta función (actualizá el complemento)".to_owned(),
		code => format!("el servidor respondió {code}"),
	})
}

/// File names already on the server.
#[tauri::command]
pub async fn home_server_list(url: String, password: String) -> Result<Vec<String>, String> {
	let response = client()?
		.get(format!("{}/api/phone/media", base(&url)?))
		.header("x-og-password", password)
		.send()
		.await
		.map_err(text)?;
	let body = checked(response).await?.text().await.map_err(text)?;
	serde_json::from_str(&body).map_err(text)
}

/// Send one stored file; the server puts it in Martins Grindr/`base_name`.
#[tauri::command]
pub async fn home_server_upload(
	app: AppHandle,
	url: String,
	password: String,
	file_name: String,
	base_name: String,
	is_video: bool,
	content_type: Option<String>,
) -> Result<(), String> {
	let path = crate::archive_store::stored_file(&app, &file_name)?;
	let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
		.await
		.map_err(text)?
		.map_err(text)?;
	let target = format!(
		"{}/api/phone/media/{}?base={}&video={}&ct={}",
		base(&url)?,
		encode(&file_name),
		encode(&base_name),
		if is_video { 1 } else { 0 },
		encode(content_type.as_deref().unwrap_or("")),
	);
	let response = client()?
		.put(target)
		.header("x-og-password", password)
		.body(bytes)
		.send()
		.await
		.map_err(text)?;
	checked(response).await.map(drop)
}

/// Everything the server keeps (`{"entries":[…]}`), as JSON text.
#[tauri::command]
pub async fn home_server_manifest(url: String, password: String) -> Result<String, String> {
	let response = client()?
		.get(format!("{}/api/sync/manifest", base(&url)?))
		.header("x-og-password", password)
		.send()
		.await
		.map_err(text)?;
	checked(response).await?.text().await.map_err(text)
}

/// Whether the web version asked every device to sync (`{requested,…}`).
#[tauri::command]
pub async fn home_server_sync_status(url: String, password: String) -> Result<String, String> {
	let response = client()?
		.get(format!("{}/api/sync/request", base(&url)?))
		.header("x-og-password", password)
		.send()
		.await
		.map_err(text)?;
	checked(response).await?.text().await.map_err(text)
}

/// Send one stored file with its entry (JSON), for the server's Recibidos.
#[tauri::command]
pub async fn home_server_put_item(
	app: AppHandle,
	url: String,
	password: String,
	file_name: String,
	entry: String,
	base_name: String,
) -> Result<(), String> {
	let path = crate::archive_store::stored_file(&app, &file_name)?;
	let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
		.await
		.map_err(text)?
		.map_err(text)?;
	let target = format!(
		"{}/api/sync/item/{}?base={}&entry={}",
		base(&url)?,
		encode(&file_name),
		encode(&base_name),
		encode(&entry),
	);
	let response = client()?
		.put(target)
		.header("x-og-password", password)
		.body(bytes)
		.send()
		.await
		.map_err(text)?;
	checked(response).await.map(drop)
}

/// Bring one file from the server into the app's own store; returns its size.
#[tauri::command]
pub async fn home_server_get_item(
	app: AppHandle,
	url: String,
	password: String,
	file_name: String,
) -> Result<u64, String> {
	let target_path = crate::archive_store::stored_file(&app, &file_name)?;
	// Never replace a file the phone already has.
	if let Ok(metadata) = std::fs::metadata(&target_path) {
		if metadata.is_file() && metadata.len() > 0 {
			return Ok(metadata.len());
		}
	}
	let response = client()?
		.get(format!("{}/api/sync/item/{}", base(&url)?, encode(&file_name)))
		.header("x-og-password", password)
		.send()
		.await
		.map_err(text)?;
	let bytes = checked(response).await?.bytes().await.map_err(text)?;
	if bytes.is_empty() {
		return Err("el archivo llegó vacío".to_owned());
	}
	let size = bytes.len() as u64;
	tauri::async_runtime::spawn_blocking(move || {
		use std::io::Write as _;
		let mut name = target_path.file_name().unwrap_or_default().to_os_string();
		name.push(".incoming");
		let partial = target_path.with_file_name(name);
		{
			let mut file = std::fs::File::create(&partial)?;
			file.write_all(&bytes)?;
			file.sync_all()?;
		}
		std::fs::rename(&partial, &target_path)
	})
	.await
	.map_err(text)?
	.map_err(text)?;
	Ok(size)
}

/// Send the settings snapshot (a JSON object of key → value).
#[tauri::command]
pub async fn home_server_settings(
	url: String,
	password: String,
	settings: String,
) -> Result<(), String> {
	let response = client()?
		.put(format!("{}/api/phone/settings", base(&url)?))
		.header("x-og-password", password)
		.header("content-type", "application/json")
		.body(settings)
		.send()
		.await
		.map_err(text)?;
	checked(response).await.map(drop)
}

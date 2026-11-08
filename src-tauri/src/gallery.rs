//! Saves received media into the phone's public gallery (Pictures / Movies).
//!
//! The bytes are fetched here in Rust through the authenticated media path
//! (the webview can't fetch the proxied media: its http scheme vs the https app
//! is mixed content), then written through the android-fs plugin. Writing in
//! Rust needs no `android-fs:` capability grant — those gate the JS bridge.

/// Fetch a media URL through the authenticated media path and return its bytes
/// as base64, so the webview can keep an in-app copy (it can't fetch the proxied
/// media itself: http scheme vs the https app is mixed content).
#[tauri::command]
pub async fn fetch_media_b64(
	app: tauri::AppHandle,
	url: String,
	is_video: bool,
) -> Result<String, String> {
	use base64::{engine::general_purpose::STANDARD, Engine as _};
	let (bytes, _content_type) =
		crate::media::fetch_media_bytes(&app, &url, is_video).await?;
	Ok(STANDARD.encode(bytes))
}

/// Fetch a media URL and write it to the gallery under `base_name` (the
/// extension is chosen from the real content type).
#[tauri::command]
pub async fn save_media_to_gallery(
	app: tauri::AppHandle,
	url: String,
	base_name: String,
	is_video: bool,
) -> Result<(), String> {
	let (bytes, content_type) =
		crate::media::fetch_media_bytes(&app, &url, is_video).await?;
	save(&app, &bytes, &base_name, content_type.as_deref(), is_video)
}

fn ext_and_mime(content_type: Option<&str>, is_video: bool) -> (&'static str, String) {
	let ct = content_type.unwrap_or("").to_ascii_lowercase();
	if is_video || ct.starts_with("video/") {
		let ext = if ct.contains("webm") { "webm" } else { "mp4" };
		let mime = if ct.is_empty() { "video/mp4".to_owned() } else { ct };
		return (ext, mime);
	}
	let ext = if ct.contains("webp") {
		"webp"
	} else if ct.contains("png") {
		"png"
	} else if ct.contains("gif") {
		"gif"
	} else {
		"jpg"
	};
	let mime = if ct.is_empty() { "image/jpeg".to_owned() } else { ct };
	(ext, mime)
}

#[cfg(target_os = "android")]
fn save(
	app: &tauri::AppHandle,
	bytes: &[u8],
	base_name: &str,
	content_type: Option<&str>,
	is_video: bool,
) -> Result<(), String> {
	use tauri_plugin_android_fs::{AndroidFsExt, PublicImageDir, PublicVideoDir};

	let (ext, mime) = ext_and_mime(content_type, is_video);
	let fs = app.android_fs();
	let storage = fs.public_storage();
	// Ask once; modern Android grants MediaStore writes without a prompt.
	let _ = storage.request_permission();
	let relative = format!("Martins Grindr/{base_name}.{ext}");
	let uri = if is_video || mime.starts_with("video/") {
		storage.write_new(
			None,
			PublicVideoDir::Movies,
			&relative,
			Some(mime.as_str()),
			bytes,
		)
	} else {
		storage.write_new(
			None,
			PublicImageDir::Pictures,
			&relative,
			Some(mime.as_str()),
			bytes,
		)
	}
	.map_err(|error| error.to_string())?;
	let _ = storage.scan(&uri);
	Ok(())
}

#[cfg(not(target_os = "android"))]
fn save(
	_app: &tauri::AppHandle,
	_bytes: &[u8],
	_base_name: &str,
	_content_type: Option<&str>,
	_is_video: bool,
) -> Result<(), String> {
	let _ = ext_and_mime(_content_type, _is_video);
	Err("Guardar en la galería solo está disponible en Android".to_owned())
}

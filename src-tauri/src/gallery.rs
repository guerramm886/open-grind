//! Saves received media into the phone's public gallery (Pictures / Movies).
//!
//! The write runs here in Rust through the android-fs plugin, so it needs no
//! `android-fs:` capability grant — those gate the JS-to-plugin bridge, not
//! Rust-side calls, which keeps the capability surface unchanged.

/// Write bytes into the device gallery. `is_video` picks Movies vs Pictures.
#[tauri::command]
pub fn save_media_to_gallery(
	app: tauri::AppHandle,
	data: Vec<u8>,
	filename: String,
	mime: String,
	is_video: bool,
) -> Result<(), String> {
	save(&app, &data, &filename, &mime, is_video)
}

#[cfg(target_os = "android")]
fn save(
	app: &tauri::AppHandle,
	data: &[u8],
	filename: &str,
	mime: &str,
	is_video: bool,
) -> Result<(), String> {
	use tauri_plugin_android_fs::{AndroidFsExt, PublicImageDir, PublicVideoDir};

	let fs = app.android_fs();
	let storage = fs.public_storage();
	let relative = format!("Martins Grindr/{filename}");
	let uri = if is_video {
		storage.write_new(
			None,
			PublicVideoDir::Movies,
			&relative,
			Some(mime),
			data,
		)
	} else {
		storage.write_new(
			None,
			PublicImageDir::Pictures,
			&relative,
			Some(mime),
			data,
		)
	}
	.map_err(|error| error.to_string())?;
	// Best effort: make the new file show up in the gallery immediately.
	let _ = storage.scan(&uri);
	Ok(())
}

#[cfg(not(target_os = "android"))]
fn save(
	_app: &tauri::AppHandle,
	_data: &[u8],
	_filename: &str,
	_mime: &str,
	_is_video: bool,
) -> Result<(), String> {
	Err("Guardar en la galería solo está disponible en Android".to_owned())
}

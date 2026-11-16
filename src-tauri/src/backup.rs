//! Moves a finished backup zip out of the staging cache into the phone's
//! public Download folder, where a file manager can see and unzip it.
//!
//! The webview builds the zip and streams it into a staged file (see
//! `upload::staged`); this only does the final copy, so the archive never has
//! to fit in memory.

use crate::upload::staged::StagedMedia;

const FOLDER: &str = "Martins Grindr";

/// Keep only characters that are safe in a file name; never a path.
fn clean_name(file_name: &str) -> String {
	let cleaned: String = file_name
		.chars()
		.filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
		.collect();
	let cleaned = cleaned.trim_matches('.').to_owned();
	if cleaned.is_empty() {
		"backup.zip".to_owned()
	} else {
		cleaned
	}
}

/// Copy the staged file `id` to Download/Martins Grindr/`file_name`, discard
/// the staged copy, and return where it ended up (for showing to the user).
#[tauri::command]
pub async fn export_backup_to_downloads(
	app: tauri::AppHandle,
	id: String,
	file_name: String,
) -> Result<String, String> {
	let name = clean_name(&file_name);
	tauri::async_runtime::spawn_blocking(move || {
		let staged = StagedMedia::of(&app).map_err(|error| error.to_string())?;
		let source = staged.path(&id).map_err(|error| error.to_string())?;
		let outcome = copy_out(&app, &source, &name);
		let _ = staged.discard(&id);
		outcome
	})
	.await
	.map_err(|error| error.to_string())?
}

#[cfg(target_os = "android")]
fn copy_out(
	app: &tauri::AppHandle,
	source: &std::path::Path,
	name: &str,
) -> Result<String, String> {
	use std::io::Write as _;
	use tauri_plugin_android_fs::{AndroidFsExt, PublicGeneralPurposeDir};

	let mut input =
		std::fs::File::open(source).map_err(|error| error.to_string())?;
	let fs = app.android_fs();
	let storage = fs.public_storage();
	let _ = storage.request_permission();
	let relative = format!("{FOLDER}/{name}");
	let uri = storage
		.create_new_file(
			None,
			PublicGeneralPurposeDir::Download,
			&relative,
			Some("application/zip"),
		)
		.map_err(|error| error.to_string())?;
	let mut output = fs
		.open_file_writable(&uri)
		.map_err(|error| error.to_string())?;
	std::io::copy(&mut input, &mut output).map_err(|error| error.to_string())?;
	output.flush().map_err(|error| error.to_string())?;
	drop(output);
	let _ = storage.scan(&uri);
	Ok(format!("Descargas/{FOLDER}/{name}"))
}

#[cfg(not(target_os = "android"))]
fn copy_out(
	_app: &tauri::AppHandle,
	_source: &std::path::Path,
	_name: &str,
) -> Result<String, String> {
	let _ = FOLDER;
	Err("El backup a Descargas solo está disponible en Android".to_owned())
}

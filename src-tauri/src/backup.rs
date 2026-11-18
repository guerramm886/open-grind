//! Where backups go. The webview builds the zip and streams it into a staged
//! file (see `upload::staged`); these commands only move bytes between that
//! staging cache and the place the user chose:
//!
//! - a new file in the public Download folder,
//! - any place picked in Android's save dialog (Google Drive shows up there
//!   when its app is installed),
//! - or the same file again, to update a backup instead of adding another.
//!
//! To update without losing what the old backup held, the old file is first
//! copied back into the staging cache so the webview can read pieces of it.

use std::io::{Read as _, Seek as _, SeekFrom};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

use crate::upload::staged::StagedMedia;

const FOLDER: &str = "Martins Grindr";
const MAX_RANGE: u64 = 8 * 1024 * 1024;

/// A place a backup was written to, kept by the webview so the same file can
/// be updated later.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTarget {
	/// Opaque handle (the plugin's `FileUri` as JSON).
	uri: String,
	/// Where it is, in words for the user.
	label: String,
	/// The file's name.
	name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedCopy {
	id: String,
	size: u64,
}

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

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn place_of(uri: &str) -> &'static str {
	if uri.contains("com.google.android.apps.docs") {
		"Google Drive"
	} else if uri.contains("downloads") || uri.contains("Download") {
		"Descargas"
	} else if uri.contains("com.android.externalstorage") {
		"la memoria del teléfono"
	} else {
		"el lugar que elegiste"
	}
}

fn text_error(error: impl ToString) -> String {
	error.to_string()
}

/// Copy the staged file `id` to a new file in Download/Martins Grindr.
#[tauri::command]
pub async fn export_backup_to_downloads(
	app: tauri::AppHandle,
	id: String,
	file_name: String,
) -> Result<BackupTarget, String> {
	let name = clean_name(&file_name);
	tauri::async_runtime::spawn_blocking(move || {
		let staged = StagedMedia::of(&app).map_err(text_error)?;
		let source = staged.path(&id).map_err(text_error)?;
		let outcome = platform::to_downloads(&app, &source, &name);
		let _ = staged.discard(&id);
		outcome
	})
	.await
	.map_err(text_error)?
}

/// Open Android's save dialog. Returns `None` when the user backs out.
#[tauri::command]
pub async fn pick_backup_destination(
	app: tauri::AppHandle,
	file_name: String,
) -> Result<Option<BackupTarget>, String> {
	let name = clean_name(&file_name);
	tauri::async_runtime::spawn_blocking(move || platform::pick(&app, &name))
		.await
		.map_err(text_error)?
}

/// Replace the contents of a file chosen earlier with the staged file `id`.
#[tauri::command]
pub async fn write_backup_to_uri(
	app: tauri::AppHandle,
	id: String,
	uri: String,
) -> Result<BackupTarget, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let staged = StagedMedia::of(&app).map_err(text_error)?;
		let source = staged.path(&id).map_err(text_error)?;
		let outcome = platform::write_to(&app, &source, &uri);
		let _ = staged.discard(&id);
		outcome
	})
	.await
	.map_err(text_error)?
}

/// Copy an earlier backup into the staging cache so it can be read in
/// pieces. `None` when the file is gone or can no longer be read.
#[tauri::command]
pub async fn stage_backup_from_uri(
	app: tauri::AppHandle,
	uri: String,
) -> Result<Option<StagedCopy>, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let staged = StagedMedia::of(&app).map_err(text_error)?;
		let id = staged.create().map_err(text_error)?;
		let target = staged.path(&id).map_err(text_error)?;
		match platform::copy_from(&app, &uri, &target) {
			Ok(size) if size > 0 => Ok(Some(StagedCopy { id, size })),
			Ok(_) => {
				let _ = staged.discard(&id);
				Ok(None)
			}
			Err(error) => {
				tracing::warn!("[backup] could not read the earlier backup: {error}");
				let _ = staged.discard(&id);
				Ok(None)
			}
		}
	})
	.await
	.map_err(text_error)?
}

/// Up to `length` bytes of staged file `id` from `offset`, as base64.
#[tauri::command]
pub async fn read_staged_range(
	app: tauri::AppHandle,
	id: String,
	offset: u64,
	length: u64,
) -> Result<String, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let staged = StagedMedia::of(&app).map_err(text_error)?;
		let mut file = std::fs::File::open(staged.path(&id).map_err(text_error)?)
			.map_err(text_error)?;
		file.seek(SeekFrom::Start(offset)).map_err(text_error)?;
		let mut bytes = Vec::new();
		file.take(length.min(MAX_RANGE))
			.read_to_end(&mut bytes)
			.map_err(text_error)?;
		Ok(STANDARD.encode(bytes))
	})
	.await
	.map_err(text_error)?
}

#[cfg(target_os = "android")]
mod platform {
	use std::io::Write as _;
	use std::path::Path;

	use tauri_plugin_android_fs::{AndroidFsExt, FileUri, PublicGeneralPurposeDir};

	use super::{place_of, text_error, BackupTarget, FOLDER};

	fn copy_into(
		app: &tauri::AppHandle,
		source: &Path,
		uri: &FileUri,
	) -> Result<(), String> {
		let mut input = std::fs::File::open(source).map_err(text_error)?;
		// Truncates what was there, so an update never leaves old bytes behind.
		let mut output = app
			.android_fs()
			.open_file_writable(uri)
			.map_err(text_error)?;
		std::io::copy(&mut input, &mut output).map_err(text_error)?;
		output.flush().map_err(text_error)?;
		let _ = output.sync_all();
		Ok(())
	}

	fn target_for(
		app: &tauri::AppHandle,
		uri: &FileUri,
		fallback_name: &str,
	) -> Result<BackupTarget, String> {
		let name = app
			.android_fs()
			.get_name(uri)
			.unwrap_or_else(|_| fallback_name.to_owned());
		Ok(BackupTarget {
			uri: uri.to_json_string().map_err(text_error)?,
			label: place_of(&uri.uri).to_owned(),
			name,
		})
	}

	pub fn to_downloads(
		app: &tauri::AppHandle,
		source: &Path,
		name: &str,
	) -> Result<BackupTarget, String> {
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
			.map_err(text_error)?;
		copy_into(app, source, &uri)?;
		let _ = storage.scan(&uri);
		let mut target = target_for(app, &uri, name)?;
		target.label = format!("Descargas/{FOLDER}");
		Ok(target)
	}

	pub fn pick(
		app: &tauri::AppHandle,
		name: &str,
	) -> Result<Option<BackupTarget>, String> {
		let fs = app.android_fs();
		let picker = fs.file_picker();
		let Some(uri) = picker
			.save_file(None, name, Some("application/zip"), false)
			.map_err(text_error)?
		else {
			return Ok(None);
		};
		// So the same file can be updated after the app restarts.
		if let Err(error) = picker.persist_uri_permission(&uri) {
			tracing::warn!("[backup] could not keep access to the file: {error}");
		}
		target_for(app, &uri, name).map(Some)
	}

	pub fn write_to(
		app: &tauri::AppHandle,
		source: &Path,
		uri: &str,
	) -> Result<BackupTarget, String> {
		let uri = FileUri::from_json_str(uri).map_err(text_error)?;
		copy_into(app, source, &uri).map_err(|error| {
			format!(
				"no se pudo escribir el archivo ({error}); puede que lo hayan movido o borrado"
			)
		})?;
		target_for(app, &uri, "backup.zip")
	}

	pub fn copy_from(
		app: &tauri::AppHandle,
		uri: &str,
		target: &Path,
	) -> Result<u64, String> {
		let uri = FileUri::from_json_str(uri).map_err(text_error)?;
		let mut input = app
			.android_fs()
			.open_file_readable(&uri)
			.map_err(text_error)?;
		let mut output = std::fs::File::create(target).map_err(text_error)?;
		std::io::copy(&mut input, &mut output).map_err(text_error)
	}
}

#[cfg(not(target_os = "android"))]
mod platform {
	use std::path::Path;

	use super::BackupTarget;

	const ONLY_ANDROID: &str = "Esto solo está disponible en Android";

	pub fn to_downloads(
		_app: &tauri::AppHandle,
		_source: &Path,
		_name: &str,
	) -> Result<BackupTarget, String> {
		let _ = super::FOLDER;
		Err(ONLY_ANDROID.to_owned())
	}

	pub fn pick(
		_app: &tauri::AppHandle,
		_name: &str,
	) -> Result<Option<BackupTarget>, String> {
		Err(ONLY_ANDROID.to_owned())
	}

	pub fn write_to(
		_app: &tauri::AppHandle,
		_source: &Path,
		_uri: &str,
	) -> Result<BackupTarget, String> {
		Err(ONLY_ANDROID.to_owned())
	}

	pub fn copy_from(
		_app: &tauri::AppHandle,
		_uri: &str,
		_target: &Path,
	) -> Result<u64, String> {
		Err(ONLY_ANDROID.to_owned())
	}
}

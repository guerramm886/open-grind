//! Where saved received media lives on the device: a folder in the app's own
//! data directory. Unlike the webview's storage (OPFS), Android never clears
//! it to free up space; it only goes away when the app is uninstalled or its
//! data is cleared by hand.
//!
//! The webview keeps the list of what is saved (and why); this only stores
//! and hands back bytes by file name.

use std::fs;
use std::io::{self, Read as _, Seek as _, SeekFrom, Write as _};
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::upload::staged::StagedMedia;

const DIRECTORY: &str = "received-archive";
const MAX_RANGE: u64 = 8 * 1024 * 1024;

fn text_error(error: impl ToString) -> String {
	error.to_string()
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
	let dir = app
		.path()
		.app_data_dir()
		.map_err(text_error)?
		.join(DIRECTORY);
	fs::create_dir_all(&dir).map_err(text_error)?;
	Ok(dir)
}

/// A plain file name, never a path.
fn checked_name(file_name: &str) -> Result<&str, String> {
	let valid = !file_name.is_empty()
		&& file_name.len() <= 200
		&& !file_name.starts_with('.')
		&& file_name
			.chars()
			.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
	if valid {
		Ok(file_name)
	} else {
		Err(format!("nombre de archivo no válido: {file_name}"))
	}
}

fn path_of(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
	Ok(store_dir(app)?.join(checked_name(file_name)?))
}

/// Write through a temporary file and rename, so a crash never leaves a
/// half-written photo under the real name.
fn write_atomically(target: &PathBuf, bytes: &[u8]) -> io::Result<()> {
	let partial = target.with_extension("partial");
	{
		let mut file = fs::File::create(&partial)?;
		file.write_all(bytes)?;
		file.sync_all()?;
	}
	fs::rename(&partial, target)
}

/// Download `url` (through the authenticated media path) into the store.
/// Returns the size written.
#[tauri::command]
pub async fn archive_store_url(
	app: AppHandle,
	url: String,
	is_video: bool,
	file_name: String,
) -> Result<u64, String> {
	let target = path_of(&app, &file_name)?;
	let (bytes, _content_type) =
		crate::media::fetch_media_bytes(&app, &url, is_video).await?;
	if bytes.is_empty() {
		return Err("el archivo llegó vacío".to_owned());
	}
	let size = bytes.len() as u64;
	tauri::async_runtime::spawn_blocking(move || {
		write_atomically(&target, &bytes).map_err(text_error)
	})
	.await
	.map_err(text_error)??;
	Ok(size)
}

/// Move a file the webview staged (see `upload::staged`) into the store.
#[tauri::command]
pub async fn archive_store_staged(
	app: AppHandle,
	id: String,
	file_name: String,
) -> Result<u64, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let target = path_of(&app, &file_name)?;
		let staged = StagedMedia::of(&app).map_err(text_error)?;
		let source = staged.path(&id).map_err(text_error)?;
		let size = fs::metadata(&source).map_err(text_error)?.len();
		if size == 0 {
			let _ = staged.discard(&id);
			return Err("el archivo llegó vacío".to_owned());
		}
		let partial = target.with_extension("partial");
		if fs::rename(&source, &partial).is_err() {
			// Different filesystem: copy instead.
			fs::copy(&source, &partial).map_err(text_error)?;
			let _ = staged.discard(&id);
		}
		fs::rename(&partial, &target).map_err(text_error)?;
		Ok(size)
	})
	.await
	.map_err(text_error)?
}

#[derive(Serialize)]
pub struct StoredFile {
	name: String,
	size: u64,
}

/// Every complete file in the store.
#[tauri::command]
pub async fn archive_store_list(app: AppHandle) -> Result<Vec<StoredFile>, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let dir = store_dir(&app)?;
		let mut files = Vec::new();
		for entry in fs::read_dir(dir).map_err(text_error)? {
			let Ok(entry) = entry else { continue };
			let Ok(metadata) = entry.metadata() else { continue };
			if !metadata.is_file() || metadata.len() == 0 {
				continue;
			}
			let name = entry.file_name().to_string_lossy().into_owned();
			if name.ends_with(".partial") {
				let _ = fs::remove_file(entry.path());
				continue;
			}
			files.push(StoredFile {
				name,
				size: metadata.len(),
			});
		}
		Ok(files)
	})
	.await
	.map_err(text_error)?
}

/// Up to `length` bytes of a stored file from `offset`, as base64.
#[tauri::command]
pub async fn archive_store_read(
	app: AppHandle,
	file_name: String,
	offset: u64,
	length: u64,
) -> Result<String, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let mut file = fs::File::open(path_of(&app, &file_name)?).map_err(text_error)?;
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

/// Put a copy of a stored file in the phone's gallery, under
/// Pictures/Martins Grindr/`base_name`, photos and videos together, so it can
/// be seen and kept outside the app. `base_name` may contain one sub-folder
/// (the person). Written by path (Android indexes it on its own); if that is
/// refused, it falls back to the MediaStore route, which keeps videos apart
/// in Movies.
#[tauri::command]
pub async fn archive_store_to_gallery(
	app: AppHandle,
	file_name: String,
	base_name: String,
	is_video: bool,
	content_type: Option<String>,
) -> Result<(), String> {
	let clean: String = base_name
		.chars()
		.filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/'))
		.collect();
	let parts: Vec<&str> = clean.split('/').filter(|part| !part.is_empty()).collect();
	if parts.is_empty() || parts.len() > 2 {
		return Err(format!("nombre no válido: {base_name}"));
	}
	let base = parts.join("/");
	tauri::async_runtime::spawn_blocking(move || {
		let source = path_of(&app, &file_name)?;
		let (ext, _mime) = crate::gallery::ext_and_mime(content_type.as_deref(), is_video);
		let target_base = std::path::Path::new("/storage/emulated/0/Pictures/Martins Grindr")
			.join(&base);
		let direct = (|| -> io::Result<()> {
			if let Some(parent) = target_base.parent() {
				fs::create_dir_all(parent)?;
			}
			let mut target = target_base.with_extension(ext);
			for copy in 2..100 {
				if !target.exists() {
					break;
				}
				let name = format!(
					"{}_{copy}",
					target_base.file_name().unwrap_or_default().to_string_lossy()
				);
				target = target_base.with_file_name(name).with_extension(ext);
			}
			fs::copy(&source, &target).map(drop)
		})();
		match direct {
			Ok(()) => Ok(()),
			Err(error) => {
				tracing::warn!("[archive] gallery copy by path failed: {error}");
				let bytes = fs::read(&source).map_err(text_error)?;
				crate::gallery::save(&app, &bytes, &base, content_type.as_deref(), is_video)
			}
		}
	})
	.await
	.map_err(text_error)?
}

/// Show or hide the gallery copies: a `.nomedia` file in each Martins Grindr
/// folder keeps Gallery and Google Photos from listing them; the files stay
/// where they are, visible to a file manager.
#[tauri::command]
pub async fn gallery_folder_visibility(visible: bool) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		let root = std::path::Path::new("/storage/emulated/0");
		let mut problems = Vec::new();
		for folder in ["Pictures/Martins Grindr", "Movies/Martins Grindr"] {
			let dir = root.join(folder);
			let marker = dir.join(".nomedia");
			let outcome = if visible {
				match fs::remove_file(&marker) {
					Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
					_ => Ok(()),
				}
			} else {
				fs::create_dir_all(&dir).and_then(|()| {
					if marker.exists() {
						Ok(())
					} else {
						fs::File::create(&marker).map(drop)
					}
				})
			};
			if let Err(error) = outcome {
				problems.push(format!("{folder}: {error}"));
			}
		}
		if problems.is_empty() {
			Ok(())
		} else {
			Err(problems.join("; "))
		}
	})
	.await
	.map_err(text_error)?
}

#[tauri::command]
pub async fn archive_store_remove(app: AppHandle, file_name: String) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		match fs::remove_file(path_of(&app, &file_name)?) {
			Err(error) if error.kind() != io::ErrorKind::NotFound => Err(text_error(error)),
			_ => Ok(()),
		}
	})
	.await
	.map_err(text_error)?
}

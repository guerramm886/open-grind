//! Where saved received media lives on the device: a folder in the app's own
//! data directory. Unlike the webview's storage (OPFS), Android never clears
//! it to free up space; it only goes away when the app is uninstalled or its
//! data is cleared by hand.
//!
//! The webview keeps the list of what is saved (and why); this only stores
//! and hands back bytes by file name.

use std::fs;
use std::io::{self, Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

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
		let hidden = GALLERY_HIDDEN.load(Ordering::SeqCst);
		let folder = if hidden { HIDDEN_NAME } else { SHOWN_NAME };
		let target_base = Path::new(STORAGE_ROOT)
			.join("Pictures")
			.join(folder)
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
			// The MediaStore route always lands in the visible gallery; while
			// hidden, better no copy than a visible one.
			Err(error) if hidden => Err(format!("copia oculta: {error}")),
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

const STORAGE_ROOT: &str = "/storage/emulated/0";
const SHOWN_NAME: &str = "Martins Grindr";
/// A folder whose name starts with a dot is skipped by Android's media index
/// (and so by Gallery and Google Photos) together with everything inside;
/// a `.nomedia` file alone did not hide the per-person sub-folders.
const HIDDEN_NAME: &str = ".Martins Grindr";

/// Hidden until the page says otherwise (it does at startup, before copying).
static GALLERY_HIDDEN: AtomicBool = AtomicBool::new(true);

/// Move everything in `from` into `to` (merging folders), then drop `from`
/// if it ended up empty. A name already taken in `to` is left where it was.
fn move_into(from: &Path, to: &Path) -> io::Result<()> {
	if !from.exists() {
		return Ok(());
	}
	if !to.exists() {
		if let Some(parent) = to.parent() {
			fs::create_dir_all(parent)?;
		}
		if fs::rename(from, to).is_ok() {
			return Ok(());
		}
		fs::create_dir_all(to)?;
	}
	for entry in fs::read_dir(from)? {
		let entry = entry?;
		let name = entry.file_name();
		if name == ".nomedia" {
			let _ = fs::remove_file(entry.path());
			continue;
		}
		let target = to.join(&name);
		if entry.file_type()?.is_dir() {
			move_into(&entry.path(), &target)?;
		} else if !target.exists() {
			fs::rename(entry.path(), &target)?;
		}
	}
	let _ = fs::remove_dir(from);
	Ok(())
}

/// Show or hide the gallery copies by renaming the Martins Grindr folders
/// (Pictures and Movies) to `.Martins Grindr` and back. The files stay on the
/// phone, visible to a file manager, and survive uninstalling the app.
#[tauri::command]
pub async fn gallery_folder_visibility(visible: bool) -> Result<(), String> {
	GALLERY_HIDDEN.store(!visible, Ordering::SeqCst);
	tauri::async_runtime::spawn_blocking(move || {
		let root = Path::new(STORAGE_ROOT);
		let mut problems = Vec::new();
		for media in ["Pictures", "Movies"] {
			let shown = root.join(media).join(SHOWN_NAME);
			let hidden = root.join(media).join(HIDDEN_NAME);
			let outcome = if visible {
				move_into(&hidden, &shown)
			} else {
				// No `.nomedia`: Android refuses non-media files in Pictures and
				// Movies ("Operation not permitted"), which is why that never
				// hid anything. The dot folder is what hides them.
				move_into(&shown, &hidden)
			};
			if let Err(error) = outcome {
				problems.push(format!("{media}/{SHOWN_NAME}: {error}"));
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

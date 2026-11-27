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

/// Where a stored file is, for other native code (the home-server copy).
pub(crate) fn stored_file(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
	path_of(app, file_name)
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

/// Untouched for an hour: a write that will never finish.
fn is_stale(metadata: &fs::Metadata) -> bool {
	metadata
		.modified()
		.ok()
		.and_then(|time| time.elapsed().ok())
		.is_some_and(|age| age.as_secs() > 3600)
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
			if name.ends_with(".partial") || name.ends_with(".incoming") {
				// Only leftovers of an interrupted write, never one in progress.
				if is_stale(&metadata) {
					let _ = fs::remove_file(entry.path());
				}
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
		let target_base = if hidden { hidden_root() } else { shown_root() }.join(&base);
		let direct = (|| -> io::Result<()> {
			if hidden {
				mark_hidden()?;
			}
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
const FOLDER: &str = "Martins Grindr";

/// Where the copies live while shown: Pictures/Martins Grindr/<persona>.
fn shown_root() -> PathBuf {
	Path::new(STORAGE_ROOT).join("Pictures").join(FOLDER)
}

/// Where they live while hidden: Documents/.Martins Grindr/<persona>.
/// Android refuses a `.nomedia` file in Pictures and Movies ("Operation not
/// permitted"), and renaming folders there was refused too, so hiding there
/// never worked. Documents takes any file, so the `.nomedia` (and the dot
/// folder) keep Gallery and Google Photos out.
fn hidden_root() -> PathBuf {
	Path::new(STORAGE_ROOT).join("Documents").join(".Martins Grindr")
}

/// Every place an older version may have left copies.
fn old_roots() -> Vec<PathBuf> {
	let root = Path::new(STORAGE_ROOT);
	vec![
		root.join("Pictures").join(FOLDER),
		root.join("Pictures").join(".Martins Grindr"),
		root.join("Movies").join(FOLDER),
		root.join("Movies").join(".Martins Grindr"),
	]
}

fn mark_hidden() -> io::Result<()> {
	let root = hidden_root();
	fs::create_dir_all(&root)?;
	let marker = root.join(".nomedia");
	if !marker.exists() {
		fs::File::create(&marker)?;
	}
	Ok(())
}

/// Hidden until the page says otherwise (it does at startup, before copying).
static GALLERY_HIDDEN: AtomicBool = AtomicBool::new(true);

/// Move one file, by rename or else by copy-then-delete. A name already taken
/// gets `_2`, `_3`… so nothing is overwritten.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
	if let Some(parent) = to.parent() {
		fs::create_dir_all(parent)?;
	}
	let mut target = to.to_path_buf();
	let stem = to.file_stem().unwrap_or_default().to_string_lossy().into_owned();
	let ext = to.extension().map(|e| e.to_string_lossy().into_owned());
	for copy in 2..1000 {
		if !target.exists() {
			break;
		}
		let name = match &ext {
			Some(ext) => format!("{stem}_{copy}.{ext}"),
			None => format!("{stem}_{copy}"),
		};
		target = to.with_file_name(name);
	}
	if fs::rename(from, &target).is_ok() {
		return Ok(());
	}
	fs::copy(from, &target)?;
	fs::remove_file(from)
}

/// Move every file under `from` to the same place under `to`, one by one
/// (folders are never renamed: Android refuses that in Pictures). Returns how
/// many could not be moved and the last error.
fn move_tree(from: &Path, to: &Path, failed: &mut (usize, Option<io::Error>)) {
	let Ok(entries) = fs::read_dir(from) else { return };
	for entry in entries.flatten() {
		let name = entry.file_name();
		let path = entry.path();
		if name == ".nomedia" {
			let _ = fs::remove_file(&path);
			continue;
		}
		let Ok(kind) = entry.file_type() else { continue };
		if kind.is_dir() {
			move_tree(&path, &to.join(&name), failed);
		} else if let Err(error) = move_file(&path, &to.join(&name)) {
			failed.0 += 1;
			failed.1 = Some(error);
		}
	}
	let _ = fs::remove_dir(from);
}

/// Show or hide the gallery copies by moving them between
/// Pictures/Martins Grindr (shown) and Documents/.Martins Grindr (hidden).
/// The files stay on the phone, visible to a file manager, and survive
/// uninstalling the app.
#[tauri::command]
pub async fn gallery_folder_visibility(visible: bool) -> Result<(), String> {
	GALLERY_HIDDEN.store(!visible, Ordering::SeqCst);
	tauri::async_runtime::spawn_blocking(move || {
		let mut failed = (0usize, None);
		if visible {
			let movies = Path::new(STORAGE_ROOT).join("Movies").join(FOLDER);
			// Pictures first; a video Pictures refuses goes to Movies.
			let mut refused = (0usize, None);
			move_tree(&hidden_root(), &shown_root(), &mut refused);
			if refused.0 > 0 {
				move_tree(&hidden_root(), &movies, &mut failed);
			}
		} else {
			mark_hidden().map_err(|error| format!("Documents/.Martins Grindr: {error}"))?;
			for old in old_roots() {
				move_tree(&old, &hidden_root(), &mut failed);
			}
		}
		match failed {
			(0, _) => Ok(()),
			(count, error) => Err(format!(
				"{count} archivos no se pudieron mover: {}",
				error.map(|e| e.to_string()).unwrap_or_default()
			)),
		}
	})
	.await
	.map_err(text_error)?
}

// ------------------------------------------------------------ durable index
// The list of what is saved (and whose it is) also lives here, in a file of
// the app's own data directory, next to the files. The webview's
// localStorage can fill up or be wiped; this file is merged back in at
// startup so no saved photo or video ever drops off the list.

const INDEX: &str = "received-archive-index.json";
static INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

type IndexMap = serde_json::Map<String, serde_json::Value>;

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
	let dir = app.path().app_data_dir().map_err(text_error)?;
	fs::create_dir_all(&dir).map_err(text_error)?;
	Ok(dir.join(INDEX))
}

/// The index; an unreadable one is kept aside (never overwritten) and the
/// list starts over from what the page still has.
fn read_index(path: &Path) -> IndexMap {
	let Ok(text) = fs::read_to_string(path) else {
		return IndexMap::new();
	};
	match serde_json::from_str::<IndexMap>(&text) {
		Ok(map) => map,
		Err(error) => {
			let stamp = std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_millis())
				.unwrap_or(0);
			let aside = path.with_file_name(format!("{INDEX}.danado-{stamp}"));
			tracing::error!("[archive] unreadable index kept as {}: {error}", aside.display());
			let _ = fs::copy(path, aside);
			IndexMap::new()
		}
	}
}

fn write_index(path: &Path, map: &IndexMap) -> Result<(), String> {
	let text = serde_json::to_string(map).map_err(text_error)?;
	let partial = path.with_file_name(format!("{INDEX}.partial"));
	{
		let mut file = fs::File::create(&partial).map_err(text_error)?;
		file.write_all(text.as_bytes()).map_err(text_error)?;
		file.sync_all().map_err(text_error)?;
	}
	fs::rename(&partial, path).map_err(text_error)
}

#[tauri::command]
pub async fn archive_index_read(app: AppHandle) -> Result<IndexMap, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let path = index_path(&app)?;
		let _guard = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
		Ok(read_index(&path))
	})
	.await
	.map_err(text_error)?
}

/// Add/replace `set` and drop `remove` (only what the page explicitly
/// deleted); everything else in the index stays.
#[tauri::command]
pub async fn archive_index_merge(
	app: AppHandle,
	set: IndexMap,
	remove: Vec<String>,
) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		let path = index_path(&app)?;
		let _guard = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
		let mut map = read_index(&path);
		for id in remove {
			map.remove(&id);
		}
		map.extend(set);
		write_index(&path, &map)
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

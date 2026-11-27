//! "Guardados" on the server, answering the same commands as the app's
//! src-tauri/src/archive_store.rs, gallery.rs and upload/staged.rs.
//!
//! - The working copy lives in `<data>/received-archive` (the add-on's own
//!   folder, kept in Home Assistant backups).
//! - The "gallery" is a normal folder anyone with access to the PC can open:
//!   `<media>/Martins Grindr/<persona>/<fecha>.jpg|mp4`, photos and videos
//!   together. In Home Assistant that is Media › Martins Grindr.

use std::fs;
use std::io::{self, Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::App;

const ARCHIVE: &str = "received-archive";
const STAGED: &str = "staged-media";
const GALLERY_FOLDER: &str = "Martins Grindr";
const MAX_RANGE: u64 = 8 * 1024 * 1024;

fn text(error: impl ToString) -> String {
	error.to_string()
}

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, name: &str) -> Result<T, String> {
	serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
		.map_err(|e| format!("bad argument {name}: {e}"))
}

fn dir(root: &Path, name: &str) -> Result<PathBuf, String> {
	let dir = root.join(name);
	fs::create_dir_all(&dir).map_err(text)?;
	Ok(dir)
}

/// A plain file name, never a path.
pub fn checked_name(file_name: &str) -> Result<&str, String> {
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

pub fn stored_path(app: &App, file_name: &str) -> Result<PathBuf, String> {
	Ok(dir(&app.data_dir, ARCHIVE)?.join(checked_name(file_name)?))
}

/// Staged ids are 32 hex characters we made.
fn staged_path(app: &App, id: &str) -> Result<PathBuf, String> {
	let id = id.replace('-', "").to_ascii_lowercase();
	if id.len() != 32 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
		return Err("That file was never staged by this app".to_owned());
	}
	Ok(dir(&app.data_dir, STAGED)?.join(id))
}

fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
	let partial = target.with_extension("partial");
	{
		let mut file = fs::File::create(&partial)?;
		file.write_all(bytes)?;
		file.sync_all()?;
	}
	fs::rename(&partial, target)
}

pub fn ext_for(content_type: Option<&str>, is_video: bool) -> &'static str {
	let ct = content_type.unwrap_or("").to_ascii_lowercase();
	if ct.contains("quicktime") {
		"mov"
	} else if ct.contains("webm") {
		"webm"
	} else if is_video || ct.starts_with("video/") {
		"mp4"
	} else if ct.contains("webp") {
		"webp"
	} else if ct.contains("png") {
		"png"
	} else if ct.contains("gif") {
		"gif"
	} else if ct.contains("heic") {
		"heic"
	} else {
		"jpg"
	}
}

/// `persona/fecha` (one sub-folder at most), only safe characters.
pub fn clean_base(base_name: &str) -> Result<String, String> {
	let clean: String = base_name
		.chars()
		.filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/'))
		.collect();
	let parts: Vec<&str> = clean.split('/').filter(|part| !part.is_empty()).collect();
	if parts.is_empty() || parts.len() > 2 {
		return Err(format!("nombre no válido: {base_name}"));
	}
	Ok(parts.join("/"))
}

/// A free name for `base` in the gallery folder (never overwriting).
fn gallery_target(app: &App, base: &str, ext: &str) -> Result<PathBuf, String> {
	let target_base = app.media_dir.join(GALLERY_FOLDER).join(base);
	if let Some(parent) = target_base.parent() {
		fs::create_dir_all(parent).map_err(text)?;
	}
	let stem = target_base
		.file_name()
		.unwrap_or_default()
		.to_string_lossy()
		.into_owned();
	let mut target = target_base.with_extension(ext);
	for copy in 2..100 {
		if !target.exists() {
			break;
		}
		target = target_base
			.with_file_name(format!("{stem}_{copy}"))
			.with_extension(ext);
	}
	Ok(target)
}

/// Write `bytes` to the gallery folder under `base`, never overwriting.
fn to_gallery(app: &App, base: &str, ext: &str, bytes: &[u8]) -> Result<(), String> {
	write_atomically(&gallery_target(app, base, ext)?, bytes).map_err(text)
}

/// Move a finished file into the gallery folder under `base`.
pub fn move_to_gallery(app: &App, base: &str, ext: &str, source: &Path) -> Result<(), String> {
	let target = gallery_target(app, base, ext)?;
	if fs::rename(source, &target).is_ok() {
		return Ok(());
	}
	// /data and /media are different disks: copy, then drop the original.
	let partial = target.with_extension("partial");
	fs::copy(source, &partial).map_err(text)?;
	fs::rename(&partial, &target).map_err(text)?;
	let _ = fs::remove_file(source);
	Ok(())
}

/// Copy a stored file into the gallery folder under `base` (the original stays).
pub fn copy_to_gallery(app: &App, base: &str, ext: &str, source: &Path) -> Result<(), String> {
	let target = gallery_target(app, base, ext)?;
	let partial = target.with_extension("partial");
	fs::copy(source, &partial).map_err(text)?;
	fs::rename(&partial, &target).map_err(text)
}

fn new_id() -> Result<String, String> {
	let mut bytes = [0u8; 16];
	getrandom::fill(&mut bytes).map_err(text)?;
	Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn blocking<T: Send + 'static>(
	work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
	async move { tokio::task::spawn_blocking(work).await.map_err(text)? }
}

/// `Some(result)` when `command` is one of these, `None` otherwise.
pub async fn run(app: &App, command: &str, args: &Value) -> Option<Result<Value, String>> {
	let result = match command {
		"archive_store_url" => archive_store_url(app, args).await,
		"archive_store_staged" => archive_store_staged(app, args).await,
		"archive_store_list" => archive_store_list(app).await,
		"archive_store_read" => archive_store_read(app, args).await,
		"archive_store_to_gallery" => archive_store_to_gallery(app, args).await,
		"archive_store_remove" => archive_store_remove(app, args).await,
		// Nothing to hide here: it is a normal folder on the PC.
		"gallery_folder_visibility" => Ok(Value::Null),
		"fetch_media_b64" => fetch_media_b64(app, args).await,
		"save_media_to_gallery" => save_media_to_gallery(app, args).await,
		"stage_media" => stage_media(app).await,
		"append_staged_media" => append_staged_media(app, args).await,
		"discard_staged_media" => discard_staged_media(app, args).await,
		// What the phone sent with "Sincronizar", for the page to list too.
		"phone_entries" => Ok(Value::Array(crate::phone::phone_entries(app))),
		// The durable list of what is saved here (see phone.rs).
		"archive_index_read" => Ok(Value::Object(crate::phone::all_entries(app))),
		"archive_index_merge" => archive_index_merge(app, args).await,
		_ => return None,
	};
	Some(result)
}

async fn archive_store_url(app: &App, args: &Value) -> Result<Value, String> {
	let url: String = arg(args, "url")?;
	let is_video: bool = arg(args, "isVideo")?;
	let file_name: String = arg(args, "fileName")?;
	let target = stored_path(app, &file_name)?;
	let (bytes, _) = crate::media::fetch_bytes(app, &url, is_video).await?;
	if bytes.is_empty() {
		return Err("el archivo llegó vacío".to_owned());
	}
	let size = bytes.len() as u64;
	blocking(move || write_atomically(&target, &bytes).map_err(text)).await?;
	Ok(json!(size))
}

async fn archive_store_staged(app: &App, args: &Value) -> Result<Value, String> {
	let id: String = arg(args, "id")?;
	let file_name: String = arg(args, "fileName")?;
	let target = stored_path(app, &file_name)?;
	let source = staged_path(app, &id)?;
	blocking(move || {
		let size = fs::metadata(&source).map_err(text)?.len();
		if size == 0 {
			let _ = fs::remove_file(&source);
			return Err("el archivo llegó vacío".to_owned());
		}
		let partial = target.with_extension("partial");
		if fs::rename(&source, &partial).is_err() {
			fs::copy(&source, &partial).map_err(text)?;
			let _ = fs::remove_file(&source);
		}
		fs::rename(&partial, &target).map_err(text)?;
		Ok(json!(size))
	})
	.await
}

async fn archive_store_list(app: &App) -> Result<Value, String> {
	let root = dir(&app.data_dir, ARCHIVE)?;
	blocking(move || {
		let mut files = Vec::new();
		for entry in fs::read_dir(root).map_err(text)? {
			let Ok(entry) = entry else { continue };
			let Ok(metadata) = entry.metadata() else { continue };
			if !metadata.is_file() || metadata.len() == 0 {
				continue;
			}
			let name = entry.file_name().to_string_lossy().into_owned();
			if name.ends_with(".partial") || name.ends_with(".incoming") {
				// Only leftovers of an interrupted write, never one in progress.
				let stale = metadata
					.modified()
					.ok()
					.and_then(|time| time.elapsed().ok())
					.is_some_and(|age| age.as_secs() > 3600);
				if stale {
					let _ = fs::remove_file(entry.path());
				}
				continue;
			}
			files.push(json!({ "name": name, "size": metadata.len() }));
		}
		Ok(Value::Array(files))
	})
	.await
}

async fn archive_store_read(app: &App, args: &Value) -> Result<Value, String> {
	let file_name: String = arg(args, "fileName")?;
	let offset: u64 = arg(args, "offset")?;
	let length: u64 = arg(args, "length")?;
	let path = stored_path(app, &file_name)?;
	blocking(move || {
		let mut file = fs::File::open(path).map_err(text)?;
		file.seek(SeekFrom::Start(offset)).map_err(text)?;
		let mut bytes = Vec::new();
		file.take(length.min(MAX_RANGE))
			.read_to_end(&mut bytes)
			.map_err(text)?;
		Ok(json!(STANDARD.encode(bytes)))
	})
	.await
}

async fn archive_store_to_gallery(app: &App, args: &Value) -> Result<Value, String> {
	let file_name: String = arg(args, "fileName")?;
	let base_name: String = arg(args, "baseName")?;
	let is_video: bool = arg(args, "isVideo")?;
	let content_type: Option<String> = arg(args, "contentType")?;
	let source = stored_path(app, &file_name)?;
	let base = clean_base(&base_name)?;
	let app = app.clone();
	blocking(move || {
		let bytes = fs::read(&source).map_err(text)?;
		let sniffed = crate::media::sniff(&bytes);
		let content_type = content_type.filter(|ct| !ct.is_empty()).unwrap_or(sniffed.to_owned());
		to_gallery(&app, &base, ext_for(Some(&content_type), is_video), &bytes)?;
		Ok(Value::Null)
	})
	.await
}

async fn archive_index_merge(app: &App, args: &Value) -> Result<Value, String> {
	let set: serde_json::Map<String, Value> = arg(args, "set")?;
	let remove: Vec<String> = arg(args, "remove")?;
	let app = app.clone();
	blocking(move || crate::phone::merge_entries(&app, set, &remove).map(|()| Value::Null)).await
}

async fn archive_store_remove(app: &App, args: &Value) -> Result<Value, String> {
	let file_name: String = arg(args, "fileName")?;
	let path = stored_path(app, &file_name)?;
	match fs::remove_file(path) {
		Err(error) if error.kind() != io::ErrorKind::NotFound => Err(text(error)),
		_ => Ok(Value::Null),
	}
}

async fn fetch_media_b64(app: &App, args: &Value) -> Result<Value, String> {
	let url: String = arg(args, "url")?;
	let is_video: bool = arg(args, "isVideo")?;
	let (bytes, _) = crate::media::fetch_bytes(app, &url, is_video).await?;
	Ok(json!(STANDARD.encode(bytes)))
}

async fn save_media_to_gallery(app: &App, args: &Value) -> Result<Value, String> {
	let url: String = arg(args, "url")?;
	let base_name: String = arg(args, "baseName")?;
	let is_video: bool = arg(args, "isVideo")?;
	let base = clean_base(&format!("Descargas/{base_name}"))?;
	let (bytes, content_type) = crate::media::fetch_bytes(app, &url, is_video).await?;
	let app = app.clone();
	blocking(move || {
		to_gallery(&app, &base, ext_for(Some(content_type), is_video), &bytes)?;
		Ok(Value::Null)
	})
	.await
}

async fn stage_media(app: &App) -> Result<Value, String> {
	let id = new_id()?;
	let path = staged_path(app, &id)?;
	fs::File::create_new(path).map_err(text)?;
	Ok(json!(id))
}

async fn append_staged_media(app: &App, args: &Value) -> Result<Value, String> {
	let id: String = arg(args, "id")?;
	let chunk: String = arg(args, "chunk")?;
	let bytes = STANDARD.decode(chunk).map_err(text)?;
	let path = staged_path(app, &id)?;
	blocking(move || {
		fs::OpenOptions::new()
			.append(true)
			.open(path)
			.and_then(|mut file| file.write_all(&bytes))
			.map_err(text)?;
		Ok(Value::Null)
	})
	.await
}

async fn discard_staged_media(app: &App, args: &Value) -> Result<Value, String> {
	let id: String = arg(args, "id")?;
	match fs::remove_file(staged_path(app, &id)?) {
		Err(error) if error.kind() != io::ErrorKind::NotFound => Err(text(error)),
		_ => Ok(Value::Null),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn names_stay_inside_their_folders() {
		assert!(checked_name("abc_1.jpg").is_ok());
		assert!(checked_name("../x").is_err());
		assert!(checked_name(".hidden").is_err());
		assert_eq!(clean_base("Juan_123/2026-01-01_x").unwrap(), "Juan_123/2026-01-01_x");
		assert_eq!(clean_base("../../etc/passwd").unwrap(), "etc/passwd");
		assert!(clean_base("a/b/c").is_err());
		assert!(clean_base("").is_err());
	}

	#[test]
	fn extensions_follow_the_content() {
		assert_eq!(ext_for(Some("image/png"), false), "png");
		assert_eq!(ext_for(None, true), "mp4");
		assert_eq!(ext_for(Some("video/quicktime"), true), "mov");
		assert_eq!(ext_for(Some(""), false), "jpg");
	}
}

//! Everything the server keeps lives under one data folder (in Home
//! Assistant: the add-on's `/data`, included in Home Assistant backups):
//!
//! - `secrets/`  the Grindr session, device and signing key (never served)
//! - `app-data/` what the page used to keep in the phone: settings, phrases,
//!               notes, marks... one file per key, readable JSON/text
//!
//! Writes go through a temporary file and a rename, so a crash never leaves
//! half a file.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Store {
	root: PathBuf,
}

const SECRETS: &str = "secrets";
const APP_DATA: &str = "app-data";

fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
	if let Some(parent) = target.parent() {
		fs::create_dir_all(parent)?;
	}
	let partial = target.with_extension("partial");
	fs::write(&partial, bytes)?;
	fs::rename(&partial, target)
}

fn remove_if_there(path: &Path) {
	match fs::remove_file(path) {
		Ok(()) => {}
		Err(e) if e.kind() == io::ErrorKind::NotFound => {}
		Err(e) => tracing::warn!("[store] could not remove {}: {e}", path.display()),
	}
}

/// A key as a plain file name: letters, digits, `-`, `_`, `.`; anything else
/// is spelled out as `%XX` so every key maps to exactly one file.
fn file_name_for(key: &str) -> Option<String> {
	if key.is_empty() || key.len() > 300 {
		return None;
	}
	let mut name = String::with_capacity(key.len());
	for byte in key.bytes() {
		match byte {
			b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' => {
				name.push(byte as char)
			}
			b'.' if !name.is_empty() => name.push('.'),
			_ => name.push_str(&format!("%{byte:02X}")),
		}
	}
	Some(name)
}

impl Store {
	pub fn open(root: PathBuf) -> io::Result<Self> {
		fs::create_dir_all(root.join(SECRETS))?;
		fs::create_dir_all(root.join(APP_DATA))?;
		Ok(Self { root })
	}

	fn secret_path(&self, name: &str) -> PathBuf {
		self.root.join(SECRETS).join(name)
	}

	pub fn load_secret<T: serde::de::DeserializeOwned>(&self, name: &str) -> Option<T> {
		let bytes = fs::read(self.secret_path(name)).ok()?;
		match rmp_serde::from_slice(&bytes) {
			Ok(value) => Some(value),
			Err(e) => {
				tracing::warn!("[store] unreadable {name}, ignoring it: {e}");
				None
			}
		}
	}

	pub fn save_secret<T: serde::Serialize>(&self, name: &str, value: &T) {
		let result = rmp_serde::encode::to_vec_named(value)
			.map_err(|e| io::Error::other(e.to_string()))
			.and_then(|bytes| write_atomically(&self.secret_path(name), &bytes));
		if let Err(e) = result {
			tracing::error!("[store] could not save {name}: {e}");
		}
	}

	pub fn delete_secret(&self, name: &str) {
		remove_if_there(&self.secret_path(name));
	}

	fn app_data_path(&self, key: &str) -> Option<PathBuf> {
		Some(self.root.join(APP_DATA).join(file_name_for(key)?))
	}

	pub fn read_app_data(&self, key: &str) -> Option<String> {
		fs::read_to_string(self.app_data_path(key)?).ok()
	}

	pub fn write_app_data(&self, key: &str, value: &str) -> io::Result<()> {
		let path = self
			.app_data_path(key)
			.ok_or_else(|| io::Error::other("invalid key"))?;
		write_atomically(&path, value.as_bytes())
	}

	pub fn remove_app_data(&self, key: &str) {
		if let Some(path) = self.app_data_path(key) {
			remove_if_there(&path);
		}
	}

	/// Every stored key with its value, to fill the page's storage at start.
	pub fn all_app_data(&self) -> Vec<(String, String)> {
		let Ok(entries) = fs::read_dir(self.root.join(APP_DATA)) else {
			return Vec::new();
		};
		let mut out = Vec::new();
		for entry in entries.flatten() {
			let name = entry.file_name().to_string_lossy().into_owned();
			if name.ends_with(".partial") {
				continue;
			}
			let Some(key) = key_from_file_name(&name) else { continue };
			if let Ok(value) = fs::read_to_string(entry.path()) {
				out.push((key, value));
			}
		}
		out
	}
}

fn key_from_file_name(name: &str) -> Option<String> {
	let bytes = name.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] == b'%' {
			let hex = name.get(i + 1..i + 3)?;
			out.push(u8::from_str_radix(hex, 16).ok()?);
			i += 3;
		} else {
			out.push(bytes[i]);
			i += 1;
		}
	}
	String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn keys_round_trip_through_file_names() {
		for key in ["greeting-phrases-v1", "open-grind:app-data:x/y", "á é", ".hidden"] {
			let name = file_name_for(key).unwrap();
			assert!(!name.contains('/') && !name.starts_with('.'), "{name}");
			assert_eq!(key_from_file_name(&name).as_deref(), Some(key));
		}
	}
}

//! Photos and videos: the page asks `/og-media/<token>`, where the token is
//! what the app puts after `ogmedia://localhost/` — `i` (image) or `v` (video)
//! plus the Grindr URL in base64url. Fetched through the Grindr client, like
//! the app, since Grindr's media needs its headers.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use crate::App;

const MAX_MEDIA_BYTES: usize = 300 * 1024 * 1024;

pub fn sniff(bytes: &[u8]) -> &'static str {
	match bytes {
		[0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
		[0x89, b'P', b'N', b'G', ..] => "image/png",
		[b'G', b'I', b'F', ..] => "image/gif",
		[b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
		[_, _, _, _, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c', ..] => "image/heic",
		[_, _, _, _, b'f', b't', b'y', b'p', b'q', b't', ..] => "video/quicktime",
		[_, _, _, _, b'f', b't', b'y', b'p', ..] => "video/mp4",
		[0x1A, 0x45, 0xDF, 0xA3, ..] => "video/webm",
		_ => "application/octet-stream",
	}
}

fn target(token: &str) -> Option<(String, grindr::MediaFetcher)> {
	let fetcher = match token.chars().next()? {
		'i' => grindr::MediaFetcher::ImageLoader,
		'v' => grindr::MediaFetcher::MediaPlayer,
		_ => return None,
	};
	let bytes = URL_SAFE_NO_PAD.decode(token.get(1..)?.trim_end_matches('=')).ok()?;
	let url = String::from_utf8(bytes).ok()?;
	url.starts_with("https://").then_some((url, fetcher))
}

/// Byte range `bytes=a-b` of a body we already hold whole.
fn requested_range(headers: &HeaderMap, len: usize) -> Option<(usize, usize)> {
	let value = headers.get(header::RANGE)?.to_str().ok()?;
	let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
	let (start, end) = spec.split_once('-')?;
	let (start, end) = match (start.trim(), end.trim()) {
		("", suffix) => {
			let n: usize = suffix.parse().ok()?;
			(len.saturating_sub(n), len.checked_sub(1)?)
		}
		(start, "") => (start.parse().ok()?, len.checked_sub(1)?),
		(start, end) => (start.parse().ok()?, end.parse::<usize>().ok()?.min(len.checked_sub(1)?)),
	};
	(start <= end && end < len).then_some((start, end))
}

/// The whole file behind a Grindr media URL, with its sniffed content type.
pub async fn fetch_bytes(
	app: &App,
	url: &str,
	is_video: bool,
) -> Result<(Vec<u8>, &'static str), String> {
	if !url.starts_with("https://") {
		return Err(format!("dirección no válida: {url}"));
	}
	let fetcher = if is_video {
		grindr::MediaFetcher::MediaPlayer
	} else {
		grindr::MediaFetcher::ImageLoader
	};
	let response = app
		.client
		.fetch_media(grindr::MediaRequest {
			url,
			range: None,
			max_bytes: MAX_MEDIA_BYTES,
			fetcher,
		})
		.await
		.map_err(|e| e.to_string())?;
	if !(200..300).contains(&response.status) {
		return Err(format!("Grindr respondió {}", response.status));
	}
	let body = Vec::from(response.body);
	let content_type = sniff(&body);
	Ok((body, content_type))
}

pub async fn serve(
	State(app): State<App>,
	Path(token): Path<String>,
	headers: HeaderMap,
) -> Response {
	let Some((url, fetcher)) = target(&token) else {
		return StatusCode::NOT_FOUND.into_response();
	};
	let response = match app
		.client
		.fetch_media(grindr::MediaRequest {
			url: &url,
			range: None,
			max_bytes: MAX_MEDIA_BYTES,
			fetcher,
		})
		.await
	{
		Ok(response) => response,
		Err(e) => {
			tracing::warn!("[media] {e}");
			return StatusCode::BAD_GATEWAY.into_response();
		}
	};
	if !(200..300).contains(&response.status) {
		return StatusCode::from_u16(response.status)
			.unwrap_or(StatusCode::BAD_GATEWAY)
			.into_response();
	}
	let body = Vec::from(response.body);
	let content_type = sniff(&body);
	let total = body.len();
	let cache = "private, max-age=86400";

	// Videos seek with ranges; answer them from the whole body.
	if let Some((start, end)) = requested_range(&headers, total) {
		let part = body[start..=end].to_vec();
		return (
			StatusCode::PARTIAL_CONTENT,
			[
				(header::CONTENT_TYPE, content_type.to_owned()),
				(header::ACCEPT_RANGES, "bytes".to_owned()),
				(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}")),
				(header::CACHE_CONTROL, cache.to_owned()),
			],
			Body::from(part),
		)
			.into_response();
	}
	(
		[
			(header::CONTENT_TYPE, content_type.to_owned()),
			(header::ACCEPT_RANGES, "bytes".to_owned()),
			(header::CACHE_CONTROL, cache.to_owned()),
		],
		Body::from(body),
	)
		.into_response()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn tokens_decode_like_the_app_encodes_them() {
		let token = format!("v{}", URL_SAFE_NO_PAD.encode("https://cdns.grindr.com/x.mp4"));
		let (url, fetcher) = target(&token).unwrap();
		assert_eq!(url, "https://cdns.grindr.com/x.mp4");
		assert_eq!(fetcher, grindr::MediaFetcher::MediaPlayer);
		assert!(target("xabc").is_none());
		assert!(target(&format!("i{}", URL_SAFE_NO_PAD.encode("http://a"))).is_none());
	}

	#[test]
	fn ranges() {
		let mut headers = HeaderMap::new();
		headers.insert(header::RANGE, "bytes=0-".parse().unwrap());
		assert_eq!(requested_range(&headers, 10), Some((0, 9)));
		headers.insert(header::RANGE, "bytes=2-4".parse().unwrap());
		assert_eq!(requested_range(&headers, 10), Some((2, 4)));
		headers.insert(header::RANGE, "bytes=-3".parse().unwrap());
		assert_eq!(requested_range(&headers, 10), Some((7, 9)));
		headers.insert(header::RANGE, "bytes=20-".parse().unwrap());
		assert_eq!(requested_range(&headers, 10), None);
	}
}

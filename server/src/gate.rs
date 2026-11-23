//! The page's own lock: with `OG_PASSWORD` set, a browser has to enter it once
//! (`/acceso`) and then carries a cookie. Without it, anyone who reaches the
//! port gets in, so it is only for trying the server at home.

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::Form;
use sha2::{Digest, Sha256};

use crate::store::Store;
use crate::App;

const COOKIE: &str = "og_access";
const SALT: &str = "access-salt";

pub struct Gate {
	/// The cookie value that lets a browser in; `None` = no password set.
	token: Option<String>,
	password: Option<String>,
}

fn hex(bytes: &[u8]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl Gate {
	pub fn new(store: &Store, password: Option<String>) -> Self {
		let password = password.filter(|p| !p.is_empty());
		let Some(password) = password else {
			tracing::warn!("[gate] no OG_PASSWORD: the page is open to anyone who reaches it");
			return Self { token: None, password: None };
		};
		let salt = store.load_secret::<Vec<u8>>(SALT).unwrap_or_else(|| {
			let mut salt = vec![0u8; 32];
			getrandom::fill(&mut salt).expect("no randomness");
			store.save_secret(SALT, &salt);
			salt
		});
		let mut hasher = Sha256::new();
		hasher.update(&salt);
		hasher.update(password.as_bytes());
		Self {
			token: Some(hex(&hasher.finalize())),
			password: Some(password),
		}
	}

	fn lets_in(&self, headers: &HeaderMap) -> bool {
		let Some(token) = &self.token else { return true };
		// The phone app sends the password itself (it keeps no cookie).
		if let (Some(sent), Some(password)) = (
			headers.get("x-og-password").and_then(|v| v.to_str().ok()),
			&self.password,
		) {
			return same(sent.as_bytes(), password.as_bytes());
		}
		headers
			.get_all(header::COOKIE)
			.iter()
			.filter_map(|value| value.to_str().ok())
			.flat_map(|value| value.split(';'))
			.filter_map(|pair| pair.trim().split_once('='))
			.any(|(name, value)| name == COOKIE && same(value.as_bytes(), token.as_bytes()))
	}
}

/// Compare without stopping at the first different byte.
fn same(a: &[u8], b: &[u8]) -> bool {
	a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub async fn require(State(app): State<App>, request: Request, next: Next) -> Response {
	if app.gate.lets_in(request.headers()) {
		return next.run(request).await;
	}
	let path = request.uri().path();
	if path.starts_with("/api/") || path.starts_with("/og-media/") {
		StatusCode::UNAUTHORIZED.into_response()
	} else {
		Redirect::to("/acceso").into_response()
	}
}

const PAGE: &str = r#"<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Martins Grindr</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#f2f4f8;font:16px system-ui,sans-serif}
form{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}
input,button{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid #2b3245;background:#151b2b;color:inherit}
button{background:#f5c518;color:#111;border:0;font-weight:600}
p{margin:0;color:#ff8a8a;min-height:1.2em}
</style></head><body>
<form method="post" action="/acceso">
<h1 style="margin:0 0 4px;font-size:20px">Martins Grindr</h1>
<input type="password" name="password" placeholder="Clave de acceso" autocomplete="current-password" autofocus required>
<button type="submit">Entrar</button>
<p>{{error}}</p>
</form></body></html>"#;

pub async fn form() -> Html<String> {
	Html(PAGE.replace("{{error}}", ""))
}

#[derive(serde::Deserialize)]
pub struct Login {
	password: String,
}

pub async fn submit(State(app): State<App>, Form(login): Form<Login>) -> Response {
	let (Some(token), Some(password)) = (&app.gate.token, &app.gate.password) else {
		return Redirect::to("/").into_response();
	};
	if !same(login.password.as_bytes(), password.as_bytes()) {
		// A wrong guess costs a second.
		tokio::time::sleep(std::time::Duration::from_secs(1)).await;
		return (
			StatusCode::UNAUTHORIZED,
			Html(PAGE.replace("{{error}}", "Clave incorrecta")),
		)
			.into_response();
	}
	let cookie = format!(
		"{COOKIE}={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"
	);
	([(header::SET_COOKIE, cookie)], Redirect::to("/")).into_response()
}

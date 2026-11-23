//! open-grind as a web app: this server runs the same Grindr client the
//! Android app runs natively (the `grindr` crate) and serves the app's pages.
//! The page talks to it through a small shim (`web/shim.js`) that stands in
//! for Tauri, so the page code is the same as in the app.
//!
//! Settings: environment variables
//! - `OG_DATA_DIR`  where everything is kept (default `/data`)
//! - `OG_WEB_DIR`   the built pages (default `./web`)
//! - `OG_PORT`      port (default 8099)
//! - `OG_PASSWORD`  if set, the page asks for it once per browser
//! - `OG_MEDIA_DIR` where saved photos are copied as normal files (default `/media`)

mod archive;
mod commands;
mod error;
mod gate;
mod media;
mod phone;
mod shapes;
mod store;
mod tasks;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::handler::Handler as _;
use axum::http::{header, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::Stream;
use serde::Serialize;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::services::ServeDir;

use crate::store::Store;

/// Something the page listens to (`listen("grindr:chat_message", …)`).
#[derive(Clone, Serialize)]
pub struct Event {
	pub event: String,
	pub payload: serde_json::Value,
}

pub struct AppInner {
	pub client: grindr::GrindrClient,
	pub store: Store,
	pub events: broadcast::Sender<Event>,
	pub foreground: AtomicBool,
	pub gate: gate::Gate,
	pub web_dir: PathBuf,
	pub data_dir: PathBuf,
	/// Where saved photos are copied as normal files (`<media>/Martins Grindr`).
	pub media_dir: PathBuf,
}

pub type App = Arc<AppInner>;

impl AppInner {
	pub fn emit(&self, event: &str, payload: impl Serialize) {
		let payload = serde_json::to_value(payload).unwrap_or(serde_json::Value::Null);
		// No listener (no page open) is fine.
		let _ = self.events.send(Event {
			event: event.to_owned(),
			payload,
		});
	}
}

pub const DEVICE: &str = "device-info";
pub const SESSION: &str = "session";
pub const SIGNING_KEY: &str = "device-signing-key";

fn env_or(name: &str, default: &str) -> String {
	std::env::var(name)
		.ok()
		.filter(|value| !value.trim().is_empty())
		.unwrap_or_else(|| default.to_owned())
}

/// `OG_PASSWORD`, or in Home Assistant the add-on's "password" option
/// (Home Assistant writes the options to `/data/options.json`).
fn password(data_dir: &std::path::Path) -> Option<String> {
	if let Some(password) = std::env::var("OG_PASSWORD").ok().filter(|p| !p.is_empty()) {
		return Some(password);
	}
	let options = std::fs::read(data_dir.join("options.json")).ok()?;
	let options: serde_json::Value = serde_json::from_slice(&options).ok()?;
	options
		.get("password")?
		.as_str()
		.map(str::to_owned)
		.filter(|p| !p.is_empty())
}

#[tokio::main]
async fn main() {
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::try_from_default_env()
				.unwrap_or_else(|_| "info".into()),
		)
		.init();

	// CI runs this under an emulated old CPU: building the client initialises
	// BoringSSL, which is where an unsupported instruction would show up.
	if std::env::args().any(|arg| arg == "--self-test") {
		let client = grindr::GrindrClient::new(grindr::DeviceInfo::generate(), None)
			.expect("cannot build the Grindr client");
		drop(client);
		println!("self-test ok");
		return;
	}

	let data_dir = PathBuf::from(env_or("OG_DATA_DIR", "/data"));
	let web_dir = PathBuf::from(env_or("OG_WEB_DIR", "./web"));
	let port: u16 = env_or("OG_PORT", "8099").parse().unwrap_or(8099);
	let store = Store::open(data_dir.clone()).expect("cannot open the data folder");

	let device = store.load_secret::<grindr::DeviceInfo>(DEVICE).unwrap_or_else(|| {
		let device = grindr::DeviceInfo::generate();
		store.save_secret(DEVICE, &device);
		device
	});
	let credentials = store.load_secret::<grindr::Credentials>(SESSION);
	let resumed = credentials.clone().map(|credentials| grindr::Session {
		credentials,
		token: None,
	});
	let client = grindr::GrindrClient::new(device, resumed).expect("cannot build the Grindr client");

	let (events, _) = broadcast::channel(1024);
	let app: App = Arc::new(AppInner {
		client,
		store: store.clone(),
		events,
		foreground: AtomicBool::new(true),
		gate: gate::Gate::new(&store, password(&data_dir)),
		web_dir: web_dir.clone(),
		data_dir: data_dir.clone(),
		media_dir: PathBuf::from(env_or("OG_MEDIA_DIR", "/media")),
	});
	tasks::spawn_all(app.clone(), credentials);

	// Any other path is a page of the app (it routes itself): give it the start
	// page, with the shim.
	let static_files = ServeDir::new(&web_dir)
		.append_index_html_on_directories(false)
		.fallback(index_page.with_state(app.clone()));

	let protected = Router::new()
		.route("/api/invoke/:command", post(invoke))
		.route("/api/events", get(events_stream))
		.route("/api/storage", get(storage_all).post(storage_write))
		.route("/og-media/:token", get(media::serve))
		.route("/api/phone/media", get(phone::list))
		.route("/api/phone/media/:file_name", axum::routing::put(phone::upload))
		.route("/api/phone/settings", axum::routing::put(phone::settings))
		.route("/", get(index_page))
		.route("/index.html", get(index_page))
		.fallback_service(static_files)
		.layer(axum::middleware::from_fn_with_state(app.clone(), gate::require))
		.layer(DefaultBodyLimit::max(64 * 1024 * 1024));

	let router = Router::new()
		.route("/og-server.js", get(shim_script))
		.route("/acceso", get(gate::form).post(gate::submit))
		.merge(protected)
		.with_state(app);

	let address = SocketAddr::from(([0, 0, 0, 0], port));
	tracing::info!("open-grind web on http://{address}");
	let listener = tokio::net::TcpListener::bind(address).await.expect("cannot open the port");
	axum::serve(listener, router)
		.with_graceful_shutdown(async {
			let _ = tokio::signal::ctrl_c().await;
		})
		.await
		.expect("server stopped");
}

/// Any command the page would have sent to the app's native side.
async fn invoke(
	State(app): State<App>,
	Path(command): Path<String>,
	body: Option<Json<serde_json::Value>>,
) -> Response {
	let args = body.map(|Json(value)| value).unwrap_or(serde_json::Value::Null);
	match commands::run(&app, &command, args).await {
		Ok(value) => Json(value).into_response(),
		Err(error) => {
			if !matches!(error, error::AppError::Unsupported(_)) {
				tracing::warn!("[invoke] {command}: {error}");
			}
			(StatusCode::BAD_REQUEST, Json(error)).into_response()
		}
	}
}

async fn events_stream(
	State(app): State<App>,
) -> Sse<impl Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
	// Say where the socket stands right away, as the app does on start.
	let connected = *app.client.connection_state().borrow()
		== grindr::WsConnectionState::Connected;
	let first = Event {
		event: if connected { "ws:connected" } else { "ws:disconnected" }.to_owned(),
		payload: serde_json::Value::Null,
	};
	let stream = tokio_stream::once(Ok(first))
		.chain(BroadcastStream::new(app.events.subscribe()))
		.filter_map(|item| item.ok())
		.map(|event| {
			Ok(SseEvent::default().data(serde_json::to_string(&event).unwrap_or_default()))
		});
	Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn storage_all(State(app): State<App>) -> Json<serde_json::Map<String, serde_json::Value>> {
	let mut map = serde_json::Map::new();
	for (key, value) in app.store.all_app_data() {
		if key.starts_with(commands::NATIVE_PREFIX) {
			continue;
		}
		map.insert(key, serde_json::Value::String(value));
	}
	Json(map)
}

#[derive(serde::Deserialize)]
struct StorageWrite {
	#[serde(default)]
	set: std::collections::HashMap<String, String>,
	#[serde(default)]
	remove: Vec<String>,
	#[serde(default)]
	clear: bool,
}

async fn storage_write(State(app): State<App>, Json(write): Json<StorageWrite>) -> StatusCode {
	if write.clear {
		for (key, _) in app.store.all_app_data() {
			if !key.starts_with(commands::NATIVE_PREFIX) {
				app.store.remove_app_data(&key);
			}
		}
	}
	for key in write.remove {
		if !key.starts_with(commands::NATIVE_PREFIX) {
			app.store.remove_app_data(&key);
		}
	}
	let mut failed = false;
	for (key, value) in write.set {
		if key.starts_with(commands::NATIVE_PREFIX) {
			continue;
		}
		if let Err(e) = app.store.write_app_data(&key, &value) {
			tracing::error!("[storage] {key}: {e}");
			failed = true;
		}
	}
	if failed {
		StatusCode::INTERNAL_SERVER_ERROR
	} else {
		StatusCode::NO_CONTENT
	}
}

/// The app's start page with the shim loaded before anything else.
async fn index_page(State(app): State<App>) -> Response {
	let Ok(html) = tokio::fs::read_to_string(app.web_dir.join("index.html")).await else {
		return (StatusCode::NOT_FOUND, "Falta la página (index.html)").into_response();
	};
	let tag = r#"<script src="/og-server.js"></script>"#;
	let html = match html.find("<head>") {
		Some(at) => format!("{}{tag}{}", &html[..at + 6], &html[at + 6..]),
		None => format!("{tag}{html}"),
	};
	(
		[(header::CACHE_CONTROL, "no-store")],
		Html(html),
	)
		.into_response()
}

async fn shim_script() -> Response {
	(
		[
			(header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
			(header::CACHE_CONTROL, "no-store"),
		],
		include_str!("../web/shim.js"),
	)
		.into_response()
}

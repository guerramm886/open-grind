//! The commands the page sends (`invoke("request", …)` in the app), answered
//! the way the app's native side answers them.

use std::str::FromStr as _;
use std::sync::atomic::Ordering;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::shapes::{self, SignInResult};
use crate::{App, DEVICE, SESSION, SIGNING_KEY};

/// App-data keys kept for the app's own files (`read_app_data`), apart from
/// the page's settings.
pub const NATIVE_PREFIX: &str = "native:";

const SIGNED_UPLOAD_PATHS: [&str; 2] = ["/v5/media/upload", "/v6/chat/media/upload"];
const MAX_EXTERNAL_BYTES: usize = 4 * 1024 * 1024;

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, name: &str) -> Result<T, AppError> {
	serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
		.map_err(|e| AppError::Http(format!("bad argument {name}: {e}")))
}

fn to_json(value: impl Serialize) -> Result<Value, AppError> {
	serde_json::to_value(value).map_err(|e| AppError::Http(e.to_string()))
}

pub async fn run(app: &App, command: &str, args: Value) -> Result<Value, AppError> {
	if let Some(result) = crate::archive::run(app, command, &args).await {
		return result.map_err(AppError::Http);
	}
	let client = &app.client;
	match command {
		"backend_ready" => Ok(json!(true)),
		// Kept on the server's own disk; "keyring" so the page shows no
		// "plain file" warning meant for desktop computers.
		"storage_backend" => Ok(json!("keyring")),

		"sign_in_with_email" => {
			let email: String = arg(&args, "email")?;
			let password: String = arg(&args, "password")?;
			let captcha: Option<String> = arg(&args, "captchaToken")?;
			end_existing_session(app).await;
			let result = match captcha {
				Some(token) => client.sign_in_with_email_captcha(&email, &password, &token).await?,
				None => client.sign_in_with_email(&email, &password).await?,
			};
			to_json(SignInResult::from(result))
		}
		"sign_in_with_google_token" => {
			let token: String = arg(&args, "token")?;
			end_existing_session(app).await;
			to_json(SignInResult::from(client.sign_in_with_google(&token).await?))
		}
		"refresh_session" => {
			let geohash: Option<String> = arg(&args, "geohash")?;
			let result = client
				.refresh_session_at_geohash(geohash.as_deref())
				.await
				.map_err(|e| AppError::from_client_error(e, client))?;
			to_json(SignInResult::from(result))
		}
		"sign_out" => {
			forget_account(app).await;
			Ok(Value::Null)
		}
		"current_session" => to_json(shapes::current_session(
			client.session_receiver().borrow().as_ref(),
		)),
		"account_restriction" => {
			let restriction = client
				.session_receiver()
				.borrow()
				.as_ref()
				.and_then(|s| s.token.as_ref()?.restriction.clone())
				.map(shapes::Restriction::from);
			to_json(restriction)
		}
		"session_feature_flags" => {
			let flags = client
				.session_receiver()
				.borrow()
				.as_ref()
				.and_then(|s| s.token.as_ref())
				.map(|token| shapes::feature_flags_of(&token.session_id))
				.unwrap_or_default();
			to_json(flags)
		}
		"recaptcha_first_party_enabled" => {
			Ok(json!(client.recaptcha_first_party_enabled().await?))
		}
		"set_app_active" => {
			// The server stays connected whether or not a page is open; a page
			// coming back only nudges a dead connection.
			let active: bool = arg(&args, "active")?;
			app.foreground.store(true, Ordering::SeqCst);
			if active && !client.is_active() {
				client.set_active(true);
				client.reset_transport().await?;
			}
			Ok(Value::Null)
		}
		"rotate_api_params" => {
			let new_device = grindr::DeviceInfo::generate();
			app.store.save_secret(DEVICE, &new_device);
			let old_device = client.rotate_device(new_device).await?;
			Ok(json!({
				"user-agent": grindr::build_user_agent(&old_device, "Free"),
				"l-device-info": grindr::build_device_info_header(&old_device),
			}))
		}

		"request" => {
			let payload: String = arg(&args, "payload")?;
			request(app, &payload).await.map(Value::String)
		}
		"fetch_external" => {
			let url: String = arg(&args, "url")?;
			let range: Option<String> = arg(&args, "range")?;
			let response = client
				.fetch_media(grindr::MediaRequest {
					url: &url,
					range: range.as_deref(),
					max_bytes: MAX_EXTERNAL_BYTES,
					fetcher: grindr::MediaFetcher::Plain,
				})
				.await
				.map_err(|e| AppError::from_client_error(e, client))?;
			encode_response(response.status, Vec::from(response.body)).map(Value::String)
		}

		"ws_connect" => {
			client.connect().await;
			Ok(Value::Null)
		}
		"ws_reconnect" => {
			ws_reconnect(client).await?;
			Ok(Value::Null)
		}
		"ws_send" => {
			let command: grindr::WsCommand = arg(&args, "command")?;
			if *client.connection_state().borrow() != grindr::WsConnectionState::Connected {
				return Err(AppError::Http("WS not connected".to_owned()));
			}
			client
				.ws_sender()
				.try_send(command)
				.map_err(|e| AppError::Http(format!("WS send failed: {e}")))?;
			Ok(Value::Null)
		}

		"read_app_data" => {
			let file: String = arg(&args, "file")?;
			match app.store.read_app_data(&format!("{NATIVE_PREFIX}{file}")) {
				Some(encoded) => {
					let bytes = STANDARD
						.decode(encoded.trim())
						.map_err(|e| AppError::Http(e.to_string()))?;
					to_json(bytes)
				}
				None => Ok(Value::Null),
			}
		}
		"write_app_data" => {
			let file: String = arg(&args, "file")?;
			let content: String = arg(&args, "content")?;
			app.store
				.write_app_data(&format!("{NATIVE_PREFIX}{file}"), &content)
				.map_err(|e| AppError::Http(e.to_string()))?;
			Ok(Value::Null)
		}
		"remove_app_data" => {
			let file: String = arg(&args, "file")?;
			app.store.remove_app_data(&format!("{NATIVE_PREFIX}{file}"));
			Ok(Value::Null)
		}

		other => Err(AppError::Unsupported(other.to_owned())),
	}
}

#[derive(Deserialize)]
struct RequestPayload {
	method: String,
	path: String,
	#[serde(with = "serde_bytes")]
	#[serde(default)]
	body: Option<Vec<u8>>,
}

#[derive(Serialize)]
struct RawResponse {
	status: u16,
	#[serde(with = "serde_bytes")]
	body: Vec<u8>,
}

fn encode_response(status: u16, body: Vec<u8>) -> Result<String, AppError> {
	rmp_serde::encode::to_vec_named(&RawResponse { status, body })
		.map(|bytes| STANDARD.encode(bytes))
		.map_err(|e| AppError::Http(e.to_string()))
}

/// A REST call to Grindr, packed exactly as in src-tauri/src/api/rest.rs.
async fn request(app: &App, payload: &str) -> Result<String, AppError> {
	let bytes = STANDARD
		.decode(payload)
		.map_err(|e| AppError::Http(format!("Failed to decode base64 payload: {e}")))?;
	let payload: RequestPayload = rmp_serde::from_slice(&bytes)
		.map_err(|e| AppError::Http(format!("Failed to decode request payload: {e}")))?;

	let bare_path = payload.path.split(['?', '#']).next().unwrap_or(&payload.path);
	if SIGNED_UPLOAD_PATHS.contains(&bare_path) {
		return Err(AppError::Api {
			code: 400,
			message: format!("{} needs the signed upload command", payload.path),
		});
	}
	let method = grindr::Method::from_str(&payload.method).map_err(|_| AppError::Api {
		code: 400,
		message: format!("Invalid method: {}", payload.method),
	})?;
	let json_body: Option<Value> = match payload.body {
		Some(b) => Some(
			rmp_serde::from_slice::<Value>(&b)
				.map_err(|e| AppError::Http(format!("Failed to decode msgpack body: {e}")))?,
		),
		None => None,
	};

	let client = &app.client;
	let request = client.request(method, &payload.path);
	let request = match &json_body {
		Some(body) => request.json(body),
		None => request,
	};
	let raw = request
		.send()
		.await
		.map_err(|e| AppError::from_client_error(e, client))?;
	encode_response(raw.status, raw.body)
}

const RECONNECT_STEP_TIMEOUT: Duration = Duration::from_secs(3);

async fn ws_reconnect(client: &grindr::GrindrClient) -> Result<(), AppError> {
	let mut states = client.connection_state();
	if *states.borrow_and_update() != grindr::WsConnectionState::Connected {
		return Ok(());
	}
	client.set_active(false);
	let stopped = tokio::time::timeout(
		RECONNECT_STEP_TIMEOUT,
		states.wait_for(|state| *state == grindr::WsConnectionState::Disconnected),
	)
	.await
	.is_ok();
	client.set_active(true);
	if !stopped {
		return Err(AppError::Http("WS did not go down in time".to_owned()));
	}
	let _ = tokio::time::timeout(
		RECONNECT_STEP_TIMEOUT,
		states.wait_for(|state| *state == grindr::WsConnectionState::Connected),
	)
	.await;
	Ok(())
}

static SIGN_OUT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Sign out and move to a fresh device, as the app does.
pub async fn forget_account(app: &App) {
	let _one_at_a_time = SIGN_OUT.lock().await;
	app.client.sign_out().await;
	app.store.delete_secret(SESSION);
	app.store.delete_secret(SIGNING_KEY);
	let new_device = grindr::DeviceInfo::generate();
	app.store.save_secret(DEVICE, &new_device);
	if let Err(e) = app.client.rotate_device(new_device).await {
		tracing::error!("[auth] could not move to a new device: {e}");
	}
}

async fn end_existing_session(app: &App) {
	if app.client.session_receiver().borrow().is_some() {
		forget_account(app).await;
	}
}

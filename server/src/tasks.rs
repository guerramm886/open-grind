//! What runs in the background for as long as the server is up, as the app's
//! setup does (src-tauri/src/lib.rs and api/ws.rs): keep the session saved,
//! and pass Grindr's live events on to whatever page is open.

use tokio::sync::broadcast::error::RecvError;

use crate::shapes::{Restriction, SessionErrorPayload};
use crate::{App, SESSION, SIGNING_KEY};

pub fn spawn_all(app: App, stored: Option<grindr::Credentials>) {
	tokio::spawn(keep_session_saved(app.clone(), stored));
	tokio::spawn(keep_signing_key_saved(app.clone()));
	tokio::spawn(forward_live_events(app.clone()));
	tokio::spawn(forward_connection_state(app.clone()));
	tokio::spawn(follow_auth_events(app));
}

async fn keep_session_saved(app: App, mut stored: Option<grindr::Credentials>) {
	let mut session_rx = app.client.session_receiver();
	let mut restriction = None;
	while session_rx.changed().await.is_ok() {
		let (next, next_restriction) = {
			let session = session_rx.borrow();
			(
				session.as_ref().map(|session| session.credentials.clone()),
				session
					.as_ref()
					.and_then(|session| session.token.as_ref()?.restriction.clone()),
			)
		};
		if next_restriction != restriction {
			if let Some(r) = &next_restriction {
				app.emit("auth:restriction", Restriction::from(r.clone()));
			}
			restriction = next_restriction;
		}
		if next == stored {
			continue;
		}
		match &next {
			Some(credentials) => app.store.save_secret(SESSION, credentials),
			None => app.store.delete_secret(SESSION),
		}
		stored = next;
	}
}

async fn keep_signing_key_saved(app: App) {
	if let Some(key) = app.store.load_secret::<grindr::DeviceSigningKey>(SIGNING_KEY) {
		if !app.client.restore_signing_key(key).await {
			tracing::warn!("[signing] stored key was refused, deleting it");
			app.store.delete_secret(SIGNING_KEY);
		}
	}
	let mut key_rx = app.client.signing_key_receiver();
	while key_rx.changed().await.is_ok() {
		let key = key_rx.borrow().clone();
		match key {
			Some(key) => app.store.save_secret(SIGNING_KEY, &key),
			None => app.store.delete_secret(SIGNING_KEY),
		}
	}
}

async fn forward_live_events(app: App) {
	let mut rx = app.client.ws_receiver();
	loop {
		match rx.recv().await {
			Ok(event) => {
				let safe_type = event.event_type.replace('.', "_");
				app.emit(&format!("grindr:{safe_type}"), &event.payload);
			}
			Err(RecvError::Lagged(skipped)) => app.emit("ws:events-dropped", skipped),
			Err(RecvError::Closed) => break,
		}
	}
}

async fn forward_connection_state(app: App) {
	let mut rx = app.client.connection_state();
	loop {
		if rx.changed().await.is_err() {
			break;
		}
		let connected = *rx.borrow() == grindr::WsConnectionState::Connected;
		app.emit(
			if connected { "ws:connected" } else { "ws:disconnected" },
			(),
		);
	}
}

async fn follow_auth_events(app: App) {
	let mut rx = app.client.auth_event_receiver();
	loop {
		let event = match rx.recv().await {
			Ok(event) => event,
			Err(RecvError::Lagged(_)) => continue,
			Err(RecvError::Closed) => break,
		};
		match event {
			grindr::AuthEvent::SignedOut => {
				crate::commands::forget_account(&app).await;
				app.emit(
					"auth:session-error",
					SessionErrorPayload {
						message: "Session expired".to_owned(),
						unauthorized: true,
						kind: "Unauthorized".to_owned(),
						attempts: 0,
						transient: false,
					},
				);
			}
			grindr::AuthEvent::RefreshFailed { message, kind, .. } => {
				let transient = kind.is_transient();
				app.emit(
					"auth:session-error",
					SessionErrorPayload {
						message,
						unauthorized: false,
						kind: if transient { "Http" } else { "Auth" }.to_owned(),
						attempts: 0,
						transient,
					},
				);
			}
			grindr::AuthEvent::RefreshRecovered => app.emit("auth:session-ok", ()),
			grindr::AuthEvent::Banned(info) => {
				crate::commands::forget_account(&app).await;
				app.emit("auth:banned", crate::error::BanInfo::from(info));
			}
			_ => {}
		}
	}
}

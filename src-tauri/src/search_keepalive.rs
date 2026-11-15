// Keeps the app process alive (Android foreground service + notification)
// while queued photo searches run, so they continue after the user leaves the
// app. The searches themselves run in the webview; this only holds the process.

#[cfg(target_os = "android")]
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Wry};

use crate::error::AppError;

#[cfg(target_os = "android")]
struct AndroidSearchKeepAlive {
	handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldRequest {
	text: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseRequest {
	done_text: Option<String>,
}

pub fn plugin() -> TauriPlugin<Wry> {
	Builder::new("search-keepalive")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"org.opengrind.search",
					"SearchKeepAlivePlugin",
				)?;
				_app.manage(AndroidSearchKeepAlive { handle });
			}
			Ok(())
		})
		.build()
}

/// Start (or update the text of) the ongoing "searching" notification.
#[tauri::command]
pub async fn search_keepalive_hold(
	app: AppHandle,
	text: String,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		let handle = app.state::<AndroidSearchKeepAlive>().handle.clone();
		handle
			.run_mobile_plugin_async::<serde_json::Value>(
				"hold",
				HoldRequest { text },
			)
			.await
			.map_err(|error| {
				AppError::Http(format!("Could not hold the search: {error}"))
			})?;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (&app, &text);
	}
	Ok(())
}

/// Stop the ongoing notification; `done_text` posts a "finished" one.
#[tauri::command]
pub async fn search_keepalive_release(
	app: AppHandle,
	done_text: Option<String>,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		let handle = app.state::<AndroidSearchKeepAlive>().handle.clone();
		handle
			.run_mobile_plugin_async::<serde_json::Value>(
				"release",
				ReleaseRequest { done_text },
			)
			.await
			.map_err(|error| {
				AppError::Http(format!("Could not release the search: {error}"))
			})?;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (&app, &done_text);
	}
	Ok(())
}

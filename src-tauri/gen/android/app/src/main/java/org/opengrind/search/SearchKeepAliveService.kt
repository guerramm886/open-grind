package org.opengrind.search

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

// Keeps the process (and its webview) running while queued photo searches are
// in progress, so they continue after the user leaves the app.
class SearchKeepAliveService : Service() {
	private var wakeLock: PowerManager.WakeLock? = null

	override fun onBind(intent: Intent?): IBinder? = null

	override fun onCreate() {
		super.onCreate()
		running = WeakReference(this)
	}

	override fun onStartCommand(
		intent: Intent?,
		flags: Int,
		startId: Int,
	): Int {
		try {
			ServiceCompat.startForeground(
				this,
				NOTIFICATION_ID,
				ongoing(this, text),
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
					ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
				} else {
					0
				},
			)
		} catch (e: Exception) {
			stopSelf()
			return START_NOT_STICKY
		}
		// A release that arrived before the service came up.
		if (!wanted) {
			finish()
			return START_NOT_STICKY
		}
		acquireWakeLock()
		return START_NOT_STICKY
	}

	override fun onTimeout(
		startId: Int,
		fgsType: Int,
	) {
		finish()
	}

	override fun onDestroy() {
		if (running?.get() === this) running = null
		wakeLock?.let { if (it.isHeld) it.release() }
		wakeLock = null
		super.onDestroy()
	}

	private fun finish() {
		ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
		stopSelf()
	}

	private fun acquireWakeLock() {
		if (wakeLock?.isHeld == true) return
		val power = getSystemService(Context.POWER_SERVICE) as PowerManager
		wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
			setReferenceCounted(false)
			acquire(WAKE_LOCK_TIMEOUT_MS)
		}
	}

	companion object {
		private const val CHANNEL_ID = "org.opengrind.search.keepalive"
		private const val NOTIFICATION_ID = 4712
		private const val DONE_NOTIFICATION_ID = 4713
		private const val WAKE_LOCK_TAG = "opengrind:search"
		private const val WAKE_LOCK_TIMEOUT_MS = 2L * 60L * 60L * 1000L

		@Volatile private var wanted = false
		@Volatile private var text = ""
		private var running: WeakReference<SearchKeepAliveService>? = null

		fun hold(
			context: Context,
			newText: String,
		) {
			text = newText
			val alreadyUp = wanted && running?.get() != null
			wanted = true
			if (alreadyUp) {
				// Just refresh the text; no new start needed (and starting from
				// the background isn't always allowed).
				context.getSystemService(NotificationManager::class.java)
					.notify(NOTIFICATION_ID, ongoing(context, newText))
				return
			}
			context.startForegroundService(Intent(context, SearchKeepAliveService::class.java))
		}

		fun release(
			context: Context,
			doneText: String?,
		) {
			wanted = false
			ContextCompat.getMainExecutor(context).execute { running?.get()?.finish() }
			if (!doneText.isNullOrBlank()) {
				try {
					context.getSystemService(NotificationManager::class.java)
						.notify(DONE_NOTIFICATION_ID, done(context, doneText))
				} catch (_: Exception) {
				}
			}
		}

		private fun channel(context: Context) {
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
				val channel = NotificationChannel(
					CHANNEL_ID,
					"Búsqueda en fotos",
					NotificationManager.IMPORTANCE_LOW,
				).apply { setShowBadge(false) }
				context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
			}
		}

		private fun openApp(context: Context): PendingIntent? {
			val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
			return PendingIntent.getActivity(
				context,
				0,
				launch,
				PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
			)
		}

		private fun ongoing(
			context: Context,
			body: String,
		): Notification {
			channel(context)
			return NotificationCompat.Builder(context, CHANNEL_ID)
				.setContentTitle("Buscando en fotos…")
				.setContentText(body)
				.setSmallIcon(android.R.drawable.ic_menu_search)
				.setPriority(NotificationCompat.PRIORITY_LOW)
				.setOngoing(true)
				.setSilent(true)
				.setOnlyAlertOnce(true)
				.setContentIntent(openApp(context))
				.setProgress(0, 0, true)
				.build()
		}

		private fun done(
			context: Context,
			body: String,
		): Notification {
			channel(context)
			return NotificationCompat.Builder(context, CHANNEL_ID)
				.setContentTitle("Búsqueda en fotos terminada")
				.setContentText(body)
				.setStyle(NotificationCompat.BigTextStyle().bigText(body))
				.setSmallIcon(android.R.drawable.ic_menu_search)
				.setPriority(NotificationCompat.PRIORITY_LOW)
				.setAutoCancel(true)
				.setContentIntent(openApp(context))
				.build()
		}
	}
}

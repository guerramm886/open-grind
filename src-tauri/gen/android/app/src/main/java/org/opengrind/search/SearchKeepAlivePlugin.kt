package org.opengrind.search

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
internal class HoldArgs {
    var text: String? = null
}

@InvokeArg
internal class ReleaseArgs {
    var doneText: String? = null
}

@TauriPlugin
class SearchKeepAlivePlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun hold(invoke: Invoke) {
        val args = invoke.parseArgs(HoldArgs::class.java)
        try {
            SearchKeepAliveService.hold(activity.applicationContext, args.text ?: "")
        } catch (_: Exception) {
            // Without the service the search still runs while the app is open.
        }
        invoke.resolve()
    }

    @Command
    fun release(invoke: Invoke) {
        val args = invoke.parseArgs(ReleaseArgs::class.java)
        try {
            SearchKeepAliveService.release(activity.applicationContext, args.doneText)
        } catch (_: Exception) {
        }
        invoke.resolve()
    }
}

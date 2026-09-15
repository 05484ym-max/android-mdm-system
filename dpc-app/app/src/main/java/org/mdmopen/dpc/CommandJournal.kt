package org.mdmopen.dpc

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small durable idempotency journal for server commands.
 *
 * The server is allowed to re-deliver a leased command when an HTTP response or
 * ACK is lost. The device therefore records a command ID before side effects and
 * remembers terminal outcomes across process death/reboot. The journal is
 * deliberately bounded so a long-lived device cannot grow SharedPreferences
 * forever.
 */
object CommandJournal {
    private const val PREFS = "dpc_command_journal"
    private const val KEY_ORDER = "_order"
    private const val MAX_ENTRIES = 200

    data class Entry(val status: String, val message: String?) {
        val terminal: Boolean get() = status == "SUCCESS" || status == "FAILED"
    }

    @Synchronized
    fun get(context: Context, commandId: String): Entry? {
        val raw = prefs(context).getString(commandId, null) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            Entry(
                status = json.optString("status", "STARTED"),
                message = if (json.isNull("message")) null else json.optString("message", null),
            )
        }.getOrNull()
    }

    @Synchronized
    fun markStarted(context: Context, commandId: String) {
        if (get(context, commandId)?.terminal == true) return
        put(context, commandId, "STARTED", null)
    }

    @Synchronized
    fun markTerminal(context: Context, commandId: String, status: String, message: String?) {
        require(status == "SUCCESS" || status == "FAILED")
        put(context, commandId, status, message?.take(500))
    }

    private fun put(context: Context, commandId: String, status: String, message: String?) {
        val p = prefs(context)
        val order = readOrder(p).toMutableList().apply {
            remove(commandId)
            add(commandId)
        }
        val editor = p.edit().putString(
            commandId,
            JSONObject().put("status", status).put("message", message).toString(),
        )
        while (order.size > MAX_ENTRIES) {
            val removed = order.removeAt(0)
            editor.remove(removed)
        }
        editor.putString(KEY_ORDER, JSONArray(order).toString()).commit()
    }

    private fun readOrder(p: android.content.SharedPreferences): List<String> =
        runCatching {
            val array = JSONArray(p.getString(KEY_ORDER, "[]"))
            (0 until array.length()).mapNotNull { array.optString(it, null) }
        }.getOrDefault(emptyList())

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

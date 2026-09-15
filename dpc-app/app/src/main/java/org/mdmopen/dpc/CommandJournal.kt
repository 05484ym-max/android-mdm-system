package org.mdmopen.dpc

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Durable, bounded idempotency journal for server commands. */
object CommandJournal {
    private const val PREFS = "dpc_command_journal"
    private const val KEY_ORDER = "_order"
    private const val MAX_ENTRIES = 200

    data class Entry(
        val status: String,
        val message: String?,
        val metadata: String?,
        val startedAt: Long?,
    ) {
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
                metadata = if (json.isNull("metadata")) null else json.optString("metadata", null),
                startedAt = if (json.has("startedAt") && !json.isNull("startedAt")) json.optLong("startedAt") else null,
            )
        }.getOrNull()
    }

    @Synchronized
    fun markStarted(context: Context, commandId: String, metadata: String? = null) {
        val existing = get(context, commandId)
        if (existing?.terminal == true) return
        put(
            context,
            commandId,
            "STARTED",
            null,
            metadata ?: existing?.metadata,
            existing?.startedAt ?: System.currentTimeMillis(),
        )
    }

    @Synchronized
    fun updateStartedMetadata(context: Context, commandId: String, metadata: String?) {
        val existing = get(context, commandId) ?: return
        if (existing.terminal) return
        put(
            context,
            commandId,
            existing.status,
            existing.message,
            metadata,
            existing.startedAt ?: System.currentTimeMillis(),
        )
    }

    @Synchronized
    fun markTerminal(context: Context, commandId: String, status: String, message: String?) {
        require(status == "SUCCESS" || status == "FAILED")
        val existing = get(context, commandId)
        put(
            context,
            commandId,
            status,
            message?.take(500),
            existing?.metadata,
            existing?.startedAt,
        )
    }

    private fun put(
        context: Context,
        commandId: String,
        status: String,
        message: String?,
        metadata: String?,
        startedAt: Long?,
    ) {
        val p = prefs(context)
        val order = readOrder(p).toMutableList().apply {
            remove(commandId)
            add(commandId)
        }
        val json = JSONObject()
            .put("status", status)
            .put("message", message)
            .put("metadata", metadata)
            .put("startedAt", startedAt)
        val editor = p.edit().putString(commandId, json.toString())
        while (order.size > MAX_ENTRIES) {
            editor.remove(order.removeAt(0))
        }
        check(editor.putString(KEY_ORDER, JSONArray(order).toString()).commit()) {
            "Could not persist command journal"
        }
    }

    private fun readOrder(p: android.content.SharedPreferences): List<String> =
        runCatching {
            val array = JSONArray(p.getString(KEY_ORDER, "[]"))
            (0 until array.length()).mapNotNull { array.optString(it, null) }
        }.getOrDefault(emptyList())

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

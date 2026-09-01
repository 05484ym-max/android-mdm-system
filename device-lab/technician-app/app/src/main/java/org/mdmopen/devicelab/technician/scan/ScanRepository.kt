package org.mdmopen.devicelab.technician.scan

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.mdmopen.devicelab.technician.protocol.DeviceEvidence
import java.io.File
import java.util.UUID

/**
 * Local-only scan history + an offline upload queue, stored as a plain JSON file under
 * filesDir (no Room/SQLite dependency needed for this MVP's modest local history size).
 *
 * Safety property enforced here, not just in the UI: an offline-saved entry's `decision`
 * field is always null until a real backend response fills it in via markSynced(). There is
 * no method on this class that lets a caller attach a decision without going through a
 * successful backend submit - so a stale/offline decision can never be displayed as current.
 */
class ScanRepository(context: Context) {
    private val file = File(context.filesDir, "scan_history.json")

    data class Entry(
        val localId: String,
        val capturedAt: String,
        val evidenceJson: JSONObject,
        val synced: Boolean,
        val remoteScanId: String?,
        val decisionJson: JSONObject?
    )

    @Synchronized
    fun saveOffline(evidence: DeviceEvidence, evidenceJson: JSONObject): Entry {
        val entry = Entry(
            localId = UUID.randomUUID().toString(),
            capturedAt = evidence.capturedAt,
            evidenceJson = evidenceJson,
            synced = false,
            remoteScanId = null,
            decisionJson = null
        )
        val all = readAll().toMutableList()
        all.add(0, entry)
        writeAll(all)
        return entry
    }

    /** Called only after a real, successful backend response - never with a locally-guessed decision. */
    @Synchronized
    fun markSynced(localId: String, remoteScanId: String, decisionJson: JSONObject?) {
        val all = readAll().map {
            if (it.localId == localId) it.copy(synced = true, remoteScanId = remoteScanId, decisionJson = decisionJson) else it
        }
        writeAll(all)
    }

    @Synchronized
    fun listAll(): List<Entry> = readAll()

    @Synchronized
    fun listPendingUpload(): List<Entry> = readAll().filter { !it.synced }

    private fun readAll(): List<Entry> {
        if (!file.exists()) return emptyList()
        val array = JSONArray(file.readText(Charsets.UTF_8))
        return (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            Entry(
                localId = o.getString("localId"),
                capturedAt = o.getString("capturedAt"),
                evidenceJson = o.getJSONObject("evidence"),
                synced = o.getBoolean("synced"),
                remoteScanId = o.optString("remoteScanId", null),
                decisionJson = if (o.has("decision") && !o.isNull("decision")) o.getJSONObject("decision") else null
            )
        }
    }

    private fun writeAll(entries: List<Entry>) {
        val array = JSONArray()
        for (e in entries) {
            array.put(JSONObject().apply {
                put("localId", e.localId)
                put("capturedAt", e.capturedAt)
                put("evidence", e.evidenceJson)
                put("synced", e.synced)
                putOpt("remoteScanId", e.remoteScanId)
                putOpt("decision", e.decisionJson)
            })
        }
        file.writeText(array.toString(), Charsets.UTF_8)
    }

    private fun Entry.copy(
        synced: Boolean = this.synced,
        remoteScanId: String? = this.remoteScanId,
        decisionJson: JSONObject? = this.decisionJson
    ) = Entry(localId, capturedAt, evidenceJson, synced, remoteScanId, decisionJson)
}

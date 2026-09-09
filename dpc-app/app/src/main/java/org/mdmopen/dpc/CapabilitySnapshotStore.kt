package org.mdmopen.dpc

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class CapabilitySnapshot(
    val detectedAt: Long,
    val adapterId: String,
    val adapterConfidence: Int,
    val profile: DeviceProfile,
)

object CapabilitySnapshotStore {
    private const val PREFS = "device_capability_snapshot"
    private const val KEY_JSON = "snapshot_json"

    fun refresh(context: Context): CapabilitySnapshot {
        val profile = DeviceCapabilityDetector.detect(context)
        val selection = DeviceAdapterResolver.resolve(profile)
        val snapshot = CapabilitySnapshot(
            detectedAt = System.currentTimeMillis(),
            adapterId = selection.adapterId,
            adapterConfidence = selection.confidence,
            profile = profile,
        )
        persist(context, snapshot)
        return snapshot
    }

    fun read(context: Context): CapabilitySnapshot? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_JSON, null) ?: return null
        return runCatching { fromJson(JSONObject(raw)) }.getOrNull()
    }

    private fun persist(context: Context, snapshot: CapabilitySnapshot) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_JSON, toJson(snapshot).toString())
            .apply()
    }

    private fun toJson(snapshot: CapabilitySnapshot): JSONObject {
        val p = snapshot.profile
        return JSONObject()
            .put("detectedAt", snapshot.detectedAt)
            .put("adapterId", snapshot.adapterId)
            .put("adapterConfidence", snapshot.adapterConfidence)
            .put("manufacturer", p.manufacturer)
            .put("brand", p.brand)
            .put("model", p.model)
            .put("device", p.device)
            .put("product", p.product)
            .put("buildDisplay", p.buildDisplay)
            .put("sdkInt", p.sdkInt)
            .put("androidRelease", p.androidRelease)
            .put("oemSkin", p.oemSkin)
            .put("oemSkinVersion", p.oemSkinVersion)
            .put("capabilities", JSONArray(p.capabilities.map { it.name }))
    }

    private fun fromJson(json: JSONObject): CapabilitySnapshot {
        val capabilitiesArray = json.optJSONArray("capabilities") ?: JSONArray()
        val capabilities = buildSet {
            for (i in 0 until capabilitiesArray.length()) {
                runCatching { DeviceCapability.valueOf(capabilitiesArray.getString(i)) }
                    .getOrNull()
                    ?.let { add(it) }
            }
        }
        val profile = DeviceProfile(
            manufacturer = json.optString("manufacturer"),
            brand = json.optString("brand"),
            model = json.optString("model"),
            device = json.optString("device"),
            product = json.optString("product"),
            buildDisplay = json.optString("buildDisplay"),
            sdkInt = json.optInt("sdkInt"),
            androidRelease = json.optString("androidRelease"),
            oemSkin = json.optString("oemSkin", "aosp_generic"),
            oemSkinVersion = json.optString("oemSkinVersion").takeIf { it.isNotBlank() && it != "null" },
            capabilities = capabilities,
        )
        return CapabilitySnapshot(
            detectedAt = json.optLong("detectedAt"),
            adapterId = json.optString("adapterId", "aosp.generic"),
            adapterConfidence = json.optInt("adapterConfidence", 0),
            profile = profile,
        )
    }
}

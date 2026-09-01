package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

enum class DnsMode { OFF, OPPORTUNISTIC, PROVIDER_HOSTNAME, UNKNOWN, ERROR }

enum class DnsFailSafeState { NORMAL, DEGRADED, ROLLED_BACK, RECOVERING }

enum class DnsNetworkType { WIFI, CELLULAR, OTHER, NONE }

data class AdBlockDnsStatus(
    val dnsMode: DnsMode,
    // The host actually configured on the device right now (read live from
    // DevicePolicyManager) - never confuse with Config.dnsDesiredProviderHost,
    // which is only what the server last asked for and may not be applied yet.
    val dnsActualProviderHost: String?,
    val dnsFilteringRequested: Boolean,
    val dnsFilteringActual: Boolean,
    val dnsFailSafeState: DnsFailSafeState,
    val dnsResolutionOk: Boolean?,
    val dotProviderReachable: Boolean?,
    val currentNetworkType: DnsNetworkType,
    val consecutiveDnsFailures: Int,
    val lastDnsCheckAt: Long?,
    val lastDnsModeChangeAt: Long?,
    val lastRollbackAt: Long?,
    val failureReason: String?,
    val previousDnsMode: DnsMode?,
)

/**
 * Owns everything Private-DNS related: applying the server's desired filtering
 * state, and a fully local fail-safe watchdog that rolls PROVIDER_HOSTNAME
 * back to OPPORTUNISTIC if the configured resolver stops working - without
 * depending on the backend being reachable (see runFailSafeCheckCycle). Kept
 * out of PolicyEnforcer.kt on purpose: unrelated concern (app hiding vs. a
 * DNS resolver's own network health).
 *
 * There is no OFF path anywhere here by design: AOSP's DevicePolicyManager
 * exposes no setter that can express PRIVATE_DNS_MODE_OFF (verified directly
 * against the platform source - DevicePolicyManagerService.setGlobalPrivateDns
 * only has cases for OPPORTUNISTIC and PROVIDER_HOSTNAME; anything else,
 * including OFF, hits its own IllegalArgumentException server-side). Every
 * "disable" path here always means OPPORTUNISTIC, and every user-facing
 * string says so plainly rather than implying a real off switch.
 */
object AdBlockDns {

    private const val PREFS = "dpc_adblock_dns"
    private const val KEY_PREVIOUS_MODE = "previous_mode"
    private const val KEY_PREVIOUS_HOST = "previous_host"
    private const val KEY_FAIL_SAFE_STATE = "fail_safe_state"
    private const val KEY_CONSECUTIVE_FAILURES = "consecutive_failures"
    private const val KEY_RECOVERY_STREAK = "recovery_streak"
    private const val KEY_LAST_CHECK_AT = "last_check_at"
    private const val KEY_LAST_MODE_CHANGE_AT = "last_mode_change_at"
    private const val KEY_LAST_ROLLBACK_AT = "last_rollback_at"
    private const val KEY_LAST_RECOVERY_AT = "last_recovery_at"
    private const val KEY_FAILURE_REASON = "failure_reason"
    private const val KEY_COOLDOWN_UNTIL = "cooldown_until"
    private const val KEY_LAST_DNS_OK = "last_dns_ok"
    private const val KEY_LAST_DOT_OK = "last_dot_ok"
    private const val KEY_ROLLBACK_TIMESTAMPS = "rollback_timestamps_csv"
    // Every IP the current provider host resolved to while DNS was known to
    // be healthy (CSV, set right after a successful enable()) - see
    // checkDotProviderHealth().
    private const val KEY_PROVIDER_RESOLVED_IPS = "provider_resolved_ips_csv"

    // Thresholds from the fail-safe design round - named constants only,
    // never re-derived elsewhere.
    private const val CONSECUTIVE_FAILURES_TO_ROLLBACK = 4
    private const val CONSECUTIVE_SUCCESSES_TO_RECOVER = 3
    private const val ROLLBACK_COOLDOWN_MS = 30 * 60 * 1000L
    private const val RECOVERY_RETRY_INTERVAL_MS = 10 * 60 * 1000L
    private const val MAX_ROLLBACKS_PER_WINDOW = 3
    private const val ROLLBACK_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000L
    private const val EXTENDED_COOLDOWN_MS = 6 * 60 * 60 * 1000L

    private val IP_CHECK_HOSTS = listOf("1.1.1.1", "8.8.8.8")
    private const val SOCKET_TIMEOUT_MS = 4000
    private const val SET_MODE_TIMEOUT_MS = 20_000L
    private const val DOT_PORT = 853

    // Every mutating DPM call runs here, never on the caller's thread -
    // guarantees "set operations only on a background/worker thread"
    // regardless of what thread PolicySync/CommandExecutor/the customer's
    // own toggle call in from.
    private val executor = Executors.newSingleThreadExecutor()

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun admin(context: Context) =
        ComponentName(context, DpcDeviceAdminReceiver::class.java)

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun SharedPreferences.longOrNull(key: String): Long? =
        if (contains(key)) getLong(key, 0) else null

    private fun SharedPreferences.boolOrNull(key: String): Boolean? =
        if (contains(key)) getBoolean(key, false) else null

    private fun readFailSafeState(p: SharedPreferences): DnsFailSafeState =
        p.getString(KEY_FAIL_SAFE_STATE, null)
            ?.let { runCatching { DnsFailSafeState.valueOf(it) }.getOrNull() }
            ?: DnsFailSafeState.NORMAL

    // ---------- reading current real state (cheap Settings reads - main-thread safe) ----------

    /** Always the platform's own live state - never trusts our cached
     * "requested" value for what mode is actually active. */
    fun currentMode(context: Context): DnsMode = try {
        when (dpm(context).getGlobalPrivateDnsMode(admin(context))) {
            DevicePolicyManager.PRIVATE_DNS_MODE_OFF -> DnsMode.OFF
            DevicePolicyManager.PRIVATE_DNS_MODE_OPPORTUNISTIC -> DnsMode.OPPORTUNISTIC
            DevicePolicyManager.PRIVATE_DNS_MODE_PROVIDER_HOSTNAME -> DnsMode.PROVIDER_HOSTNAME
            else -> DnsMode.UNKNOWN
        }
    } catch (_: Exception) {
        DnsMode.ERROR
    }

    fun currentActualProviderHost(context: Context): String? = try {
        dpm(context).getGlobalPrivateDnsHost(admin(context))
    } catch (_: Exception) {
        null
    }

    /** Full snapshot for the sync health payload and the customer's own DNS card. */
    fun currentStatus(context: Context): AdBlockDnsStatus {
        val p = prefs(context)
        val mode = currentMode(context)
        return AdBlockDnsStatus(
            dnsMode = mode,
            dnsActualProviderHost = currentActualProviderHost(context),
            dnsFilteringRequested = Config.dnsFilteringRequested(context),
            dnsFilteringActual = mode == DnsMode.PROVIDER_HOSTNAME,
            dnsFailSafeState = readFailSafeState(p),
            dnsResolutionOk = p.boolOrNull(KEY_LAST_DNS_OK),
            dotProviderReachable = p.boolOrNull(KEY_LAST_DOT_OK),
            currentNetworkType = networkType(context),
            consecutiveDnsFailures = p.getInt(KEY_CONSECUTIVE_FAILURES, 0),
            lastDnsCheckAt = p.longOrNull(KEY_LAST_CHECK_AT),
            lastDnsModeChangeAt = p.longOrNull(KEY_LAST_MODE_CHANGE_AT),
            lastRollbackAt = p.longOrNull(KEY_LAST_ROLLBACK_AT),
            failureReason = p.getString(KEY_FAILURE_REASON, null),
            previousDnsMode = p.getString(KEY_PREVIOUS_MODE, null)
                ?.let { runCatching { DnsMode.valueOf(it) }.getOrNull() },
        )
    }

    private fun networkType(context: Context): DnsNetworkType = try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val caps = network?.let { cm.getNetworkCapabilities(it) }
        when {
            caps == null -> DnsNetworkType.NONE
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> DnsNetworkType.WIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> DnsNetworkType.CELLULAR
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> DnsNetworkType.OTHER
            else -> DnsNetworkType.NONE
        }
    } catch (_: Exception) {
        DnsNetworkType.NONE
    }

    // ---------- mutating operations - always dispatched to the worker executor ----------

    /** Turns strict filtering on. Blocking (the real DPM call performs its own
     * live connectivity check to providerHost) - callers must already be off
     * the UI thread; the actual DPM call is additionally forced onto the
     * dedicated executor regardless. */
    fun enable(context: Context, providerHost: String): String {
        val previousMode = currentMode(context)
        val previousHost = currentActualProviderHost(context)

        val result = try {
            executor.submit(Callable {
                dpm(context).setGlobalPrivateDnsModeSpecifiedHost(admin(context), providerHost)
            }).get(SET_MODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            recordFailureReason(context, "enable_failed: ${e.message}")
            return "הפעלת סינון DNS נכשלה: ${e.message}"
        }

        recordModeChange(context, previousMode, previousHost)

        return when (result) {
            DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR -> {
                resetFailSafe(context)
                // DNS is known-healthy right now (the DPM call above just proved
                // it live) - the only safe moment to resolve+cache the
                // provider's IP for checkDotProviderHealth() to reuse later,
                // once we're no longer sure system DNS resolution even works.
                resolveAndCacheProviderIp(context, providerHost)
                Config.setDnsPolicy(
                    context, providerHost, true,
                    Config.dnsAllowCustomerToggle(context), Config.dnsDesiredProviderFilters(context),
                )
                "סינון DNS הופעל (Strict, ספק: $providerHost)"
            }
            DevicePolicyManager.PRIVATE_DNS_SET_ERROR_HOST_NOT_SERVING -> {
                recordFailureReason(context, "provider_not_serving")
                "הפעלת סינון DNS נכשלה: הספק $providerHost לא עונה ל-DNS-over-TLS"
            }
            else -> {
                recordFailureReason(context, "set_failed")
                "הפעלת סינון DNS נכשלה (קוד $result)"
            }
        }
    }

    /** Safe rollback. Android has no API path to PRIVATE_DNS_MODE_OFF at all
     * (see class doc) - this always lands on OPPORTUNISTIC and says so. */
    fun disable(context: Context): String {
        val previousMode = currentMode(context)
        val previousHost = currentActualProviderHost(context)

        if (previousMode != DnsMode.PROVIDER_HOSTNAME) {
            Config.setDnsPolicy(
                context, Config.dnsDesiredProviderHost(context), false,
                Config.dnsAllowCustomerToggle(context), Config.dnsDesiredProviderFilters(context),
            )
            return "סינון DNS כבר לא היה פעיל (מצב נוכחי: $previousMode)"
        }

        val result = try {
            executor.submit(Callable {
                dpm(context).setGlobalPrivateDnsModeOpportunistic(admin(context))
            }).get(SET_MODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            recordFailureReason(context, "disable_failed: ${e.message}")
            return "כיבוי סינון DNS נכשל: ${e.message}"
        }

        recordModeChange(context, previousMode, previousHost)
        Config.setDnsPolicy(
            context, Config.dnsDesiredProviderHost(context), false,
            Config.dnsAllowCustomerToggle(context), Config.dnsDesiredProviderFilters(context),
        )

        return if (result == DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR) {
            "סינון DNS כובה - המכשיר עבר למצב Opportunistic (אין אפשרות לכבות DNS פרטי לגמרי ברמת Android)"
        } else {
            recordFailureReason(context, "disable_set_failed")
            "כיבוי סינון DNS נכשל (קוד $result)"
        }
    }

    /**
     * Reconciles actual mode with the server's last-synced desired state.
     * Called every sync, same role as PolicyEnforcer.apply() for app hiding.
     *
     * requested=false always wins immediately, even mid-incident - there is
     * nothing left for the fail-safe to protect once filtering is meant to be
     * off. requested=true is deliberately NOT re-applied while a rollback/
     * recovery episode is in progress: doing so would force strict mode back
     * on before runFailSafeCheckCycle()'s own cooldown/recovery checks ever
     * ran, which would silently defeat the entire fail-safe mechanism on the
     * very next sync after every rollback.
     */
    fun reconcile(context: Context): String? {
        val requested = Config.dnsFilteringRequested(context)
        val actual = currentMode(context) == DnsMode.PROVIDER_HOSTNAME
        val state = readFailSafeState(prefs(context))

        if (!requested) {
            if (actual) return disable(context)
            if (state != DnsFailSafeState.NORMAL) resetFailSafe(context)
            return null
        }

        if (state != DnsFailSafeState.NORMAL) return null
        if (actual) return null
        return Config.dnsDesiredProviderHost(context)?.let { enable(context, it) }
    }

    private fun recordModeChange(context: Context, previousMode: DnsMode, previousHost: String?) {
        prefs(context).edit()
            .putString(KEY_PREVIOUS_MODE, previousMode.name)
            .putString(KEY_PREVIOUS_HOST, previousHost)
            .putLong(KEY_LAST_MODE_CHANGE_AT, System.currentTimeMillis())
            .apply()
    }

    private fun recordFailureReason(context: Context, reason: String) {
        prefs(context).edit().putString(KEY_FAILURE_REASON, reason).apply()
    }

    private fun resetFailSafe(context: Context) {
        prefs(context).edit()
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.NORMAL.name)
            .putInt(KEY_CONSECUTIVE_FAILURES, 0)
            .putInt(KEY_RECOVERY_STREAK, 0)
            .remove(KEY_COOLDOWN_UNTIL)
            .remove(KEY_FAILURE_REASON)
            .apply()
    }

    // ---------- local fail-safe watchdog ----------

    /**
     * One check cycle. Entirely local - never calls the backend, so it keeps
     * working even if DNS itself is the thing that's broken (requirement:
     * fail-safe must not depend on backend/FCM reachability). Safe to call
     * from a background thread on every sync; returns a short status string
     * for the sync summary, or null if there was nothing to check this cycle.
     */
    fun runFailSafeCheckCycle(context: Context): String? {
        val p = prefs(context)
        val mode = currentMode(context)
        val state = readFailSafeState(p)
        val now = System.currentTimeMillis()

        if (state == DnsFailSafeState.ROLLED_BACK || state == DnsFailSafeState.RECOVERING) {
            val cooldownUntil = p.getLong(KEY_COOLDOWN_UNTIL, 0L)
            if (now < cooldownUntil) return null
            return runRecoveryCheck(context, p, now)
        }

        // NORMAL/DEGRADED only matter while actually in strict mode - nothing
        // to protect otherwise.
        if (mode != DnsMode.PROVIDER_HOSTNAME) return null
        return runStrictHealthCheck(context, p, now)
    }

    private fun runStrictHealthCheck(context: Context, p: SharedPreferences, now: Long): String {
        val ipOk = checkIpConnectivity()
        val dnsOk = ipOk && checkDnsResolution(ourControlledDomain(context))
        val dotOk = ipOk && checkDotProviderHealth(context, Config.dnsDesiredProviderHost(context))

        p.edit()
            .putLong(KEY_LAST_CHECK_AT, now)
            .putBoolean(KEY_LAST_DNS_OK, dnsOk)
            .putBoolean(KEY_LAST_DOT_OK, dotOk)
            .apply()

        if (!ipOk) {
            // No signal either way - a network blip is not evidence for or
            // against the DoT provider. The streak is left exactly as-is.
            return "בדיקת DNS: אין קליטה בסיסית, המחזור לא נספר"
        }

        if (dnsOk) {
            p.edit()
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.NORMAL.name)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .apply()
            return "בדיקת DNS: תקין"
        }

        val failures = p.getInt(KEY_CONSECUTIVE_FAILURES, 0) + 1
        val reason = if (dotOk) "dns_failed_provider_healthy" else "provider_down_or_blocked"
        p.edit()
            .putInt(KEY_CONSECUTIVE_FAILURES, failures)
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.DEGRADED.name)
            .putString(KEY_FAILURE_REASON, reason)
            .apply()

        if (failures < CONSECUTIVE_FAILURES_TO_ROLLBACK) {
            return "בדיקת DNS: כשל $failures/$CONSECUTIVE_FAILURES_TO_ROLLBACK ($reason)"
        }

        if (!withinRollbackRateLimit(p, now)) {
            p.edit()
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.ROLLED_BACK.name)
                .putLong(KEY_COOLDOWN_UNTIL, now + EXTENDED_COOLDOWN_MS)
                .apply()
            return "Fail-safe: הגבלת קצב הופעלה ($MAX_ROLLBACKS_PER_WINDOW rollbacks/24h) - " +
                "נשאר ב-Opportunistic, recovery אוטומטי מושהה"
        }

        val disableResult = disable(context)
        recordRollback(context, p, now, reason)
        return "Fail-safe: rollback ל-Opportunistic אחרי $failures כשלים רצופים ($reason). $disableResult"
    }

    private fun runRecoveryCheck(context: Context, p: SharedPreferences, now: Long): String {
        val host = Config.dnsDesiredProviderHost(context)
        if (host.isNullOrBlank()) return "Recovery: אין providerHost מוגדר"

        val ipOk = checkIpConnectivity()
        val dotOk = ipOk && checkDotProviderHealth(context, host)
        val dnsOk = ipOk && checkDnsResolution(ourControlledDomain(context))

        p.edit()
            .putLong(KEY_LAST_CHECK_AT, now)
            .putBoolean(KEY_LAST_DNS_OK, dnsOk)
            .putBoolean(KEY_LAST_DOT_OK, dotOk)
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.RECOVERING.name)
            .apply()

        if (!ipOk || !dotOk) {
            // Failed recovery attempt - restart the cooldown from now.
            // Anti-flapping: never retry immediately after a failed check.
            p.edit()
                .putInt(KEY_RECOVERY_STREAK, 0)
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.ROLLED_BACK.name)
                .putLong(KEY_COOLDOWN_UNTIL, now + ROLLBACK_COOLDOWN_MS)
                .apply()
            return "Recovery: הבדיקה נכשלה, cooldown הוארך"
        }

        val streak = p.getInt(KEY_RECOVERY_STREAK, 0) + 1
        if (streak < CONSECUTIVE_SUCCESSES_TO_RECOVER) {
            p.edit()
                .putInt(KEY_RECOVERY_STREAK, streak)
                .putLong(KEY_COOLDOWN_UNTIL, now + RECOVERY_RETRY_INTERVAL_MS)
                .apply()
            return "Recovery: הצלחה $streak/$CONSECUTIVE_SUCCESSES_TO_RECOVER"
        }

        val enableResult = enable(context, host)
        p.edit()
            .putLong(KEY_LAST_RECOVERY_AT, now)
            .putInt(KEY_RECOVERY_STREAK, 0)
            .apply()
        return "Recovery: הצלחה מלאה, חזרה ל-Strict. $enableResult"
    }

    private fun recordRollback(context: Context, p: SharedPreferences, now: Long, reason: String) {
        val recentPlusNow = (p.getString(KEY_ROLLBACK_TIMESTAMPS, "") ?: "")
            .split(",").mapNotNull { it.toLongOrNull() }
            .filter { now - it < ROLLBACK_RATE_LIMIT_WINDOW_MS } + now
        p.edit()
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.ROLLED_BACK.name)
            .putLong(KEY_LAST_ROLLBACK_AT, now)
            .putLong(KEY_COOLDOWN_UNTIL, now + ROLLBACK_COOLDOWN_MS)
            .putInt(KEY_RECOVERY_STREAK, 0)
            .putString(KEY_ROLLBACK_TIMESTAMPS, recentPlusNow.joinToString(","))
            .putString(KEY_FAILURE_REASON, reason)
            .apply()
    }

    private fun withinRollbackRateLimit(p: SharedPreferences, now: Long): Boolean {
        val recent = (p.getString(KEY_ROLLBACK_TIMESTAMPS, "") ?: "")
            .split(",").mapNotNull { it.toLongOrNull() }
            .count { now - it < ROLLBACK_RATE_LIMIT_WINDOW_MS }
        return recent < MAX_ROLLBACKS_PER_WINDOW
    }

    // ---------- the three checks ----------
    // None of these rely on getActiveNetwork()/NetworkCapabilities alone or a
    // bare ping - each is a real socket-level probe with its own bound timeout.

    /**
     * Bare TCP connect to IP literals - deliberately NOT a TLS handshake.
     * An earlier version of this check used TLS here to make a captive
     * portal read as "suspect" rather than "connected", but that imports
     * certificate/SNI-with-an-IP-literal/protocol-negotiation failure modes
     * that are about the TLS stack, not about whether the device has basic
     * IP connectivity - exactly the kind of unrelated failure that must not
     * be able to freeze/miscount a fail-safe cycle. Captive-portal handling
     * is already covered at the decision-matrix level (a portal that
     * intercepts everything reads the same as a real outage, an accepted
     * trade-off from the design round) - this check only needs to answer
     * "is there a network path to the internet at all".
     */
    private fun checkIpConnectivity(): Boolean = IP_CHECK_HOSTS.any { canTcpConnect(it, 443) }

    /** Resolves a domain we actually control via the *current* system
     * resolver - end-to-end proof that DNS genuinely works right now under
     * whatever mode is active, not just that the provider is reachable. Uses
     * the backend's own host (already ours, no new infrastructure needed). */
    private fun checkDnsResolution(domain: String): Boolean = try {
        InetAddress.getAllByName(domain).isNotEmpty()
    } catch (_: Exception) {
        false
    }

    /**
     * Direct TLS handshake to the provider on 853 - the same technique
     * DevicePolicyManager itself uses internally before ever accepting a
     * setGlobalPrivateDnsModeSpecifiedHost() call. Connects to a *cached* IP
     * when one is available (see resolveAndCacheProviderIp(), populated right
     * after a successful enable() while DNS is known to be healthy) rather
     * than resolving the hostname directly: while still in
     * PROVIDER_HOSTNAME/Strict mode with no automatic fallback, resolving the
     * provider's own hostname through the system resolver would resolve
     * through the very resolver being tested - if it's down, hostname
     * resolution fails first and this check would always read "unhealthy"
     * regardless of whether the provider's TLS service on 853 is actually
     * fine. An IP literal never triggers a DNS lookup, so connecting via the
     * cached IP breaks that circularity.
     *
     * The real provider hostname is still always sent as SNI (see
     * canTlsHandshake's separate connect/sni parameters) - connecting by IP
     * must not mean testing an anonymous endpoint. Multiple IPs are cached
     * and tried in turn (not just the first one InetAddress.getByName()
     * happens to return) so one stale/unreachable address among several
     * anycast/load-balanced IPs doesn't read as "provider down" on its own -
     * only falls back to a live hostname resolution when there is no cache
     * at all yet (the one-time, unavoidable circularity risk on the very
     * first check for a newly configured provider).
     */
    private fun checkDotProviderHealth(context: Context, host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val cachedIps = prefs(context).getString(KEY_PROVIDER_RESOLVED_IPS, null)
            ?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
        if (cachedIps.isNotEmpty()) {
            return cachedIps.any { canTlsHandshake(connectHost = it, sniHost = host, DOT_PORT) }
        }
        return canTlsHandshake(connectHost = host, sniHost = host, DOT_PORT)
    }

    /** Called right after a successful enable() - resolution here happens
     * exactly when DNS is known to be working, not during a later health
     * check where that's precisely what's in question. Caches every address
     * the hostname resolves to, not just the first one. */
    private fun resolveAndCacheProviderIp(context: Context, host: String) {
        try {
            val ips = InetAddress.getAllByName(host).mapNotNull { it.hostAddress }.distinct()
            if (ips.isNotEmpty()) {
                prefs(context).edit().putString(KEY_PROVIDER_RESOLVED_IPS, ips.joinToString(",")).apply()
            }
        } catch (_: Exception) {
            // Leave any previously cached IPs in place rather than clearing
            // them - a transient resolution failure right after a successful
            // enable() is not evidence the old cached IPs are wrong.
        }
    }

    private fun canTcpConnect(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(InetAddress.getByName(host), port), SOCKET_TIMEOUT_MS) }
        true
    } catch (_: Exception) {
        false
    }

    /** connectHost is what we open the TCP/TLS connection to (may be a cached
     * IP literal, to avoid a DNS lookup); sniHost is always the real provider
     * hostname, sent as SNI regardless of how connectHost was reached - a
     * connection made by IP must still identify itself as the real host, or
     * SNI-based virtual hosting on the provider's end could select the wrong
     * certificate/service entirely. Neither this nor canTcpConnect performs
     * certificate-to-hostname verification (only the default trust-chain
     * check from startHandshake()) - deliberately: verifying hostname against
     * a certificate here would risk failing this check on a real, healthy
     * provider for reasons unrelated to whether it's actually up. */
    private fun canTlsHandshake(connectHost: String, sniHost: String, port: Int): Boolean {
        return try {
            val raw = Socket()
            raw.connect(InetSocketAddress(InetAddress.getByName(connectHost), port), SOCKET_TIMEOUT_MS)
            raw.soTimeout = SOCKET_TIMEOUT_MS
            (SSLSocketFactory.getDefault().createSocket(raw, sniHost, port, true) as SSLSocket).use { ssl ->
                ssl.startHandshake()
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun ourControlledDomain(context: Context): String = try {
        URI(Config.serverUrl(context)).host ?: "example.com"
    } catch (_: Exception) {
        "example.com"
    }
}

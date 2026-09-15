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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

enum class DnsMode { OFF, OPPORTUNISTIC, PROVIDER_HOSTNAME, UNKNOWN, ERROR }

enum class DnsFailSafeState { NORMAL, DEGRADED, ROLLED_BACK, RECOVERING }

enum class DnsNetworkType { WIFI, CELLULAR, OTHER, NONE }

data class AdBlockDnsStatus(
    val dnsMode: DnsMode,
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
 * depending on the backend being reachable.
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
    private const val KEY_PROVIDER_RESOLVED_IPS = "provider_resolved_ips_csv"

    private const val CONSECUTIVE_FAILURES_TO_ROLLBACK = 4
    private const val RAPID_CONFIRM_ATTEMPTS = 3
    private const val RAPID_CONFIRM_DELAY_MS = 3_000L
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

    @Volatile
    private var executor: ExecutorService = newMutationExecutor()

    private fun newMutationExecutor(): ExecutorService =
        Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mdm-dns-dpm").apply { isDaemon = true }
        }

    /**
     * Runs one DPM mutation with a hard timeout. A timed-out Binder/OEM call may
     * ignore interruption; replacing the single-thread executor prevents that
     * stuck call from poisoning every future DNS operation for the lifetime of
     * the process.
     */
    @Synchronized
    private fun runDpmMutation(call: Callable<Int>): Int {
        val activeExecutor = executor
        val future = activeExecutor.submit(call)
        return try {
            future.get(SET_MODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            future.cancel(true)
            activeExecutor.shutdownNow()
            if (executor === activeExecutor) executor = newMutationExecutor()
            throw e
        } catch (e: Exception) {
            future.cancel(true)
            throw e
        }
    }

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

    fun enable(context: Context, providerHost: String): String {
        val previousMode = currentMode(context)
        val previousHost = currentActualProviderHost(context)

        val result = try {
            runDpmMutation(Callable {
                dpm(context).setGlobalPrivateDnsModeSpecifiedHost(admin(context), providerHost)
            })
        } catch (e: Exception) {
            recordFailureReason(context, "enable_failed: ${e.message}")
            return "הפעלת סינון DNS נכשלה: ${e.message}"
        }

        recordModeChange(context, previousMode, previousHost)

        return when (result) {
            DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR -> {
                resetFailSafe(context)
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
            runDpmMutation(Callable {
                dpm(context).setGlobalPrivateDnsModeOpportunistic(admin(context))
            })
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
            return "בדיקת DNS: אין קליטה בסיסית, המחזור לא נספר"
        }

        if (dnsOk) {
            p.edit()
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.NORMAL.name)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .apply()
            return "בדיקת DNS: תקין"
        }

        var rapidRecovered = false
        for (attempt in 1 until RAPID_CONFIRM_ATTEMPTS) {
            try {
                Thread.sleep(RAPID_CONFIRM_DELAY_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return "בדיקת DNS: הופסקה"
            }

            val retryIpOk = checkIpConnectivity()
            if (!retryIpOk) {
                p.edit()
                    .putLong(KEY_LAST_CHECK_AT, System.currentTimeMillis())
                    .putBoolean(KEY_LAST_DNS_OK, false)
                    .putBoolean(KEY_LAST_DOT_OK, false)
                    .apply()
                return "בדיקת DNS: הקישוריות הבסיסית נעלמה בזמן האימות, לא נספר ככשל DNS"
            }

            if (checkDnsResolution(ourControlledDomain(context))) {
                rapidRecovered = true
                break
            }
        }

        if (rapidRecovered) {
            p.edit()
                .putLong(KEY_LAST_CHECK_AT, System.currentTimeMillis())
                .putBoolean(KEY_LAST_DNS_OK, true)
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.NORMAL.name)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .remove(KEY_FAILURE_REASON)
                .apply()
            return "בדיקת DNS: התאושש לאחר אימות מהיר"
        }

        if (!checkIpConnectivity()) {
            return "בדיקת DNS: אין עוד קישוריות בסיסית, rollback בוטל"
        }

        val failures = p.getInt(KEY_CONSECUTIVE_FAILURES, 0) + 1
        val reason = if (dotOk) "dns_failed_provider_healthy" else "provider_down_or_blocked"
        p.edit()
            .putInt(KEY_CONSECUTIVE_FAILURES, failures)
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.DEGRADED.name)
            .putString(KEY_FAILURE_REASON, reason)
            .apply()

        if (failures < CONSECUTIVE_FAILURES_TO_ROLLBACK) {
            val disableResult = disable(context)
            recordRollback(context, p, System.currentTimeMillis(), reason)
            return "Fail-safe מהיר: rollback ל-Opportunistic אחרי כשל DNS מאומת. $disableResult"
        }

        if (!withinRollbackRateLimit(p, now)) {
            val disableResult = disable(context)
            p.edit()
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.ROLLED_BACK.name)
                .putLong(KEY_COOLDOWN_UNTIL, now + EXTENDED_COOLDOWN_MS)
                .putString(KEY_FAILURE_REASON, reason)
                .apply()
            return "Fail-safe: הגבלת קצב הופעלה ($MAX_ROLLBACKS_PER_WINDOW rollbacks/24h) - " +
                "rollback ל-Opportunistic נשמר ו-recovery אוטומטי מושהה. $disableResult"
        }

        val disableResult = disable(context)
        recordRollback(context, p, now, reason)
        return "Fail-safe: rollback ל-Opportunistic אחרי $failures כשלים רצופים ($reason). $disableResult"
    }

    private fun runRecoveryCheck(context: Context, p: SharedPreferences, now: Long): String {
        val host = Config.dnsDesiredProviderHost(context)
        if (host.isNullOrBlank()) return "Recovery: אין providerHost מוגדר"

        val ipOk = checkIpConnectivity()
        var dotOk = ipOk && checkDotProviderHealth(context, host)
        if (ipOk && !dotOk && currentMode(context) != DnsMode.PROVIDER_HOSTNAME) {
            resolveAndCacheProviderIp(context, host)
            dotOk = checkDotProviderHealth(context, host)
        }
        val dnsOk = ipOk && checkDnsResolution(ourControlledDomain(context))

        p.edit()
            .putLong(KEY_LAST_CHECK_AT, now)
            .putBoolean(KEY_LAST_DNS_OK, dnsOk)
            .putBoolean(KEY_LAST_DOT_OK, dotOk)
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.RECOVERING.name)
            .apply()

        if (!ipOk || !dotOk) {
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
        if (currentMode(context) != DnsMode.PROVIDER_HOSTNAME) {
            p.edit()
                .putInt(KEY_RECOVERY_STREAK, 0)
                .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.ROLLED_BACK.name)
                .putLong(KEY_COOLDOWN_UNTIL, now + ROLLBACK_COOLDOWN_MS)
                .putString(KEY_FAILURE_REASON, "recovery_enable_failed")
                .apply()
            return "Recovery: הספק עבר בדיקות אך החזרה ל-Strict נכשלה; נשאר ב-Opportunistic. $enableResult"
        }
        p.edit()
            .putLong(KEY_LAST_RECOVERY_AT, now)
            .putInt(KEY_RECOVERY_STREAK, 0)
            .putString(KEY_FAIL_SAFE_STATE, DnsFailSafeState.NORMAL.name)
            .remove(KEY_COOLDOWN_UNTIL)
            .remove(KEY_FAILURE_REASON)
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

    private fun checkIpConnectivity(): Boolean = IP_CHECK_HOSTS.any { canTcpConnect(it, 443) }

    private fun checkDnsResolution(domain: String): Boolean = try {
        InetAddress.getAllByName(domain).isNotEmpty()
    } catch (_: Exception) {
        false
    }

    private fun checkDotProviderHealth(context: Context, host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val cachedIps = prefs(context).getString(KEY_PROVIDER_RESOLVED_IPS, null)
            ?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
        if (cachedIps.isNotEmpty()) {
            return cachedIps.any { canTlsHandshake(connectHost = it, sniHost = host, DOT_PORT) }
        }
        return canTlsHandshake(connectHost = host, sniHost = host, DOT_PORT)
    }

    private fun resolveAndCacheProviderIp(context: Context, host: String) {
        try {
            val ips = InetAddress.getAllByName(host).mapNotNull { it.hostAddress }.distinct()
            if (ips.isNotEmpty()) {
                prefs(context).edit().putString(KEY_PROVIDER_RESOLVED_IPS, ips.joinToString(",")).apply()
            }
        } catch (_: Exception) {
        }
    }

    private fun canTcpConnect(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(InetAddress.getByName(host), port), SOCKET_TIMEOUT_MS) }
        true
    } catch (_: Exception) {
        false
    }

    private fun canTlsHandshake(connectHost: String, sniHost: String, port: Int): Boolean {
        return try {
            val raw = Socket()
            raw.connect(InetSocketAddress(InetAddress.getByName(connectHost), port), SOCKET_TIMEOUT_MS)
            raw.soTimeout = SOCKET_TIMEOUT_MS
            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            (factory.createSocket(raw, sniHost, port, true) as SSLSocket).use { ssl ->
                ssl.sslParameters = ssl.sslParameters.apply {
                    endpointIdentificationAlgorithm = "HTTPS"
                }
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

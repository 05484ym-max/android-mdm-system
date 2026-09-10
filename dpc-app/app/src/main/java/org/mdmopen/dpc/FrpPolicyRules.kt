package org.mdmopen.dpc

object FrpPolicyRules {
    data class Validation(
        val accountIds: List<String>,
        val valid: Boolean,
        val error: String? = null,
    )

    fun validate(enabled: Boolean, accountIds: List<String>): Validation {
        val normalized = accountIds
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()

        if (normalized.size > 20) {
            return Validation(normalized.take(20), false, "TOO_MANY_ACCOUNTS")
        }
        if (normalized.any { it.length > 256 }) {
            return Validation(normalized, false, "ACCOUNT_ID_TOO_LONG")
        }
        if (enabled && normalized.isEmpty()) {
            return Validation(normalized, false, "ENABLED_WITHOUT_ACCOUNTS_REJECTED")
        }
        return Validation(normalized, true)
    }
}

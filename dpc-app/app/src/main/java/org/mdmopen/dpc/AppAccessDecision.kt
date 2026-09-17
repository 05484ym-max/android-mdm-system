package org.mdmopen.dpc

enum class AppAccessMode {
    APPROVED_ONLY,
    OPEN_WITH_BLACKLIST,
}

object AppAccessDecision {
    fun shouldBlock(
        packageName: String,
        mode: AppAccessMode,
        allowedPackages: Set<String>,
        blockedPackages: Set<String>,
        essentialPackages: Set<String>,
        ownPackage: String,
    ): Boolean {
        if (packageName == ownPackage || packageName in essentialPackages) return false
        return when (mode) {
            AppAccessMode.APPROVED_ONLY -> packageName !in allowedPackages
            AppAccessMode.OPEN_WITH_BLACKLIST -> packageName in blockedPackages
        }
    }
}

// Pure JVM module: zero android.* imports on purpose. All the fiddly wire-format and
// state-machine logic for the ADB/Fastboot host implementation lives here so it can be
// unit-tested on a plain JVM without an Android SDK, an emulator, or real USB hardware.
// The Android `app` module is a thin USB I/O shell around this module's pure functions.
plugins {
    kotlin("jvm")
}
dependencies {
    testImplementation(kotlin("test"))
}
tasks.test {
    useJUnitPlatform()
}
kotlin {
    jvmToolchain(17)
}

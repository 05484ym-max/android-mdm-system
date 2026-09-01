// Standalone Gradle root, separate from dpc-app and from the repo's root project.
// Deliberately kept on the same plugin/Kotlin versions as dpc-app for consistency.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("org.jetbrains.kotlin.jvm") version "1.9.24" apply false
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.mdmopen.devicelab.technician"
    // minSdk 33 (Android 13) per the requested feasibility range; compileSdk/targetSdk kept
    // at 35 (Android 15, an AGP-8.7.3-supported level actually available today) rather than
    // guessing at an unreleased "Android 16" SDK/AGP pairing this sandbox cannot verify.
    // Bump once a newer AGP is adopted and Android 16 support is actually validated.
    compileSdk = 35

    defaultConfig {
        applicationId = "org.mdmopen.devicelab.technician"
        minSdk = 33
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-mvp"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":protocol-core"))
}

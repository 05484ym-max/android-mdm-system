plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

// Supplied by CI. Without it the build would fall back to Gradle's throw-away debug
// key, silently changing the APK signature and breaking every existing QR code.
val keystorePath: String? = System.getenv("DPC_KEYSTORE_PATH")

android {
    namespace = "org.mdmopen.dpc"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.mdmopen.dpc"
        minSdk = 29
        // Android 16 runs apps targeting older SDKs, so target 35 keeps the current
        // behavior model while compileSdk 36 lets us build and validate against the
        // Android 16 platform APIs. We can raise targetSdk separately after device
        // provisioning is proven stable on Samsung Android 16.
        targetSdk = 35
        versionCode = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = "0.1.${System.getenv("VERSION_CODE") ?: "0"}"
    }

    signingConfigs {
        create("shared") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("DPC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DPC_KEY_ALIAS")
                keyPassword = System.getenv("DPC_KEYSTORE_PASSWORD")
            }
            // Keep all signature schemes because OEM provisioning stacks vary.
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        getByName("debug") {
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("shared")
            }
        }
        getByName("release") {
            isMinifyEnabled = false
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("shared")
            }
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
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    testImplementation("junit:junit:4.13.2")
}

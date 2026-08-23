plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystorePath: String? = System.getenv("DPC_KEYSTORE_PATH")

android {
    namespace = "org.mdmopen.dpc"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.mdmopen.dpc"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (keystorePath != null) {
            create("shared") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("DPC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DPC_KEY_ALIAS")
                keyPassword = System.getenv("DPC_KEYSTORE_PASSWORD")
            }
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

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.yehudikasher.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.yehudikasher.browser"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-poc"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // AGP 8+ no longer generates BuildConfig (including the built-in DEBUG
    // field) by default - required for LocalPolicyStore's existing
    // BuildConfig.DEBUG check, which predates this change.
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
}

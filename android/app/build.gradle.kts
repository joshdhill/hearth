plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.joshdhill.hearth"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.joshdhill.hearth"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // A fixed key kept in the repo so each new build installs over the last one.
    signingConfigs {
        create("hearth") {
            storeFile = file("hearth.keystore")
            storePassword = "hearthtv"
            keyAlias = "hearth"
            keyPassword = "hearthtv"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("hearth")
        }
        getByName("debug") {
            signingConfig = signingConfigs.getByName("hearth")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.media3:media3-datasource:1.5.1")
    implementation("androidx.media3:media3-database:1.5.1")
}

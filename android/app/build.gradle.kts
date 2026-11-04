import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
}

// The app shares the web app's version (package.json), as the desktop app does.
val appVersion = (JsonSlurper().parse(rootDir.resolve("../package.json")) as Map<*, *>)["version"] as String
val versionParts = appVersion.substringBefore("-").split(".").map(String::toInt)

// The built web app (npm run build) is the app's content, bundled as assets.
val dist = rootDir.resolve("../dist")

// Release signing comes from android/keystore.properties, which is never committed. Without
// it, release builds are signed with this machine's debug key: fine for sideloading, but an
// update has to be signed with the same key as the version it replaces.
val keystoreFile = rootDir.resolve("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use(::load) }

android {
    namespace = "com.vexyeclipse.argent"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.vexyeclipse.argent"
        minSdk = 24
        targetSdk = 36
        versionCode = versionParts[0] * 10_000 + versionParts[1] * 100 + versionParts[2]
        versionName = appVersion
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootDir.resolve(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    sourceSets.getByName("main").assets.srcDir(dist)
    androidResources {
        // Android's default list plus source maps, which are half of dist/ and unused here.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:<dir>_*:!CVS:!thumbs.db:!picasa.ini:!*~:!*.map"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild") {
    doFirst {
        check(dist.resolve("index.html").exists()) { "dist/ is missing: run `npm run build` in the Argent folder first." }
    }
}

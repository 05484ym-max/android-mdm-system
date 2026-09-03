import java.awt.BasicStroke
import java.awt.Color
import java.awt.RenderingHints
import java.awt.geom.Arc2D
import java.awt.geom.Path2D
import java.awt.geom.RoundRectangle2D
import java.awt.image.BufferedImage
import javax.imageio.ImageIO

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedIconResDir = layout.buildDirectory.dir("generated/res/browserIconFallback")

android {
    namespace = "org.yehudikasher.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.yehudikasher.browser"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField(
            "String",
            "FILTER_API_BASE_URL",
            "\"https://android-mdm-system.onrender.com\""
        )

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

    buildFeatures {
        buildConfig = true
    }

    sourceSets.getByName("main").res.srcDir(generatedIconResDir)
}

val generateRasterIconFallback by tasks.registering {
    val outputFile = generatedIconResDir.map {
        it.file("mipmap-xxxhdpi/browser_icon.png")
    }
    outputs.file(outputFile)

    doLast {
        val file = outputFile.get().asFile
        file.parentFile.mkdirs()

        val size = 432
        val scale = size / 108.0
        val image = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g.scale(scale, scale)

            val green = Color.decode("#0B5A3C")
            val gold = Color.decode("#F3D98B")

            g.color = green
            g.fill(RoundRectangle2D.Double(4.0, 4.0, 100.0, 100.0, 32.0, 32.0))

            g.color = gold
            g.stroke = BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.draw(RoundRectangle2D.Double(9.0, 9.0, 90.0, 90.0, 24.0, 24.0))

            g.stroke = BasicStroke(4.5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.draw(Arc2D.Double(18.0, 18.0, 66.0, 66.0, 0.0, 360.0, Arc2D.OPEN))

            g.stroke = BasicStroke(4.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawLine(19, 51, 83, 51)
            g.draw(Arc2D.Double(33.0, 18.0, 36.0, 66.0, 90.0, 180.0, Arc2D.OPEN))
            g.draw(Arc2D.Double(33.0, 18.0, 36.0, 66.0, -90.0, 180.0, Arc2D.OPEN))
            g.draw(Arc2D.Double(24.0, 27.0, 54.0, 28.0, 200.0, 140.0, Arc2D.OPEN))
            g.draw(Arc2D.Double(24.0, 53.0, 54.0, 28.0, 20.0, 140.0, Arc2D.OPEN))

            val shield = Path2D.Double()
            shield.moveTo(60.0, 49.0)
            shield.curveTo(68.0, 48.0, 75.0, 44.0, 81.0, 39.0)
            shield.curveTo(87.0, 44.0, 94.0, 48.0, 100.0, 49.0)
            shield.lineTo(100.0, 66.0)
            shield.curveTo(100.0, 78.0, 92.0, 88.0, 81.0, 94.0)
            shield.curveTo(70.0, 88.0, 62.0, 78.0, 62.0, 66.0)
            shield.closePath()

            g.color = green
            g.fill(shield)
            g.color = gold
            g.stroke = BasicStroke(4.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.draw(shield)

            val check = Path2D.Double()
            check.moveTo(71.0, 67.0)
            check.lineTo(78.0, 74.0)
            check.lineTo(91.0, 59.0)
            g.stroke = BasicStroke(5.5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.draw(check)
        } finally {
            g.dispose()
        }

        check(ImageIO.write(image, "png", file)) {
            "Could not write browser raster icon fallback"
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(generateRasterIconFallback)
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
}

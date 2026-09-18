import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.spring) apply false
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.spring.dependencyManagement) apply false
}

// 전 모듈 공통 컴파일/테스트 규약. 모듈별 build.gradle.kts는 의존성만 선언한다.
subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")

    group = "com.trippilot"
    version = "0.0.1-SNAPSHOT"

    repositories { mavenCentral() }

    // JDK 25 툴체인으로 컴파일하되, 바이트코드 target은 21로 핀한다.
    // (ArchUnit·Konsist 등 게이트 도구 호환 — architecture.md §9.1)
    extensions.configure<JavaPluginExtension> {
        toolchain { languageVersion.set(JavaLanguageVersion.of(25)) }
    }

    tasks.withType<KotlinCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_21)
            freeCompilerArgs.add("-Xjsr305=strict")
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.release.set(21)
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }
}

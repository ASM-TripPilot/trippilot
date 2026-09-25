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
        // **테스트 JVM 은 Gradle 데몬과 별도 프로세스라 `org.gradle.jvmargs` 를 안 물려받는다.**
        // 기본 512m 으로는 Spring 컨텍스트 + Testcontainers 가 든 IT 에서 OOM 이 난다
        // (2026-09-25 실측 — `TokenRefreshControllerIT` 가 `EnumSet.java:118` 에서 죽었다).
        maxHeapSize = "1500m"
        // **워커 수를 코어에 맡기지 않는다.** 기본은 1이지만 `org.gradle.parallel` 아래서
        // 모듈별 test 태스크가 동시에 뜨므로, 여기를 늘리면 곱해져 CI 러너(4코어 16GB)가 넘친다.
        maxParallelForks = 1
    }
}

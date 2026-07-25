rootProject.name = "trippilot-backend"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

// 조립 모듈(★ 유일한 Spring Boot 애플리케이션)
include(":app")

// 공통 플랫폼 (app → modules → common, 역방향 금지 — R5)
include(":common:core")
include(":common:security")
include(":common:test-support")   // 테스트 하네스(TRIP-149) — 각 모듈이 testImplementation 으로 재사용

// 기능 모듈 (U1 범위: M1 Auth · M2 Profile · C3 Moderation)
include(":modules:auth")
include(":modules:profile")
include(":modules:moderation")
include(":modules:accommodation-search")   // C3 숙소 탐색 (TRIP-175)

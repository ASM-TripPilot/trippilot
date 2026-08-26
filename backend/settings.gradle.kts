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
include(":modules:saved-accommodation")   // C4 숙소 등록·거점 (TRIP-176)
include(":modules:place-data")             // C7 POI 정본·수집게이트·후보풀 (TRIP-212)
include(":modules:trip")   // C6 여행 생성 (TRIP-177)
include(":modules:itinerary-generation")   // C8 AI 일정 생성 백엔드 — 도메인·영속·경계 (TRIP-266)
include(":modules:weather-context")   // C11 날씨·맥락 (TRIP-273 · U4)
include(":modules:planb-detection")   // C9 감지·억제 (TRIP-273 · U4)
include(":modules:itinerary-recalculation")   // C10 재계획 세션 (TRIP-273 · U4)
include(":modules:change-log")   // 변경 이력(changelog 계층) — US-PLANB-09 (TRIP-275)
include(":modules:archive")   // C12 방문 실적·기록(actual 계층) — U4 에서 이관 (TRIP-540 · U5)
include(":modules:reflection")   // C13 회고 — 하루 한 장 (TRIP-552 · U5)
include(":modules:notification")   // C14 알림함·리마인드 스케줄 (TRIP-547 · U6)

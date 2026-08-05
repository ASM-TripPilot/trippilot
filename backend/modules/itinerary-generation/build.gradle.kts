// modules/itinerary-generation — C8: AI 일정 생성 결과의 백엔드 도메인·영속·오케스트레이션.
// AI 솔버·오케스트레이션은 Python 서비스 소유; 백엔드는 ScheduleAgent 경계로 호출하고 결과를 소유·영속한다.
// TRIP-266: 스키마·도메인 토대(itinerary→day→slot). 타 modules/* 직접 참조 금지(R1).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(project(":modules:trip"))            // R1: trip.api(TripFacade)만 — 날짜·소유 조회
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — itinerary/day/slot
    implementation(libs.spring.boot.starter.web)        // adapter/in/web — 생성 API
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
    testImplementation(libs.jackson.module.kotlin)      // BE-1 계약 직렬화(snake_case) 왕복 테스트
    testImplementation(libs.jackson.datatype.jsr310)
}

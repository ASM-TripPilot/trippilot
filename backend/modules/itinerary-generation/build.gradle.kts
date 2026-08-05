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
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — itinerary/day/slot
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
}

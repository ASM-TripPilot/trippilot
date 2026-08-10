// modules/planb — Plan-B 재계획(C9 감지 · C10 재계산) · 에픽 F · US-PLANB-*.
// 여행 중 신호로 재계획을 제안하고, 사용자가 고른 대안을 확정까지 잇는다.
// itinerary-generation 과 분리한 이유: 재계획은 **여행 중** 상태(실행·트리거·세션)를 가지며
// 생성 모듈이 이쪽에 의존하지 않아야 한다(의존 방향 planb → itinerary-generation).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))   // R1: 소유·구간 검증만 — trip.api(TripFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)   // adapter/in/web — 진입 요청 필수값
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}

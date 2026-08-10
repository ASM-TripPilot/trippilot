// modules/planb-detection — C9 감지·억제(U4 정본 `construction/u4-in-trip-planb/`).
// 재계획(C10)과 나눈 이유: 여기는 "알릴지"를, 저기는 "무엇으로 바꿀지"를 정한다.
// 실패 모드가 달라(허위 알림 vs 잘못된 확정) 한 모듈에 두면 한쪽 변경이 다른 쪽을 흔든다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))                   // R1: 소유·구간 검증 — trip.api
    implementation(project(":modules:itinerary-generation"))   // R1: 남은 슬롯 판정 — itinerarygeneration.api
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
}

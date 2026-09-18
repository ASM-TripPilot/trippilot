// modules/weather-context — C11 날씨·맥락(U4 정본 §4).
// "하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트" — 기상 조회를 여기서만 한다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:place-data"))   // R1: 지역 대표 좌표만 — placedata.api(RegionLookupFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)     // 실 기상청 어댑터의 RestClient (TRIP-849)
    implementation(libs.jackson3.module.kotlin)      // 응답 JsonNode 파싱 (SB4 기본 = Jackson 3)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}

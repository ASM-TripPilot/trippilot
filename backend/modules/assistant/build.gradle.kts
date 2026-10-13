// modules/assistant — C16 AI 도우미(U8 · TRIP-1377). 대화 세션·메시지·변경 제안을 소유한다.
// **말단 모듈이다** — 다른 모듈의 `api` 만 부르고, 이 모듈을 부르는 모듈은 없다(앱만 REST 로 부른다).
plugins {
    alias(libs.plugins.kotlin.spring)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))                  // R1: 소유 확인·컨텍스트 칩 재료 — trip.api
    implementation(project(":modules:saved-accommodation"))   // R1: 기준 숙소 이름(칩) — TripBaseStayFacade
    implementation(libs.spring.boot.starter.jdbc)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}

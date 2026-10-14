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
    implementation(project(":modules:moderation"))            // R1: 입력 선검사 — TextModerationFacade
    implementation(project(":modules:itinerary-generation"))  // R1: 일정 요약·계획 슬롯 읽기 — ItineraryFacade · ItineraryPlanFacade
    implementation(project(":modules:place-data"))            // R1: 장소 표면(영업시간) — PoiSurfaceFacade
    implementation(project(":modules:weather-context"))       // R1: 표시용 날씨 — ContextFacade
    implementation(libs.spring.boot.starter.jdbc)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.jackson3.module.kotlin)   // AI 해석 경계 와이어(Jackson 3 = SB4 기본) — 없으면 데이터클래스가 조용히 기본값이 된다(anti-patterns)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.jackson.datatype.jsr310)   // 스냅샷 직렬형(날짜·시각)을 화이트리스트와 견준다
}

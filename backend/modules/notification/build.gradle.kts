// modules/notification — C14 알림함·리마인드 스케줄(U6 · TRIP-547).
// 아웃박스 구독자와 시각 폴링을 여기서 소유한다. 발행측(U1·U3·U4·U5) 코드는 건드리지 않는다 —
// 구독만으로 붙는 것이 이 모듈이 U6 에서 가장 먼저 서는 이유다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))   // R1: 여행 소유자·기간 조회만 — trip.api(TripOwnerFacade)
    // R1: 그 날 갈 곳의 **이름**만 — itinerary-generation.api(ItineraryPlanFacade). 이름 규칙(확정분
    // 동결 우선, INV-U1-03)은 저쪽이 소유하므로 poiId 를 받아 place-data 를 따로 묻지 않는다.
    implementation(project(":modules:itinerary-generation"))
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    // 아웃박스 payload(JSON 문자열)를 읽는다. 트리로만 읽으므로 Kotlin 모듈은 필요 없다.
    implementation(libs.jackson.module.kotlin)
    implementation(libs.jackson3.module.kotlin)         // AI 경계 매퍼(Jackson 3 = SB4 기본) — 회고·일정 경계와 같은 관례
    implementation(libs.kotlin.reflect)
    // 계측(OBS-U6-02·03·04)만 쓴다 — 레지스트리 구현·내보내기는 app 이 갖는다.
    implementation(libs.micrometer.core)

    testImplementation(project(":common:test-support"))
}

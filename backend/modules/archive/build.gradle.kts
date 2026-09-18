// modules/archive — C12 Travel Archive(U5 정본 `construction/u5-records-reflection/`).
// 방문 실적(`visit_check`)의 소유를 U4 재계획에서 넘겨받는다(DEC-U5-2) — 실적은 `actual` 계층이라
// 사진·메모·회고가 앞으로 여기에 붙는다. 재계획 모듈에 두면 그쪽이 기록 기능을 따라 계속 부풀고,
// 반대로 기록이 재계획을 되부르는 순환이 열린다(BR-U5-10).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))   // R1: 소유·구간 검증만 — trip.api(TripFacade)
    implementation(project(":modules:auth"))   // R1: 위치 동의(L3) 조회만 — auth.api(LocationConsentFacade)
    implementation(project(":modules:itinerary-generation"))  // R1: 계획 슬롯 조회만 — itinerarygeneration.api(ItineraryPlanFacade)
    implementation(project(":modules:saved-accommodation"))   // R1: 날짜별 기준 숙소만 — savedaccommodation.api(TripBaseStayFacade)
    implementation(project(":modules:change-log"))            // R1: 변경 이력 **읽기만**(BR-U5-29) — changelog.api
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}

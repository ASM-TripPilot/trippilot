// modules/itinerary-recalculation — C10 재계획(U4 정본 `construction/u4-in-trip-planb/`).
// 감지(C9 planb-detection)와 나눈 이유: 감지는 "알릴지"를 정하고 여기는 "무엇으로 바꿀지"를 정한다.
// 둘의 실패 모드가 달라(허위 알림 vs 잘못된 확정) 같은 모듈에 두면 한쪽 변경이 다른 쪽을 흔든다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))                   // R1: 소유·구간 검증 — trip.api
    implementation(project(":modules:itinerary-generation"))   // R1: 일정 요약 조회 — itinerarygeneration.api
    implementation(project(":modules:saved-accommodation")) // R1: 기준점 사다리의 숙소 앵커 — savedaccommodation.api
    implementation(project(":modules:place-data"))          // R1: 마지막 완료 방문지 좌표 — placedata.api
    implementation(project(":modules:archive"))             // R1: 방문 실적(잠금·마지막 방문지) — archive.api
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
}

// modules/reflection — C13 회고(U5 정본 `construction/u5-records-reflection/`).
// **방향은 한쪽뿐이다**: reflection → archive. archive 는 reflection 을 모른다(BR-U5-51) —
// 되부르면 "기록이 회고를 만들고, 회고가 기록을 읽는" 순환이 된다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))     // R1: 소유·기간 검증만 — trip.api(TripFacade)
    implementation(project(":modules:archive"))  // R1: 방문 실적 읽기만 — archive.api(ArchiveFacade)
    implementation(project(":modules:place-data")) // R1: 방문점 좌표(거리 근사) — placedata.api
    implementation(project(":modules:profile"))  // R1: 임계 미만 미리보기의 온보딩 취향 — profile.api
    implementation(project(":modules:auth"))     // R1: 개인화 동의 게이트 — auth.api(PersonalizationConsentFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)
    // 아웃박스 payload(JSON 문자열)를 읽는다. 트리로만 읽으므로 Kotlin 모듈은 필요 없다.
    implementation(libs.jackson.module.kotlin)
    implementation(libs.jackson3.module.kotlin)         // AI 경계 매퍼(Jackson 3 = SB4 기본) — 일정 경계와 같은 관례

    testImplementation(project(":common:test-support"))
}

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
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
